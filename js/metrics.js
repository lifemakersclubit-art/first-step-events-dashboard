/* ==========================================================================
   metrics.js — PURE calculation layer. No DOM, no rendering, no side effects.
   Every number on the dashboard originates here, so each function is
   independently testable (see README → "Metric Definitions").
   ========================================================================== */

const Metrics = (function () {
  const HOUR = 3600000;
  const DAY = 86400000;

  /* ------------------------------------------------------------------
     TIME KEYS
     ------------------------------------------------------------------ */
  const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const AR_MONTHS = [
    "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
    "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
  ];

  function dayKey(d) {
    const x = d instanceof Date ? d : new Date(d);
    return (
      x.getFullYear() +
      "-" +
      String(x.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(x.getDate()).padStart(2, "0")
    );
  }

  function hourKey(d) {
    return dayKey(d) + "T" + String((d instanceof Date ? d : new Date(d)).getHours()).padStart(2, "0");
  }

  function dayLabel(d) {
    const x = d instanceof Date ? d : new Date(d);
    return AR_DAYS[x.getDay()] + " " + x.getDate() + " " + AR_MONTHS[x.getMonth()];
  }

  function hourLabel(h) {
    const hh = ((h % 24) + 24) % 24;
    if (hh === 0) return "12 ص";
    if (hh === 12) return "12 م";
    return hh < 12 ? hh + " ص" : hh - 12 + " م";
  }

  function hourRangeLabel(h) {
    return hourLabel(h) + " – " + hourLabel(h + 1);
  }

  function shortDate(d) {
    const x = d instanceof Date ? d : new Date(d);
    return x.getDate() + "/" + (x.getMonth() + 1);
  }

  function stamp(d) {
    const x = d instanceof Date ? d : new Date(d);
    return (
      String(x.getDate()).padStart(2, "0") + "/" +
      String(x.getMonth() + 1).padStart(2, "0") + "/" +
      x.getFullYear() + " " +
      String(x.getHours()).padStart(2, "0") + ":" +
      String(x.getMinutes()).padStart(2, "0")
    );
  }

  function timeOnly(d) {
    const x = d instanceof Date ? d : new Date(d);
    return (
      String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0")
    );
  }

  /* ==================================================================
     1. VOLUME
     ================================================================== */

  /** Total number of valid registration records. */
  function calculateTotalRegistrations(records) {
    return records ? records.length : 0;
  }

  /** Registrations whose timestamp falls inside the last `hours`. */
  function countInWindow(records, hours, now) {
    const end = now ? now.getTime() : Date.now();
    const start = end - hours * HOUR;
    let n = 0;
    for (let i = 0; i < records.length; i++) {
      const t = records[i].ts;
      if (t != null && t > start && t <= end) n++;
    }
    return n;
  }

  /** Registrations on the same calendar day as `now`. */
  function countToday(records, now) {
    const ref = now || new Date();
    const k = dayKey(ref);
    let n = 0;
    for (let i = 0; i < records.length; i++) {
      if (records[i].ts != null && dayKey(new Date(records[i].ts)) === k) n++;
    }
    return n;
  }

  /**
   * REGISTRATION VELOCITY = registrations in period ÷ hours in period.
   * window: { hours: number } or a string like "24h".
   */
  function calculateRegistrationVelocity(records, hours, now) {
    const h = typeof hours === "string" ? parseFloat(hours) : hours;
    if (!h || h <= 0) return null;
    return countInWindow(records, h, now) / h;
  }

  /** Average registrations per day since the first registration. */
  function calculateDailyRate(records, now) {
    if (!records.length) return null;
    const end = now ? now.getTime() : Date.now();
    const first = records[0].ts;
    const days = Math.max((end - first) / DAY, 1 / 24);
    return records.length / days;
  }

  /** Average registrations per hour since the first registration. */
  function calculateHourlyRate(records, now) {
    if (!records.length) return null;
    const end = now ? now.getTime() : Date.now();
    const first = records[0].ts;
    const hours = Math.max((end - first) / HOUR, 1);
    return records.length / hours;
  }

  /** (current − previous) ÷ previous × 100. null when previous is 0. */
  function calculateGrowthRate(current, previous) {
    if (previous == null || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  /** Velocity now vs. the immediately preceding equivalent window. */
  function velocityChange(records, hours, now) {
    const ref = now ? now.getTime() : Date.now();
    const current = calculateRegistrationVelocity(records, hours, new Date(ref));
    const prevEnd = new Date(ref - hours * HOUR);
    const previous = calculateRegistrationVelocity(records, hours, prevEnd);
    return {
      current: current,
      previous: previous,
      change: calculateGrowthRate(current, previous),
    };
  }

  /* ==================================================================
     2. TARGET / PACE
     ================================================================== */

  /** Actual ÷ Target × 100. */
  function calculateAchievementRate(actual, target) {
    if (!target || target <= 0) return null;
    return (actual / target) * 100;
  }

  /**
   * TARGET PACE = registrations per hour required to hit the target
   * before the deadline. Null when the window is unknown.
   */
  function calculateTargetPace(target, campaignStart, campaignEnd, now) {
    if (!target || target <= 0) return null;
    const ref = (now ? now.getTime() : Date.now());
    const start = campaignStart ? new Date(campaignStart).getTime() : ref;
    const end = campaignEnd ? new Date(campaignEnd).getTime() : null;
    const totalHours = end ? (end - start) / HOUR : null;
    if (!totalHours || totalHours <= 0) return null;
    return target / totalHours;
  }

  /** Registrations that SHOULD have arrived by now. */
  function expectedToDate(target, campaignStart, campaignEnd, now) {
    const ref = (now ? now.getTime() : Date.now());
    const start = campaignStart ? new Date(campaignStart).getTime() : ref;
    const end = campaignEnd ? new Date(campaignEnd).getTime() : null;
    if (!end || end <= start) return null;
    const elapsed = Math.min(Math.max(ref - start, 0), end - start);
    const ratio = elapsed / (end - start);
    return target * ratio;
  }

  /** CURRENT PACE = registrations per hour over a recent window. */
  function calculateCurrentPace(records, hours, now) {
    return calculateRegistrationVelocity(records, hours, now);
  }

  /** % gap between actual pace and required pace. */
  function paceGapPercent(currentPace, targetPace) {
    if (!targetPace) return null;
    return ((currentPace - targetPace) / targetPace) * 100;
  }

  /** above | on | behind — the board's core question. */
  function paceVerdict(gapPct, thresholds) {
    if (gapPct == null) return "neutral";
    if (gapPct <= thresholds.critical) return "critical";
    if (gapPct < thresholds.attention) return "attention";
    if (gapPct >= thresholds.excellent) return "excellent";
    return "neutral";
  }

  /* ==================================================================
     3. PROJECTION — transparent, no ML
     ================================================================== */

  /**
   * projectedFinal = current + weighted recent velocity × remaining hours
   * confidence blends data volume, time span and velocity stability.
   */
  function calculateProjection(records, target, campaignEnd, now) {
    const ref = now ? new Date(now) : new Date();
    const end = campaignEnd ? new Date(campaignEnd).getTime() : null;
    const remainingHours = end ? Math.max((end - ref.getTime()) / HOUR, 0) : 0;

    const v24 = calculateRegistrationVelocity(records, 24, ref);
    const v72 = calculateRegistrationVelocity(records, 72, ref);
    const vWeek = calculateRegistrationVelocity(records, 168, ref);

    // Weighted blend of the windows that actually have data.
    const parts = [];
    if (v24 != null) parts.push([0.5, v24]);
    if (v72 != null) parts.push([0.3, v72]);
    if (vWeek != null) parts.push([0.2, vWeek]);
    if (!parts.length) {
      return {
        projected: null, velocity: null, remainingHours, confidence: 0,
        insufficient: true, reason: "لا توجد تسجيلات كافية داخل نافذة التوقع",
      };
    }
    const wsum = parts.reduce(function (a, p) { return a + p[0]; }, 0);
    const velocity = parts.reduce(function (a, p) { return a + p[0] * p[1]; }, 0) / wsum;

    const current = records.length;
    const projected = Math.round(current + velocity * remainingHours);

    /* ---- confidence ---- */
    const volumeScore = Math.min(1, current / 300);
    const spanHours = current ? (ref.getTime() - records[0].ts) / HOUR : 0;
    const spanScore = Math.min(1, spanHours / 72);
    const baseline = Math.max(vWeek || velocity, 0.5);
    const instability = Math.min(1, Math.abs((v24 || 0) - (v72 || 0)) / baseline);
    const stabilityScore = 1 - instability;
    const windowScore = Math.min(1, remainingHours > 0 ? 168 / Math.max(remainingHours, 1) : 0.6);
    const confidence = Math.round(
      100 * (0.34 * volumeScore + 0.26 * spanScore + 0.22 * stabilityScore + 0.18 * windowScore)
    );

    const insufficient = confidence < CONFIG.THRESHOLDS.projectionMinConfidence;

    return {
      projected: insufficient ? null : projected,
      rawProjected: projected,
      velocity: velocity,
      remainingHours: remainingHours,
      confidence: confidence,
      insufficient: insufficient,
      reason: insufficient
        ? "البيانات غير كافية للتوقع (" + confidence + "% ثقة)"
        : null,
      willHitTarget: target ? projected >= target : null,
    };
  }

  /* ==================================================================
     4. PEAKS
     ================================================================== */

  /** Busiest hour-of-day across all records. */
  function calculatePeakHour(records) {
    const buckets = new Array(24).fill(0);
    for (let i = 0; i < records.length; i++) {
      const t = records[i].ts;
      if (t != null) buckets[new Date(t).getHours()]++;
    }
    let best = -1, bestCount = 0;
    for (let h = 0; h < 24; h++) if (buckets[h] > bestCount) { bestCount = buckets[h]; best = h; }
    if (best < 0 || bestCount === 0) return { hour: null, count: 0, buckets: buckets, label: null };

    // Best contiguous 2–3 hour block (how long the peak actually lasted).
    let bestSpan = { start: best, len: 1, sum: buckets[best] };
    for (let len = 2; len <= 3; len++) {
      for (let s = 0; s < 24; s++) {
        let sum = 0;
        for (let k = 0; k < len; k++) sum += buckets[(s + k) % 24];
        if (sum > bestSpan.sum) bestSpan = { start: s, len: len, sum: sum };
      }
    }

    return {
      hour: best,
      count: bestCount,
      buckets: buckets,
      label: hourRangeLabel(bestSpan.start),
      span: bestSpan,
    };
  }

  /** Busiest calendar day. */
  function calculatePeakDay(records) {
    const map = new Map();
    for (let i = 0; i < records.length; i++) {
      const t = records[i].ts;
      if (t == null) continue;
      const k = dayKey(new Date(t));
      if (!map.has(k)) map.set(k, { key: k, count: 0, date: new Date(t) });
      map.get(k).count++;
    }
    let best = null;
    map.forEach(function (v) { if (!best || v.count > best.count) best = v; });
    if (!best) return { key: null, count: 0, label: null };
    return { key: best.key, count: best.count, label: dayLabel(best.date), date: best.date };
  }

  /* ==================================================================
     5. SERIES / TIMELINE
     ================================================================== */

  /**
   * Buckets registrations into hour / day / week series.
   * Returns [{ start, label, count, cumulative, expected }].
   */
  function buildTimeline(records, options) {
    const opts = options || {};
    const now = opts.now ? new Date(opts.now) : new Date();
    const bucket = opts.bucket || "auto";
    const target = opts.target || 0;
    const campaignStart = opts.campaignStart ? new Date(opts.campaignStart) : null;
    const campaignEnd = opts.campaignEnd ? new Date(opts.campaignEnd) : null;

    const first = records.length ? new Date(records[0].ts) : now;
    const last = records.length
      ? new Date(records[records.length - 1].ts)
      : now;
    const spanHours = Math.max((last.getTime() - first.getTime()) / HOUR, 1);

    let mode = bucket;
    if (mode === "auto") {
      mode = spanHours <= 36 ? "hour" : spanHours <= 24 * 21 ? "day" : "week";
    }

    const size = mode === "hour" ? HOUR : mode === "day" ? DAY : 7 * DAY;
    const from = opts.from ? new Date(opts.from) : campaignStart || first;
    const to = opts.to ? new Date(opts.to) : new Date(Math.max(now.getTime(), last.getTime()));

    const map = new Map();
    const keyOf = mode === "hour"
      ? function (t) { return new Date(t).setMinutes(0, 0, 0); }
      : mode === "day"
      ? function (t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
      : function (t) { const d = new Date(t); const wd = (d.getDay() + 1) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - wd).getTime(); };

    // Pre-seed every bucket so gaps render honestly (no invented data).
    const startStamp = keyOf(from.getTime());
    const endStamp = keyOf(to.getTime());
    const maxBuckets = mode === "hour" ? 24 * 40 : mode === "day" ? 400 : 120;
    let cursor = startStamp, guard = 0;
    while (cursor <= endStamp && guard++ < maxBuckets) {
      map.set(cursor, 0);
      cursor += size;
    }

    for (let i = 0; i < records.length; i++) {
      const t = records[i].ts;
      if (t == null) continue;
      const k = keyOf(t);
      if (map.has(k)) map.set(k, map.get(k) + 1);
    }

    const campaignTotalHours = campaignStart && campaignEnd
      ? Math.max((campaignEnd.getTime() - campaignStart.getTime()) / HOUR, 1)
      : null;

    const keys = Array.from(map.keys()).sort(function (a, b) { return a - b; });

    /* Expected cumulative pace at each bucket end, then the per-bucket delta
       so the dashed reference line stays meaningful when actual > expected. */
    const expectedCum = keys.map(function (k) {
      if (!campaignStart || !campaignEnd || !target) return null;
      const bucketEnd = new Date(k + size).getTime();
      const elapsed = Math.min(Math.max(bucketEnd - campaignStart.getTime(), 0), campaignTotalHours * HOUR);
      return (target * (elapsed / HOUR)) / campaignTotalHours;
    });

    let cumulative = 0;
    let prevExpected = 0;
    const series = keys.map(function (k, bi) {
      const count = map.get(k);
      cumulative += count;
      const bucketEnd = new Date(k + size);

      let expected = null;
      if (expectedCum[bi] != null) {
        expected = Math.max(expectedCum[bi] - prevExpected, 0);
        prevExpected = expectedCum[bi];
      }

      const d = new Date(k);
      const label = mode === "hour" ? hourLabel(d.getHours()) : mode === "day" ? shortDate(d) : dayLabel(d);
      return {
        t: k,
        label: label,
        fullLabel: mode === "hour" ? dayLabel(d) + " — " + hourLabel(d.getHours()) : dayLabel(d),
        count: count,
        cumulative: cumulative,
        expected: expected == null ? null : expected,
        expectedCumulative: expectedCum[bi],
        gap: expected == null ? null : count - expected,
      };
    });

    return { series: series, mode: mode, bucketSize: size };
  }

  /** Hour-of-day × day-of-week matrix for the heatmap. */
  function buildHeatmap(records, hours) {
    const grid = [];
    for (let d = 0; d < 7; d++) grid.push(new Array(24).fill(0));
    for (let i = 0; i < records.length; i++) {
      const t = records[i].ts;
      if (t == null) continue;
      const d = new Date(t);
      grid[d.getDay()][d.getHours()]++;
    }
    let max = 0, total = 0;
    grid.forEach(function (row) {
      row.forEach(function (v) { if (v > max) max = v; total += v; });
    });
    return { grid: grid, max: max, total: total, hours: hours || 24 };
  }

  /* ==================================================================
     6. DISTRIBUTIONS
     ================================================================== */

  /** Generic categorical distribution, sorted desc. */
  function distribution(records, accessor, options) {
    const opts = options || {};
    const map = new Map();
    for (let i = 0; i < records.length; i++) {
      const key = accessor(records[i]);
      if (key == null || key === "" || key === "غير محدد") {
        if (opts.excludeUnknown) continue;
      }
      const k = key == null || key === "" ? "غير محدد" : String(key);
      map.set(k, (map.get(k) || 0) + 1);
    }
    const total = records.length || 1;
    const out = Array.from(map.entries()).map(function (e) {
      return { label: e[0], count: e[1], pct: (e[1] / total) * 100 };
    });
    out.sort(function (a, b) { return b.count - a.count; });
    if (opts.limit && out.length > opts.limit) {
      const rest = out.slice(opts.limit);
      const restCount = rest.reduce(function (a, r) { return a + r.count; }, 0);
      out.length = opts.limit;
      out.push({ label: "أخرى", count: restCount, pct: (restCount / total) * 100, isRest: true });
    }
    return out;
  }

  function groupBy(records, accessor) {
    const map = new Map();
    for (let i = 0; i < records.length; i++) {
      const k = accessor(records[i]);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(records[i]);
    }
    return map;
  }

  /** Distinct non-empty values of a field, sorted Arabic-locale asc. */
  function facets(records, key) {
    const set = new Set();
    for (let i = 0; i < records.length; i++) {
      const v = records[i][key];
      if (v != null && v !== "" && v !== "غير محدد") set.add(v);
    }
    return Array.from(set).sort(function (a, b) { return String(a).localeCompare(String(b), "ar"); });
  }

  /** Cross-tab: two categorical fields. */
  function crossTab(records, aFn, bFn, limit) {
    const rows = new Map();
    for (let i = 0; i < records.length; i++) {
      const a = aFn(records[i]) || "غير محدد";
      if (!rows.has(a)) rows.set(a, new Map());
      const b = bFn(records[i]) || "غير محدد";
      rows.get(a).set(b, (rows.get(a).get(b) || 0) + 1);
    }
    const out = [];
    rows.forEach(function (inner, a) {
      const total = Array.from(inner.values()).reduce(function (s, v) { return s + v; }, 0);
      inner.forEach(function (c, b) { out.push({ a: a, b: b, count: c, pct: (c / total) * 100 }); });
    });
    out.sort(function (x, y) { return y.count - x.count; });
    return limit ? out.slice(0, limit) : out;
  }

  /* ==================================================================
     7. NUMERIC PROFILE
     ================================================================== */

  function stats(values) {
    const v = values.filter(function (n) { return typeof n === "number" && isFinite(n); });
    if (!v.length) return { n: 0, avg: null, min: null, max: null, median: null };
    const sorted = v.slice().sort(function (a, b) { return a - b; });
    const sum = v.reduce(function (a, b) { return a + b; }, 0);
    const mid = Math.floor(sorted.length / 2);
    return {
      n: v.length,
      avg: sum / v.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    };
  }

  function ageGroupOf(age) {
    if (typeof age !== "number" || !isFinite(age)) return "غير محدد";
    for (let i = 0; i < CONFIG.AGE_GROUPS.length; i++) {
      const g = CONFIG.AGE_GROUPS[i];
      if (age >= g.min && age <= g.max) return g.key;
    }
    return "غير محدد";
  }

  function ageDistribution(records) {
    const rows = distribution(records, function (r) { return ageGroupOf(r.age); });
    // Enforce declared bucket order for a stable, comparable chart.
    const order = CONFIG.AGE_GROUPS.map(function (g) { return g.key; }).concat(["غير محدد"]);
    rows.sort(function (a, b) { return order.indexOf(a.label) - order.indexOf(b.label); });
    return rows;
  }

  /* ==================================================================
     8. EVENT COMPARISON
     ================================================================== */

  /** Per-event rollup used by the Events view. */
  function eventsComparison(records, now) {
    const groups = groupBy(records, function (r) { return r.event || "غير محدد"; });
    const out = [];
    groups.forEach(function (rows, name) {
      const cfg = resolveEventConfig(name);
      const rowsSorted = rows.slice().sort(function (a, b) { return a.ts - b.ts; });
      const velocity24 = calculateRegistrationVelocity(rowsSorted, 24, now);
      const velocityHour = calculateHourlyRate(rowsSorted, now);
      const peakHour = calculatePeakHour(rowsSorted);
      const peakDay = calculatePeakDay(rowsSorted);
      const achievement = calculateAchievementRate(rowsSorted.length, cfg.target);
      out.push({
        name: name,
        target: cfg.target,
        total: rowsSorted.length,
        achievement: achievement,
        remaining: Math.max((cfg.target || 0) - rowsSorted.length, 0),
        perDay: calculateDailyRate(rowsSorted, now),
        perHour: velocityHour,
        velocity24: velocity24,
        peakHour: peakHour.label,
        peakDay: peakDay.label,
        firstSeen: new Date(rowsSorted[0].ts),
        lastSeen: new Date(rowsSorted[rowsSorted.length - 1].ts),
        status: achievementStatus(achievement),
      });
    });
    out.sort(function (a, b) { return b.total - a.total; });
    return out.map(function (e, i) { e.rank = i + 1; return e; });
  }

  function achievementStatus(pct) {
    if (pct == null) return "neutral";
    if (pct < CONFIG.THRESHOLDS.achievement.critical) return "critical";
    if (pct < CONFIG.THRESHOLDS.achievement.attention) return "attention";
    if (pct >= 100) return "excellent";
    return "neutral";
  }

  /* ==================================================================
     9. DATA QUALITY
     ================================================================== */

  /**
   * Completeness (70%) + validity/uniqueness (30%).
   * Works purely off boolean quality flags computed upstream, so the
   * function never touches (and never receives) any personal data.
   * Returns { score, completeness, validity, issues[], total }
   */
  function calculateDataQuality(records) {
    const total = records.length;
    if (!total) {
      return { score: null, completeness: null, validity: null, issues: [], total: 0, missingTotal: 0, issueTotal: 0 };
    }

    const missingChecks = CONFIG.QUALITY_CHECKS.filter(function (c) { return c.kind === "missing"; });
    const issueChecks = CONFIG.QUALITY_CHECKS.filter(function (c) { return c.kind === "issue"; });

    let missingTotal = 0;
    let issueTotal = 0;

    const issues = CONFIG.QUALITY_CHECKS.map(function (c) {
      let n = 0;
      for (let i = 0; i < records.length; i++) {
        const flags = records[i].quality || {};
        const v = flags[c.flag];
        if (c.kind === "missing" ? v === false : v === true) n++;
      }
      if (c.kind === "missing") missingTotal += n;
      else issueTotal += n;
      return {
        key: c.key,
        label: c.label,
        kind: c.kind,
        count: n,
        pct: (n / total) * 100,
        severity: (n / total) > 0.25 ? "critical" : (n / total) > 0.08 ? "attention" : "neutral",
      };
    })
      .filter(function (i) { return i.count > 0; })
      .sort(function (a, b) { return b.pct - a.pct; });

    const completeness = Math.max(0, 1 - missingTotal / (missingChecks.length * total));
    const validity = Math.max(0, 1 - issueTotal / (issueChecks.length * total));
    const score = Math.max(0, Math.min(100, Math.round(100 * (0.7 * completeness + 0.3 * validity))));

    return {
      score: score,
      completeness: Math.round(completeness * 1000) / 10,
      validity: Math.round(validity * 1000) / 10,
      issues: issues,
      total: total,
      missingTotal: missingTotal,
      issueTotal: issueTotal,
      issueCount: issues.length,
    };
  }

  /* ---- public API ---- */

  /* ==================================================================
     10. FORMATTING
     ================================================================== */

  let _nf = null, _pf = null, _cf = null;
  function numFmt() {
    if (_nf) return _nf;
    const loc = CONFIG.NUMBER_SYSTEM === "latn" ? "ar-EG-u-nu-latn" : CONFIG.LOCALE;
    try { _nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }); }
    catch (e) { _nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }); }
    return _nf;
  }
  function pctFmt() {
    if (_pf) return _pf;
    const loc = CONFIG.NUMBER_SYSTEM === "latn" ? "ar-EG-u-nu-latn" : CONFIG.LOCALE;
    try { _pf = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }); }
    catch (e) { _pf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }); }
    return _pf;
  }

  const Fmt = {
    int: function (n) {
      if (n == null || !isFinite(n)) return "—";
      return numFmt().format(Math.round(n));
    },
    dec: function (n, digits) {
      if (n == null || !isFinite(n)) return "—";
      const loc = CONFIG.NUMBER_SYSTEM === "latn" ? "ar-EG-u-nu-latn" : CONFIG.LOCALE;
      try {
        return new Intl.NumberFormat(loc, { maximumFractionDigits: digits == null ? 1 : digits, minimumFractionDigits: digits == null ? 0 : digits }).format(n);
      } catch (e) {
        return n.toFixed(digits == null ? 1 : digits);
      }
    },
    pct: function (n, digits) {
      if (n == null || !isFinite(n)) return "—";
      return pctFmt().format(n) + "٪";
    },
    signedPct: function (n, digits) {
      if (n == null || !isFinite(n)) return "—";
      const s = n > 0 ? "+" : n < 0 ? "−" : "";
      return s + pctFmt().format(Math.abs(n)) + "٪";
    },
    signed: function (n, digits) {
      if (n == null || !isFinite(n)) return "—";
      const s = n > 0 ? "+" : n < 0 ? "−" : "";
      return s + Fmt.dec(Math.abs(n), digits == null ? 1 : digits);
    },
    hours: function (h) {
      if (h == null || !isFinite(h)) return "—";
      if (h >= 48) return Fmt.dec(h / 24, 1) + " يوم";
      if (h >= 1.05) return Fmt.dec(h, 1) + " ساعة";
      const m = Math.max(Math.round(h * 60), 1);
      return m + " دقيقة";
    },
    date: function (d) { return d ? stamp(d) : "—"; },
    time: function (d) { return d ? timeOnly(d) : "—"; },
    ago: function (ts) {
      if (!ts) return "—";
      const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
      if (s < 60) return "الآن";
      const m = Math.floor(s / 60);
      if (m < 60) return "منذ " + m + " دقيقة";
      const h = Math.floor(m / 60);
      if (h < 24) return "منذ " + h + " ساعة";
      const d = Math.floor(h / 24);
      return "منذ " + d + " يوم";
    },
    duration: function (ms) {
      if (ms == null || !isFinite(ms)) return "—";
      const total = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(total / 60), s = total % 60;
      return m + ":" + String(s).padStart(2, "0");
    },
  };

  return {
    HOUR: HOUR,
    DAY: DAY,
    AR_DAYS: AR_DAYS,
    dayKey: dayKey,
    hourKey: hourKey,
    dayLabel: dayLabel,
    hourLabel: hourLabel,
    hourRangeLabel: hourRangeLabel,
    shortDate: shortDate,
    calculateTotalRegistrations: calculateTotalRegistrations,
    countInWindow: countInWindow,
    countToday: countToday,
    calculateRegistrationVelocity: calculateRegistrationVelocity,
    calculateDailyRate: calculateDailyRate,
    calculateHourlyRate: calculateHourlyRate,
    calculateGrowthRate: calculateGrowthRate,
    velocityChange: velocityChange,
    calculateAchievementRate: calculateAchievementRate,
    calculateTargetPace: calculateTargetPace,
    expectedToDate: expectedToDate,
    calculateCurrentPace: calculateCurrentPace,
    paceGapPercent: paceGapPercent,
    paceVerdict: paceVerdict,
    calculateProjection: calculateProjection,
    calculatePeakHour: calculatePeakHour,
    calculatePeakDay: calculatePeakDay,
    buildTimeline: buildTimeline,
    buildHeatmap: buildHeatmap,
    distribution: distribution,
    groupBy: groupBy,
    crossTab: crossTab,
    facets: facets,
    stats: stats,
    ageGroupOf: ageGroupOf,
    ageDistribution: ageDistribution,
    eventsComparison: eventsComparison,
    achievementStatus: achievementStatus,
    calculateDataQuality: calculateDataQuality,
    Fmt: Fmt,
  };
})();

/* Expose for classic-script (file://) consumption — no modules. */
  window.Metrics = Metrics;
  window.Fmt = Metrics.Fmt;