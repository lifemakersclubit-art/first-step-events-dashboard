/**
 * ============================================================
    FIRST STEP EVENTS — Registration Intelligence
    js/filter-engine.js — Builds dashboard payload from filtered dataset
   ------------------------------------------------------------
    v2 changes:
      • Inverted index (value -> record indices) so filtering is O(matches)
        instead of O(total) per filter key.
      • quality decoded from the compact bitmask (rec.q) the backend sends,
        with a fallback to the legacy rec.quality object.
      • Filter options are derived from the FULL dataset once, so dropdowns
        keep every value while a filter is active (no self-shrinking menus).
      • Distribution emits a consistent {name,count,percentage} shape.
   ============================================================
 */

var FilterEngine = (function () {
  'use strict';

  /* Bit order must match Q_KEYS in Code.gs */
  var Q_KEYS = [
    'hasName', 'hasPhone', 'hasWhatsapp', 'hasEmail', 'hasCollege',
    'hasAge', 'hasGender', 'hasEvent', 'hasSource',
    'invalidEmail', 'invalidPhone', 'invalidAge',
    'dupNationalId', 'dupEmail', 'dupPhone'
  ];

  var Q_BIT = {};
  Q_KEYS.forEach(function (k, i) { Q_BIT[k] = i; });

  /* filter key -> record field */
  var FILTER_KEYS = {
    event: 'event',
    governorate: 'governorate',
    university: 'university',
    gender: 'gender',
    status: 'studentStatus',
    volunteer: 'volunteer',
    source: 'eventSource'
  };

  /* keys we build facets + index for */
  var FACET_KEYS = [
    'event', 'governorate', 'university', 'gender',
    'studentStatus', 'volunteer', 'eventSource',
    'academicYear', 'college', 'age'
  ];

  var UNKNOWN = 'غير محدد';

  /* The sheet is a free-text form and we have live rows carrying "12", "78"
     and a full 14-digit national ID in the age column. Only plausible ages are
     charted; the rest are already reported by the quality panel
     ("سن غير منطقي"), so they never reach a chart. Must match AGE_MIN/AGE_MAX
     in google-apps-script/Code.gs. */
  var AGE_MIN = 14;
  var AGE_MAX = 70;

  function present(v) {
    return v != null && String(v).trim() !== '';
  }

  function unknown(v) {
    return v == null || v === '' || v === UNKNOWN;
  }

  function plausibleAge(v) {
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) && n >= AGE_MIN && n <= AGE_MAX;
  }

  /**
   * Reads a quality flag from a record.
   * Prefers the bitmask (rec.q) — 15 booleans cost ~8 bytes instead of ~230.
   * Falls back to the legacy rec.quality object for older cached payloads.
   */
  function qflag(rec, key) {
    if (!rec) return false;
    if (typeof rec.q === 'number') {
      var bit = Q_BIT[key];
      if (bit === undefined) return false;
      return (rec.q & (1 << bit)) !== 0;
    }
    return !!(rec.quality && rec.quality[key]);
  }

  /* ------------------------------------------------------------------
     Index
     ------------------------------------------------------------------ */

  var indexCache = null;   /* rows ref the index was built from */
  var optionsCache = null; /* facets for the full dataset */

  /**
   * Builds value -> [rowIndex] maps for every faceted field in one pass.
   * Costs a single O(n * keys) walk, then every filter is a hash lookup.
   */
  function buildIndex(rows) {
    var index = { __by: rows, __maps: Object.create(null) };
    for (var f = 0; f < FACET_KEYS.length; f++) index.__maps[FACET_KEYS[f]] = new Map();

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      for (var k = 0; k < FACET_KEYS.length; k++) {
        var field = FACET_KEYS[k];
        var v = r[field];
        if (v == null || v === '') continue;
        var map = index.__maps[field];
        var bucket = map.get(v);
        if (bucket) bucket.push(i);
        else map.set(v, [i]);
      }
    }
    return index;
  }

  function ensureIndex(rows) {
    if (indexCache && indexCache.__by === rows) return indexCache;
    indexCache = buildIndex(rows);
    return indexCache;
  }

  function activeFilters(filters) {
    var out = [];
    var f = filters || {};
    Object.keys(FILTER_KEYS).forEach(function (key) {
      var v = f[key];
      if (v != null && v !== '' && v !== 'all') out.push([FILTER_KEYS[key], v]);
    });
    if (f.from != null && f.from !== '') out.push(['__from', Number(f.from)]);
    if (f.to != null && f.to !== '') out.push(['__to', Number(f.to)]);
    return out;
  }

  function intersect(a, b) {
    var small = a.length <= b.length ? a : b;
    var large = a.length <= b.length ? b : a;
    var set = new Set(small);
    var out = [];
    for (var i = 0; i < large.length; i++) {
      if (set.has(large[i])) out.push(large[i]);
    }
    return out;
  }

  /**
   * Filters records. Uses the inverted index for categorical keys and falls
   * back to a linear scan for date bounds (which are range, not equality).
   */
  function applyFilters(records, filters, index) {
    if (!records || !records.length) return [];

    var picks = activeFilters(filters);
    if (!picks.length) return records.slice();

    var idx = index || ensureIndex(records);
    var matched = null;
    var ranges = [];

    for (var i = 0; i < picks.length; i++) {
      var field = picks[i][0];
      var value = picks[i][1];

      if (field === '__from' || field === '__to') {
        ranges.push([field, value]);
        continue;
      }

      var bucket = idx.__maps[field] && idx.__maps[field].get(value);
      if (!bucket || !bucket.length) return [];
      matched = matched === null ? bucket.slice() : intersect(matched, bucket);
      if (!matched.length) return [];
    }

    var out;
    if (matched === null) {
      out = records.slice();
    } else {
      out = new Array(matched.length);
      for (var j = 0; j < matched.length; j++) out[j] = records[matched[j]];
    }

    if (!ranges.length) return out;

    var from = null, to = null;
    ranges.forEach(function (r) {
      if (r[0] === '__from') from = r[1];
      else to = r[1];
    });

    return out.filter(function (r) {
      if (from != null && r.ts < from) return false;
      if (to != null && r.ts > to) return false;
      return true;
    });
  }

  /* ------------------------------------------------------------------
     Facets (options for the filter bar) — computed once per dataset
     ------------------------------------------------------------------ */

  function facetsOf(records, field) {
    var seen = new Set();
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var v = records[i][field];
      if (unknown(v)) continue;
      if (field === 'age' && !plausibleAge(v)) continue;
      var k = String(v);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    out.sort(function (a, b) { return String(a).localeCompare(String(b), 'ar'); });
    return out;
  }

  function facets(records, field) {
    return facetsOf(records, field);
  }

  function allFacets(records) {
    return {
      events: facetsOf(records, 'event'),
      governorates: facetsOf(records, 'governorate'),
      universities: facetsOf(records, 'university'),
      genders: facetsOf(records, 'gender'),
      statuses: facetsOf(records, 'studentStatus'),
      volunteers: facetsOf(records, 'volunteer'),
      sources: facetsOf(records, 'eventSource'),
      ages: facetsOf(records, 'age'),
      years: facetsOf(records, 'academicYear'),
      colleges: facetsOf(records, 'college')
    };
  }

  function optionsFor(rows) {
    if (optionsCache && optionsCache.__by === rows) return optionsCache;
    var o = allFacets(rows);
    o.__by = rows;
    optionsCache = o;
    return o;
  }

  /* ------------------------------------------------------------------
     Distributions
     ------------------------------------------------------------------ */

  /**
   * Counts records by one field. Emits {name,count,percentage} plus the
   * legacy label/pct aliases so both chart and list consumers keep working.
   */
  function distribution(records, field, opts) {
    opts = opts || {};
    var getter = typeof field === 'function' ? field : function (r) { return r[field]; };
    var counts = Object.create(null);
    var total = 0;

    for (var i = 0; i < records.length; i++) {
      var v = getter(records[i]);
      if (!opts.excludeUnknown || !unknown(v)) {
        if (field === 'age' && !plausibleAge(v)) continue;
        counts[v] = (counts[v] || 0) + 1;
        total++;
      }
    }

    var arr = Object.keys(counts).map(function (k) {
      var p = total ? (counts[k] / total) * 100 : 0;
      return {
        name: k,
        label: k,
        count: counts[k],
        percentage: p,
        pct: p
      };
    });

    arr.sort(function (a, b) { return b.count - a.count; });
    if (opts.limit) arr = arr.slice(0, opts.limit);
    return arr;
  }

  function stats(values) {
    var nums = values.filter(function (v) { return typeof v === 'number'; });
    if (!nums.length) return { avg: null, min: null, max: null };
    var sum = 0, min = nums[0], max = nums[0];
    for (var i = 0; i < nums.length; i++) {
      sum += nums[i];
      if (nums[i] < min) min = nums[i];
      if (nums[i] > max) max = nums[i];
    }
    return { avg: sum / nums.length, min: min, max: max };
  }

  function dailySeries(records) {
    var map = Object.create(null);
    for (var i = 0; i < records.length; i++) {
      var d = new Date(records[i].ts);
      d.setHours(0, 0, 0, 0);
      var k = d.getTime();
      map[k] = (map[k] || 0) + 1;
    }
    return Object.keys(map).map(function (k) {
      return { date: parseInt(k, 10), count: map[k] };
    }).sort(function (a, b) { return a.date - b.date; });
  }

  /* ------------------------------------------------------------------
     Quality
     ------------------------------------------------------------------ */

  var QUALITY_CHECKS = [
    { key: 'hasName', label: 'اسم غير موجود' },
    { key: 'hasPhone', label: 'رقم الهاتف غير موجود' },
    { key: 'hasWhatsapp', label: 'رقم الواتساب غير موجود' },
    { key: 'hasEmail', label: 'بريد إلكتروني غير موجود' },
    { key: 'hasCollege', label: 'كلية/جامعة غير محددة' },
    { key: 'hasAge', label: 'السن غير موجود' },
    { key: 'hasGender', label: 'النوع غير محدد' },
    { key: 'hasEvent', label: 'الإيفنت غير محدد' },
    { key: 'hasSource', label: 'مصدر التسجيل غير محدد' }
  ];

  var QUALITY_INVALID = [
    { key: 'invalidEmail', label: 'بريد إلكتروني غير صالح' },
    { key: 'invalidPhone', label: 'رقم هاتف غير صالح' },
    { key: 'invalidAge', label: 'سن غير منطقي' },
    { key: 'dupNationalId', label: 'تكرار في الرقم القومي' },
    { key: 'dupEmail', label: 'تكرار في البريد الإلكتروني' },
    { key: 'dupPhone', label: 'تكرار في رقم الهاتف' }
  ];

  function buildQuality(records) {
    var total = records.length;
    if (!total) return { score: 100, completeness: 100, validity: 100, missingTotal: 0, issueTotal: 0, issues: [], total: 0 };

    var missing = new Array(QUALITY_CHECKS.length);
    var invalid = new Array(QUALITY_INVALID.length);
    var i, b;
    for (b = 0; b < missing.length; b++) missing[b] = 0;
    for (b = 0; b < invalid.length; b++) invalid[b] = 0;

    /* Single pass over records, bit-testing only — no per-key object reads.
       QUALITY_CHECKS are "has*" flags, so a field is MISSING when false. */
    for (i = 0; i < total; i++) {
      var rec = records[i];
      for (b = 0; b < QUALITY_CHECKS.length; b++) if (!qflag(rec, QUALITY_CHECKS[b].key)) missing[b]++;
      for (b = 0; b < QUALITY_INVALID.length; b++) if (qflag(rec, QUALITY_INVALID[b].key)) invalid[b]++;
    }

    var completenessSum = 0;
    var issues = [];

    for (b = 0; b < QUALITY_CHECKS.length; b++) {
      var pctMissing = (missing[b] / total) * 100;
      completenessSum += (100 - pctMissing);
      if (missing[b] > 0) {
        issues.push({
          label: QUALITY_CHECKS[b].label,
          count: missing[b],
          pct: pctMissing,
          severity: pctMissing > 20 ? 'critical' : pctMissing > 5 ? 'attention' : 'excellent'
        });
      }
    }

    var invalidTotal = 0;
    for (b = 0; b < QUALITY_INVALID.length; b++) {
      if (!invalid[b]) continue;
      invalidTotal += invalid[b];
      issues.push({
        label: QUALITY_INVALID[b].label,
        count: invalid[b],
        pct: (invalid[b] / total) * 100,
        severity: 'critical'
      });
    }

    var completeness = completenessSum / QUALITY_CHECKS.length;
    /* Validity covers every defect, duplicates included — they are invalid data
       just as much as a malformed email. MUST match the server's breakdown. */
    var validity = 100 - (invalidTotal / total) * 100;    var score = Math.round(0.7 * completeness + 0.3 * validity);
    var missingTotal = 0;
    for (b = 0; b < missing.length; b++) missingTotal += missing[b];

    return {
      score: Math.max(0, Math.min(100, score)),
      completeness: Math.round(completeness * 10) / 10,
      validity: Math.round(validity * 10) / 10,
      missingTotal: missingTotal,
      issueTotal: issues.length,
      issues: issues,
      total: total
    };
  }

  /* ------------------------------------------------------------------
     Payload
     ------------------------------------------------------------------ */

  var EMPTY_PAYLOAD = {
    success: true,
    summary: {},
    daily: [],
    events: [],
    governorates: [],
    genders: [],
    ages: [],
    years: [],
    colleges: [],
    quality: {},
    options: {}
  };

  function buildPayload(dataset, filters) {
    var rows = (dataset && dataset.rows) || [];
    if (!rows.length) return EMPTY_PAYLOAD;

    var idx = ensureIndex(rows);
    var filtered = applyFilters(rows, filters, idx);

    var total = filtered.length;
    var unfiltered = rows.length;

    var daily = dailySeries(filtered);

    var events = distribution(filtered, 'event', { excludeUnknown: true }).map(function (e) {
      return {
        name: e.name,
        count: e.count,
        percentage: e.percentage,
        digest: 'متوسط ' + (e.count / Math.max(1, daily.length)).toFixed(1) + ' / يوم'
      };
    });

    var lastSubmissionAt = null;
    if (total) {
      /* Do not assume the rows are sorted — take a real max. */
      var newest = -Infinity;
      for (var t = 0; t < total; t++) {
        if (filtered[t].ts > newest) newest = filtered[t].ts;
      }
      lastSubmissionAt = newest === -Infinity ? null : newest;
    }

    return {
      success: true,
      generatedAt: new Date().toISOString(),
      summary: {
        totalRegistrations: total,
        totalUnfiltered: unfiltered,
        uniqueEvents: events.length,
        governorates: distribution(filtered, 'governorate', { excludeUnknown: true }).length,
        activeDays: daily.length,
        lastSubmissionAt: lastSubmissionAt
      },
      daily: daily,
      events: events,
      governorates: distribution(filtered, 'governorate', { excludeUnknown: true }),
      genders: distribution(filtered, 'gender', { excludeUnknown: true }),
      ages: distribution(filtered, 'age', { excludeUnknown: true }),
      years: distribution(filtered, 'academicYear', { excludeUnknown: true }),
      colleges: distribution(filtered, 'college', { excludeUnknown: true, limit: 10 }),
      quality: buildQuality(filtered),
      options: optionsFor(rows)
    };
  }

  /** Drops memoised state (call when a new dataset arrives). */
  function reset() {
    indexCache = null;
    optionsCache = null;
  }

  return {
    buildPayload: buildPayload,
    applyFilters: applyFilters,
    buildIndex: buildIndex,
    reset: reset,
    facets: facets,
    allFacets: allFacets,
    optionsFor: optionsFor,
    distribution: distribution,
    dailySeries: dailySeries,
    buildQuality: buildQuality,
    stats: stats,
    qflag: qflag,
    Q_KEYS: Q_KEYS
  };
})();
