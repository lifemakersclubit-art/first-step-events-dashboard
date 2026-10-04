/* ==========================================================================
   FIRST STEP EVENTS · Registration Intelligence — Google Apps Script Backend
   --------------------------------------------------------------------------
   الإصدار 3 — مُحسَّن للأداء.

   طريقة التشغيل:
     1) افتح الشيت → Extensions → Apps Script.
     2) الصق هذا الملف كاملًا في Code.gs (احذف أي محتوى قديم).
     3) Deploy → New deployment → Web app → Execute as: Me
        → Who has access: Anyone → Deploy → انسخ رابط /exec.
     4) في اللوحة: js/config.js → CONFIG.BASE_URL + DEMO_MODE = false.

   الأفعال:
     ?action=ping                → فحص صحة + حالة الكاش
     ?action=warm                → بناء/تحديث الكاش مسبقًا (ينفع كـ cron)
     ?action=facets              → خيارات الفلاتر فقط (صغيرة جدًا)
     ?action=rows                → كل السجلات مُصغّرة (للفلترة المحلية)
     ?action=dashboard[&filters] → تجميع مُجهَّز server-side (أسرع، أقل حجمًا)

   فلاتر dashboard (اختيارية، كلها اختيارية):
     &event=&governorate=&university=&gender=&status=&volunteer=&source=
     &from=<ms>&to=<ms>

   معاملات إضافية:
     &full=1        → يرسل حقول interest/goal/expectation/discoveryChannel أيضًا
     &refresh=1     → يتخطى الكاش ويبنيه من جديد
     &callback=fn   → استجابة JSONP

   Privat:
     • لا يُرسل أي اسم/هاتف/واتساب/بريد/رقم قومي إلى المتصفح إطلاقًا.
     • الحقول الحساسة تُقرأ داخليًا فقط وتُختصر في قناع أرقام (bitmask).

   الأداء (v3):
     • CacheService مقسّم إلى chunks (يتجاوز حد 100KB للعنصر الواحد).
     • TTL = 900 ثانية (أقصى CacheService فعلي 21600).
     • Cache hit → لا نفتح الشيت ولا نلمس الشبكة إطلاقًا.
     • القراءة من الشيت محصورة في getLastRow/getLastColumn (بلا صفوف/أعمدة فارغة).
     • quality يُرسل كقناع أرقام بدل 15 مفتاح نصي لكل سجل (~95% توفير).
     • rows يرسل الحقول المستخدمة فقط افتراضيًا.
   ========================================================================== */

/* ==========================================================================
   1. الإعدادات
   ========================================================================== */

var CFG = {
  SPREADSHEET_ID: "1sS8XwonuIQCVuYJWgkmPK-C71b6O65ZDJjZx4OVQINo",

  /* اسم التبويب. اتركه فارغًا "" لاستخدام SHEET_GID ثم أول تبويب. */
  SHEET_NAME: "",

  /* رقم تبويب البيانات (gid من نهاية الرابط #gid=…) */
  SHEET_GID: 1436196095,

  /* مدة الكاش بالثواني. CacheService يسمح حتى 21600 (6 ساعات). */
  CACHE_SECONDS: 900,

  /* حد حجم العنصر الواحد في CacheService (~100KB). نستخدم 90KB احتياطًا. */
  CACHE_CHUNK: 90000,

  /* أقصى عدد أجزاء مسموح به (حارس أمان ضد تلف الكاش). */
  CACHE_MAX_CHUNKS: 64,

  /* نسخة bumped مع كل تغيير في بنية الكاش */
  CACHE_VERSION: "v3"
};

/* ==========================================================================
   2. الحقول المتوقعة في الشيت
   ========================================================================== */

var FIELDS = [
  { key: "_id", label: "المعرّف", system: true },
  { key: "_uuid", label: "المعرّف الموحد", system: true },
  {
    key: "_submission_time",
    label: "وقت التسجيل",
    system: true,
    type: "datetime",
    aliases: ["timestamp", "التاريخ والوقت", "وقت الإرسال", "submission time", "time"]
  },

  {
    key: "event",
    label: "الإيفنت",
    aliases: ["ما الايفنت الذي ترغب في التسجيل به وحضوره", "ال ايفنت", "الاييفنت", "اسم الايفنت"]
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
    aliases: ["هل انت طالب أم خريج", "طالب ام خريج", "الصف الدراسي"]
  },
  {
    key: "academicYear",
    label: "السنة الدراسية",
    aliases: ["اذا كنت طالبا ما السنة الدراسية التي تدرس بها حاليا", "السنة الدراسية", "سنه دراسيه"]
  },
  {
    key: "volunteer",
    label: "متطوع حاليًا",
    aliases: [
      "هل انت متطوع حاليا في اندية صناع الحياة بالجامعات المصرية",
      "هل أنت متطوع حاليًا في صناع الحياة بالجامعات المصرية؟",
      "هل انت متطوع حاليا في نوادي صناع الحياة بالجامعات المصرية",
      "متطوع في صناع الحياة",
      "متطوع"
    ]
  },
  {
    key: "discoveryChannel",
    label: "أول تعارف بالنوادي",
    aliases: [
      "كيف تعرفت على اندية صناع الحياة بالجامعات المصرية لاول مرة",
      "كيف تعرفت على صناع الحياة بالجامعات المصرية لأول مرة؟",
      "كيف تعرفت على اندية صناع الحياة بالجامعات المصرية لاول مرة",
      "كيف تعرفت على صناع الحياة",
      "اول مرة"
    ]
  },
  {
    key: "eventSource",
    label: "مصدر معرفة الإيفنت",
    aliases: ["كيف تعرفت على هذا الايفنت", "مصدر التسجيل", "كيف سمعت عن الايفنت"]
  },
  { key: "interest", label: "المجال محل الاهتمام", aliases: ["ما المجال الذي تهتم به أكثر", "المجال", "اهتمام"] },
  { key: "goal", label: "الهدف الأساسي", aliases: ["ما هدفك الاساسي من حضور الايفنت", "الهدف"] },
  {
    key: "expectation",
    label: "المطلوب من الإيفنت",
    aliases: ["ما اكثر شيء تحب ان تراه او تستفيد منه خلال الايفنت", "المتوقع من الايفنت", "ماذا تريد من الايفنت"]
  },
  { key: "participantId", label: "Participant ID", sensitive: true, aliases: ["participant id", "معرف المشارك"] },
  { key: "qrCode", label: "QR Code", sensitive: true, aliases: ["qr code", "رمز qr"] },
  { key: "emailStatus", label: "Email Status", sensitive: true, aliases: ["email status", "حالة البريد"] }
];

/* الحقول المُصرَّح بإرسالها (بلا PII). */
var OUT_CORE = [
  "ts", "event", "gender", "age", "college", "university", "governorate",
  "studentStatus", "academicYear", "volunteer", "eventSource"
];

/* حقول نصية طويلة — لا تُرسل إلا مع full=1 (تستهلك معظم حجم البيانات). */
var OUT_EXTRA = ["discoveryChannel", "interest", "goal", "expectation"];

/* أعلام الجودة مرتبة = ترتيب البتات في القناع. */
var Q_KEYS = [
  "hasName", "hasPhone", "hasWhatsapp", "hasEmail", "hasCollege",
  "hasAge", "hasGender", "hasEvent", "hasSource",
  "invalidEmail", "invalidPhone", "invalidAge",
  "dupNationalId", "dupEmail", "dupPhone"
];

/* خريطة الفلاتر: اسم الح param → مفتاح السجل. */
var FILTER_MAP = {
  event: "event",
  governorate: "governorate",
  university: "university",
  gender: "gender",
  status: "studentStatus",
  volunteer: "volunteer",
  source: "eventSource"
};

/* ==========================================================================
   3. أدوات النص
   ========================================================================== */

var DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

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

function compact(v) {
  return normalizeText(v).replace(/\s+/g, "");
}

function looseKey(v) {
  return compact(v).replace(/\u064A/g, "\u0649");
}

/* ==========================================================================
   4. توحيد القيم
   ========================================================================== */

/* Group keys ARE the canonical (Arabic) values returned to the browser.
   Matching runs in two passes — exact equality first, then substring — so an
   ambiguous alias can never steal a row: without the exact pass, the alias
   "متطوع" (yes-list) matches inside "غير متطوع" and flips a non-volunteer. */
var VALUE_ALIASES = {
  gender: {
    "ذكر": ["ذكر", "رجل", "male", "m"],
    "أنثى": ["انثى", "انثه", "بنت", "امراه", "انثي", "female", "f"]
  },
  studentStatus: {
    "طالب": ["طالب", "طالبه", "طالب/", "undergraduate", "student"],
    "خريج": ["خريج", "خريجه", "graduate", "graduated"]
  },
  volunteer: {
    "نعم": ["نعم", "نعم،", "yes", "true", "متطوع", "حالي"],
    "لا": ["لا", "لا،", "no", "false", "لست", "غير متطوع", "غيرمتطوع", "ليس"]
  },
  academicYear: {
    "السنة الأولى": ["الاولى", "الاوله", "1", "first", "اولى"],
    "السنة الثانية": ["الثانيه", "الثانية", "2", "second"],
    "السنة الثالثة": ["الثالثه", "الثالثة", "3", "third"],
    "السنة الرابعة": ["الرابعه", "الرابعة", "4", "fourth", "خامس"],
    "خريج": ["خريج", "خريجه", "graduate"]
  }
};

/* Fields where a negation word flips the answer. Checked BEFORE substring
   matching, otherwise the "متطوع" alias inside "لست متطوعا" wins and a
   self-declared non-volunteer gets counted as a volunteer. */
var NEGATIVE_CANONICAL = { volunteer: "لا" };
var NEGATION_RE = /(^|[\s،,])(لا|ليس|لست|غير|لم|لن)([\s،,]|$)/;

/**
 * Normalises a raw cell value to its canonical form.
 * Pass 1 requires an exact (loose) match; only if nothing matches exactly do we
 * fall back to substring matching. That ordering is what keeps
 * "غير متطوع" -> لا instead of being swallowed by the "متطوع" alias.
 */
function canonicalValue(field, raw) {
  if (!normalizeText(raw)) return "";
  var table = VALUE_ALIASES[field];
  if (!table) return String(raw).trim();

  var key = looseKey(raw);
  var groups = Object.keys(table);

  /* pass 1 — exact equality */
  for (var i = 0; i < groups.length; i++) {
    var list = table[groups[i]];
    for (var j = 0; j < list.length; j++) {
      if (key === looseKey(list[j])) return groups[i];
    }
  }

  /* negation guard — must run before substring matching */
  var neg = NEGATIVE_CANONICAL[field];
  if (neg && NEGATION_RE.test(String(raw))) return neg;

  /* pass 2 — conservative substring match (alias contained in the value) */
  for (var g = 0; g < groups.length; g++) {
    var aliases = table[groups[g]];
    for (var k = 0; k < aliases.length; k++) {
      var a = looseKey(aliases[k]);
      if (a.length >= 2 && key.indexOf(a) !== -1) return groups[g];
    }
  }

  return String(raw).trim();
}

/* ==========================================================================
   5. الجغرافيا
   ========================================================================== */

var GEO_RULES = [
  { gov: "القاهرة", uni: "جامعة الأزهر", keys: ["الازهر بالقاهره", "الازهر", "جامعة الازهر"] },
  { gov: "القاهرة", uni: "جامعة القاهرة", keys: ["جامعة القاهره", "القاهره"] },
  { gov: "الدقهلية", uni: "جامعة المنصورة", keys: ["المنصوره", "جامعة المنصوره"] },
  { gov: "البحيرة", uni: "جامعة بنها", keys: ["بنها", "جامعة بنها"] },
  { gov: "قنا", uni: "جامعة قنا", keys: ["قنا", "جامعة قنا"] },
  { gov: "الشرقية", uni: "جامعة الزقازيق", keys: ["الزقازيق", "زقازيق", "الشرقيه"] },
  { gov: "الغربية", uni: "جامعة طنطا", keys: ["طنطا", "جامعة طنطا", "الغربيه"] },
  { gov: "القليوبية", uni: "جامعة بنها فرع بنها", keys: ["بنها فرع بنها", "قليوبيه"] },
  { gov: "أسيوط", uni: "جامعة أسيوط", keys: ["اسيوط", "جامعة اسيوط"] },
  { gov: "الإسكندرية", uni: "جامعة الإسكندرية", keys: ["اسكندريه", "اسكندرية", "جامعة اسكندريه"] },
  { gov: "المنوفية", uni: "جامعة المنوفية", keys: ["منوفيه", "جامعة المنوفيه", "شبين الكوم"] },
  { gov: "كفر الشيخ", uni: "جامعة كفر الشيخ", keys: ["كفر الشيخ"] },
  { gov: "دمياط", uni: "جامعة دمياط", keys: ["دمياط"] },
  { gov: "بورسعيد", uni: "جامعة بورسعيد", keys: ["بورسعيد"] },
  { gov: "السويس", uni: "جامعة السويس", keys: ["السويس"] },
  { gov: "الأقصر", uni: "جامعة الأقصر", keys: ["الاقصر"] },
  { gov: "أسوان", uni: "جامعة أسوان", keys: ["اسوان"] },
  { gov: "المنيا", uni: "جامعة المنيا", keys: ["المنيا", "جامعة المنيا"] },
  { gov: "الفيوم", uni: "جامعة الفيوم", keys: ["الفيوم"] },
  { gov: "بني سويف", uni: "جامعة بني سويف", keys: ["بني سويف", "بنى سويف"] },
  { gov: "الوادي الجديد", uni: "جامعة الوادي الجديد", keys: ["الوادي الجديد", "خاربه"] },
  { gov: "البحر الأحمر", uni: "جامعة الغردقة", keys: ["الغردقه", "البحر الاحمر"] },
  { gov: "مطروح", uni: "جامعة مطروح", keys: ["مطروح"] },
  { gov: "شمال سيناء", uni: "جامعة شمال سيناء", keys: ["شمال سيناء", "العريش"] }
];

function deriveGeography(record) {
  var explicitUni = record.university;
  var explicitGov = record.governorate;
  var haystack = compact([record.college, explicitUni, explicitGov].filter(Boolean).join(" "));

  if (record.university && record.governorate) {
    return { governorate: record.governorate, university: record.university };
  }

  if (haystack) {
    for (var i = 0; i < GEO_RULES.length; i++) {
      var rule = GEO_RULES[i];
      for (var j = 0; j < rule.keys.length; j++) {
        var k = compact(rule.keys[j]);
        if (k && haystack.indexOf(k) !== -1) {
          return {
            governorate: record.governorate || rule.gov,
            university: record.university || rule.uni,
            matched: true
          };
        }
      }
    }
  }

  if (haystack) {
    var raw = [record.college, record.university].filter(Boolean).join(" ");
    var m = String(raw).match(/(?:جامع[ةه]|كلي[ةه]|معهد|اكاديمي[ةه])\s+[^\s،,.\-]+(?:\s+[^\s،,.\-]+)?/);
    if (m) {
      return {
        governorate: record.governorate || "غير محدد",
        university: record.university || m[0].trim(),
        matched: false
      };
    }
  }

  return {
    governorate: record.governorate || "غير محدد",
    university: record.university || "غير محدد",
    matched: false
  };
}

/* ==========================================================================
   6. تحويل القيم والتحقق
   ========================================================================== */

function toNumber(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  var s = String(v)
    .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
    .replace(/[^\d.\-]/g, "");
  var n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function toDate(v) {
  if (v == null || v === "") return null;
  if (Object.prototype.toString.call(v) === "[object Date]") return isNaN(v.getTime()) ? null : v;
  if (typeof v === "object" && typeof v.value === "string") return toDate(v.value);
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function toText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    return String(v.formattedValue != null ? v.formattedValue : v.value != null ? v.value : "");
  }
  return String(v).trim();
}

function present(v) {
  return v != null && String(v).trim() !== "";
}

function scrubText(v) {
  if (v == null) return "";
  return String(v)
    .replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\b\d{10,15}\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function isValidEmail(v) { return EMAIL_RE.test(String(v || "").trim()); }

function isValidPhone(v) {
  var digits = String(v || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isValidAge(n) { return n != null && n >= 14 && n <= 70; }

/* ==========================================================================
   7. مطابقة صف العناوين
   ========================================================================== */

var CANDIDATES = FIELDS.map(function (f) {
  var list = [f.label].concat(f.aliases || []);
  return { key: f.key, exact: list.map(normalizeText), compact: list.map(compact) };
});

function mapHeaders(headerRow) {
  var headers = headerRow || [];
  var mapping = {};
  var used = {};
  var unmapped = [];

  var prepared = headers.map(function (raw, idx) {
    return { raw: raw, idx: idx, n: normalizeText(raw), c: compact(raw) };
  });

  prepared.forEach(function (h) {
    if (!h.n) return;
    for (var i = 0; i < CANDIDATES.length; i++) {
      var cand = CANDIDATES[i];
      if (used[cand.key]) continue;
      if (cand.exact.indexOf(h.n) !== -1 || cand.compact.indexOf(h.c) !== -1) {
        mapping[cand.key] = h.idx;
        used[cand.key] = true;
        h.done = true;
        return;
      }
    }
  });

  prepared.forEach(function (h) {
    if (!h.n || h.done) return;
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < CANDIDATES.length; i++) {
      var cand = CANDIDATES[i];
      if (used[cand.key]) continue;
      for (var j = 0; j < cand.compact.length; j++) {
        var cc = cand.compact[j];
        if (cc.length < 6) continue;
        if (h.c.indexOf(cc) === -1 && cc.indexOf(h.c) === -1) continue;
        var longest = Math.max(h.c.length, cc.length);
        var score = Math.min(h.c.length, cc.length) / longest;
        if (score > bestScore) { bestScore = score; best = cand.key; }
      }
    }
    if (best && bestScore >= 0.5) {
      mapping[best] = h.idx;
      used[best] = true;
      h.done = true;
    }
  });

  prepared.forEach(function (h) {
    if (h.n && !h.done) unmapped.push(String(h.raw));
  });

  return { mapping: mapping, unmapped: unmapped, headers: headers };
}

function mapRow(row, mapping) {
  var rec = {};
  for (var i = 0; i < FIELDS.length; i++) {
    var f = FIELDS[i];
    var idx = mapping[f.key];
    var raw = idx === undefined ? null : row[idx];
    if (f.type === "number") rec[f.key] = toNumber(raw);
    else if (f.type === "datetime") rec[f.key] = toDate(raw);
    else rec[f.key] = toText(raw);
  }
  if (!rec._submission_time) rec._submission_time = null;
  return rec;
}

function findTimeColumn_(values, mapped) {
  if (mapped.mapping._submission_time !== undefined) return mapped.mapping._submission_time;
  var rows = values.length;
  if (rows < 2) return -1;
  for (var c = 0; c < values[0].length; c++) {
    var dates = 0;
    for (var r = 1; r < rows; r++) {
      if (Object.prototype.toString.call(values[r][c]) === "[object Date]") dates++;
    }
    if (dates >= (rows - 1) * 0.5) {
      mapped.mapping._submission_time = c;
      return c;
    }
  }
  return -1;
}

function countDuplicates(values) {
  var seen = {};
  var flags = [];
  for (var i = 0; i < values.length; i++) {
    var isDup = false;
    var v = values[i];
    if (present(v)) {
      var k = compact(v);
      if (Object.prototype.hasOwnProperty.call(seen, k)) isDup = true;
      else seen[k] = i;
    }
    flags.push(isDup);
  }
  return flags;
}

/* ==========================================================================
   8. CacheService مقسّم إلى أجزاء (يتجاوز حد 100KB/عنصر)
   ========================================================================== */

function cache_() {
  try { return CacheService.getScriptCache(); } catch (e) { return null; }
}

function cacheKey_(name) {
  return "fse." + CFG.CACHE_VERSION + "." + name;
}

function cachePurge_(cache, key) {
  try {
    var head = cache.get(key + ":h");
    if (head) {
      var n = parseInt(String(head).replace(/^n/, ""), 10);
      if (isFinite(n) && n > 0 && n <= CFG.CACHE_MAX_CHUNKS) {
        for (var i = 0; i < n; i++) {
          try { cache.remove(key + ":" + i); } catch (e) {}
        }
      }
      try { cache.remove(key + ":h"); } catch (e2) {}
    }
    try { cache.remove(key); } catch (e3) {}
  } catch (e4) {}
}

/** يكتب نصًا (JSON) في الكاش، مقسّمًا لأجزاء لو أكبر من الحد. */
function cachePutText_(cache, key, text) {
  if (!cache) return false;
  cachePurge_(cache, key);

  if (text.length <= CFG.CACHE_CHUNK) {
    try { cache.put(key, text, CFG.CACHE_SECONDS); return true; } catch (e) { return false; }
  }

  var n = Math.ceil(text.length / CFG.CACHE_CHUNK);
  if (n > CFG.CACHE_MAX_CHUNKS) return false;

  try { cache.put(key + ":h", "n" + n, CFG.CACHE_SECONDS); } catch (e) { return false; }

  for (var i = 0; i < n; i++) {
    try {
      cache.put(key + ":" + i, text.substr(i * CFG.CACHE_CHUNK, CFG.CACHE_CHUNK), CFG.CACHE_SECONDS);
    } catch (e2) {
      /* الحصة ممتلئة — تنظيف جزئي ثم نتابع بدون كاش */
      for (var j = 0; j < i; j++) { try { cache.remove(key + ":" + j); } catch (e3) {} }
      try { cache.remove(key + ":h"); } catch (e4) {}
      return false;
    }
  }
  return true;
}

/** يقرأ نصًا من الكاش (يجمع الأجزاء). يُرجع null عند وجود أي جزء ناقص. */
function cacheGetText_(cache, key) {
  if (!cache) return null;

  var head = null;
  try { head = cache.get(key + ":h"); } catch (e) { head = null; }

  if (head) {
    var n = parseInt(String(head).replace(/^n/, ""), 10);
    if (!isFinite(n) || n <= 0 || n > CFG.CACHE_MAX_CHUNKS) return null;
    var buf = [];
    for (var i = 0; i < n; i++) {
      var part = null;
      try { part = cache.get(key + ":" + i); } catch (e2) { part = null; }
      if (part == null) return null; /* كاش ناقص = treat as miss */
      buf.push(part);
    }
    return buf.join("");
  }

  try { return cache.get(key); } catch (e3) { return null; }
}

function cacheRemove_(name) {
  var cache = cache_();
  if (!cache) return;
  cachePurge_(cache, cacheKey_(name));
}

/* ==========================================================================
   9. بناء الـ dataset من الشيت (مرة واحدة ثم يُخزَّن)
   ========================================================================== */

function resolveSheet_(ss) {
  if (CFG.SHEET_NAME) {
    var byName = ss.getSheetByName(CFG.SHEET_NAME);
    if (byName) return byName;
    throw new Error("لم يتم العثور على التبويب: " + CFG.SHEET_NAME);
  }
  if (CFG.SHEET_GID !== null && CFG.SHEET_GID !== undefined) {
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === CFG.SHEET_GID) return sheets[i];
    }
  }
  var first = ss.getSheets()[0];
  if (!first) throw new Error("لا توجد تبويبات في الشيت");
  return first;
}

/** يبني dataset نظيف (بلا PII) من الشيت. لا يستخدم الكاش. */
function buildDataset_() {
  var t0 = Date.now();

  var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  var sheet = resolveSheet_(ss);

  /* حدود حقيقية بدل getDataRange — يتجنّبousands الصفوف/الأعمدة الفارغة */
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (!lastRow || !lastCol) throw new Error("الشيت فارغ (لا يوجد صف عناوين)");

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  if (!values.length) throw new Error("الشيت فارغ (لا يوجد صف عناوين)");

  var headers = values[0];
  var mapped = mapHeaders(headers);

  if (findTimeColumn_(values, mapped) === -1 && mapped.mapping._submission_time === undefined) {
    throw new Error("تعذر التعرف على عمود التاريخ/وقت التسجيل في الشيت");
  }
  if (mapped.mapping.event === undefined) {
    throw new Error("تعذر التعرف على عمود الإيفنت — راجع صف العناوين");
  }

  /* ---- التكرارات: المرور على الأعمدة الحساسة فقط بدل mapRow لكل صف ---- */
  var rawRows = new Array(lastRow - 1);
  for (var i = 1; i < lastRow; i++) rawRows[i - 1] = mapRow(values[i], mapped.mapping);

  var dupNationalId = countDuplicates(rawRows.map(function (r) { return r.nationalId; }));
  var dupEmail = countDuplicates(rawRows.map(function (r) { return r.email; }));
  var dupPhone = countDuplicates(rawRows.map(function (r) { return r.phone; }));

  var records = [];
  var skipped = 0;

  for (var n = 0; n < rawRows.length; n++) {
    var r = rawRows[n];
    var ts = r._submission_time ? r._submission_time.getTime() : null;
    if (ts == null || !isFinite(ts)) { skipped++; continue; }

    var geo = deriveGeography(r);

    /* quality كقناع أرقام: 15 بتة بدل 15 مفتاحًا نصيًا */
    var q = 0;
    if (present(r.fullName)) q |= 1;
    if (present(r.phone)) q |= 2;
    if (present(r.whatsapp)) q |= 4;
    if (present(r.email)) q |= 8;
    if (present(r.college)) q |= 16;
    if (typeof r.age === "number") q |= 32;
    if (present(r.gender)) q |= 64;
    if (present(r.event)) q |= 128;
    if (present(r.eventSource)) q |= 256;
    if (present(r.email) && !isValidEmail(r.email)) q |= 512;
    if (present(r.phone) && !isValidPhone(r.phone)) q |= 1024;
    if (typeof r.age === "number" && !isValidAge(r.age)) q |= 2048;
    if (dupNationalId[n]) q |= 4096;
    if (dupEmail[n]) q |= 8192;
    if (dupPhone[n]) q |= 16384;

    records.push({
      ts: ts,
      event: scrubText(r.event),
      gender: canonicalValue("gender", r.gender),
      age: typeof r.age === "number" ? r.age : null,
      college: scrubText(r.college),
      university: scrubText(geo.university || ""),
      governorate: scrubText(geo.governorate || ""),
      studentStatus: canonicalValue("studentStatus", r.studentStatus),
      academicYear: canonicalValue("academicYear", r.academicYear),
      volunteer: canonicalValue("volunteer", r.volunteer),
      discoveryChannel: scrubText(r.discoveryChannel || ""),
      eventSource: scrubText(r.eventSource || ""),
      interest: scrubText(r.interest || ""),
      goal: scrubText(r.goal || ""),
      expectation: scrubText(r.expectation || ""),
      q: q
    });
  }

  records.sort(function (a, b) { return a.ts - b.ts; });

  var columnMap = {};
  for (var key in mapped.mapping) {
    if (Object.prototype.hasOwnProperty.call(mapped.mapping, key)) {
      columnMap[key] = String(headers[mapped.mapping[key]]);
    }
  }

  var updatedAt;
  try { updatedAt = ss.getLastModified().toISOString(); }
  catch (e) { updatedAt = new Date().toISOString(); }

  return {
    builtAt: new Date().toISOString(),
    buildMs: Date.now() - t0,
    updatedAt: updatedAt,
    skipped: skipped,
    sheetName: sheet.getName(),
    sheetId: sheet.getSheetId(),
    unmapped: mapped.unmapped,
    mappedColumns: Object.keys(mapped.mapping),
    columnMap: columnMap,
    records: records
  };
}

/** dataset من الكاش، أو يُبنى ويُخزَّن. */
function getDataset_(forceRefresh) {
  var cache = cache_();
  var key = cacheKey_("ds");

  if (!forceRefresh && cache) {
    var text = cacheGetText_(cache, key);
    if (text) {
      try {
        var ds = JSON.parse(text);
        if (ds && ds.records) {
          /* Set AFTER deserialising so the flag is never persisted. */
          ds.fromCache = true;
          return ds;
        }
      } catch (e) {}
    }
  }

  var fresh = buildDataset_();
  fresh.fromCache = false;

  if (cache) {
    try {
      var ok = cachePutText_(cache, key, JSON.stringify(fresh));
      fresh.cached = ok;
    } catch (e2) { fresh.cached = false; }
  } else {
    fresh.cached = false;
  }

  return fresh;
}

/** إسقاط السجلات إلى الحقول المُصرَّح بها فقط. */
function projectRows_(records, full) {
  var fields = full ? OUT_CORE.concat(OUT_EXTRA) : OUT_CORE;
  var out = new Array(records.length);
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var o = {};
    for (var f = 0; f < fields.length; f++) o[fields[f]] = r[fields[f]];
    o.q = r.q;
    out[i] = o;
  }
  return out;
}

/* ==========================================================================
   10. تجميع server-side (نفس مخرجات FilterEngine في الواجهة)
   ========================================================================== */

function unknown_(v) {
  return v == null || v === "" || v === "غير محدد";
}

/* Ages are only charted inside a plausible range. The sheet is a free-text
   form: we have live rows carrying "12", "78" and a full 14-digit national ID
   in the age column. Anything outside the range is already reported by the
   quality panel ("سن غير منطقي"), so dropping it here keeps junk — and an ID —
   out of the browser and out of the age chart. */
var AGE_MIN = 14;
var AGE_MAX = 70;

function plausibleAge_(v) {
  var n = typeof v === "number" ? v : toNumber(v);
  return n != null && isFinite(n) && n >= AGE_MIN && n <= AGE_MAX;
}

function distribution_(records, key) {
  var counts = Object.create(null);
  var total = 0;
  for (var i = 0; i < records.length; i++) {
    var v = records[i][key];
    if (unknown_(v)) continue;
    if (key === "age" && !plausibleAge_(v)) continue;
    counts[v] = (counts[v] || 0) + 1;
    total++;
  }
  var arr = Object.keys(counts).map(function (k) {
    return { name: k, count: counts[k], percentage: total ? (counts[k] / total) * 100 : 0 };
  });
  arr.sort(function (a, b) { return b.count - a.count; });
  return { list: arr, total: total };
}

function dailySeries_(records) {
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

function facets_(records) {
  function uniq(key) {
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < records.length; i++) {
      var v = records[i][key];
      if (unknown_(v)) continue;
      if (key === "age" && !plausibleAge_(v)) continue;
      var k = String(v);
      if (!seen[k]) { seen[k] = 1; out.push(v); }
    }
    out.sort(function (a, b) { return String(a).localeCompare(String(b), "ar"); });
    return out;
  }
  return {
    events: uniq("event"),
    governorates: uniq("governorate"),
    universities: uniq("university"),
    genders: uniq("gender"),
    statuses: uniq("studentStatus"),
    volunteers: uniq("volunteer"),
    sources: uniq("eventSource"),
    ages: uniq("age"),
    years: uniq("academicYear"),
    colleges: uniq("college")
  };
}

var Q_LABELS = [
  ["hasName", "اسم غير موجود"],
  ["hasPhone", "رقم الهاتف غير موجود"],
  ["hasWhatsapp", "رقم الواتساب غير موجود"],
  ["hasEmail", "بريد إلكتروني غير موجود"],
  ["hasCollege", "كلية/جامعة غير محددة"],
  ["hasAge", "السن غير موجود"],
  ["hasGender", "النوع غير محدد"],
  ["hasEvent", "الإيفنت غير محدد"],
  ["hasSource", "مصدر التسجيل غير محدد"]
];

function quality_(records) {
  var n = records.length;
  if (!n) return { score: 100, completeness: 100, validity: 100, missingTotal: 0, issueTotal: 0, issues: [], total: 0 };

  /* Q_KEYS[0..8] are "has*" bits -> a field is MISSING when the bit is clear. */
  var missing = new Array(Q_LABELS.length);
  var i, b;
  for (b = 0; b < Q_LABELS.length; b++) missing[b] = 0;

  var invalidEmail = 0, invalidPhone = 0, invalidAge = 0;
  var dupNationalId = 0, dupEmail = 0, dupPhone = 0;

  for (i = 0; i < n; i++) {
    var q = records[i].q | 0;
    for (b = 0; b < 9; b++) if (!(q & (1 << b))) missing[b]++;
    if (q & 512) invalidEmail++;
    if (q & 1024) invalidPhone++;
    if (q & 2048) invalidAge++;
    if (q & 4096) dupNationalId++;
    if (q & 8192) dupEmail++;
    if (q & 16384) dupPhone++;
  }

  var completenessSum = 0;
  var issues = [];

  for (b = 0; b < Q_LABELS.length; b++) {
    var pct = (missing[b] / n) * 100;
    completenessSum += (100 - pct);
    if (missing[b] > 0) {
      issues.push({
        label: Q_LABELS[b][1],
        count: missing[b],
        pct: pct,
        severity: pct > 20 ? "critical" : pct > 5 ? "attention" : "excellent"
      });
    }
  }

  /* Validity covers every defect, duplicates included — they are invalid data
     just as much as a malformed email. MUST match the browser's breakdown. */
  var defects = invalidEmail + invalidPhone + invalidAge + dupNationalId + dupEmail + dupPhone;

  function push(label, c) {
    if (!c) return;
    var pct = (c / n) * 100;
    issues.push({ label: label, count: c, pct: pct, severity: "critical" });
  }
  push("بريد إلكتروني غير صالح", invalidEmail);
  push("رقم هاتف غير صالح", invalidPhone);
  push("سن غير منطقي", invalidAge);
  push("تكرار في الرقم القومي", dupNationalId);
  push("تكرار في البريد الإلكتروني", dupEmail);
  push("تكرار في رقم الهاتف", dupPhone);

  var completeness = completenessSum / Q_LABELS.length;
  var validity = 100 - (defects / n) * 100;
  var score = Math.round(0.7 * completeness + 0.3 * validity);
  var missingTotal = 0;
  for (b = 0; b < Q_LABELS.length; b++) missingTotal += missing[b];

  return {
    score: Math.max(0, Math.min(100, score)),
    completeness: Math.round(completeness * 10) / 10,
    validity: Math.round(validity * 10) / 10,
    missingTotal: missingTotal,
    issueTotal: issues.length,
    issues: issues,
    total: n
  };
}

/** يطبّق فلاتر query على السجلات. */
function applyServerFilters_(records, params) {
  var f = {};
  for (var p in FILTER_MAP) {
    if (!Object.prototype.hasOwnProperty.call(FILTER_MAP, p)) continue;
    var v = params[p];
    if (v != null && String(v) !== "" && String(v) !== "all") f[FILTER_MAP[p]] = String(v);
  }
  var from = toNumber(params.from);
  var to = toNumber(params.to);
  if (from != null) f.__from = from;
  if (to != null) f.__to = to;

  var keys = Object.keys(f);
  if (!keys.length) return records;

  var out = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var ok = true;
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (key === "__from") { if (r.ts < f.__from) { ok = false; break; } continue; }
      if (key === "__to") { if (r.ts > f.__to) { ok = false; break; } continue; }
      if (r[key] !== f[key]) { ok = false; break; }
    }
    if (ok) out.push(r);
  }
  return out;
}

/** يبني payload اللوحة (نفس شكل مخرجات FilterEngine). */
function buildDashboard_(ds, filtered) {
  var total = filtered.length;
  var daily = dailySeries_(filtered);

  var ev = distribution_(filtered, "event");
  var gov = distribution_(filtered, "governorate");

  var events = ev.list.map(function (e) {
    return {
      name: e.name,
      count: e.count,
      percentage: e.percentage,
      digest: "متوسط " + (e.count / Math.max(1, daily.length)).toFixed(1) + " / يوم"
    };
  });

  var last = total ? filtered[filtered.length - 1].ts : null;

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRegistrations: total,
      totalUnfiltered: ds.records.length,
      uniqueEvents: events.length,
      governorates: gov.list.length,
      activeDays: daily.length,
      lastSubmissionAt: last
    },
    daily: daily,
    events: events,
    governorates: gov.list,
    genders: distribution_(filtered, "gender").list,
    ages: distribution_(filtered, "age").list,
    years: distribution_(filtered, "academicYear").list,
    colleges: distribution_(filtered, "college").list.slice(0, 10),
    statuses: distribution_(filtered, "studentStatus").list,
    volunteers: distribution_(filtered, "volunteer").list,
    quality: quality_(filtered),
    options: facets_(ds.records),
    updatedAt: ds.updatedAt,
    meta: {
      source: "google-sheet",
      servedFrom: ds.fromCache ? "cache" : "sheet",
      buildMs: ds.buildMs,
      privacy: "pii-stripped",
      synthetic: false
    }
  };
}

/* ==========================================================================
   11. الاستجابة HTTP
   ========================================================================== */

function jsonOut_(obj, callback) {
  var json = typeof obj === "string" ? obj : JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function truthy_(v) {
  return v === "1" || v === "true" || v === "yes";
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || "dashboard").toLowerCase();
  var callback = params.callback
    ? String(params.callback).replace(/[^A-Za-z0-9_$]/g, "")
    : "";
  var refresh = truthy_(params.refresh);
  var t0 = Date.now();

  var out;
  try {
    if (action === "ping") {
      out = {
        success: true,
        serverTime: new Date().toISOString(),
        version: "3.0",
        cacheTtl: CFG.CACHE_SECONDS,
        cached: !!cacheGetText_(cache_(), cacheKey_("ds")),
        sheet: CFG.SHEET_NAME || ("gid:" + CFG.SHEET_GID)
      };
    } else if (action === "warm") {
      var ds0 = getDataset_(refresh);
      out = {
        success: true,
        records: ds0.records.length,
        buildMs: ds0.buildMs,
        cached: ds0.cached,
        updatedAt: ds0.updatedAt
      };
    } else if (action === "facets") {
      var dsF = getDataset_(refresh);
      out = {
        success: true,
        options: facets_(dsF.records),
        summary: { totalRegistrations: dsF.records.length },
        updatedAt: dsF.updatedAt,
        meta: { servedFrom: dsF.fromCache ? "cache" : "sheet", buildMs: dsF.buildMs }
      };
    } else if (action === "rows") {
      var dsR = getDataset_(refresh);
      out = {
        success: true,
        rows: projectRows_(dsR.records, truthy_(params.full)),
        updatedAt: dsR.updatedAt,
        meta: {
          totalRows: dsR.skipped + dsR.records.length,
          validRows: dsR.records.length,
          skippedRows: dsR.skipped,
          unmappedColumns: dsR.unmapped,
          servedFrom: dsR.fromCache ? "cache" : "sheet",
          buildMs: dsR.buildMs,
          privacy: "pii-stripped",
          synthetic: false
        }
      };
    } else if (action === "dashboard") {
      var ds = getDataset_(refresh);
      out = buildDashboard_(ds, applyServerFilters_(ds.records, params));
    } else {
      out = { success: false, error: "إجراء غير معروف: " + action };
    }
  } catch (err) {
    out = { success: false, error: String((err && err.message) || err) };
  }

  if (out && out.success) out.meta = out.meta || {};
  if (out && typeof out === "object") {
    out.meta = out.meta || {};
    out.meta.serverMs = Date.now() - t0;
  }

  return jsonOut_(out, callback);
}

/* ==========================================================================
   12. صيانة (من محرر Apps Script)
   ========================================================================== */

/** يبني الكاش مسبقًا — اربطه بـ trigger زمني كل 10 دقائق. */
function warmCache() { return getDataset_(true).records.length; }

/** يمسح الكاش (عند تغيير بنية الشيت). */
function clearCache() {
  cacheRemove_("ds");
  return "cleared";
}

/** ملخص غير حساس للتأكد من أن المطابقة تعمل. */
function testConnection() {
  var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  var sheet = resolveSheet_(ss);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, Math.max(1, lastRow), Math.max(1, lastCol)).getValues();
  var mapped = mapHeaders(values[0]);
  findTimeColumn_(values, mapped);

  return {
    sheet: sheet.getName(),
    sheetId: sheet.getSheetId(),
    lastRow: lastRow,
    lastColumn: lastCol,
    dataRows: Math.max(0, lastRow - 1),
    mapped: Object.keys(mapped.mapping),
    unmapped: mapped.unmapped,
    hasEvent: mapped.mapping.event !== undefined,
    hasTime: mapped.mapping._submission_time !== undefined,
    updatedAt: ss.getLastModified().toISOString()
  };
}

/** يبني dataset ويتحقق من غياب الـ PII ومن حجم الحمولة. */
function testPayload() {
  var ds = getDataset_(true);
  var rows = projectRows_(ds.records, false);
  var json = JSON.stringify(rows);
  var banned = ["fullName", "phone", "whatsapp", "email", "nationalId", "participantId", "qrCode"];
  var keys = rows.length ? Object.keys(rows[0]) : [];
  var chunks = Math.ceil(json.length / CFG.CACHE_CHUNK);

  return {
    records: ds.records.length,
    skipped: ds.skipped,
    buildMs: ds.buildMs,
    rowsBytes: json.length,
    rowsKB: Math.round(json.length / 1024),
    cacheChunks: chunks,
    cacheable: chunks <= CFG.CACHE_MAX_CHUNKS,
    unmapped: ds.unmapped,
    rowKeys: keys,
    piiLeak: keys.filter(function (k) { return banned.indexOf(k) !== -1; }),
    updatedAt: ds.updatedAt
  };
}

/** مقارنة حجم الحمولة: full=1 مقابل الأساس — لقياس مكسب slenderization. */
function testPayloadSize() {
  var ds = getDataset_(false);
  var lean = JSON.stringify(projectRows_(ds.records, false)).length;
  var full = JSON.stringify(projectRows_(ds.records, true)).length;
  return {
    leanKB: Math.round(lean / 1024),
    fullKB: Math.round(full / 1024),
    savedKB: Math.round((full - lean) / 1024),
    savedPct: full ? Math.round(((full - lean) / full) * 100) : 0
  };
}
