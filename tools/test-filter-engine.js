/* Functional + perf test for the new FilterEngine.
   Run: node tools/test-filter-engine.js                                   */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ---- minimal Util shim (utils.js is browser-oriented) ---- */
const Util = {
  fmtNumber: (n) => (n == null ? '—' : String(n)),
  pct: (p, t) => (!t ? '0%' : Math.round((p / t) * 100) + '%')
};

const sandbox = { Util, console, Map, Set, Date, Math, JSON, Object, Array, Number, String, performance: { now: () => Date.now() } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/filter-engine.js'), 'utf8'), sandbox, { filename: 'filter-engine.js' });
const FilterEngine = sandbox.FilterEngine;

/* ---- Q_KEYS must mirror Code.gs exactly ---- */
const CODE_GS = fs.readFileSync(path.join(ROOT, 'google-apps-script/Code.gs'), 'utf8');
const gasBlock = CODE_GS.match(/var Q_KEYS = \[([\s\S]*?)\];/);
const gasKeys = [...gasBlock[1].matchAll(/"([a-zA-Z]+)"/g)].map(m => m[1]);

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('  PASS  ' + name); }
  else { failures++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

/* ------------------------------------------------------------------
   Synthetic dataset shaped exactly like GAS projectRows_(records, false)
   ------------------------------------------------------------------ */
const EVENTS = ['ورشة السيرة الذاتية', 'لقاء التوجيه', 'أسبوع ريادة الأعمال'];
const GOVS = ['القاهرة', 'الإسكندرية', 'أسيوط'];
const UNIS = ['جامعة القاهرة', 'جامعة الإسكندرية', 'جامعة أسيوط'];
const GENDERS = ['ذكر', 'أنثى'];
const STATUS = ['طالب', 'خريج'];
const VOL = ['نعم', 'لا'];
const YEARS = ['السنة الأولى', 'السنة الثانية', 'السنة الثالثة'];

function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const N = 5000;
const rnd = mulberry(42);
const rows = [];
const base = Date.UTC(2026, 0, 5);

for (let i = 0; i < N; i++) {
  /* ~12% of records deliberately missing fields, to exercise quality bits */
  const thin = rnd() < 0.12;
  let q = 0;
  if (!thin || rnd() > 0.3) q |= 1;      /* hasName */
  if (!thin || rnd() > 0.4) q |= 2;      /* hasPhone */
  if (!thin || rnd() > 0.5) q |= 8;      /* hasEmail */
  if (!thin || rnd() > 0.2) q |= 16;     /* hasCollege */
  if (rnd() > 0.1) q |= 32;              /* hasAge */
  if (rnd() > 0.05) q |= 64;             /* hasGender */
  q |= 128;                              /* hasEvent always */
  if (rnd() > 0.3) q |= 256;             /* hasSource */
  if (rnd() < 0.02) q |= 512;            /* invalidEmail */
  if (rnd() < 0.02) q |= 1024;           /* invalidPhone */
  if (rnd() < 0.02) q |= 2048;           /* invalidAge */
  if (rnd() < 0.03) q |= 8192;           /* dupEmail */

  rows.push({
    ts: base + Math.floor(rnd() * 90) * 86400000 + Math.floor(rnd() * 86400000),
    event: EVENTS[Math.floor(rnd() * EVENTS.length)],
    gender: thin && !(q & 64) ? '' : GENDERS[Math.floor(rnd() * 2)],
    age: (q & 32) ? 17 + Math.floor(rnd() * 8) : null,
    college: (q & 16) ? 'كلية ' + UNIS[Math.floor(rnd() * UNIS.length)] : '',
    university: UNIS[Math.floor(rnd() * UNIS.length)],
    governorate: GOVS[Math.floor(rnd() * GOVS.length)],
    studentStatus: STATUS[Math.floor(rnd() * 2)],
    academicYear: YEARS[Math.floor(rnd() * YEARS.length)],
    volunteer: VOL[Math.floor(rnd() * 2)],
    eventSource: (q & 256) ? 'سوشيال ميديا' : '',
    q
  });
}
rows.sort((a, b) => a.ts - b.ts);

/* ------------------------------------------------------------------
   1. Q_KEYS parity between GAS and the frontend
   ------------------------------------------------------------------ */
console.log('\n1. quality bitmask parity (Code.gs <-> filter-engine.js)');
check('Q_KEYS match (' + gasKeys.length + ' keys)',
  JSON.stringify(gasKeys) === JSON.stringify(FilterEngine.Q_KEYS),
  JSON.stringify(gasKeys) + ' vs ' + JSON.stringify(FilterEngine.Q_KEYS));

/* ------------------------------------------------------------------
   2. bitmask encode/decode round-trip
   ------------------------------------------------------------------ */
console.log('\n2. quality flag decode');
let decodeOk = true;
for (const r of rows) {
  for (let b = 0; b < FilterEngine.Q_KEYS.length; b++) {
    const key = FilterEngine.Q_KEYS[b];
    const expected = (r.q & (1 << b)) !== 0;
    if (FilterEngine.qflag(r, key) !== expected) { decodeOk = false; break; }
  }
  if (!decodeOk) break;
}
check('every bit decodes to its own flag', decodeOk);
check('legacy rec.quality object still supported',
  FilterEngine.qflag({ quality: { hasName: true, hasPhone: false } }, 'hasName') === true &&
  FilterEngine.qflag({ quality: { hasName: true } }, 'hasPhone') === false);
check('record with no quality data reads as all-false',
  FilterEngine.qflag({ ts: 1 }, 'hasName') === false);

/* ------------------------------------------------------------------
   3. filtering correctness vs a naive scan
   ------------------------------------------------------------------ */
console.log('\n3. filtering correctness (index vs naive scan)');
const FILTER_KEYS = { event: 'event', governorate: 'governorate', university: 'university', gender: 'gender', status: 'studentStatus', volunteer: 'volunteer', source: 'eventSource' };

function naive(rows, f) {
  return rows.filter(r => {
    for (const k in FILTER_KEYS) {
      const v = f[k];
      if (v && r[FILTER_KEYS[k]] !== v) return false;
    }
    if (f.from && r.ts < f.from) return false;
    if (f.to && r.ts > f.to) return false;
    return true;
  });
}

const cases = [
  {},
  { event: EVENTS[0] },
  { governorate: GOVS[1] },
  { gender: 'أنثى' },
  { status: 'خريج', volunteer: 'نعم' },
  { event: EVENTS[1], governorate: GOVS[2], gender: 'ذكر' },
  { source: '' },
  { volunteer: 'لا', year: 'x' },
  { event: 'لا يوجد' },
  { from: base + 30 * 86400000, to: base + 60 * 86400000 },
  { event: EVENTS[2], from: base + 10 * 86400000 }
];

let filterOk = true;
cases.forEach((f, i) => {
  const a = naive(rows, f).length;
  const b = FilterEngine.applyFilters(rows, f).length;
  if (a !== b) { filterOk = false; console.log('      case ' + i + ' ' + JSON.stringify(f) + ': naive=' + a + ' index=' + b); }
});
check('all ' + cases.length + ' filter cases match the naive scan', filterOk);

check('no filters returns every row', FilterEngine.applyFilters(rows, {}).length === N);
check('"all" is treated as no filter', FilterEngine.applyFilters(rows, { event: 'all' }).length === N);

/* the index must be built once and reused, not rebuilt per filter change */
{
  FilterEngine.reset();
  const t = process.hrtime.bigint();
  FilterEngine.applyFilters(rows, { event: EVENTS[0] });   /* builds the index */
  const withBuild = Number(process.hrtime.bigint() - t) / 1e6;

  const t2 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) FilterEngine.applyFilters(rows, { governorate: GOVS[1] });
  const warmAvg = Number(process.hrtime.bigint() - t2) / 1e6 / 20;

  FilterEngine.reset();
  const t3 = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) { FilterEngine.reset(); FilterEngine.applyFilters(rows, { governorate: GOVS[1] }); }
  const coldAvg = Number(process.hrtime.bigint() - t3) / 1e6 / 20;

  console.log('  (first call incl. index build: ' + withBuild.toFixed(2) + ' ms)');
  console.log('  (warm filter: ' + warmAvg.toFixed(3) + ' ms  vs  cold: ' + coldAvg.toFixed(3) + ' ms)');
  check('a warm filter is much cheaper than a cold one (index is reused)',
    warmAvg < coldAvg / 3, 'warm=' + warmAvg.toFixed(3) + ' cold=' + coldAvg.toFixed(3));
}

/* exact record identity, not just counts */
let identityOk = true;
{
  const f = { event: EVENTS[0], gender: 'أنثى' };
  const a = naive(rows, f);
  const b = FilterEngine.applyFilters(rows, f);
  if (a.length !== b.length) identityOk = false;
  else for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { identityOk = false; break; }
}
check('filtered output preserves the original record objects', identityOk);

/* ------------------------------------------------------------------
   4. payload shape — every series must carry `name`
      (this is the bug that broke the gender/age/year/college doughnuts)
   ------------------------------------------------------------------ */
console.log('\n4. payload shape consumed by charts.js / dashboard.js');
const payload = FilterEngine.buildPayload({ rows }, {});

['genders', 'ages', 'years', 'colleges', 'events', 'governorates'].forEach(k => {
  const list = payload[k] || [];
  const allNamed = list.every(d => typeof d.name === 'string' && d.name.length > 0);
  check(k + ': every entry has a non-empty `name` (' + list.length + ' slices)', allNamed);
  check(k + ': every entry has a numeric `count`', list.every(d => typeof d.count === 'number'));
  check(k + ': every entry has a numeric `percentage`', list.every(d => typeof d.percentage === 'number'));
});

check('summary.totalRegistrations === N', payload.summary.totalRegistrations === N);
check('summary.totalUnfiltered === N', payload.summary.totalUnfiltered === N);
check('summary.lastSubmissionAt is the true max ts',
  payload.summary.lastSubmissionAt === Math.max(...rows.map(r => r.ts)));
check('summary.activeDays matches daily length',
  payload.summary.activeDays === payload.daily.length);
check('daily is sorted ascending by date',
  payload.daily.every((d, i, a) => i === 0 || a[i - 1].date <= d.date));
check('daily counts sum to the filtered total',
  payload.daily.reduce((s, d) => s + d.count, 0) === N);
check('colleges are capped at 10', payload.colleges.length <= 10);
check('quality.score is 0..100', payload.quality.score >= 0 && payload.quality.score <= 100);
check('quality.total === N', payload.quality.total === N);
check('quality.issues is an array', Array.isArray(payload.quality.issues));
check('every quality issue has label/count/pct/severity',
  payload.quality.issues.every(i => i.label && typeof i.count === 'number' && typeof i.pct === 'number' && i.severity));

/* filtered payload must agree with the filtered record count */
const p2 = FilterEngine.buildPayload({ rows }, { gender: 'أنثى' });
const expected2 = rows.filter(r => r.gender === 'أنثى').length;
check('filtered payload total matches the record count', p2.summary.totalRegistrations === expected2);
check('filtered payload reports the unfiltered total too', p2.summary.totalUnfiltered === N);
check('filtered daily sums to the filtered total',
  p2.daily.reduce((s, d) => s + d.count, 0) === expected2);

/* options must come from the FULL dataset, not the filtered slice */
check('filter options stay complete while a filter is active',
  p2.options.governorates.length === 3 && p2.options.events.length === 3);

/* empty dataset */
const empty = FilterEngine.buildPayload({ rows: [] }, {});
check('empty dataset yields a safe payload', empty.success === true && empty.summary && Array.isArray(empty.daily));

/* ------------------------------------------------------------------
   5. performance: index vs naive scan
   ------------------------------------------------------------------ */
console.log('\n5. performance');
function bench(label, fn, iters) {
  fn(); /* warm */
  const t = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / iters;
  console.log('  ' + label.padEnd(42) + ms.toFixed(3) + ' ms/op');
  return ms;
}

console.log('  dataset = ' + N + ' rows, ' + FilterEngine.Q_KEYS.length + ' quality bits');
const iters = 200;
const tIndex = bench('FilterEngine.applyFilters (indexed)', () => FilterEngine.applyFilters(rows, { event: EVENTS[0] }), iters);
const tNaive = bench('naive .filter() scan', () => naive(rows, { event: EVENTS[0] }), iters);
console.log('  speedup: ' + (tNaive / tIndex).toFixed(2) + 'x');

bench('buildPayload (full, unfiltered)', () => FilterEngine.buildPayload({ rows }, {}), 50);
bench('buildPayload (event filter)', () => FilterEngine.buildPayload({ rows }, { event: EVENTS[0] }), 50);
const tBuild = bench('buildIndex (one-off)', () => FilterEngine.buildIndex(rows), 50);

/* payload size: bitmask vs the old verbose quality object */
const withMask = JSON.stringify(rows).length;
const withObject = JSON.stringify(rows.map(r => {
  const c = Object.assign({}, r);
  delete c.q;
  c.quality = {};
  FilterEngine.Q_KEYS.forEach((k, b) => { if (r.q & (1 << b)) c.quality[k] = true; });
  return c;
})).length;
console.log('\n  rows payload with bitmask : ' + (withMask / 1024).toFixed(1) + ' KB');
console.log('  rows payload with objects : ' + (withObject / 1024).toFixed(1) + ' KB');
console.log('  saving                    : ' + (100 - (withMask / withObject) * 100).toFixed(1) + '%');
console.log('  per-record quality cost   : ' + ((withObject - withMask) / N).toFixed(0) + ' bytes -> ~8 bytes');
console.log('  GAS cache chunks needed   : ' + Math.ceil(withMask / 90000) + ' (limit 64)');

/* ------------------------------------------------------------------ */
console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
