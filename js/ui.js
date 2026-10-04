/* ==========================================================================
   ui.js — Rendering layer. Pure "state in → DOM out".
   Every renderer is defensive: missing data yields a graceful empty state,
   never NaN, never undefined, never a misleading zero.
   ========================================================================== */

const UI = (function () {
  const $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------
     Icons
     ------------------------------------------------------------------ */
  const ICONS = {
    excellent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 17 10 11l4 4 6-7"/><path d="M20 8v6h-6"/></svg>',
    attention: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v9m0 4v.5M12 3 2 21h20L12 3Z"/></svg>',
    critical: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v9m0 4v.5M12 2 1 21h22L12 2Z"/></svg>',
    neutral: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    up: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 19V6M6 12l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v13M6 12l6 6 6-6"/></svg>',
    flat: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  };

  const STATUS_LABEL = {
    excellent: "ممتاز",
    attention: "يحتاج انتباه",
    critical: "حرج",
    neutral: "على المسار",
  };

  function icon(name) {
    return ICONS[name] || ICONS.neutral;
  }

  /* ------------------------------------------------------------------
     Count-up micro interaction
     ------------------------------------------------------------------ */
  const prevValues = new Map();

  function countUp(el, to, opts) {
    if (!el) return;
    const o = opts || {};
    const format = o.format || Fmt.int;
    if (!CONFIG.ANIMATE || o.instant || to == null || !isFinite(to)) {
      prevValues.set(el, to);
      el.textContent = format(to);
      return;
    }
    const from = typeof prevValues.get(el) === "number" ? prevValues.get(el) : 0;
    prevValues.set(el, to);
    if (from === to) { el.textContent = format(to); return; }

    const dur = 780;
    const t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------------
     Small builders
     ------------------------------------------------------------------ */
  function esc(s) {
    return Insights.esc(s);
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function statRow(label, value, extraClass) {
    return '<div class="statrow"><span>' + esc(label) + "</span><b class='" + (extraClass || "") + "'>" + value + "</b></div>";
  }

  function emptyBox(title, hint) {
    return (
      '<div class="empty"><div class="empty__title">' + esc(title) + "</div>" +
      (hint ? '<div class="empty__hint">' + esc(hint) + "</div>" : "") + "</div>"
    );
  }

  function panel(id) { return $(id); }

  /* ------------------------------------------------------------------
     Dual-target helper — the focused tabs reuse the same renderers.
     Overview owns id "x"; the dedicated view owns "x-2".
     ------------------------------------------------------------------ */
  function each(baseId, fn) {
    [$(baseId), $(baseId + "-2")].forEach(function (node) {
      if (node) {
        try { fn(node); } catch (e) { console.error("[UI.each:" + baseId + "]", e); }
      }
    });
  }

  function setTextEach(baseId, text) {
    each(baseId, function (n) { n.textContent = text; });
  }

  /* ==================================================================
     1. HERO — response speed
     ================================================================== */
  function renderHero(ctx) {
    const pace = panel("pace");
    if (pace) pace.setAttribute("data-status", ctx.verdict || "neutral");

    setText($("hero-event-name"), ctx.eventName);
    setText($("hero-total-reg"), ctx.total != null ? Fmt.int(ctx.total) : "—");
    setText($("pace-number"), Fmt.dec(ctx.currentPace, 1));
    setText($("pace-unit-label"), "تسجيل / ساعة");
    setText($("pace-avg"), ctx.perHour != null ? "متوسط الحملة " + Fmt.dec(ctx.perHour, 1) + " / ساعة" : "");

    const v = $("pace-verdict");
    if (v) {
      v.innerHTML = icon(ctx.verdict || "neutral") + "<span>" + (STATUS_LABEL[ctx.verdict] || "—") + "</span>";
    }

    /* ---- 4 response-speed stats ---- */
    const stats = $("hero-stats");
    if (stats) {
      const rows = [
        ["آخر ساعة", ctx.last1h],
        ["آخر 6 ساعات", ctx.last6h],
        ["آخر 12 ساعة", ctx.last12h],
        ["آخر 24 ساعة", ctx.last24h],
      ];
      stats.innerHTML = rows
        .map(function (r) {
          return (
            '<div class="hero__stat"><span class="hero__stat-val num">' + Fmt.int(r[1]) + "</span>" +
            '<span class="hero__stat-lbl">' + r[0] + "</span></div>"
          );
        })
        .join("");
    }

    /* ---- hour ruler ---- */
    const ruler = $("hero-ruler");
    if (ruler) {
      const buckets = ctx.peakHour && ctx.peakHour.buckets ? ctx.peakHour.buckets : new Array(24).fill(0);
      const max = Math.max.apply(null, buckets.concat([1]));
      const peak = ctx.peakHour ? ctx.peakHour.hour : -1;
      let html = '<div class="ruler__ticks">';
      for (let h = 0; h < 24; h++) {
        const pct = (buckets[h] / max) * 100;
        html +=
          '<div class="ruler__tick" data-peak="' + (h === peak ? 1 : 0) + '" title="' +
          Metrics.hourLabel(h) + ": " + buckets[h] + '">' +
          '<i class="ruler__bar" style="height:' + Math.max(pct, 2) + '%"></i></div>';
      }
      html += "</div><div class='ruler__hours'>";
      for (let h = 0; h < 24; h += 3) {
        html += '<span class="ruler__hour" data-peak="' + (h === peak ? 1 : 0) + '">' + String(h).padStart(2, "0") + "</span>";
        if (h + 3 < 24) html += '<span class="ruler__hour"></span><span class="ruler__hour"></span>';
      }
      html += "</div>";
      ruler.innerHTML = html;
    }
  }

  /* ==================================================================
     2. EXECUTIVE SNAPSHOT
     ================================================================== */
  function renderSnapshot(ctx) {
    const out = Insights.snapshot(ctx);
    const host = $("snapshot-text");
    if (host) host.innerHTML = out.html;

    const chips = $("snapshot-chips");
    if (chips) {
      chips.innerHTML = out.chips
        .map(function (c) { return '<span class="chip">' + esc(c[0]) + " <b>" + c[1] + "</b></span>"; })
        .join("");
    }
  }

  /* ==================================================================
     3. KPI CARDS
     ================================================================== */
  function kpiCard(o) {
    return (
      '<article class="kpi' + (o.hero ? " kpi--hero" : "") + (o.tall ? " kpi--tall" : "") +
      '" data-status="' + (o.status || "neutral") + '">' +
      '<span class="kpi__lbl">' + o.icon + esc(o.label) + "</span>" +
      '<b class="kpi__val' + (o.small ? " kpi__val--sm" : "") + '">' + o.value + "</b>" +
      (o.bar != null ? '<span class="kpi__bar"><i style="width:' + o.bar + '%"></i></span>' : "") +
      '<span class="kpi__foot">' +
      (o.trend || "") +
      (o.foot ? '<span class="kpi__expl">' + o.foot + "</span>" : "") +
      "</span></article>"
    );
  }

  function trendChip(value, suffix) {
    if (value == null || !isFinite(value)) return '<span class="kpi__trend" data-dir="flat">—</span>';
    const dir = value > 0.5 ? "up" : value < -0.5 ? "down" : "flat";
    const ic = dir === "up" ? ICONS.up : dir === "down" ? ICONS.down : ICONS.flat;
    return '<span class="kpi__trend" data-dir="' + dir + '">' + ic + (Fmt.signedPct(value)) + "</span>";
  }

  function renderKpis(ctx) {
    const groupA = [
      kpiCard({
        label: "إجمالي التسجيلات", value: Fmt.int(ctx.total), icon: icon("neutral"),
        status: ctx.totalStatus, foot: "منذ بداية الحملة",
        trend: ctx.growth != null ? trendChip(ctx.growth) : "",
      }),
      kpiCard({
        label: "تسجيلات اليوم", value: Fmt.int(ctx.today), icon: icon(ctx.todayStatus || "neutral"),
        status: ctx.todayStatus, foot: "منذ منتصف الليل",
      }),
      kpiCard({
        label: "آخر 24 ساعة", value: Fmt.int(ctx.last24h), icon: icon("neutral"),
        status: ctx.vel24Status, foot: Fmt.dec(ctx.velocity24, 1) + " / ساعة",
        trend: ctx.velocityChange && ctx.velocityChange.change != null ? trendChip(ctx.velocityChange.change) : "",
      }),
      kpiCard({
        label: "آخر ساعة", value: Fmt.int(ctx.last1h), icon: icon(ctx.vel1hStatus || "neutral"),
        status: ctx.vel1hStatus, foot: "مقارنة بالمتوسط " + Fmt.dec(ctx.perHour, 1) + " / ساعة",
      }),
    ];

    const groupB = [
      kpiCard({
        label: "متوسط التسجيل / ساعة", value: Fmt.dec(ctx.perHour, 1), icon: icon("neutral"),
        status: ctx.paceStatus, small: true,
        foot: "متوسط " + Fmt.dec(ctx.perDay, 1) + " تسجيل / يوم",
      }),
      kpiCard({
        label: "آخر 6 ساعات", value: Fmt.int(ctx.last6h), icon: icon("neutral"), small: true,
        foot: Fmt.dec(ctx.last6h / 6, 1) + " / ساعة",
      }),
      kpiCard({
        label: "آخر 12 ساعة", value: Fmt.int(ctx.last12h), icon: icon("neutral"), small: true,
        foot: Fmt.dec(ctx.last12h / 12, 1) + " / ساعة",
      }),
      kpiCard({
        label: "تغيّر سرعة التسجيل",
        value: ctx.velocityChange && ctx.velocityChange.change != null ? Fmt.signedPct(ctx.velocityChange.change) : "—",
        icon: icon(ctx.velocityChangeStatus), status: ctx.velocityChangeStatus, small: true,
        trend: ctx.velocityChange && ctx.velocityChange.change != null ? trendChip(ctx.velocityChange.change) : "",
        foot: "مقارنة بـ" + (ctx.velocityChange ? ctx.velocityChange.label : "الفترة السابقة"),
      }),
      kpiCard({
        label: "ذروة التسجيل اليومية", value: ctx.peakDay ? Fmt.int(ctx.peakDay.count) : "—",
        icon: icon("neutral"), small: true,
        foot: ctx.peakDay && ctx.peakDay.label ? esc(ctx.peakDay.label) : "لا توجد بيانات",
      }),
      kpiCard({
        label: "أعلى ساعة استجابة", value: ctx.peakHour && ctx.peakHour.label ? esc(ctx.peakHour.label) : "—",
        icon: icon("neutral"), small: true,
        foot: ctx.peakHour ? Fmt.int(ctx.peakHour.count) + " تسجيل" : "لا توجد بيانات",
      }),
      kpiCard({
        label: "جودة البيانات", value: ctx.qualityScore != null ? Fmt.pct(ctx.qualityScore, 1) : "—",
        icon: icon(ctx.qualityStatus), status: ctx.qualityStatus, small: true,
        bar: ctx.qualityScore,
        foot: ctx.qualityIssueCount != null ? ctx.qualityIssueCount + " نوع خلل مكتشف" : "لا توجد بيانات",
      }),
    ];

    const a = $("kpi-group-a");
    if (a) a.innerHTML = groupA.join("");
    const b = $("kpi-group-b");
    if (b) b.innerHTML = groupB.join("");
    const s = $("kpi-group-speed");
    if (s) s.innerHTML = groupB.concat(groupA.slice(0, 2)).join("");

    /* pace comparison block */
    each("pace-compare", function (paceBox) {
      if (ctx.currentPace == null || ctx.targetPace == null) {
        paceBox.innerHTML = emptyBox("لا توجد بيانات كافية لتحديد المسار المطلوب");
        return;
      }
      const max = Math.max(ctx.currentPace, ctx.targetPace) * 1.2;
      const bar = function (label, value, color, note) {
        const status = color === "var(--c-excellent)" ? "excellent" : color === "var(--c-critical)" ? "critical" : "attention";
        return (
          '<div class="issue" data-status="' + status + '">' +
          '<span class="issue__flag" style="background:' + color + '"></span>' +
          '<span class="issue__name">' + esc(label) + (note ? ' <span class="micro">' + esc(note) + "</span>" : "") + "</span>" +
          '<span class="issue__val">' + Fmt.dec(value, 1) + " /س</span>" +
          '<span class="minibar" style="width:96px"><i style="width:' + Math.min(100, (value / max) * 100) + '%"></i></span>' +
          "</div>"
        );
      };
      paceBox.innerHTML =
        bar("المعدل المطلوب للوصول للهدف", ctx.targetPace, "var(--brand-400)", "مستهدف " + Fmt.int(ctx.target)) +
        bar("المعدل الفعلي الآن", ctx.currentPace,
          ctx.paceStatus === "excellent" ? "var(--c-excellent)" : ctx.paceStatus === "critical" ? "var(--c-critical)" : "var(--c-attention)",
          "متوسط " + Fmt.dec(ctx.perHour, 1) + " /س") +
        (ctx.paceGap != null
          ? '<div class="issue"><span class="issue__flag" style="background:var(--ink-3)"></span>' +
            '<span class="issue__name">الفجوة عن المسار المطلوب</span>' +
            '<span class="issue__val">' + Fmt.signedPct(ctx.paceGap) + "</span></div>"
          : "");
    });
  }

  /* ==================================================================
     4. VELOCITY CHART + TIMELINE
     ================================================================== */
  function renderVelocity(ctx) {
    const series = ctx.timeline.series;
    if (!series.length) {
      each("velocity-chart", function (n) {
        Charts.emptyState(n, "لا توجد بيانات خلال هذه الفترة", "وسّع نطاق التاريخ أو أزل بعض الفلاتر");
      });
      return;
    }

    const data = series.map(function (p) {
      return { label: p.label, fullLabel: p.fullLabel, value: p.count, expected: p.expected };
    });
    let peakIndex = 0;
    data.forEach(function (d, i) { if (d.value > data[peakIndex].value) peakIndex = i; });

    const color = ctx.verdict === "critical" ? "var(--crit-400)"
      : ctx.verdict === "attention" ? "var(--amber-500)"
      : "var(--brand-400)";

    each("velocity-chart", function (host) {
      try {
        Charts.line(host, data, {
          height: ctx.timeline.mode === "hour" ? 300 : 290,
          statusColor: color,
          peakIndex: peakIndex,
        });
      } catch (e) {
        Charts.emptyState(host, "تعذر رسم الرسم البياني");
      }
    });

    /* bucket switcher labels */
    const mode = ctx.timeline.mode;
    ["velocity-seg", "velocity-seg-2"].forEach(function (id) {
      const seg = $(id);
      if (!seg) return;
      Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
        const match = b.dataset.bucket === mode;
        b.setAttribute("aria-pressed", match ? "true" : "false");
        b.disabled = !match && b.dataset.bucket !== "auto";
      });
    });
    setText($("velocity-mode-note"), mode === "hour" ? "عرض بالساعة" : mode === "day" ? "عرض باليوم" : "عرض بالأسبوع");
  }

  function renderTimeline(ctx) {
    each("timeline-list", function (host) {
      const series = ctx.timeline.series.slice(-16);
      if (!series.length) {
        host.innerHTML = emptyBox("لا توجد بيانات خلال هذه الفترة");
        return;
      }
      const max = Math.max.apply(null, series.map(function (p) { return p.count; }).concat([1]));
      const peak = Math.max.apply(null, series.map(function (p) { return p.count; }));

      host.innerHTML = series
        .map(function (p) {
          const isPeak = p.count === peak && p.count > 0;
          return (
            '<div class="barrow' + (isPeak ? " barrow--amber" : "") + '"' + (isPeak ? ' data-status="attention"' : "") + ">" +
            '<div class="barrow__name"><span class="num">' + esc(p.label) + "</span></div>" +
            '<div class="barrow__track"><i class="barrow__fill" style="width:' + Math.max((p.count / max) * 100, p.count ? 3 : 0) + '%"></i></div>' +
            '<div class="barrow__val"><span class="num">' + Fmt.int(p.count) + "</span>" +
            '<span class="barrow__pct">' + Fmt.int(p.cumulative) + " تراكمي</span></div></div>"
          );
        })
        .join("");
    });

    setTextEach("timeline-peak",
      ctx.timeline.series.length
        ? "أعلى نقطة: " + Fmt.int(Math.max.apply(null, ctx.timeline.series.map(function (p) { return p.count; }).concat([0]))) + " تسجيل"
        : "لا توجد بيانات");
  }

  function renderHeatmap(ctx) {
    const hm = Metrics.buildHeatmap(ctx.records, 24);
    if (!hm.total) {
      each("heatmap", function (n) { n.innerHTML = emptyBox("لا توجد بيانات كافية لخريطة الحرارة"); });
      return;
    }

    const cells = ["<div></div>"];
    for (let h = 0; h < 24; h += 2) {
      cells.push('<div class="heat__lbl">' + String(h).padStart(2, "0") + "</div>");
    }
    for (let d = 0; d < 7; d++) {
      cells.push('<div class="heat__lbl">' + Metrics.AR_DAYS[d].replace("ال", "") + "</div>");
      for (let h = 0; h < 24; h++) {
        const v = hm.grid[d][h];
        const ratio = v / Math.max(hm.max, 1);
        let bg = "var(--surface-2)";
        if (v > 0) {
          const alpha = (0.12 + ratio * 0.8).toFixed(2);
          bg = ratio > 0.66 ? "rgba(251,174,66," + alpha + ")"
            : ratio > 0.33 ? "rgba(27,127,184," + alpha + ")"
            : "rgba(74,163,212," + alpha + ")";
        }
        cells.push(
          '<div class="heat__cell" data-v="' + v + '" style="background:' + bg + '" title="' +
          Metrics.AR_DAYS[d] + " " + String(h).padStart(2, "0") + ": " + v + '"></div>'
        );
      }
    }

    each("heatmap", function (host) {
      host.className = "heat";
      host.style.gridTemplateColumns = "44px repeat(12, minmax(0, 1fr))";
      host.style.direction = "ltr";
      host.innerHTML = cells.join("");
    });

    const dayTotals = hm.grid.map(function (row) { return row.reduce(function (a, b) { return a + b; }, 0); });
    const bestDay = dayTotals.indexOf(Math.max.apply(null, dayTotals));
    setTextEach("heatmap-note",
      "أعلى يوم: " + Metrics.AR_DAYS[bestDay] + " (" + Fmt.int(dayTotals[bestDay]) + " تسجيل) • الذروة: " +
      (ctx.peakHour && ctx.peakHour.label ? ctx.peakHour.label : "—"));
  }

  /* ==================================================================
     5. ALERTS
     ================================================================== */
  function renderAlerts(list) {
    each("alerts-list", function (host) {
      if (!list.length) {
        host.className = "alerts--empty";
        host.textContent = "لا توجد تنبيهات — كل المؤشرات ضمن الحدود الآمنة.";
        return;
      }
      host.className = "alerts";
      host.innerHTML = list
        .map(function (a, i) {
          const meta = Alerts.META[a.type] || Alerts.META.info;
          const st = meta.label === "حرج" ? "critical"
            : meta.label === "تحذير" ? "attention"
              : "excellent";
          return (
            '<div class="alert" data-status="' + st + '" style="--i:' + i + '">' +
            '<span class="alert__badge">' +
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="' + meta.icon + '"/></svg>' +
            meta.label + "</span>" +
            '<div class="alert__body"><b>' + esc(a.title) + "</b> — " + esc(a.detail) + "</div>" +
            '<span class="alert__time">' + Fmt.time(new Date(a.at)) + "</span></div>"
          );
        })
        .join("");
    });
  }

  /* ==================================================================
     6. GEOGRAPHY
     ================================================================== */
  function renderGeo(ctx) {
    const gov = Metrics.distribution(ctx.records, function (r) { return r.governorate; }, { excludeUnknown: true, limit: 10 });
    const uni = Metrics.distribution(ctx.records, function (r) { return r.university; }, { excludeUnknown: true, limit: 12 });
    const col = Metrics.distribution(ctx.records, function (r) { return r.college; }, { excludeUnknown: true, limit: 12 });

    each("geo-university", function (n) { Charts.bars(n, uni, { rank: true }); });
    each("geo-governorate", function (n) { Charts.bars(n, gov, { rank: true }); });
    each("geo-college", function (n) { Charts.bars(n, col, { limit: 12 }); });
    setTextEach("geo-subtitle", Insights.geoSubtitle(ctx.records));

    each("geo-stats", function (n) {
      const covered = Metrics.facets(ctx.records, "governorate").length;
      const unis = Metrics.facets(ctx.records, "university").length;
      n.innerHTML =
        statRow("محافظات مغطاة", Fmt.int(covered)) +
        statRow("جامعات / كليات", Fmt.int(unis)) +
        statRow("أعلى محافظة", gov.length ? gov[0].label : "—") +
        statRow("نسبة أعلى محافظة", gov.length ? Fmt.pct(gov[0].pct) : "—");
    });
  }

  /* ==================================================================
     7. MARKETING SOURCES
     ================================================================== */
  function renderSources(ctx) {
    const src = Metrics.distribution(ctx.records, function (r) { return r.eventSource; }, { excludeUnknown: true, limit: 9 });
    const disc = Metrics.distribution(ctx.records, function (r) { return r.discoveryChannel; }, { excludeUnknown: true, limit: 8 });

    each("sources-list", function (n) { Charts.bars(n, src, { rank: true, amber: true }); });
    each("sources-strip", function (n) { Charts.strip(n, src); });
    each("discovery-list", function (n) { Charts.bars(n, disc, { rank: true, limit: 8 }); });
    setTextEach("sources-subtitle", Insights.sourceSubtitle(ctx.records));

    each("source-efficiency", function (host) {
      const rows = Metrics.crossTab(
        ctx.records,
        function (r) { return r.eventSource || "غير محدد"; },
        function (r) { return r.volunteer === "yes" ? "متطوع" : "غير متطوع"; },
        10
      );
      if (!rows.length) { host.innerHTML = emptyBox("لا توجد بيانات"); return; }
      const hosts = Metrics.facets(ctx.records, "eventSource");
      host.innerHTML = '<div class="statlist">' + hosts.slice(0, 7).map(function (h) {
        const vol = rows.filter(function (r) { return r.a === h && r.b === "متطوع"; }).reduce(function (a, r) { return a + r.count; }, 0);
        const non = rows.filter(function (r) { return r.a === h && r.b === "غير متطوع"; }).reduce(function (a, r) { return a + r.count; }, 0);
        const tot = vol + non;
        return statRow(h, tot ? Fmt.pct((vol / tot) * 100, 0) + " متطوع" : "—");
      }).join("") + "</div>";
    });
  }

  /* ==================================================================
     8. AUDIENCE PROFILE
     ================================================================== */
  function renderAudience(ctx) {
    const gender = Metrics.distribution(ctx.records, function (r) { return r.gender; }, { excludeUnknown: true, limit: 4 });
    const genderForDonut = gender.map(function (g, i) {
      return { label: g.label, count: g.count, color: i === 0 ? "var(--amber-500)" : "var(--brand-400)" };
    });
    each("aud-gender", function (fig) {
      Charts.donut(fig, genderForDonut, { centerValue: Fmt.int(ctx.total), centerLabel: "مشارك" });
      const list = document.createElement("div");
      list.className = "donut__list";
      list.innerHTML = gender.map(function (g) {
        return '<div class="donut__item"><span class="swatch" style="background:' +
          genderColor(g.label) + '"></span><span>' + esc(genderLabel(g.label)) + '</span><b>' + Fmt.int(g.count) + "</b>" +
          '<span class="micro">' + Fmt.pct(g.pct) + "</span></div>";
      }).join("") || emptyBox("لا توجد بيانات");
      fig.appendChild(list);
    });

    /* age */
    const age = Metrics.ageDistribution(ctx.records);
    each("aud-age", function (n) { Charts.columns(n, age, { height: 200 }); });
    const st = Metrics.stats(ctx.records.map(function (r) { return r.age; }));
    const topBucket = age.filter(function (r) { return r.count; })
      .sort(function (a, b) { return b.count - a.count; })[0];
    each("aud-age-stats", function (n) {
      n.innerHTML =
        statRow("متوسط السن", st.avg != null ? Fmt.dec(st.avg, 1) + " سنة" : "—") +
        statRow("أصغر / أكبر", st.min != null ? st.min + " / " + st.max : "—") +
        statRow("الفئة الأكثر حضورًا", topBucket ? topBucket.label : "—");
    });

    /* student vs graduate */
    const statusRows = Metrics.distribution(ctx.records, function (r) { return r.studentStatus; }, { excludeUnknown: true, limit: 4 });
    each("aud-status", function (n) {
      n.innerHTML = statusRows.length
        ? '<div class="statlist">' + statusRows.map(function (r) {
            return statRow(statusLabel(r.label), Fmt.int(r.count) + "  (" + Fmt.pct(r.pct) + ")");
          }).join("") + "</div>"
        : emptyBox("لا توجد بيانات");
    });

    /* academic year */
    const yearRows = Metrics.distribution(ctx.records, function (r) { return r.academicYear; }, { limit: 8 });
    each("aud-year", function (n) { Charts.bars(n, yearRows, { limit: 8 }); });

    /* colleges */
    const colRows = Metrics.distribution(ctx.records, function (r) { return r.college; }, { excludeUnknown: true, limit: 10 });
    each("aud-college", function (n) { Charts.bars(n, colRows, { rank: true, limit: 10 }); });

    setTextEach("aud-subtitle", Insights.audienceSubtitle(ctx.records));
  }

  function genderColor(label) {
    if (label === "male") return "var(--amber-500)";
    if (label === "female") return "var(--brand-400)";
    return "var(--ink-3)";
  }

  function genderLabel(v) {
    return v === "male" ? "ذكور" : v === "female" ? "إناث" : v || "غير محدد";
  }
  function statusLabel(v) {
    return v === "student" ? "طالب" : v === "graduate" ? "خريج" : v || "غير محدد";
  }

  /* ==================================================================
     9. INTERESTS / GOALS / EXPECTATIONS
     ================================================================== */
  function renderInterests(ctx) {
    const interest = Metrics.distribution(ctx.records, function (r) { return r.interest; }, { excludeUnknown: true, limit: 8 });
    const goal = Metrics.distribution(ctx.records, function (r) { return r.goal; }, { excludeUnknown: true, limit: 8 });
    const expect = Metrics.distribution(ctx.records, function (r) { return r.expectation; }, { excludeUnknown: true, limit: 8 });

    each("interest-list", function (n) { Charts.bars(n, interest, { rank: true, amber: true, limit: 8 }); });
    each("goal-list", function (n) { Charts.bars(n, goal, { rank: true, limit: 8 }); });
    each("expect-list", function (n) { Charts.bars(n, expect, { rank: true, limit: 8 }); });

    const lead = interest[0];
    setTextEach("interest-lead", lead
      ? "المجال الأكثر جذبًا: " + lead.label + " — " + Fmt.int(lead.count) + " مشارك (" + Fmt.pct(lead.pct) + ")."
      : "لا توجد بيانات كافية");

    const eLead = expect[0];
    setTextEach("expect-lead", eLead
      ? "أكثر ما يريده المشاركون: " + eLead.label + " (" + Fmt.pct(eLead.pct) + ")."
      : "لا توجد بيانات كافية");
  }

  /* ==================================================================
     10. VOLUNTEERS
     ================================================================== */
  function renderVolunteers(ctx) {
    const vol = Metrics.distribution(ctx.records, function (r) { return r.volunteer; }, { excludeUnknown: true, limit: 3 });
    const total = vol.reduce(function (a, v) { return a + v.count; }, 0);

    each("vol-donut", function (fig) {
      Charts.donut(fig, vol.map(function (v, i) {
        return {
          label: v.label === "yes" ? "متطوع" : "غير متطوع",
          count: v.count,
          color: i === 0 ? "var(--amber-500)" : "var(--brand-400)",
        };
      }), { centerValue: Fmt.int(total), centerLabel: "إجابة" });

      const list = document.createElement("div");
      list.className = "donut__list";
      list.innerHTML = vol.map(function (v) {
        return '<div class="donut__item"><span class="swatch" style="background:' +
          (v.label === "yes" ? "var(--amber-500)" : "var(--brand-400)") + '"></span><span>' +
          (v.label === "yes" ? "متطوع حاليًا" : "ليس متطوعًا") + "</span><b>" + Fmt.int(v.count) + "</b>" +
          '<span class="micro">' + Fmt.pct(v.pct) + "</span></div>";
      }).join("") || emptyBox("لا توجد بيانات");
      fig.appendChild(list);
    });

    each("vol-cross", function (cross) {
      const rows = Metrics.crossTab(
        ctx.records,
        function (r) { return r.volunteer === "yes" ? "متطوع" : "غير متطوع"; },
        function (r) { return r.eventSource || "غير محدد"; },
        20
      );
      if (!rows.length) { cross.innerHTML = emptyBox("لا توجد بيانات"); return; }
      const aVals = ["متطوع", "غير متطوع"];
      const bVals = Metrics.facets(ctx.records, "eventSource").slice(0, 6);
      let html = '<div class="table-wrap"><table class="data" style="min-width:520px"><thead><tr><th>المصدر</th>';
      aVals.forEach(function (a) { html += "<th>" + esc(a) + "</th>"; });
      html += "<th>الإجمالي</th></tr></thead><tbody>";
      bVals.forEach(function (b) {
        const cells = aVals.map(function (a) {
          return rows.filter(function (r) { return r.a === a && r.b === b; }).reduce(function (s, r) { return s + r.count; }, 0);
        });
        const tot = cells.reduce(function (s, v) { return s + v; }, 0);
        html += "<tr><td>" + esc(b) + "</td>" +
          cells.map(function (v) {
            const share = tot ? (v / tot) * 100 : 0;
            const st = share > 45 ? "excellent" : share < 20 ? "critical" : "neutral";
            return '<td><span class="minibar" data-status="' + st + '"><i style="width:' + Math.min(100, share) + '%"></i></span><span class="num">' + Fmt.int(v) + "</span></td>";
          }).join("") +
          '<td class="n">' + Fmt.int(tot) + "</td></tr>";
      });
      html += "</tbody></table></div>";
      cross.innerHTML = html;
    });
  }

  /* ==================================================================
     11. DATA QUALITY
     ================================================================== */
  function renderQuality(ctx) {
    const dq = ctx.quality;

    each("quality-score", function (node) {
      node.textContent = dq.score == null ? "—" : Fmt.pct(dq.score, 1);
      node.setAttribute("data-status", ctx.qualityStatus);
    });
    each("quality-bar", function (bar) {
      bar.setAttribute("data-status", ctx.qualityStatus);
      const fill = bar.querySelector(".bar__actual");
      if (fill) fill.style.width = (dq.score == null ? 0 : dq.score) + "%";
    });
    setTextEach("quality-subtitle", Insights.qualitySubtitle(dq));

    each("quality-issues", function (n) {
      n.innerHTML = !dq.issues.length
        ? emptyBox("لا توجد مشكلات في البيانات", "جودة البيانات ممتازة")
        : dq.issues.map(function (i) {
            return (
              '<div class="issue" data-status="' + i.severity + '">' +
              '<span class="issue__flag"></span>' +
              '<span class="issue__name">' + esc(i.label) + "</span>" +
              '<span class="issue__val">' + Fmt.int(i.count) + "</span>" +
              '<span class="barrow__pct">' + Fmt.pct(i.pct) + "</span></div>"
            );
          }).join("");
    });

    each("quality-summary", function (n) {
      n.innerHTML =
        statRow("إجمالي السجلات المفحوصة", Fmt.int(dq.total)) +
        statRow("نسبة الاكتمال", dq.completeness == null ? "—" : Fmt.pct(dq.completeness, 1)) +
        statRow("نسبة الصلاحية", dq.validity == null ? "—" : Fmt.pct(dq.validity, 1)) +
        statRow("حقول ناقصة (مجموع)", Fmt.int(dq.missingTotal || 0)) +
        statRow("سجلات بتكرار / خطأ", Fmt.int(dq.issueTotal || 0));
    });
  }

  /* ==================================================================
     12. EVENTS COMPARISON TABLE
     ================================================================== */
  const tableState = { sortKey: "total", dir: -1 };

  function renderEvents(ctx) {
    const host = $("events-table");
    if (!host) return;
    const rows = ctx.events;
    setText($("events-count"), rows.length ? Fmt.int(rows.length) + " إيفنت" : "لا توجد بيانات");

    if (!rows.length) {
      host.innerHTML = emptyBox("لا توجد إيفنتات", "تحقق من عمود الإيفنت في الشيت");
      return;
    }

    const COLS = [
      { key: "rank", label: "#", cls: "n", get: function (r) { return r.rank; } },
      { key: "name", label: "الإيفنت", cls: "ev-name", get: function (r) { return Insights.esc(r.name); } },
      { key: "total", label: "التسجيلات", cls: "n", get: function (r) { return Fmt.int(r.total); }, num: true },
      { key: "perDay", label: "تسجيل / يوم", cls: "n", get: function (r) { return Fmt.dec(r.perDay, 1); }, num: true },
      { key: "perHour", label: "تسجيل / ساعة", cls: "n", get: function (r) { return Fmt.dec(r.perHour, 1); }, num: true },
      { key: "velocity24", label: "سرعة 24س", cls: "n", get: function (r) { return Fmt.dec(r.velocity24, 1); }, num: true },
      { key: "peakDay", label: "ذروة اليوم", cls: "", get: function (r) { return r.peakDay ? Insights.esc(r.peakDay) : "—"; } },
      { key: "peakHour", label: "ذروة الساعة", cls: "", get: function (r) { return r.peakHour ? Insights.esc(r.peakHour) : "—"; } },
    ];

    const sorted = rows.slice().sort(function (a, b) {
      const col = COLS.filter(function (c) { return c.key === tableState.sortKey; })[0];
      if (!col) return 0;
      const av = a[tableState.sortKey], bv = b[tableState.sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * tableState.dir;
      return String(av).localeCompare(String(bv), "ar") * tableState.dir;
    });

    let html = '<div class="table-wrap"><table class="data"><thead><tr>';
    COLS.forEach(function (c) {
      const active = c.key === tableState.sortKey;
      html +=
        '<th class="' + c.cls + '" data-key="' + c.key + '" aria-sort="' + (active ? (tableState.dir === 1 ? "ascending" : "descending") : "none") + '">' +
        c.label + '<span class="sort-ind">' + (active ? (tableState.dir === 1 ? "▲" : "▼") : "") + "</span></th>";
    });
    html += "</tr></thead><tbody>";
    sorted.forEach(function (r) {
      html += '<tr data-status="neutral">';
      COLS.forEach(function (c) {
        let v = c.get(r);
        if (c.key === "rank") v = '<span class="rank" data-top="' + (r.rank <= 3 ? r.rank : "") + '">' + r.rank + "</span>";
        html += '<td class="' + c.cls + '">' + v + "</td>";
      });
      html += "</tr>";
    });
    html += "</tbody></table></div>";
    host.innerHTML = html;

    Array.prototype.forEach.call(host.querySelectorAll("th[data-key]"), function (th) {
      th.onclick = function () {
        const key = th.dataset.key;
        if (tableState.sortKey === key) tableState.dir *= -1;
        else { tableState.sortKey = key; tableState.dir = key === "rank" ? 1 : -1; }
        renderEvents(ctx);
      };
    });
  }

  /* ==================================================================
     13. LOADING / ERROR STATES
     ================================================================== */
  function showSkeleton(on) {
    const s = $("skeleton");
    if (s) s.hidden = !on;
    const main = $("main");
    if (main) main.setAttribute("aria-busy", on ? "true" : "false");
  }

  function showError(err) {
    const b = $("error-banner");
    if (!b) return;
    b.hidden = false;
    const msg = $("error-message");
    if (msg) msg.textContent = (err && err.message) || "خطأ غير معروف";
  }

  function hideError() {
    const b = $("error-banner");
    if (b) b.hidden = true;
  }

  /* ==================================================================
     14. LIVE STATUS
     ================================================================== */
  function renderLive(info) {
    const pill = $("live-pill");
    if (pill) pill.setAttribute("data-state", info.state);
    const st = $("live-state");
    if (st) st.textContent = info.stateLabel;
    const val = $("live-val");
    if (val) val.textContent = info.text;

    const upd = $("last-updated");
    if (upd) upd.textContent = info.updatedLabel;
    const cd = $("countdown");
    if (cd) cd.textContent = info.countdownLabel;

    const btn = $("btn-refresh");
    if (btn) {
      btn.classList.toggle("is-busy", !!info.busy);
      btn.disabled = !!info.busy;
    }

    const src = $("data-source");
    if (src) {
      src.textContent = info.sourceLabel;
      src.setAttribute("data-status", info.sourceStatus || "neutral");
    }
  }

  return {
    $: $,
    icon: icon,
    STATUS_LABEL: STATUS_LABEL,
    countUp: countUp,
    trendChip: trendChip,
    renderHero: renderHero,
    renderSnapshot: renderSnapshot,
    renderKpis: renderKpis,
    renderVelocity: renderVelocity,
    renderTimeline: renderTimeline,
    renderHeatmap: renderHeatmap,
    renderAlerts: renderAlerts,
    renderGeo: renderGeo,
    renderSources: renderSources,
    renderAudience: renderAudience,
    renderInterests: renderInterests,
    renderVolunteers: renderVolunteers,
    renderQuality: renderQuality,
    renderEvents: renderEvents,
    showSkeleton: showSkeleton,
    showError: showError,
    hideError: hideError,
    renderLive: renderLive,
    emptyBox: emptyBox,
    genderLabel: genderLabel,
  };
})();

window.UI = UI;