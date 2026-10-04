/* ==========================================================================
   schema.js — Dynamic Google-Sheet header mapping + normalization.
   We resolve columns by HEADER NAME (never by index) and normalize Arabic
   text so that أ/إ/آ, ة/ه, ى/ي, diacritics and punctuation never break matching.
   ========================================================================== */

const Schema = (function () {
  /* ------------------------------------------------------------------
     Canonical field definitions.
     aliases: extra header spellings we may encounter in the sheet.
     sensitive: PII — never rendered, never logged.
     ------------------------------------------------------------------ */
  const FIELDS = [
    { key: "_id", label: "المعرّف", system: true },
    { key: "_uuid", label: "المعرّف الموحد", system: true },
    { key: "_submission_time", label: "وقت التسجيل", system: true, type: "datetime",
      aliases: ["timestamp", "التاريخ والوقت", "وقت الإرسال", "submission time", "time"] },

    {
      key: "event",
      label: "الإيفنت",
      aliases: ["ما الايفنت الذي ترغب في التسجيل به وحضوره", "ال ايفنت", "الاييفنت", "اسم الايفنت"],
    },
    { key: "fullName", label: "الاسم بالكامل", sensitive: true, aliases: ["الاسم بالكامل", "الاسم"] },
    { key: "phone", label: "رقم الهاتف", sensitive: true, aliases: ["رقم الهاتف", "الهاتف"] },
    { key: "whatsapp", label: "رقم الواتساب", sensitive: true, aliases: ["رقم الواتساب", "الواتساب", "واتساب"] },
    { key: "nationalId", label: "الرقم القومي", sensitive: true, aliases: ["الرقم القومي", "الرقم القومى"] },
    { key: "age", label: "السن", type: "number", aliases: ["السن", "العمر"] },
    { key: "gender", label: "النوع", aliases: ["النوع", "الجندر"] },
    { key: "email", label: "البريد الإلكتروني", sensitive: true, aliases: ["البريد الالكتروني", "الايميل", "البريد"] },
    { key: "college", label: "الكلية", aliases: ["الكلية", "الكلية او الجامعة", "القسم"] },
    { key: "university", label: "الجامعة", aliases: ["الجامعة", "الجامعه"] },
    { key: "governorate", label: "المحافظة", aliases: ["المحافظة", "المحافظه"] },

    {
      key: "studentStatus",
      label: "طالب أم خريج",
      aliases: ["هل انت طالب أم خريج", "طالب ام خريج", "الصف الدراسي"],
    },
    {
      key: "academicYear",
      label: "السنة الدراسية",
      aliases: [
        "اذا كنت طالبا ما السنة الدراسية التي تدرس بها حاليا",
        "السنة الدراسية",
        "سنه دراسيه",
      ],
    },
    {
      key: "volunteer",
      label: "متطوع حاليًا",
      aliases: [
        "هل انت متطوع حاليا في اندية صناع الحياة بالجامعات المصرية",
        "هل أنت متطوع حاليًا في نوادي صناع الحياة بالجامعات المصرية؟",
        "هل انت متطوع حاليا في نوادي صناع الحياة بالجامعات المصرية",
        "متطوع في نوادي صناع الحياة",
      ],
    },
    {
      key: "discoveryChannel",
      label: "أول تعارف بالنوادي",
      aliases: [
        "كيف تعرفت على اندية صناع الحياة بالجامعات المصرية لاول مرة",
        "كيف تعرفت على نوادي صناع الحياة بالجامعات المصرية لأول مرة؟",
        "كيف تعرفت على نوادي صناع الحياة بالجامعات المصرية لاول مرة",
        "كيف تعرفت على نوادي صناع الحياة",
        "اول مرة",
      ],
    },
    {
      key: "eventSource",
      label: "مصدر معرفة الإيفنت",
      aliases: ["كيف تعرفت على هذا الايفنت", "مصدر التسجيل", "كيف سمعت عن الايفنت"],
    },
    { key: "interest", label: "المجال محل الاهتمام", aliases: ["ما المجال الذي تهتم به أكثر", "المجال", "اهتمام"] },
    { key: "goal", label: "الهدف الأساسي", aliases: ["ما هدفك الاساسي من حضور الايفنت", "الهدف"] },
    {
      key: "expectation",
      label: "المطلوب من الإيفنت",
      aliases: [
        "ما اكثر شيء تحب ان تراه او تستفيد منه خلال الايفنت",
        "المتوقع من الايفنت",
        "ماذا تريد من الايفنت",
      ],
    },
    { key: "participantId", label: "Participant ID", sensitive: true, aliases: ["participant id", "معرف المشارك"] },
    { key: "qrCode", label: "QR Code", sensitive: true, aliases: ["qr code", "رمز qr"] },
    { key: "emailStatus", label: "Email Status", sensitive: true, aliases: ["email status", "حالة البريد"] },
  ];

  /* ------------------------------------------------------------------
     Text normalization
     ------------------------------------------------------------------ */
  const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

  function normalizeText(v) {
    if (v == null) return "";
    return String(v)
      .replace(DIACRITICS, "")
      .replace(/[\u0622\u0623\u0625]/g, "\u0627")
      .replace(/\u0629/g, "\u0647")
      .replace(/\u0649/g, "\u064A")
      .replace(/[\u200f\u200e]/g, "")
      .replace(/[^\w\u0621-\u064A]+/g, " ")
      .trim()
      .toLowerCase();
  }

  /** Comparison key: also collapses spaces so "بن ها" == "بنها". */
  function compact(v) {
    return normalizeText(v).replace(/\s+/g, "");
  }

  /**
   * Loose equality key for value canonicalisation. Arabic form feeds disagree
   * on yeh/alef-maqsura, so "أنثى" (U+0649) and "انثي" (U+064A) must both
   * collapse to the same token before alias matching.
   */
  function looseKey(v) {
    return compact(v).replace(/\u064A/g, "\u0649");
  }

  /* ------------------------------------------------------------------
     Header -> canonical key resolution
     ------------------------------------------------------------------ */
  function buildCandidates(field) {
    const list = [field.label].concat(field.aliases || []);
    return {
      exact: list.map(normalizeText),
      compact: list.map(compact),
    };
  }

  const CANDIDATES = FIELDS.reduce(function (acc, f) {
    acc[f.key] = buildCandidates(f);
    return acc;
  }, {});

  /**
   * Resolves a sheet header row into a { mapping, unmapped, headers } result.
   * Two passes keep precision high: exact/compact matches win first, then a
   * conservative fuzzy pass fills whatever remains. Fields already assigned
   * are skipped so a generic alias can never swallow a later, more specific
   * column (e.g. "الكلية او الجامعة" must not steal "الجامعة").
   */
  function mapHeaders(headerRow) {
    const headers = headerRow || [];
    const mapping = {};
    const used = {};
    const unmapped = [];

    const prepared = headers.map(function (raw) {
      return { raw: raw, n: normalizeText(raw), c: compact(raw) };
    });

    /* ---- pass 1: exact + compact equality ---- */
    prepared.forEach(function (h) {
      if (!h.n) return;
      for (let i = 0; i < FIELDS.length; i++) {
        const f = FIELDS[i];
        if (used[f.key]) continue;
        const cand = CANDIDATES[f.key];
        if (cand.exact.indexOf(h.n) !== -1 || cand.compact.indexOf(h.c) !== -1) {
          mapping[f.key] = headers.indexOf(h.raw);
          used[f.key] = true;
          h.done = true;
          return;
        }
      }
    });

    /* ---- pass 2: conservative fuzzy for leftovers ---- */
    prepared.forEach(function (h) {
      if (!h.n || h.done) return;
      let best = null;
      let bestScore = 0;
      for (let i = 0; i < FIELDS.length; i++) {
        const f = FIELDS[i];
        if (used[f.key]) continue;
        const cand = CANDIDATES[f.key];
        for (let j = 0; j < cand.compact.length; j++) {
          const cc = cand.compact[j];
          if (cc.length < 6) continue;
          if (h.c.indexOf(cc) === -1 && cc.indexOf(h.c) === -1) continue;
          const longest = Math.max(h.c.length, cc.length);
          const score = Math.min(h.c.length, cc.length) / longest;
          if (score > bestScore) { bestScore = score; best = f.key; }
        }
      }
      if (best && bestScore >= 0.5) {
        mapping[best] = headers.indexOf(h.raw);
        used[best] = true;
        h.done = true;
      }
    });

    prepared.forEach(function (h) {
      if (h.n && !h.done) unmapped.push(String(h.raw));
    });

    return { mapping: mapping, unmapped: unmapped, headers: headers };
  }

  /* ------------------------------------------------------------------
     Value coercion
     ------------------------------------------------------------------ */
  function toNumber(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    // Arabic-Indic digits -> ASCII
    const s = String(v)
      .replace(/[\u0660-\u0669]/g, function (d) {
        return String(d.charCodeAt(0) - 0x0660);
      })
      .replace(/[\u06F0-\u06F9]/g, function (d) {
        return String(d.charCodeAt(0) - 0x06F0);
      })
      .replace(/[^\d.\-]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function toDate(v) {
    if (v == null || v === "") return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === "object" && typeof v.value === "string") return toDate(v.value);
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }

  function toText(v) {
    if (v == null) return "";
    if (typeof v === "object") return String(v.formattedValue != null ? v.formattedValue : v.value != null ? v.value : "");
    return String(v).trim();
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
  function isValidEmail(v) {
    return EMAIL_RE.test(String(v || "").trim());
  }
  function isValidPhone(v) {
    const digits = String(v || "").replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
  }
  function isValidAge(n) {
    return n != null && n >= 14 && n <= 70;
  }

  /* ------------------------------------------------------------------
     Row -> canonical record
     ------------------------------------------------------------------ */
  function mapRow(row, mapping) {
    const rec = {};
    FIELDS.forEach(function (f) {
      const idx = mapping[f.key];
      let raw = idx === undefined ? null : row[idx];
      if (f.type === "number") rec[f.key] = toNumber(raw);
      else if (f.type === "datetime") rec[f.key] = toDate(raw);
      else rec[f.key] = toText(raw);
    });
    if (!rec._submission_time) rec._submission_time = null;
    return rec;
  }

  /* ------------------------------------------------------------------
     Geography derivation (no dedicated Governorate column in the sheet)
     ------------------------------------------------------------------ */
  function deriveGeography(record) {
    const explicitUni = normalizeText(record.university);
    const explicitGov = normalizeText(record.governorate);
    const haystack = compact([record.college, explicitUni, explicitGov].filter(Boolean).join(" "));

    if (record.university && record.governorate) {
      return { governorate: record.governorate, university: record.university };
    }

    if (haystack) {
      for (let i = 0; i < CONFIG.GEO_RULES.length; i++) {
        const rule = CONFIG.GEO_RULES[i];
        for (let j = 0; j < rule.keys.length; j++) {
          const k = compact(rule.keys[j]);
          if (k && haystack.indexOf(k) !== -1) {
            return {
              governorate: record.governorate || rule.gov,
              university: record.university || rule.uni,
              matched: true,
            };
          }
        }
      }
    }

    // Fallback: pull "جامعة/كلية X" straight out of the free text.
    if (haystack) {
      const raw = [record.college, record.university].filter(Boolean).join(" ");
      const m = String(raw).match(/(?:جامع[ةه]|كلي[ةه]|معهد|اكاديمي[ةه])\s+[^\s،,.\-]+(?:\s+[^\s،,.\-]+)?/);
      if (m) {
        return {
          governorate: record.governorate || "غير محدد",
          university: record.university || m[0].trim(),
          matched: false,
        };
      }
    }

    return {
      governorate: record.governorate || "غير محدد",
      university: record.university || (record.college ? "غير محدد" : "غير محدد"),
      matched: false,
    };
  }

  /* ------------------------------------------------------------------
     Canonical value aliases for categorical fields
     ------------------------------------------------------------------ */
  const VALUE_ALIASES = {
    gender: { male: ["ذكر", "رجل", "male", "m"], female: ["انثى", "انثه", "بنت", "امراه", "female", "f"] },
    studentStatus: { student: ["طالب", "طالبه", "طالب/", "undergraduate", "student"], graduate: ["خريج", "خريجه", "graduate", "graduated"] },
    volunteer: { yes: ["نعم", "yes", "متطوع", "حالي"], no: ["لا", "no", "لست", "غير متطوع"] },
    academicYear: {
      "السنة الأولى": ["الاولى", "الاوله", "1", "first", "اولى"],
      "السنة الثانية": ["الثانيه", "الثانية", "2", "second"],
      "السنة الثالثة": ["الثالثه", "الثالثة", "3", "third"],
      "السنة الرابعة": ["الرابعه", "الرابعة", "4", "fourth", "خامس"],
      خريج: ["خريج", "خريجه", "graduate"],
    },
  };

  function canonicalValue(field, raw) {
    const text = normalizeText(raw);
    if (!text) return "";
    const table = VALUE_ALIASES[field];
    if (!table) return String(raw).trim();

    const key = looseKey(raw);
    for (const group in table) {
      for (let i = 0; i < table[group].length; i++) {
        const a = looseKey(table[group][i]);
        if (key === a || key.indexOf(a) !== -1) return group;
      }
    }
    return String(raw).trim();
  }

  return {
    FIELDS: FIELDS,
    normalizeText: normalizeText,
    compact: compact,
    looseKey: looseKey,
    mapHeaders: mapHeaders,
    mapRow: mapRow,
    deriveGeography: deriveGeography,
    canonicalValue: canonicalValue,
    toNumber: toNumber,
    toDate: toDate,
    toText: toText,
    isValidEmail: isValidEmail,
    isValidPhone: isValidPhone,
    isValidAge: isValidAge,
    isSensitive: function (key) {
      const f = FIELDS.filter(function (x) {
        return x.key === key;
      })[0];
      return !!(f && f.sensitive);
    },
  };
})();

window.Schema = Schema;