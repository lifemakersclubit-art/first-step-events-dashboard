/* ==========================================================================
   insights.js — Executive Snapshot generator.
   HARD RULE: every sentence is emitted only when the underlying metric is
   real and non-null. Nothing is inferred, guessed, or filled in.
   ========================================================================== */

const Insights = (function () {
  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; });
  }

  const b = function (text) { return "<strong>" + esc(text) + "</strong>"; };
  const neg = function (text) { return '<span class="neg">' + esc(text) + "</span>"; };
  const pos = function (text) { return '<span class="pos">' + esc(text) + "</span>"; };

  /* ------------------------------------------------------------------
     MAIN SNAPSHOT — the 5-second answer to "هل الإيفنت ماشي؟"
     ------------------------------------------------------------------ */
  function snapshot(ctx) {
    if (!ctx || !ctx.total) {
      return {
        html:
          "<p>لا توجد تسجيلات خلال الفترة المحددة. " +
          "تأكد من اختيار الإيفنت الصحيح أو توسيع نطاق التاريخ، أو من اكتمال ربط Google Form بالشيت.</p>",
        chips: [],
      };
    }

    const parts = [];

    /* 1 — total registrations */
    parts.push("إجمالي التسجيلات حتى الآن " + b(Fmt.int(ctx.total) + " تسجيل") + ".");

    /* 2 — speed vs required pace */
    if (ctx.currentPace != null && ctx.targetPace != null) {
      const gap = ctx.paceGap;
      let s =
        "معدل التسجيل الحالي " + b(Fmt.dec(ctx.currentPace, 1) + " تسجيل / ساعة") +
        " مقابل معدل مطلوب " + b(Fmt.dec(ctx.targetPace, 1) + " تسجيل / ساعة") + "، ";
      if (gap == null) {
        s += ".";
      } else if (gap >= 0) {
        s += "أي " + pos("أعلى من المطلوب بنسبة " + Fmt.pct(Math.abs(gap)));
      } else {
        s += "أي " + neg("أقل من المطلوب بنسبة " + Fmt.pct(Math.abs(gap)));
      }
      parts.push(s + ".");
    } else if (ctx.perHour != null) {
      parts.push(
        "متوسط سرعة التسجيل " + b(Fmt.dec(ctx.perHour, 1) + " تسجيل / ساعة") + " منذ بداية الحملة."
      );
    }

    /* 3 — velocity direction */
    if (ctx.velocityChange && ctx.velocityChange.change != null) {
      const ch = ctx.velocityChange;
      const winLabel = ch.label || "الفترة السابقة";
      if (ch.change >= 12) {
        parts.push(
          "سرعة التسجيل " + pos("ارتفعت " + Fmt.pct(ch.change)) + " مقارنة بـ" + esc(winLabel) + "."
        );
      } else if (ch.change <= -12) {
        parts.push(
          "سرعة التسجيل " + neg("انخفضت " + Fmt.pct(Math.abs(ch.change))) + " مقارنة بـ" + esc(winLabel) + "."
        );
      } else {
        parts.push("سرعة التسجيل مستقرة تقريبًا مقارنة بـ" + esc(winLabel) + ".");
      }
    }

    /* 4 — peak response window */
    if (ctx.peakHour && ctx.peakHour.count > 0) {
      parts.push(
        "أعلى استجابة حدثت بين " + b(ctx.peakHour.label) + " (" + b(Fmt.int(ctx.peakHour.count) + " تسجيل") + ")."
      );
    }

    /* 5 — intervention call */
    if (ctx.verdict === "critical") {
      parts.push(
        "<b>يحتاج الإيفنت إلى تدخل تسويقي الآن</b> لرفع سرعة الاستجابة — " +
        "التسجيلات في " + esc(ctx.lowestWindowLabel || "الساعات الأخيرة") + " أقل بكثير من المطلوب."
      );
    } else if (ctx.verdict === "attention") {
      parts.push(
        "المسار الحالي <b>متأخر قليلًا</b> عن المطلوب؛ يُنصح بتركيز النشر في الأوقات الذروة (" +
        esc((ctx.peakHour && ctx.peakHour.label) || "أوقات الذروة") + ")."
      );
    } else if (ctx.verdict === "excellent") {
      parts.push("المسار <b>ممتاز</b> — الإيفنت ماشي أسرع من الخطة الموقّعة.");
    }

    /* 6 — geography */
    if (ctx.topGeo && ctx.topGeo.count) {
      parts.push(
        "أعلى تركّز للتسجيلات في " + b(ctx.topGeo.label) + " (" +
        b(Fmt.int(ctx.topGeo.count) + " تسجيل") + " — " + Fmt.pct(ctx.topGeo.pct) + ")."
      );
    }

    /* 7 — best marketing channel */
    if (ctx.topSource && ctx.topSource.count) {
      parts.push(
        "أفضل قناة تسويقية حتى الآن: " + b(ctx.topSource.label) + " (" +
        b(Fmt.int(ctx.topSource.count) + " تسجيل") + " — " + Fmt.pct(ctx.topSource.pct) + ")."
      );
    }

    /* 8 — data health (only when it needs board attention) */
    if (ctx.qualityScore != null && ctx.qualityScore < CONFIG.THRESHOLDS.quality.attention) {
      parts.push(
        "جودة البيانات " + neg(Fmt.pct(ctx.qualityScore, 1)) +
        " — راجع الحقول الناقصة قبل أي حملة تذكير."
      );
    }

    /* 9 — staleness */
    if (ctx.staleMinutes != null && ctx.staleMinutes >= CONFIG.ALERT_RULES.staleDataMinutes) {
      parts.push(
        "لم يصل أي تسجيل جديد منذ " + b(ctx.staleMinutes + " دقيقة") + " — راجع حالة النشر في الـ Form."
      );
    }

    /* ---- supporting chips ---- */
    const chips = [];
    if (ctx.today != null) chips.push(["تسجيلات اليوم", Fmt.int(ctx.today)]);
    if (ctx.last24h != null) chips.push(["آخر 24 ساعة", Fmt.int(ctx.last24h)]);
    if (ctx.last1h != null) chips.push(["آخر ساعة", Fmt.int(ctx.last1h)]);
    if (ctx.perDay != null) chips.push(["تسجيل / يوم", Fmt.dec(ctx.perDay, 1)]);
    if (ctx.growth != null) chips.push(["معدل النمو", Fmt.signedPct(ctx.growth)]);

    return { html: "<p>" + parts.join(" ") + "</p>", chips: chips };
  }

  /* ------------------------------------------------------------------
     Sub-line under each major panel (real numbers only)
     ------------------------------------------------------------------ */
  function geoSubtitle(records) {
    if (!records.length) return null;
    const byGov = Metrics.distribution(records, function (r) { return r.governorate; }, { excludeUnknown: true });
    if (!byGov.length) return null;
    const top = byGov[0];
    const cov = byGov.length;
    return "أعلى " + cov + " محافظة/جامعة تغطي " + Fmt.pct(byGov.slice(0, 3).reduce(function (a, r) { return a + r.pct; }, 0)) +
      " من التسجيلات — الأولى: " + top.label + ".";
  }

  function sourceSubtitle(records) {
    if (!records.length) return null;
    const src = Metrics.distribution(records, function (r) { return r.eventSource; }, { excludeUnknown: true });
    if (!src.length) return null;
    const social = src.filter(function (r) { return /فيسبوك|انستجرام|واتساب|tiktok|يوتيوب/i.test(r.label); })
      .reduce(function (a, r) { return a + r.pct; }, 0);
    const owned = src.filter(function (r) { return /متطوع|جامعة|نادي|اخبار|لوحة/i.test(r.label); })
      .reduce(function (a, r) { return a + r.pct; }, 0);
    return "القنوات الاجتماعية " + Fmt.pct(social) + " • القنوات المؤسسية " + Fmt.pct(owned) +
      " • أقواها: " + src[0].label + ".";
  }

  function audienceSubtitle(records) {
    if (!records.length) return null;
    const age = Metrics.stats(records.map(function (r) { return r.age; }));
    const gender = Metrics.distribution(records, function (r) { return r.gender; }, { excludeUnknown: true });
    const student = records.filter(function (r) { return r.studentStatus === "student"; }).length;
    const malePct = gender.length && gender[0].label === "male" ? gender[0].pct : gender.length ? 100 - gender[0].pct : null;
    const bits = [];
    if (age.avg != null) bits.push("متوسط السن " + Fmt.dec(age.avg, 1) + " سنة");
    if (malePct != null) bits.push("ذكور " + Fmt.pct(malePct));
    bits.push("طلاب " + Fmt.pct(student / records.length * 100));
    return bits.join(" • ");
  }

  function qualitySubtitle(dq) {
    if (!dq || dq.score == null) return null;
    const worst = dq.issues[0];
    let s = "اكتمال " + Fmt.pct(dq.completeness, 1) + " • صلاحية " + Fmt.pct(dq.validity, 1);
    if (worst) s += " • أكثر خلل: " + worst.label + " (" + Fmt.int(worst.count) + ")";
    return s;
  }

  return {
    snapshot: snapshot,
    geoSubtitle: geoSubtitle,
    sourceSubtitle: sourceSubtitle,
    audienceSubtitle: audienceSubtitle,
    qualitySubtitle: qualitySubtitle,
    esc: esc,
  };
})();

window.Insights = Insights;