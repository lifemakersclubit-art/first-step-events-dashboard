/* Guards against the shared lookup tables drifting between the Apps Script
   backend and the browser. These tables are duplicated on purpose (the sheet
   is normalised server-side AND the browser has a local fallback path), so
   they need a test that fails the moment one side is edited alone.

   Run: node tools/test-parity.js                                            */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

const gsSrc = fs.readFileSync(path.join(ROOT, 'google-apps-script/Code.gs'), 'utf8');

const gs = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, Map, Set };
vm.createContext(gs);
vm.runInContext(gsSrc, gs, { filename: 'Code.gs' });

/* schema.js assigns window.Schema at the end */
const fe = { console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, Map, Set, window: {} };
vm.createContext(fe);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/schema.js'), 'utf8'), fe, { filename: 'schema.js' });
const Schema = fe.window.Schema;

console.log('\n1. VALUE_ALIASES (canonical values + aliases)');
check('same set of normalised fields',
  JSON.stringify(Object.keys(gs.VALUE_ALIASES).sort()) === JSON.stringify(Object.keys(Schema.VALUE_ALIASES).sort()),
  JSON.stringify(Object.keys(gs.VALUE_ALIASES)) + ' vs ' + JSON.stringify(Object.keys(Schema.VALUE_ALIASES)));

Object.keys(gs.VALUE_ALIASES).forEach(field => {
  const g = gs.VALUE_ALIASES[field];
  const s = Schema.VALUE_ALIASES[field];
  check(field + ': same canonical groups', JSON.stringify(Object.keys(g)) === JSON.stringify(Object.keys(s)),
    JSON.stringify(Object.keys(g)) + ' vs ' + JSON.stringify(Object.keys(s)));
  Object.keys(g).forEach(group => {
    check(field + '/' + group + ': same alias list',
      JSON.stringify(g[group].slice().sort()) === JSON.stringify((s[group] || []).slice().sort()),
      JSON.stringify(g[group]) + ' vs ' + JSON.stringify(s[group]));
  });
});

check('NEGATIVE_CANONICAL matches',
  JSON.stringify(gs.NEGATIVE_CANONICAL) === JSON.stringify(Schema.NEGATIVE_CANONICAL),
  JSON.stringify(gs.NEGATIVE_CANONICAL) + ' vs ' + JSON.stringify(Schema.NEGATIVE_CANONICAL));

console.log('\n2. canonicalValue behaviour parity');
const FIELDS = ['gender', 'studentStatus', 'volunteer', 'academicYear'];
const SAMPLES = {
  gender: ['ذكر', 'انثى', 'أنثى', 'انثي', 'انثه', 'بنت', 'امراه', 'male', 'female', 'm', 'f', 'رجل', '', null, '  '],
  studentStatus: ['طالب', 'طالبه', 'طالب/', 'خريج', 'خريجه', 'graduate', 'undergraduate', 'student', 'graduated', ''],
  volunteer: ['نعم', 'لا', 'لا،', 'نعم،', 'متطوع', 'لست', 'لست متطوعا', 'غير متطوع', 'غيرمتطوع', 'ليس', 'حالي', 'yes', 'no', 'true', 'false', ''],
  academicYear: ['الأولى', 'الاولى', 'الاوله', '1', '2', 'الثانية', 'الثالثة', 'الرابعة', '4', 'خامس', 'خريج', 'graduate', '']
};

let mismatch = 0;
FIELDS.forEach(field => {
  SAMPLES[field].forEach(raw => {
    const a = gs.canonicalValue(field, raw);
    const b = Schema.canonicalValue(field, raw);
    if (a !== b) {
      mismatch++;
      console.log('      ' + field + ' ' + JSON.stringify(raw) + ': gas=' + JSON.stringify(a) + ' schema=' + JSON.stringify(b));
    }
  });
});
check('all ' + FIELDS.reduce((s, f) => s + SAMPLES[f].length, 0) + ' canonicalisation samples agree', mismatch === 0);

console.log('\n3. negation handling');
check('NEGATION_RE is defined in Code.gs', typeof String(gs.NEGATION_RE) === 'string' && String(gs.NEGATION_RE).indexOf('لست') !== -1, String(gs.NEGATION_RE));
check('"لست متطوعا" -> لا', gs.canonicalValue('volunteer', 'لست متطوعا') === 'لا');
check('"غير متطوع" -> لا', gs.canonicalValue('volunteer', 'غير متطوع') === 'لا');
check('"متطوع" -> نعم', gs.canonicalValue('volunteer', 'متطوع') === 'نعم');
check('"نعم" -> نعم', gs.canonicalValue('volunteer', 'نعم') === 'نعم');

console.log('\n4. no English canonical values leak to the browser');
['gender', 'studentStatus', 'volunteer', 'academicYear'].forEach(f => {
  Object.keys(gs.VALUE_ALIASES[f]).forEach(group => {
    check(f + ' group key "' + group + '" is not a bare English key',
      !['male', 'female', 'student', 'graduate', 'yes', 'no'].includes(group));
  });
});

console.log('\n5. text normalisation parity');
const NORM_SAMPLES = ['القاهرة', 'الronic', 'جامعة الأزهر', '  اسيوط  ', 'أ', 'إ', 'آ', 'ة', 'ى', 'ي', '١٢٣', 'a\u200fb', '', null];
let nMismatch = 0;
NORM_SAMPLES.forEach(v => {
  if (gs.normalizeText(v) !== Schema.normalizeText(v)) {
    nMismatch++;
    console.log('      ' + JSON.stringify(v) + ': gas=' + JSON.stringify(gs.normalizeText(v)) + ' schema=' + JSON.stringify(Schema.normalizeText(v)));
  }
  if (gs.compact(v) !== Schema.compact(v)) {
    nMismatch++;
    console.log('      compact ' + JSON.stringify(v) + ' differs');
  }
});
check('normalizeText/compact agree on all samples', nMismatch === 0);

console.log('\n6. GEO_RULES parity (geography derivation)');
check('same rule count', gs.GEO_RULES.length === Schema.GEO_RULES.length,
  gs.GEO_RULES.length + ' vs ' + Schema.GEO_RULES.length);
check('every rule matches (gov, uni, keys)',
  JSON.stringify(gs.GEO_RULES) === JSON.stringify(Schema.GEO_RULES));
['كلية الهندسة جامعة القاهرة', 'كلية الطب جامعة الاسكندرية', 'كلية الحقوق جامعة اسيوط',
  'معهد الهندسة جامعة المنصورة', 'اكاديمية.port Said', 'جامعة بنها فرع بنها'].forEach(college => {
  const rec = { college, university: '', governorate: '' };
  const a = gs.deriveGeography(rec);
  const b = Schema.deriveGeography(rec);
  check('deriveGeography("' + college + '") agrees',
    a.governorate === b.governorate && a.university === b.university,
    JSON.stringify(a) + ' vs ' + JSON.stringify(b));
});

console.log('\n7. Q_KEYS parity between Code.gs and filter-engine.js');
const feSandbox = { Util: { fmtNumber: String, pct: () => '' }, console, JSON, Math, Date, Object, Array, Number, String, Map, Set };
vm.createContext(feSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/filter-engine.js'), 'utf8'), feSandbox, { filename: 'filter-engine.js' });
check('Q_KEYS identical (order matters — it is the bit layout)',
  JSON.stringify(gs.Q_KEYS) === JSON.stringify(feSandbox.FilterEngine.Q_KEYS),
  JSON.stringify(gs.Q_KEYS) + ' vs ' + JSON.stringify(feSandbox.FilterEngine.Q_KEYS));

console.log('\n8. OUT fields actually consumed by the dashboard');
const feUsed = ['ts', 'event', 'gender', 'age', 'college', 'university', 'governorate',
  'studentStatus', 'academicYear', 'volunteer', 'eventSource'];
check('OUT_CORE covers every field FilterEngine filters/aggregates on', (() => {
  const core = gs.OUT_CORE;
  return feUsed.every(f => core.includes(f));
})(), JSON.stringify(gs.OUT_CORE));
check('OUT_CORE + OUT_EXTRA covers OUT_FIELDS-equivalent set', (() => {
  const all = gs.OUT_CORE.concat(gs.OUT_EXTRA);
  return ['discoveryChannel', 'interest', 'goal', 'expectation'].every(f => all.includes(f));
})());
check('no OUT field is a sensitive/PII field', (() => {
  const all = gs.OUT_CORE.concat(gs.OUT_EXTRA);
  const sensitive = gs.FIELDS.filter(f => f.sensitive).map(f => f.key);
  return all.every(f => !sensitive.includes(f));
})(), JSON.stringify(gs.FIELDS.filter(f => f.sensitive).map(f => f.key)));

console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
process.exit(failures ? 1 : 0);
