/* ==========================================================================
   Hayat Makers · Central Events Dashboard — Google Apps Script Backend
   --------------------------------------------------------------------------
   ملف واحد متكامل: الإعدادات + الحقول + المطابقة + التحقق من الجودة +
   البناء + الاستجابة (JSON / JSONP). لا يحتاج أي ملفات أخرى.

   طريقة التشغيل:
     1) افتح الشيت (Google Sheet) → Extensions → Apps Script.
     2) الصق هذا الملف كاملًا في ملف باسم Code.gs (احذف أي محتوى قديم).
     3) Deploy → New deployment → Web app → Execute as: Me
        → Who has access: Anyone  → Deploy → انسخ رابط /exec.
     4) في لوحة التحكم: js/config.js → ضع الرابط في CONFIG.API_URL
        واضبط CONFIG.DEMO_MODE = false.

   الأفعال (query string):
     ?action=dashboard   → payload كامل (سجلات بلا PII)
     ?action=ping        → فحص صحة بسيط
     &callback=fn        → استجابة JSONP (يستخدمها الواجهة تلقائيًا عند فشل CORS)

   الخصوصية (عقد صارم):
     • لا يُرسل أي اسم/هاتف/واتساب/بريد/رقم قومي إلى المتصفح إطلاقًا.
     • هذه الحقول تُقرأ داخليًا فقط لإنتاج أعلام الجودة (hasPhone, dupEmail…).
     • لا يوجد أي Console/Logger يطبع بيانات شخصية.

   الأداء:
     • نتائج آخر 120 ثانية تُخزَّن في CacheService (لو الحجم < 90KB).
     • قراءة الشيت مرة واحدة لكل طلب غير المخزَّن.
   ========================================================================== */

/* ==========================================================================
   1. الإعدادات
   ========================================================================== */

var CFG = {
  /* معرّف الشيت من رابطه:
     https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit */
  SPREADSHEET_ID: "1sS8XwonuIQCVuYJWgkmPK-C71b6O65ZDJjZx4OVQINo",

  /* اسم التبويب (Sheet tab). اتركه فارغًا "" لاستخدام SHEET_GID ثم أول تبويب. */
  SHEET_NAME: "",

  /* رقم تبويب البيانات (gid من نهاية الرابط #gid=…) */
  SHEET_GID: 1436196095,

  /* مدة التخزين المؤقت بالثواني (أقصى قيمة 600 لأن CacheService يحدّها) */
  CACHE_SECONDS: 120,

  /* مفتاح التخزين المؤقت */
  CACHE_KEY: "hmcc.dashboard.payload.v1"
};

/* ==========================================================================
   2. الحقول المتوقعة في الشيت (مرآة حيوية لـ js/schema.js)
      label + aliases تُستخدم لمطابقة صف العناوين مهما كانت لغة/صيغة الفورم.
      sensitive: تُقرأ للجودة فقط ولا تُرسل أبدًا.
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
      "هل أنت متطوع حاليًا في نوادي صناع الحياة بالجامعات المصرية؟",
      "هل انت متطوع حاليا في نوادي صناع الحياة بالجامعات المصرية",
      "متطوع في نوادي صناع الحياة",
      "متطوع"
    ]
  },
  {
    key: "discoveryChannel",
    label: "أول تعارف بالنوادي",
    aliases: [
      "كيف تعرفت على اندية صناع الحياة بالجامعات المصرية لاول مرة",
      "كيف تعرفت على نوادي صناع الحياة بالجامعات المصرية لأول مرة؟",
      "كيف تعرفت على نوادي صناع الحياة بالجامعات المصرية لاول مرة",
      "كيف تعرفت على نوادي صناع الحياة",
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

/* الحقول التي يُصرَّح بإرسالها للمتصفح (لا PII — قرار ثابت هنا لا في الواجهة) */
var OUT_FIELDS = [
  "ts", "event", "gender", "age", "college", "university", "governorate",
  "studentStatus", "academicYear", "volunteer", "discoveryChannel",
  "eventSource", "interest", "goal", "expectation", "quality"
];

/* ==========================================================================
   3. أدوات النص (مطابقة مطابقة لـ schema.js حرفيًا)
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
   4. توحيد القيم (male/female · student/graduate · yes/no · السنة…)
   ========================================================================== */

var VALUE_ALIASES = {
  gender: { male: ["ذكر", "رجل", "male", "m"], female: ["انثى", "انثه", "بنت", "امراه", "female", "f"] },
  studentStatus: { student: ["طالب", "طالبه", "طالب/", "undergraduate", "student"], graduate: ["خريج", "خريجه", "graduate", "graduated"] },
  volunteer: { yes: ["نعم", "yes", "متطوع", "حالي"], no: ["لا", "no", "لست", "غير متطوع"] },
  academicYear: {
    "السنة الأولى": ["الاولى", "الاوله", "1", "first", "اولى"],
    "السنة الثانية": ["الثانيه", "الثانية", "2", "second"],
    "السنة الثالثة": ["الثالثه", "الثالثة", "3", "third"],
    "السنة الرابعة": ["الرابعه", "الرابعة", "4", "fourth", "خامس"],
    "خريج": ["خريج", "خريجه", "graduate"]
  }
};

function canonicalValue(field, raw) {
  if (!normalizeText(raw)) return "";
  var table = VALUE_ALIASES[field];
  if (!table) return String(raw).trim();

  var key = looseKey(raw);
  for (var group in table) {
    if (!Object.prototype.hasOwnProperty.call(table, group)) continue;
    var list = table[group];
    for (var i = 0; i < list.length; i++) {
      var a = looseKey(list[i]);
      if (key === a || key.indexOf(a) !== -1) return group;
    }
  }
  return String(raw).trim();
}

/* ==========================================================================
   5. الجغرافيا (استخراج المحافظة/الجامعة من الكلية عند غياب الأعمدة)
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
  var explicitUni = normalizeText(record.university);
  var explicitGov = normalizeText(record.governorate);
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

/* تنظيف النصوص الحرة: يحذف أي إيميل أو رقم طويل (هاتف/قومي) كُتب جوّه
   حقل عادي (مثل من يكتب بريده في خانة الكلية). مطابق لـ data.js. */
function scrubText(v) {
  if (v == null) return "";
  return String(v)
    .replace(/[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\b\d{10,15}\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function isValidEmail(v) {
  return EMAIL_RE.test(String(v || "").trim());
}

function isValidPhone(v) {
  var digits = String(v || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

function isValidAge(n) {
  return n != null && n >= 14 && n <= 70;
}

/* ==========================================================================
   7. مطابقة صف العناوين (مرحلتان: تطابق تام ثم fuzzy محافظ)
   ========================================================================== */

var CANDIDATES = FIELDS.map(function (f) {
  var list = [f.label].concat(f.aliases || []);
  return {
    key: f.key,
    exact: list.map(normalizeText),
    compact: list.map(compact)
  };
});

function mapHeaders(headerRow) {
  var headers = headerRow || [];
  var mapping = {};
  var used = {};
  var unmapped = [];

  var prepared = headers.map(function (raw) {
    return { raw: raw, n: normalizeText(raw), c: compact(raw) };
  });

  /* pass 1 — تطابق تام */
  prepared.forEach(function (h) {
    if (!h.n) return;
    for (var i = 0; i < CANDIDATES.length; i++) {
      var cand = CANDIDATES[i];
      if (used[cand.key]) continue;
      if (cand.exact.indexOf(h.n) !== -1 || cand.compact.indexOf(h.c) !== -1) {
        mapping[cand.key] = headers.indexOf(h.raw);
        used[cand.key] = true;
        h.done = true;
        return;
      }
    }
  });

  /* pass 2 — fuzzy محافظ (≥ 0.5) */
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

/* احتياطي: لو العمود الزمني مسمّى بشكل غير متوقع (مثل "Timestamp" بخط غير
   مدعوم)، نبحث عن أول عمود قيمه Date في أغلب الصفوف. */
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

/* عدّاد التكرارات (لأعلام dupEmail / dupPhone / dupNationalId).
   مطابق لـ data.js: يُعلَّم الحدث التالي في التسلسل فقط (الأول يبقى false). */
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
   8. بناء الـ payload الكامل من الشيت (بلا PII)
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

function buildPayload_() {
  /* ---- cache ---- */
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache) {
    try {
      var hit = cache.get(CFG.CACHE_KEY);
      if (hit) {
        var cachedPayload = JSON.parse(hit);
        cachedPayload.meta = cachedPayload.meta || {};
        cachedPayload.meta.servedFrom = "cache";
        return cachedPayload;
      }
    } catch (e2) { /* تجاهل الكاش الفاسد */ }
  }

  /* ---- قراءة الشيت ---- */
  var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  var sheet = resolveSheet_(ss);
  var values = sheet.getDataRange().getValues();
  if (!values.length) throw new Error("الشيت فارغ (لا يوجد صف عناوين)");
  var headers = values[0];
  var mapped = mapHeaders(headers);

  if (findTimeColumn_(values, mapped) === -1 && mapped.mapping._submission_time === undefined) {
    throw new Error("تعذر التعرف على عمود التاريخ/وقت التسجيل في الشيت");
  }
  if (mapped.mapping.event === undefined) {
    throw new Error("تعذر التعرف على عمود الإيفنت — راجع صف العناوين");
  }

  /* ---- صفوف خام ---- */
  var rawRows = [];
  for (var i = 1; i < values.length; i++) rawRows.push(mapRow(values[i], mapped.mapping));

  var dupNationalId = countDuplicates(rawRows.map(function (r) { return r.nationalId; }));
  var dupEmail = countDuplicates(rawRows.map(function (r) { return r.email; }));
  var dupPhone = countDuplicates(rawRows.map(function (r) { return r.phone; }));

  /* ---- سجلات مُبسَّطة (بدون أي PII) ---- */
  var records = [];
  var skipped = 0;

  for (var n = 0; n < rawRows.length; n++) {
    var r = rawRows[n];
    var ts = r._submission_time ? r._submission_time.getTime() : null;
    if (ts == null || !isFinite(ts)) { skipped++; continue; }

    var geo = deriveGeography(r);

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
        invalidEmail: present(r.email) && !isValidEmail(r.email),
        invalidPhone: present(r.phone) && !isValidPhone(r.phone),
        invalidAge: typeof r.age === "number" && !isValidAge(r.age),
        dupNationalId: dupNationalId[n],
        dupEmail: dupEmail[n],
        dupPhone: dupPhone[n]
      }
    });
  }

  records.sort(function (a, b) { return a.ts - b.ts; });

  /* ---- meta ---- */
  var columnMap = {};
  for (var key in mapped.mapping) {
    if (Object.prototype.hasOwnProperty.call(mapped.mapping, key)) {
      columnMap[key] = String(headers[mapped.mapping[key]]);
    }
  }

  var updatedAt;
  try { updatedAt = ss.getLastModified().toISOString(); }
  catch (e3) { updatedAt = new Date().toISOString(); }

  var payload = {
    success: true,
    records: records,
    updatedAt: updatedAt,
    generatedAt: new Date().toISOString(),
    meta: {
      source: "google-sheet",
      sheetName: sheet.getName(),
      sheetId: sheet.getSheetId(),
      totalRows: rawRows.length,
      validRows: records.length,
      skippedRows: skipped,
      mappedColumns: Object.keys(mapped.mapping),
      unmappedColumns: mapped.unmapped,
      columnMap: columnMap,
      privacy: "pii-stripped",
      synthetic: false
    }
  };

  /* ---- كتابة الكاش (يتجاهل لو الحجم كبير) ---- */
  if (cache) {
    try {
      var json = JSON.stringify(payload);
      if (json.length < 90000) {
        cache.put(CFG.CACHE_KEY, json, Math.min(600, CFG.CACHE_SECONDS));
      }
    } catch (e4) { /* الحصة ممتلئة — ليس خطأ */ }
  }

  return payload;
}

/* ==========================================================================
   9. الاستجابة HTTP (JSON + JSONP)
   ========================================================================== */

function jsonOut_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var params = (e && e.parameter) || {};
  var action = String(params.action || "dashboard").toLowerCase();
  var callback = params.callback
    ? String(params.callback).replace(/[^A-Za-z0-9_$]/g, "")
    : "";

  var out;
  try {
    if (action === "ping") {
      out = {
        success: true,
        serverTime: new Date().toISOString(),
        version: "1.0",
        sheet: CFG.SHEET_NAME || ("gid:" + CFG.SHEET_GID)
      };
    } else if (action === "dashboard") {
      out = buildPayload_();
    } else {
      out = { success: false, error: "إجراء غير معروف: " + action };
    }
  } catch (err) {
    /* رسالة خطأ عامة بلا تفاصيل داخلية حساسة */
    out = { success: false, error: String((err && err.message) || err) };
  }

  return jsonOut_(out, callback);
}

/* ==========================================================================
   10. أدوات فحص (تُشغَّل من محرر Apps Script عند التطوير)
   ========================================================================== */

/** يعيد ملخصًا غير حساسًا للتأكد من أن المطابقة تعمل. */
function testConnection() {
  var ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  var sheet = resolveSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var mapped = mapHeaders(values[0]);
  findTimeColumn_(values, mapped);

  return {
    sheet: sheet.getName(),
    sheetId: sheet.getSheetId(),
    rows: values.length - 1,
    columns: values[0].length,
    mapped: Object.keys(mapped.mapping),
    unmapped: mapped.unmapped,
    hasEvent: mapped.mapping.event !== undefined,
    hasTime: mapped.mapping._submission_time !== undefined,
    updatedAt: ss.getLastModified().toISOString()
  };
}

/** يبني payload كاملًا ويتحقق من غياب الـ PII (يشغَّل من المحرر). */
function testPayload() {
  var payload = buildPayload_();
  var sample = payload.records.slice(0, 3).map(function (r) {
    return { ts: r.ts, event: r.event, gender: r.gender, governorate: r.governorate };
  });
  var keys = payload.records.length ? Object.keys(payload.records[0]) : [];
  var banned = ["fullName", "phone", "whatsapp", "email", "nationalId", "participantId", "qrCode"];
  return {
    records: payload.records.length,
    skipped: payload.meta.skippedRows,
    unmapped: payload.meta.unmappedColumns,
    recordKeys: keys,
    piiLeak: keys.filter(function (k) { return banned.indexOf(k) !== -1; }),
    sample: sample,
    updatedAt: payload.updatedAt
  };
}
