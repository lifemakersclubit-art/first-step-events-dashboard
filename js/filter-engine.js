/**
 * ============================================================
   FIRST STEP EVENTS — Registration Intelligence
   js/filter-engine.js — Builds dashboard payload from filtered dataset
   ============================================================
 */

var FilterEngine = (function () {
  'use strict';

  function present(v) {
    return v != null && String(v).trim() !== '';
  }

  function countDuplicates(values) {
    var seen = new Map();
    var dup = new Set();
    for (var i = 0; i < values.length; i++) {
      var v = values[i];
      if (!present(v)) continue;
      var k = Schema.compact(v);
      if (seen.has(k)) dup.add(i);
      else seen.set(k, i);
    }
    var flags = new Array(values.length).fill(false);
    dup.forEach(function (i) { flags[i] = true; });
    return flags;
  }

  function matchOne(rec, filter) {
    if (filter.event && rec.event !== filter.event) return false;
    if (filter.governorate && rec.governorate !== filter.governorate) return false;
    if (filter.university && rec.university !== filter.university) return false;
    if (filter.gender && rec.gender !== filter.gender) return false;
    if (filter.status && rec.studentStatus !== filter.status) return false;
    if (filter.volunteer && rec.volunteer !== filter.volunteer) return false;
    if (filter.source && rec.eventSource !== filter.source) return false;
    if (filter.from && rec.ts < filter.from) return false;
    if (filter.to && rec.ts > filter.to) return false;
    return true;
  }

  function applyFilters(records, filters) {
    if (!records || !records.length) return [];
    var f = filters || {};
    var active = Object.keys(f).some(function (k) { return f[k] != null && f[k] !== '' && f[k] !== 'all'; });
    if (!active) return records.slice();
    var out = [];
    for (var i = 0; i < records.length; i++) {
      if (matchOne(records[i], f)) out.push(records[i]);
    }
    return out;
  }

  function facets(records, key) {
    var set = new Set();
    for (var i = 0; i < records.length; i++) {
      var v = records[i][key];
      if (v != null && v !== '' && v !== 'غير محدد') set.add(v);
    }
    return Array.from(set).sort(function (a, b) { return String(a).localeCompare(String(b), 'ar'); });
  }

  function allFacets(records) {
    var unis = facets(records, 'university');
    var govs = facets(records, 'governorate');
    return {
      events: facets(records, 'event'),
      governorates: govs,
      universities: unis,
      genders: facets(records, 'gender'),
      statuses: facets(records, 'studentStatus'),
      volunteers: facets(records, 'volunteer'),
      sources: facets(records, 'eventSource'),
      ages: facets(records, 'age'),
      years: facets(records, 'academicYear'),
      colleges: facets(records, 'college')
    };
  }

  function distribution(records, getter, opts) {
    opts = opts || {};
    var counts = {};
    var total = 0;
    for (var i = 0; i < records.length; i++) {
      var v = getter(records[i]);
      if (!opts.excludeUnknown || (v != null && v !== '' && v !== 'غير محدد')) {
        counts[v] = (counts[v] || 0) + 1;
        total++;
      }
    }
    var arr = Object.keys(counts).map(function (k) {
      return { label: k, count: counts[k], pct: total ? (counts[k] / total) * 100 : 0 };
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

  function buildPayload(dataset, filters) {
    if (!dataset || !dataset.rows || !dataset.rows.length) {
      return { success: true, summary: {}, daily: [], events: [], governorates: [], genders: [], ages: [], years: [], colleges: [], quality: {}, options: {} };
    }

    var filtered = applyFilters(dataset.rows, filters);

    // Summary
    var total = filtered.length;
    var unfiltered = dataset.rows.length;

    // Daily aggregation
    var dailyMap = {};
    for (var i = 0; i < filtered.length; i++) {
      var rec = filtered[i];
      var d = new Date(rec.ts);
      d.setHours(0, 0, 0, 0);
      var key = d.getTime();
      dailyMap[key] = (dailyMap[key] || 0) + 1;
    }
    var daily = Object.keys(dailyMap).map(function (k) {
      return { date: parseInt(k), count: dailyMap[k] };
    }).sort(function (a, b) { return a.date - b.date; });

    // Events
    var eventDist = distribution(filtered, function (r) { return r.event; }, { excludeUnknown: true });
    var events = eventDist.map(function (e) {
      return {
        name: e.label,
        count: e.count,
        percentage: e.pct,
        digest: 'متوسط ' + (e.count / Math.max(1, daily.length)).toFixed(1) + ' / يوم'
      };
    });

    // Governorates
    var govDist = distribution(filtered, function (r) { return r.governorate; }, { excludeUnknown: true });
    var governorates = govDist.map(function (g) {
      return { name: g.label, count: g.count, percentage: g.pct };
    });

    // Genders
    var genders = distribution(filtered, function (r) { return r.gender; }, { excludeUnknown: true });

    // Ages
    var ages = distribution(filtered, function (r) { return r.age; }, { excludeUnknown: true });

    // Years
    var years = distribution(filtered, function (r) { return r.academicYear; }, { excludeUnknown: true });

    // Colleges
    var colleges = distribution(filtered, function (r) { return r.college; }, { excludeUnknown: true, limit: 10 });

    // Quality
    var quality = buildQuality(filtered);

    // Options for filters
    var options = allFacets(filtered);

    // Last submission
    var lastSubmissionAt = filtered.length ? Math.max.apply(null, filtered.map(function (r) { return r.ts; })) : null;

    var payload = {
      success: true,
      generatedAt: new Date().toISOString(),
      summary: {
        totalRegistrations: total,
        totalUnfiltered: unfiltered,
        uniqueEvents: events.length,
        governorates: governorates.length,
        activeDays: daily.length,
        lastSubmissionAt: lastSubmissionAt
      },
      daily: daily,
      events: events,
      governorates: governorates,
      genders: genders,
      ages: ages,
      years: years,
      colleges: colleges,
      quality: quality,
      options: options
    };

    return payload;
  }

  function buildQuality(records) {
    if (!records.length) return { score: 100, issues: [], total: 0 };

    var total = records.length;
    var checks = [
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

    var completenessSum = 0;
    var issues = [];

    for (var c = 0; c < checks.length; c++) {
      var chk = checks[c];
      var missing = 0;
      for (var i = 0; i < records.length; i++) {
        if (!records[i].quality[chk.key]) missing++;
      }
      var pct = total ? (missing / total) * 100 : 0;
      completenessSum += (100 - pct);
      if (missing > 0) {
        issues.push({
          label: chk.label,
          count: missing,
          pct: pct,
          severity: pct > 20 ? 'critical' : pct > 5 ? 'attention' : 'excellent'
        });
      }
    }

    // Validity checks
    var invalidEmail = 0, invalidPhone = 0, invalidAge = 0;
    for (var j = 0; j < records.length; j++) {
      if (records[j].quality.invalidEmail) invalidEmail++;
      if (records[j].quality.invalidPhone) invalidPhone++;
      if (records[j].quality.invalidAge) invalidAge++;
    }
    if (invalidEmail) issues.push({ label: 'بريد إلكتروني غير صالح', count: invalidEmail, pct: (invalidEmail/total)*100, severity: 'critical' });
    if (invalidPhone) issues.push({ label: 'رقم هاتف غير صالح', count: invalidPhone, pct: (invalidPhone/total)*100, severity: 'critical' });
    if (invalidAge) issues.push({ label: 'سن غير منطقي', count: invalidAge, pct: (invalidAge/total)*100, severity: 'critical' });

    // Duplicates
    var dupNationalId = 0, dupEmail = 0, dupPhone = 0;
    for (var k = 0; k < records.length; k++) {
      if (records[k].quality.dupNationalId) dupNationalId++;
      if (records[k].quality.dupEmail) dupEmail++;
      if (records[k].quality.dupPhone) dupPhone++;
    }
    if (dupNationalId) issues.push({ label: 'تكرار في الرقم القومي', count: dupNationalId, pct: (dupNationalId/total)*100, severity: 'critical' });
    if (dupEmail) issues.push({ label: 'تكرار في البريد الإلكتروني', count: dupEmail, pct: (dupEmail/total)*100, severity: 'critical' });
    if (dupPhone) issues.push({ label: 'تكرار في رقم الهاتف', count: dupPhone, pct: (dupPhone/total)*100, severity: 'critical' });

    var completeness = total ? (completenessSum / checks.length) : 100;
    var validity = total ? (100 - ((invalidEmail + invalidPhone + invalidAge) / total) * 100) : 100;
    var score = Math.round(0.7 * completeness + 0.3 * validity);

    return {
      score: Math.max(0, Math.min(100, score)),
      completeness: Math.round(completeness * 10) / 10,
      validity: Math.round(validity * 10) / 10,
      missingTotal: issues.reduce(function (s, i) { return s + i.count; }, 0),
      issueTotal: issues.length,
      issues: issues,
      total: total
    };
  }

  return {
    buildPayload: buildPayload,
    applyFilters: applyFilters,
    facets: facets,
    allFacets: allFacets,
    distribution: distribution,
    stats: stats
  };
})();