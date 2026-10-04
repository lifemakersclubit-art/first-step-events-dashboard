/* ==========================================================================
   app.js — Orchestrator. Boots the app, owns the refresh loop, derives the
   single executive context object, and hands it to the renderers.
   Contains no calculations and no markup.
   ========================================================================== */

const App = (function () {
  const VIEWS = ["overview", "events", "speed", "audience", "geography", "sources", "quality", "settings"];

  let state = {
    records: [],
    filtersBound: false,
    prevTotal: null,
    autoRefresh: true,
    interval: CONFIG.REFRESH_INTERVAL,
    nextRefreshAt: null,
    refreshCount: 0,
    loading: false,
    bucket: CONFIG.CHART_BUCKET,
    lastCtx: null,
  };

  /* ==================================================================
     CONTEXT — the one object every section renders from
     ================================================================== */
  function buildContext() {
    const now = new Date();
    const all = Data.get().records || state.records || [];
    const records = Filters.apply(all, now);

    const cfg = resolveEventConfig(Filters.state.event || CONFIG.EVENT.name || "");
    const target = cfg.target;

    /* ---- campaign window ---- */
    const bounds = records.length ? { first: records[0].ts, last: records[records.length - 1].ts } : null;
    const campaignStart = cfg.startsAt
      ? new Date(cfg.startsAt).getTime()
      : bounds ? bounds.first : now.getTime();
    const campaignEnd = cfg.endsAt
      ? new Date(cfg.endsAt).getTime()
      : cfg.startsAt
        ? now.getTime() + CONFIG.DEFAULT_CAMPAIGN_DAYS * Metrics.DAY
        : (bounds ? bounds.last : now.getTime()) + CONFIG.DEFAULT_CAMPAIGN_DAYS * Metrics.DAY;

    const total = Metrics.calculateTotalRegistrations(records);

    /* ---- response speed ---- */
    const last1h = Metrics.countInWindow(records, 1, now);
    const last3h = Metrics.countInWindow(records, 3, now);
    const last6h = Metrics.countInWindow(records, 6, now);
    const last12h = Metrics.countInWindow(records, 12, now);
    const last24h = Metrics.countInWindow(records, 24, now);
    const today = Metrics.countToday(records, now);
    const perHour = Metrics.calculateHourlyRate(records, now);
    const perDay = Metrics.calculateDailyRate(records, now);
    const velocity24 = Metrics.calculateRegistrationVelocity(records, 24, now);
    const velocityChange = Metrics.velocityChange(records, 24, now);
    velocityChange.label = "آخر 24 ساعة";

    /* ---- growth: last full day vs the one before ---- */
    let growth = null;
    if (records.length) {
      const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
      const todayCount = Metrics.countInWindow(records, (now - dayStart.getTime()) / Metrics.HOUR, now);
      const yStart = new Date(dayStart.getTime() - Metrics.DAY);
      const yEnd = new Date(dayStart.getTime() - 60000);
      const yCount = records.filter(function (r) { return r.ts > yStart.getTime() && r.ts <= yEnd.getTime(); }).length;
      growth = Metrics.calculateGrowthRate(todayCount, yCount);
    }

    /* ---- target & pace ---- */
    const achievement = Metrics.calculateAchievementRate(total, target);
    const remaining = Math.max(target - total, 0);
    const targetPace = Metrics.calculateTargetPace(target, campaignStart, campaignEnd, now);
    const currentPace = Metrics.calculateCurrentPace(records, 24, now);
    const paceGap = Metrics.paceGapPercent(currentPace, targetPace);
    const verdict = Metrics.paceVerdict(paceGap, CONFIG.THRESHOLDS.pace);
    const expectedByDate = Metrics.expectedToDate(target, campaignStart, campaignEnd, now);
    const gapCount = expectedByDate == null ? null : Math.max(0, Math.round(expectedByDate - total));
    const campaignHoursLeft = Math.max((campaignEnd - now.getTime()) / Metrics.HOUR, 0);

    /* ---- projection ---- */
    const projection = Metrics.calculateProjection(records, target, campaignEnd, now);

    /* ---- peaks ---- */
    const peakHour = Metrics.calculatePeakHour(records);
    const peakDay = Metrics.calculatePeakDay(records);

    /* ---- series ---- */
    const timeline = Metrics.buildTimeline(records, {
      now: now,
      bucket: state.bucket,
      target: target,
      campaignStart: new Date(campaignStart),
      campaignEnd: new Date(campaignEnd),
      from: Filters.state.from || (bounds ? bounds.first : null),
      to: Filters.state.to || null,
    });

    /* ---- distributions ---- */
    const quality = Metrics.calculateDataQuality(records);
    const qualityScore = quality.score;
    const qualityStatus =
      qualityScore == null ? "neutral"
        : qualityScore < CONFIG.THRESHOLDS.quality.critical ? "critical"
          : qualityScore < CONFIG.THRESHOLDS.quality.attention ? "attention" : "excellent";

    const events = Metrics.eventsComparison(records, now);

    const topGov = Metrics.distribution(records, function (r) { return r.governorate; }, { excludeUnknown: true, limit: 1 })[0] || null;
    const topSource = Metrics.distribution(records, function (r) { return r.eventSource; }, { excludeUnknown: true, limit: 1 })[0] || null;

    /* ---- freshness ---- */
    const staleMinutes = records.length
      ? Math.floor((now.getTime() - records[records.length - 1].ts) / 60000)
      : null;

    /* ---- window with the weakest velocity (for the intervention sentence) ---- */
    const windows = [
      { label: "آخر ساعة", v: last1h / 1 },
      { label: "آخر 3 ساعات", v: last3h / 3 },
      { label: "آخر 6 ساعات", v: last6h / 6 },
      { label: "آخر 24 ساعة", v: velocity24 },
    ].filter(function (w) { return w.v != null && isFinite(w.v); });
    const weakest = windows.length
      ? windows.slice().sort(function (a, b) { return a.v - b.v; })[0]
      : null;

    return {
      now: now,
      records: records,
      allRecords: all,
      eventName: Filters.state.event || cfg.name,
      target: target,
      total: total,
      remaining: remaining,
      achievement: achievement,
      achievementStatus: Metrics.achievementStatus(achievement),
      totalStatus: total === 0 ? "critical" : total < CONFIG.ALERT_RULES.lowTotalRegistrations ? "attention" : "neutral",

      today: today,
      todayStatus: velocity24 != null && velocity24 >= (targetPace || Infinity) ? "excellent" : targetPace != null && velocity24 < targetPace * 0.6 ? "critical" : "attention",
      last1h: last1h, last6h: last6h, last12h: last12h, last24h: last24h,
      velocity24: velocity24,
      vel24Status: thresholdFromVelocity(velocity24),
      vel1hStatus: thresholdFromVelocity(last1h),
      currentPace: currentPace,
      targetPace: targetPace,
      paceGap: paceGap,
      paceStatus: verdict,
      verdict: verdict,
      perHour: perHour,
      perDay: perDay,
      velocityChange: velocityChange,
      velocityChangeStatus:
        velocityChange.change == null ? "neutral"
          : velocityChange.change <= CONFIG.THRESHOLDS.velocityChange.critical ? "critical"
            : velocityChange.change <= CONFIG.THRESHOLDS.velocityChange.attention ? "attention"
              : velocityChange.change >= CONFIG.THRESHOLDS.velocityChange.positive ? "excellent" : "neutral",
      growth: growth,

      expectedByDate: expectedByDate,
      gapCount: gapCount,
      campaignHoursLeft: campaignHoursLeft,
      campaignEndsIn: campaignHoursLeft,
      lowestWindowLabel: weakest ? weakest.label : null,

      projection: projection,
      projectionStatus:
        !projection || projection.insufficient ? "neutral"
          : projection.willHitTarget ? "excellent" : "critical",

      peakHour: peakHour,
      peakDay: peakDay,
      timeline: timeline,
      events: events,
      quality: quality,
      qualityScore: qualityScore,
      qualityStatus: qualityStatus,
      qualityIssueCount: quality.issueCount,

      topGeo: topGov,
      topSource: topSource,
      staleMinutes: staleMinutes,
      filtered: (records && records.length) !== (all && all.length),
      allTotal: all.length,
    };
  }

  function thresholdFromVelocity(v) {
    if (v == null) return "neutral";
    const f = CONFIG.THRESHOLDS.velocityFloor;
    if (v < f.critical) return "critical";
    if (v < f.attention) return "attention";
    return "excellent";
  }

  /* ==================================================================
     RENDER
     ================================================================== */
  function render() {
    const ctx = buildContext();
    state.lastCtx = ctx;

    UI.renderHero(ctx);
    UI.renderSnapshot(ctx);
    UI.renderKpis(ctx);
    UI.renderVelocity(ctx);
    UI.renderTimeline(ctx);
    UI.renderHeatmap(ctx);
    UI.renderGeo(ctx);
    UI.renderSources(ctx);
    UI.renderAudience(ctx);
    UI.renderInterests(ctx);
    UI.renderVolunteers(ctx);
    UI.renderQuality(ctx);
    UI.renderEvents(ctx);
    renderAlertsFor(ctx);

    renderMeta(ctx);
    updateBadge(ctx);
  }

  function renderAlertsFor(ctx) {
    const list = Alerts.evaluate({
      total: ctx.total,
      target: ctx.target,
      achievement: ctx.achievement,
      remaining: ctx.remaining,
      currentPace: ctx.currentPace,
      targetPace: ctx.targetPace,
      paceGap: ctx.paceGap,
      gapCount: ctx.gapCount,
      velocityChange: ctx.velocityChange,
      staleMinutes: ctx.staleMinutes,
      qualityScore: ctx.qualityScore,
      campaignEndsIn: ctx.campaignEndsIn,
      newMilestone: Alerts.crossedMilestone(state.prevTotal == null ? ctx.total : state.prevTotal, ctx.total),
    });
    UI.renderAlerts(list);
    state.prevTotal = ctx.total;
  }

  function renderMeta(ctx) {
    const meta = Data.get().meta || {};
    const bits = [];
    if (ctx.filtered) bits.push("يعرض " + Fmt.int(ctx.total) + " من " + Fmt.int(ctx.allTotal) + " تسجيل");
    if (meta.unmappedColumns && meta.unmappedColumns.length) {
      bits.push("أعمدة غير معروفة: " + meta.unmappedColumns.length);
    }
    if (meta.skippedRows) bits.push("صفوف بدون تاريخ صالح: " + Fmt.int(meta.skippedRows));
    const el = UI.$("footer-stats");
    if (el) el.textContent = bits.join(" • ");
  }

  /* Small status dot in the brand mark reflecting overall health. */
  function updateBadge(ctx) {
    const worst =
      ctx.verdict === "critical" ? "critical"
        : ctx.verdict === "attention" ? "attention"
          : ctx.verdict === "excellent" ? "excellent" : "neutral";
    const el = UI.$("brand-status");
    if (el) {
      el.setAttribute("data-status", worst);
      el.title = "حالة عامة: " + (UI.STATUS_LABEL[worst] || "—");
    }
    const top = UI.$("top-status");
    if (top) {
      top.innerHTML = UI.icon(worst) + "<span>" + (UI.STATUS_LABEL[worst] || "") + "</span>";
      top.setAttribute("data-status", worst);
    }
  }

  /* ==================================================================
     LIVE STATUS
     ================================================================== */
  function renderLive() {
    const dataState = Data.get();
    let liveState = "live";
    let stateLabel = "مباشر";
    let text = "";

    if (CONFIG.DEMO_MODE) {
      liveState = "paused";
      stateLabel = "وضع تجريبي";
      text = "DEMO";
    } else if (dataState.error) {
      liveState = "error";
      stateLabel = "تعذر الاتصال";
      text = "—";
    } else if (dataState.cached) {
      liveState = "stale";
      stateLabel = "من الذاكرة";
      text = dataState.stale ? "قديم" : "مؤقت";
    } else {
      const age = dataState.updatedAt ? Date.now() - dataState.updatedAt : 0;
      if (age > CONFIG.CACHE_TTL * 4) {
        liveState = "stale";
        stateLabel = "قديم";
        text = Fmt.ago(dataState.updatedAt);
      } else {
        text = Fmt.ago(dataState.updatedAt);
      }
    }

    const countdown = state.nextRefreshAt ? Math.max(0, state.nextRefreshAt - Date.now()) : null;

    UI.renderLive({
      state: liveState,
      stateLabel: stateLabel,
      text: text,
      updatedLabel: dataState.updatedAt ? Fmt.date(new Date(dataState.updatedAt)) : "—",
      countdownLabel: state.autoRefresh && countdown != null ? "تحديث بعد " + Fmt.duration(countdown) : "التحديث التلقائي متوقف",
      busy: state.loading,
      sourceLabel:
        CONFIG.DEMO_MODE ? "بيانات تجريبية"
          : dataState.cached ? "ذاكرة مؤقتة"
            : "Google Sheet مباشر",
      sourceStatus: CONFIG.DEMO_MODE ? "attention" : dataState.cached ? "attention" : "excellent",
    });

    /* 1 Hz heartbeat — cheap, and never blocks the main thread */
    setTimeout(renderLive, 1000);
  }

  /* ==================================================================
     LOAD / REFRESH
     ================================================================== */
  function refresh(reason) {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    if (reason !== "boot") UI.showSkeleton(true);

    return Data.load()
      .then(function () {
        state.records = Data.get().records;
        state.refreshCount++;
        Filters.setRecords(state.records);
        Filters.bind();
        state.filtersBound = true;
        UI.hideError();
        state.loading = false;
        UI.showSkeleton(false);
        render();
      })
      .catch(function (err) {
        state.loading = false;
        UI.showSkeleton(false);
        UI.showError(err);
        renderEmptyShell(err);
      });
  }

  /** Keeps the frame usable when the API is down. */
  function renderEmptyShell(err) {
    const el = UI.$("footer-stats");
    if (el) {
      el.textContent = "تعذر تحميل البيانات — (" + ((err && err.message) || "خطأ") + ")";
    }
  }

  function scheduleNext() {
    clearTimeout(scheduleNext._t);
    if (!state.autoRefresh) {
      state.nextRefreshAt = null;
      return;
    }
    const jitter = Math.floor(Math.random() * CONFIG.REFRESH_JITTER);
    const wait = Math.max(state.interval + jitter, CONFIG.MIN_REFRESH_INTERVAL);
    state.nextRefreshAt = Date.now() + wait;
    scheduleNext._t = setTimeout(function () {
      refresh("auto").finally(scheduleNext);
    }, wait);
  }

  function setAutoRefresh(on) {
    state.autoRefresh = !!on;
    const sw = UI.$("set-auto");
    if (sw) sw.setAttribute("aria-checked", state.autoRefresh ? "true" : "false");
    scheduleNext();
  }

  /* ==================================================================
     NAVIGATION
     ================================================================== */
  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = "overview";
    VIEWS.forEach(function (v) {
      const el = UI.$("view-" + v);
      if (el) el.classList.toggle("is-active", v === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
      t.setAttribute("aria-selected", t.dataset.view === name ? "true" : "false");
    });
    if (window.location.hash !== "#" + name) {
      history.replaceState(null, "", "#" + name);
    }
    document.title = (name === "overview" ? "لوحة القيادة" : name) + " — مركز قيادة إيفنتات صناع الحياة";
    if (name === "overview") window.scrollTo({ top: 0, behavior: CONFIG.ANIMATE ? "smooth" : "auto" });
  }

  function bindNav() {
    const tabs = UI.$("tabs");
    if (tabs) {
      tabs.addEventListener("click", function (ev) {
        const t = ev.target.closest(".tab");
        if (t) showView(t.dataset.view);
      });
    }
    window.addEventListener("hashchange", function () {
      showView((window.location.hash || "#overview").slice(1));
    });

    /* velocity bucket switcher */
    const seg = UI.$("velocity-seg");
    if (seg) {
      seg.addEventListener("click", function (ev) {
        const b = ev.target.closest("button");
        if (!b || b.disabled) return;
        state.bucket = b.dataset.bucket;
        render();
      });
    }

    /* refresh button */
    const btn = UI.$("btn-refresh");
    if (btn) btn.addEventListener("click", function () { refresh("manual"); });

    /* filters */
    Filters.onChange(function () {
      render();
    });
  }

  /* ==================================================================
     SETTINGS
     ================================================================== */
  function bindSettings() {
    const sw = UI.$("set-auto");
    if (sw) {
      sw.onclick = function () { setAutoRefresh(!state.autoRefresh); };
      sw.setAttribute("role", "switch");
    }

    const anim = UI.$("set-animate");
    if (anim) {
      anim.onclick = function () {
        CONFIG.ANIMATE = !CONFIG.ANIMATE;
        anim.setAttribute("aria-checked", CONFIG.ANIMATE ? "true" : "false");
        render();
      };
    }

    const surface = UI.$("set-surface");
    if (surface) {
      surface.onclick = function () {
        CONFIG.SURFACE = CONFIG.SURFACE === "canvas" ? "paper" : "canvas";
        document.documentElement.setAttribute("data-surface", CONFIG.SURFACE);
        surface.querySelector("span").textContent = CONFIG.SURFACE === "canvas" ? "داكن" : "فاتح";
      };
    }

    const clearBtn = UI.$("set-clear-cache");
    if (clearBtn) {
      clearBtn.onclick = function () {
        Api.clearCache();
        clearBtn.textContent = "تم مسح الذاكرة المؤقتة";
        setTimeout(function () { clearBtn.textContent = "مسح الذاكرة المؤقتة"; }, 2200);
      };
    }

    const testBtn = UI.$("set-test");
    if (testBtn) {
      testBtn.onclick = function () {
        const out = UI.$("set-test-out");
        if (!out) return;
        if (CONFIG.DEMO_MODE) {
          out.textContent = "وضع تجريبي — لا يوجد اتصال. اضبط DEMO_MODE = false وأضف API_URL.";
          return;
        }
        out.textContent = "جارٍ الاختبار…";
        testBtn.classList.add("is-busy");
        Api.ping()
          .then(function (r) {
            out.textContent = "الاتصال ناجح • وقت الخادم: " + (r.serverTime ? Fmt.date(new Date(r.serverTime)) : "—");
          })
          .catch(function (e) {
            out.textContent = "فشل الاتصال: " + e.message;
          })
          .finally(function () { testBtn.classList.remove("is-busy"); });
      };
    }

    /* runtime info + metric definitions */
    renderSettingsInfo();
  }

  function renderSettingsInfo() {
    const info = UI.$("set-info");
    if (!info) return;
    const meta = Data.get().meta || {};
    const lines = [
      "الوضع: " + (CONFIG.DEMO_MODE ? "DEMO_MODE = true (بيانات تجريبية)" : "API مباشر"),
      "عدد السجلات: " + Fmt.int(state.records.length),
      "تحديث تلقائي: كل " + Fmt.duration(state.interval) + " (" + (state.autoRefresh ? "مفعّل" : "متوقف") + ")",
      "عدد مرات التحديث: " + Fmt.int(state.refreshCount),
      "ذاكرة مؤقتة: " + (Api.readCache() ? "متوفرة" : "لا يوجد"),
    ];
    if (meta.mappedColumns) {
      lines.push("أعمدة معرَّفة: " + meta.mappedColumns.length);
    }
    if (meta.unmappedColumns && meta.unmappedColumns.length) {
      lines.push("أعمدة غير معرَّفة: " + meta.unmappedColumns.join("، "));
    }
    if (meta.skippedRows) {
      lines.push("صفوف تم استبعادها (تاريخ غير صالح): " + meta.skippedRows);
    }
    info.innerHTML = lines.map(function (l) { return Insights.esc(l); }).join("\n");
  }

  /* ==================================================================
     BOOT
     ================================================================== */
  function boot() {
    document.documentElement.setAttribute("data-surface", CONFIG.SURFACE);
    document.documentElement.setAttribute("dir", "rtl");

    bindNav();
    bindSettings();
    showView((window.location.hash || "#overview").slice(1));
    requestAnimationFrame(renderLive);

    return refresh("boot")
      .then(function () {
        renderSettingsInfo();
        scheduleNext();
      });
  }

  return {
    boot: boot,
    refresh: refresh,
    render: render,
    setAutoRefresh: setAutoRefresh,
    showView: showView,
    buildContext: buildContext,
    getState: function () { return state; },
  };
})();

window.App = App;

/* ------------------------------------------------------------------ */
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("DOMContentLoaded", function () {
    App.boot().catch(function (err) {
      UI.showError(err);
      UI.showSkeleton(false);
    });
  });
}