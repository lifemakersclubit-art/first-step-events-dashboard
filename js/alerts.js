/* ==========================================================================
   alerts.js — Rule-based alert engine. Every threshold lives in
   CONFIG.ALERT_RULES so the board can be re-tuned without touching code.
   Alerts never invent data: each rule reads a real metric or nothing.
   ========================================================================== */

const Alerts = (function () {
  const RULES = CONFIG.ALERT_RULES;

  const SEVERITY_ORDER = { critical: 0, warning: 1, positive: 2, milestone: 3, info: 4 };

  function make(type, title, detail) {
    return {
      type: type,
      title: title,
      detail: detail,
      at: Date.now(),
    };
  }

  /**
   * @param ctx {
   *   total, target, achievement, remaining,
   *   currentPace, targetPace, paceGap,
   *   velocityChange:{current,previous,change,label},
   *   staleMinutes, qualityScore,
   *   campaignEndsIn
   * }
   */
  function evaluate(ctx) {
    const out = [];
    if (!ctx || !RULES.enabled) return out;
    if (!ctx.total) {
      out.push(make("warning", "لا توجد تسجيلات بعد",
        "لم يُسجَّل أي تسجيل حتى الآن — راجع ربط Google Form بالشيت وتأكد أن الـ API يعمل."));
      return out;
    }

    /* ---- 1. velocity collapse ---- */
    const vc = ctx.velocityChange;
    if (vc && vc.change != null) {
      const drop = -vc.change;
      if (drop >= RULES.velocityDrop.critical) {
        out.push(make("critical",
          "انهيار سرعة التسجيل " + Fmt.pct(drop),
          "سرعة التسجيل انخفضت " + Fmt.pct(drop) + " خلال " + (vc.label || "الفترة الأخيرة") +
          " — من " + Fmt.dec(vc.previous, 1) + " إلى " + Fmt.dec(vc.current, 1) + " تسجيل/ساعة."));
      } else if (drop >= RULES.velocityDrop.warning) {
        out.push(make("warning",
          "تباطؤ سرعة التسجيل " + Fmt.pct(drop),
          "انخفاض " + Fmt.pct(drop) + " في " + (vc.label || "الفترة الأخيرة") + " — راقب الساعات التالية."));
      } else if (vc.change >= RULES.velocitySurge.positive) {
        out.push(make("positive",
          "قفزة في سرعة التسجيل +" + Fmt.pct(vc.change),
          "تسارع الاستجابة " + Fmt.pct(vc.change) + " — استثمر الآن في النشر المتواصل."));
      }
    }

    /* ---- 2. pace gap ---- */
    if (ctx.paceGap != null) {
      const behind = -ctx.paceGap;
      if (behind >= RULES.paceGapCritical) {
        out.push(make("critical",
          "المسار متأخر " + Fmt.pct(behind),
          "المعدل الحالي " + Fmt.dec(ctx.currentPace, 1) + " تسجيل/ساعة مقابل " +
          Fmt.dec(ctx.targetPace, 1) + " مطلوبة. يتطلب حملة تعويضية مكثفة."));
      } else if (behind >= RULES.paceGapWarning) {
        out.push(make("warning",
          "المسار أقل من المطلوب " + Fmt.pct(behind),
          ctx.gapCount != null
            ? "ناقص " + Fmt.int(ctx.gapCount) + " تسجيل حتى الآن للحفاظ على الجدول."
            : "المسار الحالي لا يفي بالجدول الزمني المحدد."));
      } else if (ctx.paceGap >= RULES.overPacePositive) {
        out.push(make("positive",
          "المسار أعلى من المطلوب +" + Fmt.pct(ctx.paceGap),
          "المعدل الحالي أعلى من المطلوب — استمر بنفس وتيرة النشر."));
      }
    }

    /* ---- 3. milestone ---- */
    const step = RULES.milestoneStep;
    if (step > 0) {
      const hit = Math.floor(ctx.total / step) * step;
      const prevStep = hit - step;
      if (hit > 0 && prevStep >= 0 && ctx.newMilestone) {
        out.push(make("milestone",
          "معيار جديد: " + Fmt.int(hit) + " تسجيل",
          "تم تجاوز عتبة " + Fmt.int(hit) + " تسجيل."));
      }
    }

    /* ---- 4. stale feed ---- */
    if (ctx.staleMinutes != null && ctx.staleMinutes >= RULES.staleDataMinutes) {
      out.push(make("critical",
        "لا تسجيلات جديدة منذ " + ctx.staleMinutes + " دقيقة",
        "قد يكون الـ Form مغلقًا أو قناة النشر متوقفة. تحقّق من الحالة فورًا."));
    }

    /* ---- 5. low volume ---- */
    if (ctx.total < RULES.lowTotalRegistrations) {
      out.push(make("warning",
        "عدد التسجيلات منخفض جدًا (" + Fmt.int(ctx.total) + ")",
        "لم تبدأ الحملة بعد بشكل فعّال — راجع خطة النشر والجمهور المستهدف."));
    }

    /* ---- 6. quality ---- */
    if (ctx.qualityScore != null && ctx.qualityScore < RULES.qualityCritical) {
      out.push(make("warning",
        "جودة البيانات منخفضة " + Fmt.pct(ctx.qualityScore, 1),
        "يوجد نقص في الحقول الأساسية يؤثر على المتابعة والتواصل."));
    }

    /* ---- 7. closing window ---- */
    if (ctx.campaignEndsIn != null && ctx.campaignEndsIn <= 24) {
      out.push(make("warning",
        "أقل من " + Fmt.dec(ctx.campaignEndsIn, 0) + " ساعة على إغلاق التسجيل",
        "راجع وتيرة النشر وأغلق أي فجوات قبل نهاية الحملة."));
    }

    out.sort(function (a, b) {
      const d = SEVERITY_ORDER[a.type] - SEVERITY_ORDER[b.type];
      return d !== 0 ? d : b.at - a.at;
    });

    return out.slice(0, RULES.maxAlerts);
  }

  /** Milestone crossing between two totals (so it fires once, not on every refresh). */
  function crossedMilestone(prevTotal, newTotal) {
    const step = RULES.milestoneStep;
    if (!step || newTotal <= prevTotal) return false;
    return Math.floor(newTotal / step) > Math.floor(prevTotal / step);
  }

  const META = {
    critical: { label: "حرج", icon: "M12 2 1 21h22L12 2Zm0 6v6m0 3v.5" },
    warning: { label: "تحذير", icon: "M12 3v10m0 4v.5M12 3 2 21h20L12 3Z" },
    positive: { label: "إيجابي", icon: "M4 17 10 11l4 4 6-7M20 8v6h-6" },
    milestone: { label: "معيار", icon: "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" },
    info: { label: "معلومة", icon: "M12 11v6m0-9v.5M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" },
  };

  return { evaluate: evaluate, crossedMilestone: crossedMilestone, META: META };
})();

window.Alerts = Alerts;