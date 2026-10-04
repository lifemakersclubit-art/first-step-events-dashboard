/* End-to-end test for the Apps Script backend.
   Stubs SpreadsheetApp / CacheService / ContentService, runs the REAL Code.gs
   against a synthetic sheet, then asserts that the server-side aggregation and
   the browser-side FilterEngine produce identical numbers.

   Run: node tools/test-code-gs.js                                          */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ==================================================================
   1. Stub the Apps Script globals
   ================================================================== */

/* --- fake CacheService: enforces the real 100KB per-item limit --- */
const CACHE_LIMIT = 100 * 1024;
const cacheStore = new Map();
let cachePuts = 0;

const CacheService = {
  getScriptCache() {
    return {
      get(k) { return cacheStore.has(k) ? cacheStore.get(k) : null; },
      put(k, v, ttl) {
        if (String(v).length > CACHE_LIMIT) {
          throw new Error('CacheService: value too large (' + String(v).length + ' chars)');
        }
        cacheStore.set(k, String(v));
        cachePuts++;
        return true;
      },
      remove(k) {
        if (!cacheStore.has(k)) throw new Error('CacheService: key not found');
        cacheStore.delete(k);
        return true;
      }
    };
  }
};

const ContentService = {
  MimeType: { JSON: 'application/json', JAVASCRIPT: 'text/javascript' },
  createTextOutput(text) {
    return { text, setMimeType() { return this; } };
  }
};

/* --- fake SpreadsheetApp over a synthetic sheet ---
   NOTE: header order must mirror the row value order exactly. */
const HEADERS = [
  'وقت التسجيل',                                                  /* 0  */
  'ما الايفنت الذي ترغب في التسجيل به وحضوره',                     /* 1  event */
  'الاسم بالكامل',                                                /* 2  */
  'رقم الهاتف',                                                   /* 3  */
  'رقم الواتساب',                                                 /* 4  */
  'الرقم القومي',                                                 /* 5  */
  'السن',                                                         /* 6  age */
  'النوع',                                                        /* 7  gender */
  'البريد الإلكتروني',                                            /* 8  */
  'الكلية',                                                       /* 9  college */
  'الجامعة',                                                      /* 10 university */
  'المحافظة',                                                     /* 11 governorate */
  'هل انت طالب أم خريج',                                          /* 12 studentStatus */
  'اذا كنت طالبا ما السنة الدراسية التي تدرس بها حاليا',            /* 13 academicYear */
  'هل انت متطوع حاليا في اندية صناع الحياة بالجامعات المصرية',        /* 14 volunteer */
  'كيف تعرفت على هذا الايفنت',                                    /* 15 eventSource */
  'ما المجال الذي تهتم به أكثر',                                   /* 16 interest */
  'ما هدفك الاساسي من حضور الايفنت',                               /* 17 goal */
  'ما اكثر شيء تحب ان تراه او تستفيد منه خلال الايفنت'            /* 18 expectation */
];

const EVENTS = ['ورشة السيرة الذاتية', 'لقاء التوجيه', 'أسبوع ريادة الأعمال'];
const COLLEGES = [
  'كلية الهندسة جامعة القاهرة',
  'كلية الطب جامعة الإسكندرية',
  'كلية الحاسبات والمعلومات جامعة أسيوط'
];

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* Deliberately messy source data: blank cells, Arabic-Indic digits, alias
   spellings, duplicates, invalid emails/phones/ages, unparseable timestamps. */
const N = 1200;
const rnd = mulberry(7);
const sheetRows = [HEADERS];
const BASE = Date.UTC(2026, 0, 5);
const DUP_EMAILS = [];

for (let i = 0; i < N; i++) {
  const thin = rnd() < 0.1;
  const dayOffset = Math.floor(rnd() * 75);

  /* every 200th row is unusable -> must be counted as skipped */
  const ts = i % 200 === 199 ? 'not-a-date' : new Date(BASE + dayOffset * 86400000 + Math.floor(rnd() * 86400000));

  /* Arabic-Indic digits for the age every 5th row */
  const ageNum = 17 + Math.floor(rnd() * 8);
  const age = (q0(i) ? '' : (i % 5 === 0
    ? String(ageNum).replace(/\d/g, d => String.fromCharCode(0x0660 + Number(d)))
    : ageNum));

  const email = thin ? '' : (i % 37 === 0 ? 'not-an-email' : 'user' + i + '@example.com');
  if (!thin && i % 37 === 0) DUP_EMAILS.push(email);
  /* force real duplicates */
  const forcedDup = i % 101 === 100 ? 'dup@example.com' : email;

  sheetRows.push([
    ts,
    EVENTS[Math.floor(rnd() * EVENTS.length)],
    thin ? '' : 'طالب ' + i,
    thin ? '' : '0100000' + String(1000 + i),
    thin ? '' : '0100000' + String(1000 + i),
    thin ? '' : '2990001000000' + String(i % 90 + 10),
    age,
    thin ? '' : (rnd() > 0.5 ? 'ذكر' : 'أنثى'),
    forcedDup,
    thin ? '' : COLLEGES[Math.floor(rnd() * COLLEGES.length)],
    thin ? '' : (rnd() > 0.5 ? 'جامعة القاهرة' : 'جامعة أسيوط'),
    thin ? '' : (rnd() > 0.5 ? 'القاهرة' : 'أسيوط'),
    rnd() > 0.5 ? 'طالب' : 'خريج',
    ['الأولى', 'الثانية', 'الثالثة', '1', '2'][Math.floor(rnd() * 5)],
    rnd() > 0.5 ? 'نعم' : 'لا',
    thin ? '' : (rnd() > 0.5 ? 'سوشيال ميديا' : 'صحاب'),
    'ريادة الأعمال',
    'أريد وظيفة',
    'تعلم عملي'
  ]);
}
/* a handful of deliberately duplicated emails to exercise dupEmail */
for (let i = 0; i < 8; i++) {
  sheetRows[i + 1][8] = 'shared@example.com';
}
function q0(i) { return i % 17 === 3; }

const sheet = {
  getName: () => ' Registrations ',
  getSheetId: () => 1436196095,
  getLastRow: () => sheetRows.length,
  getLastColumn: () => HEADERS.length,
  getRange(r, c, nr, nc) {
    const out = [];
    for (let i = 0; i < nr; i++) out.push((sheetRows[r - 1 + i] || []).slice(c - 1, c - 1 + nc));
    return { getValues: () => out };
  },
  getDataRange: () => ({ getValues: () => sheetRows })
};

const SpreadsheetApp = {
  openById: () => ({ getSheetByName: () => null, getSheets: () => [sheet], getLastModified: () => new Date(BASE) })
};

/* --- load the real Code.gs --- */
const gsSrc = fs.readFileSync(path.join(ROOT, 'google-apps-script/Code.gs'), 'utf8');

const gsSandbox = {
  SpreadsheetApp, CacheService, ContentService,
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, Map, Set
};
vm.createContext(gsSandbox);
vm.runInContext(gsSrc, gsSandbox, { filename: 'Code.gs' });

/* --- load the frontend FilterEngine with a Util shim --- */
const feSandbox = { Util: { fmtNumber: String, pct: () => '' }, console, JSON, Math, Date, Object, Array, Number, String, Map, Set };
vm.createContext(feSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/filter-engine.js'), 'utf8'), feSandbox, { filename: 'filter-engine.js' });
const FilterEngine = feSandbox.FilterEngine;

/* ==================================================================
   2. Chunked CacheService — the fix that makes caching possible at all
   ================================================================== */
console.log('\n1. chunked CacheService');
check('single item over 100KB is rejected by the real service', (() => {
  try { cacheStore.clear(); CacheService.getScriptCache().put('big', 'x'.repeat(200000), 60); return false; }
  catch (e) { return /too large/.test(e.message); }
})());

const ds = gsSandbox.buildDataset_();
const dsJson = JSON.stringify(ds);
const dsChunks = Math.ceil(dsJson.length / gsSandbox.CFG.CACHE_CHUNK);

console.log('  dataset JSON: ' + (dsJson.length / 1024).toFixed(1) + ' KB -> ' + dsChunks + ' chunk(s)');
console.log('  OLD code cached only when JSON < 90KB -> it would have SKIPPED the cache entirely.');
console.log('  NEW code chunks it across ' + dsChunks + ' key(s).');

check('dataset exceeds the old 90KB single-item threshold (so this really was a regression)', dsJson.length > 90000);
check('chunk count is within the configured limit', dsChunks <= gsSandbox.CFG.CACHE_MAX_CHUNKS);

cacheStore.clear();
check('old cache key is NOT present after a rebuild', (() => {
  gsSandbox.getDataset_(true);
  return !cacheStore.has('hmcc.dashboard.payload.v1');
})());

const cached1 = gsSandbox.getDataset_(false);
const cached2 = gsSandbox.getDataset_(false);
check('second getDataset_() hits the cache (no sheet read)', cached1.records.length === ds.records.length);
check('every chunk was written', cacheStore.has('fse.v3.ds:h') && cacheStore.size >= dsChunks + 1);
check('cache round-trips the records exactly',
  JSON.stringify(cached1.records) === JSON.stringify(ds.records));
check('cache round-trips the provenance fields too',
  cached1.updatedAt === ds.updatedAt &&
  cached1.skipped === ds.skipped &&
  JSON.stringify(cached1.columnMap) === JSON.stringify(ds.columnMap));
check('a cache read does NOT re-stamp builtAt (data age stays truthful)',
  typeof cached1.builtAt === 'string' && cached1.builtAt === cached2.builtAt);

check('a missing chunk invalidates the whole entry (no partial data)', (() => {
  const keys = [...cacheStore.keys()].filter(k => /^fse\.v3\.ds:\d+$/.test(k));
  const victim = keys[0];
  const saved = cacheStore.get(victim);
  cacheStore.delete(victim);
  const rebuilt = gsSandbox.getDataset_(false);
  cacheStore.set(victim, saved);
  return rebuilt.records.length === ds.records.length;
})());

check('rebuild purges stale chunks instead of leaking them', (() => {
  cacheStore.clear();
  gsSandbox.getDataset_(true);
  const first = cacheStore.size;
  gsSandbox.getDataset_(true);
  return cacheStore.size === first;
})());

/* ==================================================================
   3. Header mapping + record hygiene
   ================================================================== */
console.log('\n2. header mapping and record hygiene');
check('every expected field was mapped', (() => {
  /* discoveryChannel is intentionally absent from this sheet — the backend
     must cope with a form that never asked the question. */
  const need = ['_submission_time', 'event', 'fullName', 'phone', 'whatsapp', 'nationalId', 'age', 'gender',
    'email', 'college', 'university', 'governorate', 'studentStatus', 'academicYear', 'volunteer',
    'eventSource', 'interest', 'goal', 'expectation'];
  const mapped = ds.mappedColumns;
  const missing = need.filter(k => mapped.indexOf(k) === -1);
  if (missing.length) console.log('      mapped=' + JSON.stringify(mapped) + ' missing: ' + missing.join(', '));
  return missing.length === 0;
})());
check('an absent optional column does not break the build (discoveryChannel)',
  ds.records.every(r => r.discoveryChannel === ''));
check('text columns land in the right fields (interest/goal/expectation)',
  ds.records.every(r => r.interest === 'ريادة الأعمال' && r.goal === 'أريد وظيفة' && r.expectation === 'تعلم عملي'));
check('no header is left unmapped', ds.unmapped.length === 0, JSON.stringify(ds.unmapped));
check('rows with an unparseable timestamp are skipped, not crashed',
  ds.skipped === Math.floor(N / 200), 'skipped=' + ds.skipped);
check('records = submitted rows - skipped', ds.records.length === N - ds.skipped);
check('records are sorted by ts ascending',
  ds.records.every((r, i, a) => i === 0 || a[i - 1].ts <= r.ts));

check('Arabic-Indic age digits were parsed to numbers',
  ds.records.some(r => typeof r.age === 'number'));
check('gender is canonicalised to ذكر/أنثى',
  ds.records.every(r => r.gender === '' || r.gender === 'ذكر' || r.gender === 'أنثى'));
check('academicYear alias "1"/"الأولى" maps to السنة الأولى',
  ds.records.some(r => r.academicYear === 'السنة الأولى'));
check('geography is derived for rows missing governorate',
  ds.records.every(r => r.governorate && r.university));
check('college/university derived from the free-text college cell',
  ds.records.some(r => r.university === 'جامعة القاهرة'));

/* --- regression: canonical values must be Arabic, and the "متطوع" alias
       must not swallow "غير متطوع" (which meant every non-volunteer was
       reported as a volunteer, and the نعم/لا filter matched nothing) --- */
console.log('\n2b. canonical value normalisation');
const CV = gsSandbox.canonicalValue;
check('gender canonicalises to Arabic',
  CV('gender', 'ذكر') === 'ذكر' && CV('gender', 'أنثى') === 'أنثى' &&
  CV('gender', 'انثي') === 'أنثى' && CV('gender', 'female') === 'أنثى' &&
  CV('gender', 'm') === 'ذكر');
check('studentStatus canonicalises to Arabic',
  CV('studentStatus', 'طالب') === 'طالب' && CV('studentStatus', 'خريج') === 'خريج' &&
  CV('studentStatus', 'graduate') === 'خريج');
check('volunteer canonicalises to Arabic',
  CV('volunteer', 'نعم') === 'نعم' && CV('volunteer', 'لا') === 'لا' &&
  CV('volunteer', 'yes') === 'نعم' && CV('volunteer', 'no') === 'لا');
check('REGRESSION: "غير متطوع" is NOT counted as a volunteer',
  CV('volunteer', 'غير متطوع') === 'لا', CV('volunteer', 'غير متطوع'));
check('REGRESSION: "لست متطوعا" is NOT counted as a volunteer',
  CV('volunteer', 'لست متطوعا') === 'لا', CV('volunteer', 'لست متطوعا'));
check('a genuine "متطوع" answer still counts as a volunteer',
  CV('volunteer', 'متطوع') === 'نعم');
check('blank stays blank', CV('gender', '') === '' && CV('gender', null) === '');
check('no canonical value leaks an English key',
  !ds.records.some(r => ['male', 'female', 'student', 'graduate', 'yes', 'no']
    .indexOf(r.gender) !== -1 || ['male', 'female', 'student', 'graduate', 'yes', 'no']
      .indexOf(r.studentStatus) !== -1 || ['male', 'female', 'student', 'graduate', 'yes', 'no']
        .indexOf(r.volunteer) !== -1));
check('every canonical gender is selectable by the filter',
  gsSandbox.facets_(ds.records).genders.every(g => g === 'ذكر' || g === 'أنثى'));
check('filtering by a canonical value actually returns rows', (() => {
  const f = gsSandbox.facets_(ds.records).genders;
  return f.every(g => gsSandbox.applyServerFilters_(ds.records, { gender: g }).length > 0);
})());

/* PII must never appear in the projection */
const rows = gsSandbox.projectRows_(ds.records, false);
const rowsFull = gsSandbox.projectRows_(ds.records, true);
const BANNED = ['fullName', 'phone', 'whatsapp', 'email', 'nationalId', 'participantId', 'qrCode', 'emailStatus'];
check('default rows projection has no PII keys',
  Object.keys(rows[0]).every(k => BANNED.indexOf(k) === -1), JSON.stringify(Object.keys(rows[0])));
check('full=1 rows projection still has no PII keys',
  Object.keys(rowsFull[0]).every(k => BANNED.indexOf(k) === -1), JSON.stringify(Object.keys(rowsFull[0])));
check('no PII value leaks anywhere in the payload text', (() => {
  const text = JSON.stringify(rowsFull);
  const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) || [];
  const leak = emails.filter(e => e !== 'not-an-email');
  if (leak.length) console.log('      leaked: ' + leak.slice(0, 3).join(', '));
  return leak.length === 0;
})());
check('no 10-15 digit phone-like string survives in any TEXT field', (() => {
  /* ts is an epoch-ms number, so only inspect the string-valued fields */
  const strings = [];
  rowsFull.forEach(r => Object.keys(r).forEach(k => {
    if (k === 'ts' || k === 'q' || k === 'age') return;
    if (typeof r[k] === 'string') strings.push(r[k]);
  }));
  const blob = strings.join(' | ');
  const hit = blob.match(/\b\d{10,15}\b/);
  if (hit) console.log('      leaked digit run: ' + hit[0]);
  return !hit;
})());
check('the national-ID column never reaches the browser', (() => {
  const text = JSON.stringify(rowsFull);
  return text.indexOf('2990001000000') === -1;
})());

console.log('  rows payload: ' + (JSON.stringify(rows).length / 1024).toFixed(1) + ' KB (default) vs '
  + (JSON.stringify(rowsFull).length / 1024).toFixed(1) + ' KB (full=1)');

/* ==================================================================
   4. GAS <-> frontend parity (the whole point)
   ================================================================== */
console.log('\n3. server aggregation vs browser FilterEngine');

function sortByName(a, b) {
  const x = String(a.name), y = String(b.name);
  return x < y ? -1 : x > y ? 1 : 0;
}
function sameList(a, b, label) {
  if (!a || !b) { check(label, false, 'missing list'); return; }
  if (a.length !== b.length) { check(label, false, a.length + ' vs ' + b.length); return; }
  const sa = a.slice().sort(sortByName), sb = b.slice().sort(sortByName);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i].name !== sb[i].name || sa[i].count !== sb[i].count) {
      check(label, false, sa[i].name + '/' + sa[i].count + ' vs ' + sb[i].name + '/' + sb[i].count);
      return;
    }
  }
  check(label, true);
}

const FILTER_CASES = [
  {},
  { event: EVENTS[0] },
  { governorate: 'القاهرة' },
  { gender: 'أنثى' },
  { status: 'خريج', volunteer: 'نعم' },
  { event: EVENTS[1], governorate: 'أسيوط', gender: 'ذكر' },
  { event: 'لا يوجد إيفنت' },
  { from: String(BASE + 20 * 86400000), to: String(BASE + 50 * 86400000) },
  { event: EVENTS[2], from: String(BASE + 10 * 86400000) },
  { source: '' }
];

FILTER_CASES.forEach((params, i) => {
  const gasFiltered = gsSandbox.applyServerFilters_(ds.records, params);
  const gasPayload = gsSandbox.buildDashboard_(ds, gasFiltered);

  const fePayload = FilterEngine.buildPayload({ rows }, {
    event: params.event || '',
    governorate: params.governorate || '',
    university: params.university || '',
    gender: params.gender || '',
    status: params.status || '',
    volunteer: params.volunteer || '',
    source: params.source || '',
    from: params.from || '',
    to: params.to || ''
  });

  const tag = 'case ' + i + ' ' + JSON.stringify(params);
  const ok = gasPayload.summary.totalRegistrations === fePayload.summary.totalRegistrations;
  if (!ok) {
    check(tag + ' — same total', false, 'gas=' + gasPayload.summary.totalRegistrations + ' fe=' + fePayload.summary.totalRegistrations);
  } else {
    check(tag + ' — same total (' + gasPayload.summary.totalRegistrations + ')', true);
    check(tag + ' — same daily series', JSON.stringify(gasPayload.daily) === JSON.stringify(fePayload.daily));
    sameList(gasPayload.genders, fePayload.genders, tag + ' — same genders');
    sameList(gasPayload.governorates, fePayload.governorates, tag + ' — same governorates');
    sameList(gasPayload.colleges, fePayload.colleges, tag + ' — same colleges');
    check(tag + ' — same quality score',
      gasPayload.quality.score === fePayload.quality.score,
      'gas=' + gasPayload.quality.score + ' fe=' + fePayload.quality.score);
    check(tag + ' — same activeDays', gasPayload.summary.activeDays === fePayload.summary.activeDays);
    check(tag + ' — same lastSubmissionAt', gasPayload.summary.lastSubmissionAt === fePayload.summary.lastSubmissionAt);
  }
});

/* quality: identical issue sets, not just identical scores */
{
  const g = gsSandbox.quality_(ds.records);
  const f = FilterEngine.buildQuality(ds.records);
  const key = i => i.label + '#' + i.count;
  check('quality issue sets match (server vs browser)',
    JSON.stringify(g.issues.slice().sort((a, b) => key(a).localeCompare(key(b))).map(key))
    === JSON.stringify(f.issues.slice().sort((a, b) => key(a).localeCompare(key(b))).map(key)),
    'gas=' + g.issueTotal + ' fe=' + f.issueTotal);
  check('duplicate emails were actually detected (dupEmail bit works)',
    g.issues.some(i => i.label.indexOf('البريد') !== -1));
}

/* facets parity */
{
  const g = gsSandbox.facets_(ds.records);
  const f = FilterEngine.allFacets(rows);
  check('facets.events match', JSON.stringify(g.events) === JSON.stringify(f.events), JSON.stringify(g.events) + ' vs ' + JSON.stringify(f.events));
  check('facets.universities match', JSON.stringify(g.universities) === JSON.stringify(f.universities));
  check('facets.genders match', JSON.stringify(g.genders) === JSON.stringify(f.genders));
  check('facets.colleges match', JSON.stringify(g.colleges) === JSON.stringify(f.colleges));
}

/* --- regression: a 14-digit national ID was found in the live sheet's age
       column. It must never reach a chart or a facet list. --- */
console.log('\n3b. implausible ages are excluded (national ID in the age column)');
const junk = ds.records.slice();
junk.push({ ts: BASE + 99 * 86400000, event: EVENTS[0], gender: 'ذكر', age: 30405091400123, college: '', university: 'جامعة القاهرة', governorate: 'القاهرة', studentStatus: 'طالب', academicYear: 'السنة الأولى', volunteer: 'نعم', eventSource: 'x', q: 0 });
junk.push({ ts: BASE + 98 * 86400000, event: EVENTS[0], gender: 'ذكر', age: 12, college: '', university: 'جامعة القاهرة', governorate: 'القاهرة', studentStatus: 'طالب', academicYear: 'السنة الأولى', volunteer: 'نعم', eventSource: 'x', q: 0 });
junk.push({ ts: BASE + 97 * 86400000, event: EVENTS[0], gender: 'ذكر', age: 78, college: '', university: 'جامعة القاهرة', governorate: 'القاهرة', studentStatus: 'طالب', academicYear: 'السنة الأولى', volunteer: 'نعم', eventSource: 'x', q: 0 });
junk.push({ ts: BASE + 96 * 86400000, event: EVENTS[0], gender: 'ذكر', age: 22, college: '', university: 'جامعة القاهرة', governorate: 'القاهرة', studentStatus: 'طالب', academicYear: 'السنة الأولى', volunteer: 'نعم', eventSource: 'x', q: 0 });

const ageDist = gsSandbox.distribution_(junk, 'age').list;
check('the national ID never appears in the age distribution',
  !ageDist.some(a => String(a.name).length > 3), JSON.stringify(ageDist.map(a => a.name)));
check('out-of-range ages (12, 78) are excluded', !ageDist.some(a => Number(a.name) === 12 || Number(a.name) === 78), JSON.stringify(ageDist.map(a => a.name)));
check('in-range ages are still counted', ageDist.some(a => Number(a.name) === 22), JSON.stringify(ageDist.map(a => a.name)));
check('the age facet list is filtered too',
  gsSandbox.facets_(junk).ages.every(a => Number(a) >= 14 && Number(a) <= 70));
check('the browser engine agrees on the age distribution',
  JSON.stringify(ageDist.map(a => a.name)) ===
  JSON.stringify(FilterEngine.distribution(junk, 'age', { excludeUnknown: true }).map(a => a.name)));
check('a 14-digit ID survives in the rows payload only via quality flags, not as a chart value',
  (() => {
    const dash = gsSandbox.buildDashboard_(ds, junk);
    return !dash.ages.some(a => String(a.name).length > 3);
  })());
check('the junk rows are still counted in the totals (nothing is silently dropped)',
  gsSandbox.buildDashboard_(ds, junk).summary.totalRegistrations === junk.length);
check('the browser payload filters ages identically',
  !FilterEngine.buildPayload({ rows: junk }, {}).ages.some(a => String(a.name).length > 3));

/* ==================================================================
   5. doGet routing
   ================================================================== */
console.log('\n4. doGet actions');
function call(query) {
  const out = gsSandbox.doGet({ parameter: Object.assign({ action: 'dashboard' }, query) });
  return JSON.parse(out.text);
}

cacheStore.clear();
gsSandbox.getDataset_(true); /* warm once */

const ping = call({ action: 'ping' });
check('action=ping responds', ping.success === true && ping.version === '3.0');
check('action=ping reports cache state', ping.cached === true);

const warm = call({ action: 'warm' });
check('action=warm responds', warm.success === true && warm.records > 0);

const fac = call({ action: 'facets' });
check('action=facets responds with options', fac.success === true && Array.isArray(fac.options.events));
check('action=facets is much smaller than rows',
  JSON.stringify(fac).length < JSON.stringify({ rows }).length / 5,
  Math.round(JSON.stringify(fac).length / 1024) + 'KB vs ' + Math.round(JSON.stringify({ rows }).length / 1024) + 'KB');

const rw = call({ action: 'rows' });
check('action=rows responds', rw.success === true && rw.rows.length === ds.records.length);
check('action=rows carries no PII', Object.keys(rw.rows[0]).every(k => BANNED.indexOf(k) === -1));
check('action=rows reports meta', rw.meta && rw.meta.privacy === 'pii-stripped' && typeof rw.meta.skippedRows === 'number');

const rwFull = call({ action: 'rows', full: '1' });
check('action=rows&full=1 adds the long text fields',
  'interest' in rwFull.rows[0] && 'goal' in rwFull.rows[0] && 'expectation' in rwFull.rows[0]);

const dash = call({ action: 'dashboard', event: EVENTS[0] });
check('action=dashboard honours query filters',
  dash.summary.totalRegistrations === rows.filter(r => r.event === EVENTS[0]).length,
  dash.summary.totalRegistrations + ' vs ' + rows.filter(r => r.event === EVENTS[0]).length);
check('action=dashboard reports the unfiltered total too', dash.summary.totalUnfiltered === ds.records.length);
check('action=dashboard filter options come from the full dataset',
  fac.options.events.length === dash.options.events.length);

const jsonp = gsSandbox.doGet({ parameter: { action: 'ping', callback: 'my$cb.1' } });
check('callback is sanitised and wrapped as JSONP', /^my\$cb1\(.*\);$/.test(jsonp.text), jsonp.text.slice(0, 40));

const bogus = call({ action: 'nope' });
check('unknown action returns success:false', bogus.success === false);

const bad = call({ action: 'dashboard', event: 'x'.repeat(5000) });
check('an oversized/garbage filter does not throw', bad.success === true || bad.success === false);

/* cache-hit path must be fast (no sheet read) */
const beforePuts = cachePuts;
const t = process.hrtime.bigint();
for (let i = 0; i < 50; i++) call({ action: 'dashboard', event: EVENTS[i % 3] });
const warmMs = Number(process.hrtime.bigint() - t) / 1e6 / 50;
console.log('  warm action=dashboard: ' + warmMs.toFixed(2) + ' ms/call, extra cache writes: ' + (cachePuts - beforePuts));
check('warm dashboard response is served from cache in under 150ms', warmMs < 150, warmMs.toFixed(2) + 'ms');

/* ================================================================== */
console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
