/* ==========================================================================
   data.js — Data layer. Turns a Sheet/API/Demo payload into the canonical
   record set the metrics engine consumes.

   PRIVACY CONTRACT
   ----------------
   Personal data (name, phone, whatsapp, national ID, email, participant ID,
   QR) is read ONLY to compute boolean quality flags, then immediately
   discarded. No record object ever carries PII, so it cannot reach the DOM,
   a log line, or a chart.
   ========================================================================== */

const Data = (function () {
  let state = {
    records: [],
    meta: null,
    source: "none",
    cached: false,
    stale: false,
    updatedAt: null,
    error: null,
  };

  /* ------------------------------------------------------------------
     PII helpers — used transiently, never stored on records
     ------------------------------------------------------------------ */
  function present(v) {
    return v != null && String(v).trim() !== "";
  }

  function countDuplicates(values) {
    const seen = new Map();
    const dup = new Set();
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (!present(v)) continue;
      const k = Schema.compact(v);
      if (seen.has(k)) dup.add(i);
      else seen.set(k, i);
    }
    const flags = new Array(values.length).fill(false);
    dup.forEach(function (i) { flags[i] = true; });
    return flags;
  }

  /* ------------------------------------------------------------------
     حذف أي PII كُتب جوّه حقل نصي حر (بريد في خانة الكلية مثلًا).
     مطابق لـ Code.gs حتى تبقى النتيجة متطابقة.
     ------------------------------------------------------------------ */
  function scrubText(v) {
    if (v == null) return "";
    return String(v)
      .replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, " ")
      .replace(/\b\d{10,15}\b/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function fromSheet(payload) {
    const headers = payload.headers || [];
    const rows = payload.rows || [];
    const mapped = Schema.mapHeaders(headers);
    const mapping = mapped.mapping;

    if (Object.keys(mapping).length === 0) {
      throw new Error("تعذر التعرف على أعمدة الشيت — تحقق من صف العناوين");
    }

    const raw = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) raw[i] = Schema.mapRow(rows[i], mapping);

    const dupNationalId = countDuplicates(raw.map(function (r) { return r.nationalId; }));
    const dupEmail = countDuplicates(raw.map(function (r) { return r.email; }));
    const dupPhone = countDuplicates(raw.map(function (r) { return r.phone; }));

    const records = [];
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const ts = r._submission_time ? r._submission_time.getTime() : null;
      if (ts == null || !isFinite(ts)) continue; // invalid dates are dropped, never guessed

      const geo = Schema.deriveGeography(r);

      records.push({
        ts: ts,
        event: scrubText(r.event),
        gender: Schema.canonicalValue("gender", r.gender),
        age: typeof r.age === "number" ? r.age : null,
        college: scrubText(r.college),
        university: scrubText(geo.university || ""),
        governorate: scrubText(geo.governorate || ""),
        studentStatus: Schema.canonicalValue("studentStatus", r.studentStatus),
        academicYear: Schema.canonicalValue("academicYear", r.academicYear),
        volunteer: Schema.canonicalValue("volunteer", r.volunteer),
        discoveryChannel: scrubText(r.discoveryChannel || ""),
        eventSource: scrubText(r.eventSource || ""),
        interest: scrubText(r.interest || ""),
        goal: scrubText(r.goal || ""),
        expectation: scrubText(r.expectation || ""),
        quality: {
          hasName: present(r.fullName),
          hasPhone: present(r.phone),
          hasWhatsapp: present(r.whatsapp),
          hasEmail: present(r.email),
          hasCollege: present(r.college),
          hasAge: typeof r.age === "number",
          hasGender: present(r.gender),
          hasEvent: present(r.event),
          hasSource: present(r.eventSource),
          invalidEmail: present(r.email) && !Schema.isValidEmail(r.email),
          invalidPhone: present(r.phone) && !Schema.isValidPhone(r.phone),
          invalidAge: typeof r.age === "number" && !Schema.isValidAge(r.age),
          dupNationalId: dupNationalId[i],
          dupEmail: dupEmail[i],
          dupPhone: dupPhone[i],
        },
      });
    }

    records.sort(function (a, b) { return a.ts - b.ts; });

    return {
      records: records,
      meta: Object.assign({}, payload.meta || {}, {
        unmappedColumns: mapped.unmapped,
        mappedColumns: Object.keys(mapping),
        totalRows: rows.length,
        validRows: records.length,
        skippedRows: rows.length - records.length,
      }),
    };
  }

  /* ------------------------------------------------------------------
     Already-normalized records coming from the Apps Script API
     ------------------------------------------------------------------ */
  function fromApi(payload) {
    const rows = payload.records || [];
    const records = rows
      .map(function (r) {
        const ts = typeof r.ts === "number" ? r.ts : new Date(r.ts || r._submission_time).getTime();
        if (!isFinite(ts)) return null;
        return {
          ts: ts,
          event: scrubText(r.event),
          gender: r.gender || "",
          age: typeof r.age === "number" ? r.age : null,
          college: scrubText(r.college),
          university: scrubText(r.university),
          governorate: scrubText(r.governorate),
          studentStatus: r.studentStatus || "",
          academicYear: r.academicYear || "",
          volunteer: r.volunteer || "",
          discoveryChannel: scrubText(r.discoveryChannel),
          eventSource: scrubText(r.eventSource),
          interest: scrubText(r.interest),
          goal: scrubText(r.goal),
          expectation: scrubText(r.expectation),
          quality: r.quality || {},
        };
      })
      .filter(Boolean);
    records.sort(function (a, b) { return a.ts - b.ts; });
    return { records: records, meta: Object.assign({ source: "api" }, payload.meta || {}) };
  }

  /* ------------------------------------------------------------------
     LOAD
     ------------------------------------------------------------------ */
  function load() {
    if (CONFIG.DEMO_MODE) {
      const payload = DemoData.build();
      const out = fromSheet(payload);
      state = {
        records: out.records,
        meta: out.meta,
        source: "demo",
        cached: false,
        stale: false,
        updatedAt: Date.now(),
        error: null,
      };
      return Promise.resolve(state);
    }

    return Api.loadDashboard().then(
      function (res) {
        const payload = res.payload || {};
        const out = payload.records ? fromApi(payload) : fromSheet(payload);
        state = {
          records: out.records,
          meta: Object.assign({ fromCache: !!res.cached }, out.meta || {}),
          source: res.source,
          cached: !!res.cached,
          stale: !!(res.stale || res.cached && res.age > CONFIG.CACHE_TTL),
          updatedAt: payload.updatedAt ? new Date(payload.updatedAt).getTime() : Date.now(),
          error: res.error || null,
        };
        return state;
      },
      function (err) {
        state.error = err;
        return Promise.reject(err);
      }
    );
  }

  /* ------------------------------------------------------------------
     FILTERING
     ------------------------------------------------------------------ */
  function matchOne(rec, filter) {
    if (filter.event && rec.event !== filter.event) return false;
    if (filter.governorate && rec.governorate !== filter.governorate) return false;
    if (filter.university && rec.university !== filter.university) return false;
    if (filter.gender && rec.gender !== filter.gender) return false;
    if (filter.status && rec.studentStatus !== filter.status) return false;
    if (filter.volunteer && rec.volunteer !== filter.volunteer) return false;
    if (filter.source && rec.eventSource !== filter.source) return false;
    if (filter.interest && rec.interest !== filter.interest) return false;
    if (filter.from && rec.ts < filter.from) return false;
    if (filter.to && rec.ts > filter.to) return false;
    return true;
  }

  function applyFilters(records, filters) {
    const f = filters || {};
    if (!records || !records.length) return records ? records.slice() : [];
    const active = Object.keys(f).some(function (k) { return f[k] != null && f[k] !== "" && f[k] !== "all"; });
    if (!active) return records.slice();
    const out = [];
    for (let i = 0; i < records.length; i++) {
      if (matchOne(records[i], f)) out.push(records[i]);
    }
    return out;
  }

  /* ------------------------------------------------------------------
     FACETS — populate the filter dropdowns from real values only
     ------------------------------------------------------------------ */
  function facets(records, key) {
    const set = new Set();
    for (let i = 0; i < records.length; i++) {
      const v = records[i][key];
      if (v != null && v !== "" && v !== "غير محدد") set.add(v);
    }
    return Array.from(set).sort(function (a, b) { return String(a).localeCompare(String(b), "ar"); });
  }

  function allFacets(records) {
    const unis = facets(records, "university");
    const govs = facets(records, "governorate");
    return {
      event: facets(records, "event"),
      governorate: govs,
      university: unis,
      gender: facets(records, "gender"),
      status: facets(records, "studentStatus"),
      volunteer: facets(records, "volunteer"),
      source: facets(records, "eventSource"),
      interest: facets(records, "interest"),
      academicYear: CONFIG.ACADEMIC_YEAR_ORDER.filter(function (y) {
        return records.some(function (r) { return r.academicYear === y; });
      }),
    };
  }

  /** Universities available inside a chosen governorate (chained filters). */
  function universitiesIn(records, governorate) {
    const set = new Set();
    for (let i = 0; i < records.length; i++) {
      if (!governorate || records[i].governorate === governorate) {
        const u = records[i].university;
        if (u && u !== "غير محدد") set.add(u);
      }
    }
    return Array.from(set).sort(function (a, b) { return String(a).localeCompare(String(b), "ar"); });
  }

  function bounds(records) {
    if (!records.length) return null;
    return { from: records[0].ts, to: records[records.length - 1].ts };
  }

  return {
    load: load,
    applyFilters: applyFilters,
    facets: facets,
    allFacets: allFacets,
    universitiesIn: universitiesIn,
    bounds: bounds,
    fromSheet: fromSheet,
    fromApi: fromApi,
    get: function () { return state; },
    setRecords: function (records, meta) {
      state.records = records;
      if (meta) state.meta = Object.assign({}, state.meta, meta);
    },
  };
})();

window.Data = Data;