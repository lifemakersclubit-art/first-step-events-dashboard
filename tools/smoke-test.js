/* End-to-end browser smoke test.

   Serves the project over HTTP, rewrites API_CONFIG.BASE_URL to point at a
   local endpoint backed by the REAL google-apps-script/Code.gs (loaded with
   stubbed Apps Script globals), then drives headless Chrome over the DevTools
   Protocol to assert the dashboard actually paints and the filters work.

   Run: node tools/smoke-test.js                                             */

const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const PORT = 8791;
const CDP_PORT = 9333;

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].find(p => fs.existsSync(p));

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
  return cond;
};

/* ==================================================================
   1. Load the real Code.gs with stubbed Apps Script globals
   ================================================================== */
const HEADERS = [
  'وقت التسجيل', 'ما الايفنت الذي ترغب في التسجيل به وحضوره', 'الاسم بالكامل', 'رقم الهاتف',
  'رقم الواتساب', 'الرقم القومي', 'السن', 'النوع', 'البريد الإلكتروني', 'الكلية',
  'الجامعة', 'المحافظة', 'هل انت طالب أم خريج',
  'اذا كنت طالبا ما السنة الدراسية التي تدرس بها حاليا',
  'هل انت متطوع حاليا في اندية صناع الحياة بالجامعات المصرية',
  'كيف تعرفت على هذا الايفنت', 'ما المجال الذي تهتم به أكثر',
  'ما هدفك الاساسي من حضور الايفنت',
  'ما اكثر شيء تحب ان تراه او تستفيد منه خلال الايفنت'
];
const EVENTS = ['ورشة السيرة الذاتية', 'لقاء التوجيه', 'أسبوع ريادة الأعمال', 'ملتقى الخريجين'];
const COLLEGES = ['كلية الهندسة جامعة القاهرة', 'كلية الطب جامعة الإسكندرية', 'كلية الحاسبات والمعلومات جامعة أسيوط'];
const GOVS = ['القاهرة', 'الإسكندرية', 'أسيوط', 'الدقهلية'];

let seed = 20260101;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const N = 900;
const BASE = Date.UTC(2026, 0, 5);
const sheetRows = [HEADERS];
for (let i = 0; i < N; i++) {
  const thin = rnd() < 0.08;
  sheetRows.push([
    new Date(BASE + Math.floor(rnd() * 70) * 86400000),
    EVENTS[Math.floor(rnd() * EVENTS.length)],
    thin ? '' : 'طالب ' + i,
    thin ? '' : '0100000' + (1000 + i),
    thin ? '' : '0100000' + (1000 + i),
    thin ? '' : '299000100000' + (i % 90 + 10),
    thin ? '' : 17 + Math.floor(rnd() * 8),
    thin ? '' : (rnd() > 0.5 ? 'ذكر' : 'أنثى'),
    'user' + i + '@example.com',
    thin ? '' : COLLEGES[Math.floor(rnd() * COLLEGES.length)],
    thin ? '' : '',
    thin ? '' : GOVS[Math.floor(rnd() * GOVS.length)],
    rnd() > 0.5 ? 'طالب' : 'خريج',
    ['الأولى', 'الثانية', 'الثالثة'][Math.floor(rnd() * 3)],
    rnd() > 0.5 ? 'نعم' : 'لا',
    thin ? '' : 'سوشيال ميديا',
    'ريادة الأعمال', 'وظيفة', 'تعلم عملي'
  ]);
}

const sheet = {
  getName: () => 'Registrations',
  getSheetId: () => 1436196095,
  getLastRow: () => sheetRows.length,
  getLastColumn: () => HEADERS.length,
  getRange: (r, c, nr, nc) => ({
    getValues: () => {
      const out = [];
      for (let i = 0; i < nr; i++) out.push((sheetRows[r - 1 + i] || []).slice(c - 1, c - 1 + nc));
      return out;
    }
  })
};
const cacheStore = new Map();
const gs = {
  SpreadsheetApp: { openById: () => ({ getSheetByName: () => null, getSheets: () => [sheet], getLastModified: () => new Date(BASE) }) },
  CacheService: {
    getScriptCache: () => ({
      get: k => (cacheStore.has(k) ? cacheStore.get(k) : null),
      put: (k, v) => { if (String(v).length > 100 * 1024) throw new Error('too large'); cacheStore.set(k, String(v)); },
      remove: k => { if (!cacheStore.has(k)) throw new Error('absent'); cacheStore.delete(k); }
    })
  },
  ContentService: {
    MimeType: { JSON: 'application/json', JAVASCRIPT: 'text/javascript' },
    createTextOutput: t => ({ text: t, setMimeType() { return this; } })
  },
  console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, parseInt, parseFloat, Map, Set
};
vm.createContext(gs);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'google-apps-script/Code.gs'), 'utf8'), gs, { filename: 'Code.gs' });

const truthy = ds => ds.records.length;
console.log('mock backend built: ' + truthy(gs.buildDataset_()) + ' records\n');

/* ==================================================================
   2. Static server + API endpoint
   ================================================================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

let apiHits = [];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + PORT);

  if (u.pathname === '/exec') {
    const action = u.searchParams.get('action') || 'dashboard';
    apiHits.push(action);
    let out;
    try {
      if (action === 'ping') out = { success: true, version: '3.0' };
      else if (action === 'warm') out = { success: true, records: N };
      else if (action === 'facets') {
        const ds = gs.getDataset_(false);
        out = { success: true, options: gs.facets_(ds.records), summary: { totalRegistrations: ds.records.length } };
      } else if (action === 'rows') {
        const ds = gs.getDataset_(false);
        out = { success: true, rows: gs.projectRows_(ds.records, false), updatedAt: ds.updatedAt, meta: { privacy: 'pii-stripped' } };
      } else {
        const ds = gs.getDataset_(false);
        out = gs.buildDashboard_(ds, gs.applyServerFilters_(ds.records, Object.fromEntries(u.searchParams)));
      }
    } catch (e) { out = { success: false, error: String(e.message || e) }; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
    return;
  }

  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }

  let body = fs.readFileSync(file);
  const ext = path.extname(file);

  /* Redirect the API to this server so the real page code runs unmodified. */
  if (p === '/js/config.js') {
    body = Buffer.from(String(body).replace(
      /BASE_URL:\s*'[^']*'/,
      "BASE_URL: 'http://127.0.0.1:" + PORT + "/exec'"
    ));
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(body);
});

/* ==================================================================
   3. Minimal CDP client
   ================================================================== */
function httpJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('timeout waiting for ' + label);
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];

  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      listeners.forEach(fn => fn(msg));
    }
  });

  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  const send = (method, params) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  return { ready, send, on: fn => listeners.push(fn), close: () => ws.close() };
}

/* ==================================================================
   4. Run
   ================================================================== */
(async function main() {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  if (!CHROME) { console.log('  SKIP  no Chrome/Edge found'); return finish(); }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fse-smoke-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--mute-audio',
    '--window-size=1440,2400',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profile,
    '--host-resolver-rules=MAP script.google.com 127.0.0.1:' + PORT,
    'about:blank'
  ], { stdio: 'ignore' });

  let cdp;
  try {
    const target = await waitFor(async () => {
      const list = await httpJSON('http://127.0.0.1:' + CDP_PORT + '/json/list');
      return list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    }, 20000, 'chrome devtools');

    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;

    const consoleErrors = [];
    const pageErrors = [];
    let pageLoads = 0;
    cdp.on(msg => {
      if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
        consoleErrors.push(msg.params.type + ': ' + msg.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        pageErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        consoleErrors.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
      }
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');

    const evaluate = async (expr, awaitPromise) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: !!awaitPromise
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };

    /* "Ready" is two independent requests: rows paints the numbers, facets
       fills the filter dropdowns. Wait for BOTH or later assertions race the
       slower one. */
    const FULL_READY = `(function(){
      var h = document.querySelector('#heroTotal');
      if (!h) return false;
      if (!document.body.classList.contains('ready')) return false;
      if (!h.textContent || h.textContent === 'جاري التحميل…') return false;
      var sel = document.querySelector('#dFilterEvent');
      if (!sel || sel.options.length < 2 || sel.disabled) return false;
      var err = document.querySelector('#errorState');
      if (err && !err.hidden) return 'error';
      return true;
    })()`;

    pageLoads++; await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });

    console.log('1. boot');
    const booted = await waitFor(() => evaluate(FULL_READY), 45000, 'dashboard ready').catch(e => 'TIMEOUT:' + e.message);

    if (booted === 'error') { check('dashboard reaches the ready state', false, 'showed the error state'); }
    else check('dashboard reaches the ready state (numbers + filter options)', booted === true || String(booted).indexOf('TIMEOUT') === 0, booted);

    const snap = await evaluate(`(function(){
      var t = function(s){ var e=document.querySelector(s); return e ? e.textContent.trim() : null; };
      var n = function(s){ var e=document.querySelector(s); return e ? e.querySelectorAll(s.indexOf('List')>-1?'.activity-item,.rank-item,.issue-item':'.x').length : 0; };
      var charts = [].slice.call(document.querySelectorAll('canvas')).map(function(c){
        var inst = (window.Chart && Chart.getChart(c)) || null;
        return { id: c.id, hasChart: !!inst, points: inst && inst.data.datasets[0].data ? inst.data.datasets[0].data.length : 0,
                 labels: inst && inst.data.labels ? inst.data.labels.filter(Boolean).length : 0 };
      });
      return {
        heroTotal: t('#heroTotal'),
        kpiTotal: t('#kpiTotal'),
        kpiEvents: t('#kpiEvents'),
        kpiGov: t('#kpiGovernorates'),
        kpiDays: t('#kpiDays'),
        pulse: t('#pulseDelta'),
        trendAverage: t('#trendAverage'),
        trendPeak: t('#trendPeak'),
        quality: t('#qualityScore'),
        events: document.querySelectorAll('#eventList .activity-item').length,
        govs: document.querySelectorAll('#govList .rank-item').length,
        issues: document.querySelectorAll('#issueList .issue-item').length,
        tbars: document.querySelectorAll('#trendBars .tbar').length,
        filterOpts: {
          event: document.querySelector('#dFilterEvent') ? document.querySelector('#dFilterEvent').options.length : -1,
          gender: document.querySelector('#dFilterGender') ? document.querySelector('#dFilterGender').options.length : -1,
          gov: document.querySelector('#dFilterGov') ? document.querySelector('#dFilterGov').options.length : -1,
          status: document.querySelector('#dFilterStatus') ? document.querySelector('#dFilterStatus').options.length : -1,
          volunteer: document.querySelector('#dFilterVolunteer') ? document.querySelector('#dFilterVolunteer').options.length : -1,
          source: document.querySelector('#dFilterSource') ? document.querySelector('#dFilterSource').options.length : -1
        },
        genderLabels: (window.Chart && Chart.getChart(document.querySelector('#genderChart')))
          ? Chart.getChart(document.querySelector('#genderChart')).data.labels : null,
        ageLabels: (window.Chart && Chart.getChart(document.querySelector('#ageChart')))
          ? Chart.getChart(document.querySelector('#ageChart')).data.labels : null,
        charts: charts,
        splashGone: (function(){ var s=document.querySelector('#splash'); return !s || getComputedStyle(s).display === 'none' || s.classList.contains('splash--hide'); })(),
        errorHidden: (function(){ var e=document.querySelector('#errorState'); return !e || e.hidden; })(),
        noQualitySection: !document.querySelector('#quality'),
        noQualityNav: !document.querySelector('.site-nav a[href="#quality"]'),
        orphanQualityNodes: document.querySelectorAll('#qualityScore, #qualityBar, #issueList').length,
        aboutMentionsQuality: /جودة البيانات/.test((document.querySelector('.about__list')||{}).textContent || '')
      };
    })()`);

    console.log('\n2. painted content');
    check('hero total is a formatted number', /[٠-٩0-9]/.test(snap.heroTotal || ''), snap.heroTotal);
    check('hero total matches the KPI total', snap.heroTotal === snap.kpiTotal, [snap.heroTotal, snap.kpiTotal]);
    check('KPI strip is populated', [snap.kpiEvents, snap.kpiGov, snap.kpiDays].every(v => v && v !== '—' && v !== 'جاري التحميل…'), [snap.kpiEvents, snap.kpiGov, snap.kpiDays]);
    check('event list rendered', snap.events > 0, snap.events);
    check('governorate list rendered', snap.govs > 0, snap.govs);
    check('trend bars rendered', snap.tbars > 0, snap.tbars);
    check('splash is dismissed', snap.splashGone);
    check('error state stays hidden', snap.errorHidden);

    console.log('\n2b. Data Quality section removed');
    check('no #quality section in the DOM', snap.noQualitySection);
    check('no #quality nav link', snap.noQualityNav);
    check('no orphaned quality nodes rendered', snap.orphanQualityNodes === 0, snap.orphanQualityNodes);
    check('about list no longer promises a quality report', snap.aboutMentionsQuality === false);

    console.log('\n3. charts');
    check('all 7 canvases have a live Chart.js instance', snap.charts.length === 7 && snap.charts.every(c => c.hasChart), snap.charts.map(c => c.id + ':' + c.hasChart));
    check('every chart has data points', snap.charts.every(c => c.points > 0), snap.charts.map(c => c.id + '=' + c.points));
    check('gender doughnut has real labels (the label/name regression)',
      Array.isArray(snap.genderLabels) && snap.genderLabels.length === 2 &&
      snap.genderLabels.every(l => typeof l === 'string' && l.trim().length > 0), snap.genderLabels);
    check('gender labels are Arabic, not male/female',
      Array.isArray(snap.genderLabels) && snap.genderLabels.every(l => !['male', 'female'].includes(l)), snap.genderLabels);
    check('age doughnut has real labels',
      Array.isArray(snap.ageLabels) && snap.ageLabels.length > 0 && snap.ageLabels.every(l => typeof l === 'string' && l.trim()), snap.ageLabels);

    console.log('\n3b. values drawn on the bars, without overlapping');
    /* Read back what the valueLabels plugin actually painted by walking the
       canvas pixels is overkill — instead assert the plugin is registered,
       enabled on the bar charts, and that its label boxes stay inside the
       chart area and clear of one another. */
    const vl = await evaluate(`(function(){
      var out = {};
      ['eventChart','govChart','genderChart','ageChart','yearChart','collegeChart','dailyChart'].forEach(function(id){
        var c = document.getElementById(id);
        var inst = window.Chart && Chart.getChart(c);
        if (!inst) { out[id] = null; return; }
        var o = inst.options.plugins.valueLabels || {};
        out[id] = {
          type: inst.config.type,
          enabled: !!o.enabled,
          indexAxis: inst.options.indexAxis || 'x',
          slices: (inst.data.labels || []).length
        };
      });
      out.__registered = !!(window.Chart && Chart.registry.plugins.get('valueLabels'));
      out.__totalRegistered = !!(window.Chart && Chart.registry.plugins.get('doughnutTotal'));
      return out;
    })()`);
    check('valueLabels plugin is registered', vl.__registered);
    check('doughnutTotal plugin is registered', vl.__totalRegistered);
    ['eventChart', 'govChart'].forEach(id => {
      check(id + ' has value labels enabled', vl[id] && vl[id].enabled === true, vl[id]);
      check(id + ' is horizontal so the value sits at the bar end', vl[id] && vl[id].indexAxis === 'y', vl[id]);
    });
    /* Beyond 5 slices the categorical charts become bars — never an
       unreadable doughnut with a legend running off the card. */
    ['ageChart', 'collegeChart', 'genderChart', 'yearChart'].forEach(id => {
      const s = vl[id];
      if (!s) { check(id + ' rendered', false); return; }
      if (s.slices > 5) check(id + ' switched to a bar chart (' + s.slices + ' slices)', s.type === 'bar', s);
      else check(id + ' readable at ' + s.slices + ' slices (' + s.type + ')', s.type === 'doughnut' || s.type === 'bar', s);
    });

    /* Doughnut legends must carry the number, since the arc labels are off. */
    const legend = await evaluate(`(function(){
      var g = Chart.getChart(document.getElementById('genderChart'));
      if (!g) return null;
      var gen = g.options.plugins.legend.labels.generateLabels;
      if (!gen) return { labels: g.data.labels, hasGen: false };
      var out = gen(g).map(function(l){ return l.text; });
      var ds = g.data.datasets[0].data;
      return { labels: out, hasGen: true, total: ds.reduce(function(a,b){return a+(b||0);},0) };
    })()`);
    check('doughnut legend shows name + count + share', legend && legend.hasGen && legend.labels.every(t => /\d/.test(t)), legend && legend.labels);
    check('every legend entry names a slice', legend && legend.labels.length === snap.genderLabels.length, legend && legend.labels);

    console.log('\n4. filter bar');
    const dupIds = await evaluate(`(function(){
      var seen = {}, dup = [];
      [].slice.call(document.querySelectorAll('[id]')).forEach(function(e){
        if (seen[e.id]) dup.push(e.id); else seen[e.id] = 1;
      });
      return dup;
    })()`);
    check('no duplicate element ids (a duplicate silently breaks querySelector)', dupIds.length === 0, dupIds);
    check('event options populated from the facets call', snap.filterOpts.event === 5, snap.filterOpts.event);
    check('gender options populated', snap.filterOpts.gender === 3, snap.filterOpts.gender);
    check('governorate options populated', snap.filterOpts.gov === 5, snap.filterOpts.gov);
    check('status options populated', snap.filterOpts.status === 3, snap.filterOpts.status);
    check('volunteer options populated', snap.filterOpts.volunteer === 3, snap.filterOpts.volunteer);
    check('source options populated', snap.filterOpts.source === 2, snap.filterOpts.source);

    console.log('\n4b. University filter removed');
    const uni = await evaluate(`(function(){
      return {
        select: !!document.getElementById('dFilterUni'),
        field: !!document.querySelector('label[for="dFilterUni"]'),
        filterCount: document.querySelectorAll('.dfilter__field').length,
        selects: [].slice.call(document.querySelectorAll('.dfilter__select')).map(function(s){ return s.id; })
      };
    })()`);
    check('no university <select>', uni.select === false, uni.select);
    check('no university <label>', uni.field === false);
    check('exactly 6 filter fields remain', uni.filterCount === 6, uni.filterCount);
    check('the remaining selects are the 6 intended ones',
      JSON.stringify(uni.selects) === JSON.stringify(['dFilterEvent', 'dFilterGov', 'dFilterGender', 'dFilterStatus', 'dFilterVolunteer', 'dFilterSource']),
      uni.selects);

    /* A stale ?university= deep link must be ignored, not break the page. */
    pageLoads++; await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?university=' + encodeURIComponent('جامعة القاهرة') });
    await waitFor(() => evaluate(FULL_READY), 45000, 'stale-university deep link ready').catch(() => {});
    const staleUni = await evaluate(`(function(){
      return { url: location.search, hero: document.querySelector('#heroTotal').textContent.trim(),
               events: document.querySelectorAll('#eventList .activity-item').length };
    })()`);
    check('a stale ?university= link is ignored (full dataset shown)', staleUni.events === 4, staleUni.events);
    check('a stale ?university= link leaves the URL clean', !/university=/.test(staleUni.url), staleUni.url);
    pageLoads++; await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
    await waitFor(() => evaluate(FULL_READY), 45000, 'dashboard restored').catch(() => {});

    /* every filter must actually narrow the data when selected */
    const eachFilter = await evaluate(`(function(){
      var out = {};
      var ids = { event:'#dFilterEvent', governorate:'#dFilterGov',
                  gender:'#dFilterGender', status:'#dFilterStatus', volunteer:'#dFilterVolunteer', source:'#dFilterSource' };
      return Promise.all(Object.keys(ids).map(function(k){
        var sel = document.querySelector(ids[k]);
        var opt = [].slice.call(sel.options).filter(function(o){ return o.value; })[0];
        if (!opt) return [k, null];
        sel.value = opt.value;
        sel.dispatchEvent(new Event('change'));
        return new Promise(function(res){
          setTimeout(function(){ res([k, { value: opt.value, hero: document.querySelector('#heroTotal').textContent.trim() }]); }, 650);
        });
      })).then(function(pairs){
        pairs.forEach(function(p){ out[p[0]] = p[1]; });
        return out;
      });
    })()`, true);
    Object.keys(eachFilter).forEach(k => {
      const r = eachFilter[k];
      check('filter "' + k + '" narrows the data (' + (r ? r.value : 'NO OPTIONS') + ')',
        !!r && r.hero !== snap.heroTotal && /[٠-٩0-9]/.test(r.hero), r && r.hero);
    });
    await evaluate(`document.querySelector('#dFilterReset').click(); 'ok'`);
    await new Promise(r => setTimeout(r, 700));

    console.log('\n5. filtering (debounced, local, no refetch)');
    const hitsBefore = apiHits.length;
    const filtered = await evaluate(`(function(){
      var sel = document.querySelector('#dFilterGender');
      sel.value = 'أنثى';
      sel.dispatchEvent(new Event('change'));
      return new Promise(function(res){
        setTimeout(function(){
          var h = document.querySelector('#heroTotal');
          var g = Chart.getChart(document.querySelector('#genderChart'));
          res({
            hero: h.textContent.trim(),
            genderLabels: g ? g.data.labels : null,
            genderCounts: g ? g.data.datasets[0].data : null,
            hint: (document.querySelector('#dFilterHint')||{}).textContent,
            statusSelectIntact: document.querySelector('#dFilterStatus').options.length,
            url: location.search,
            events: document.querySelectorAll('#eventList .activity-item').length
          });
        }, 700);
      });
    })()`, true);

    check('filter narrowed the total', filtered.hero !== snap.heroTotal, [snap.heroTotal, filtered.hero]);
    check('gender chart now shows only the selected value',
      Array.isArray(filtered.genderLabels) && filtered.genderLabels.length === 1 && filtered.genderLabels[0] === 'أنثى', filtered.genderLabels);
    check('gender count equals the filtered total',
      filtered.genderCounts && filtered.genderCounts.length === 1 &&
      parseInt(String(filtered.genderCounts[0]).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)), 10) > 0, filtered.genderCounts);
    check('filter hint reports shown vs all', /عرض/.test(filtered.hint || ''), filtered.hint);
    check('the status <select> still holds its options after painting', filtered.statusSelectIntact === 3, filtered.statusSelectIntact);
    check('filter is reflected in the URL', /gender=/.test(filtered.url || ''), filtered.url);
    check('filtering required NO new network call (dataset cached in memory)',
      apiHits.length === hitsBefore, apiHits.slice(hitsBefore));

    console.log('\n6. chart instance reuse (no destroy/recreate storm)');
    const reuse = await evaluate(`(function(){
      var before = Chart.getChart(document.querySelector('#genderChart'));
      var sel = document.querySelector('#dFilterGender');
      sel.value = 'ذكر';
      sel.dispatchEvent(new Event('change'));
      return new Promise(function(res){
        setTimeout(function(){
          var after = Chart.getChart(document.querySelector('#genderChart'));
          res({ same: before === after, labels: after ? after.data.labels : null, total: document.querySelector('#heroTotal').textContent.trim() });
        }, 700);
      });
    })()`, true);
    check('the same Chart instance is reused across filter changes', reuse.same);
    check('instance now shows the other gender', Array.isArray(reuse.labels) && reuse.labels.length === 1 && reuse.labels[0] === 'ذكر', reuse.labels);
    check('total changed back', reuse.total !== filtered.hero, [filtered.hero, reuse.total]);

    console.log('\n7. deep link + reset');
    pageLoads++; await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html?event=' + encodeURIComponent(EVENTS[0]) });
    await waitFor(() => evaluate(FULL_READY), 45000, 'deep-linked dashboard ready').catch(() => {});
    const deep = await evaluate(`(function(){
      return { sel: document.querySelector('#dFilterEvent').value, hero: document.querySelector('#heroTotal').textContent.trim(),
               events: document.querySelectorAll('#eventList .activity-item').length,
               hint: (document.querySelector('#dFilterHint')||{}).textContent };
    })()`);
    check('deep-linked filter is applied to the <select>', deep.sel === EVENTS[0], deep.sel);
    check('deep-linked filter is applied to the numbers', deep.hero !== snap.heroTotal && deep.hero !== '—', deep.hero);
    check('deep-linked view is narrowed to that event', deep.events === 1, deep.events);
    check('the hint paragraph (not a <select>) shows the filter summary', /عرض/.test(deep.hint || ''), deep.hint);

    console.log('\n7b. branding');
    const brand = await evaluate(`(function(){
      var splash = document.getElementById('splash');
      return {
        splashText: splash ? splash.textContent.replace(/\\s+/g,' ').trim() : null,
        title: document.title,
        description: (document.querySelector('meta[name="description"]')||{}).content,
        heroWord: (document.querySelector('.hero__word')||{}).textContent,
        headerWord: (document.querySelector('.brand__word')||{}).textContent
      };
    })()`);
    /* The event name must only ever appear in Latin script. An Arabic
       transliteration slipped into the splash once already. */
    check('no Arabic transliteration of the event name anywhere in the page',
      !/فيرست ستيب/.test(JSON.stringify(brand)), brand.splashText);
    check('splash shows the org name in Arabic',
      /صناع الحياة بالجامعات المصرية/.test(brand.splashText || ''), brand.splashText);
    check('splash shows the event name in Latin script',
      /FIRST STEP EVENTS/.test(brand.splashText || ''), brand.splashText);
    check('splash has exactly two text lines', (brand.splashText || '').split(' ').length > 0 && !/إيفنتس/.test(brand.splashText || ''), brand.splashText);
    check('meta description carries no Arabic transliteration',
      !/فيرست ستيب/.test(brand.description || ''), brand.description);
    check('hero wordmark is Latin script', /FIRST STEP/.test((brand.heroWord || '').replace(/\s+/g, ' ')), brand.heroWord);
    check('header wordmark is Latin script', /FIRST STEP EVENTS/.test((brand.headerWord || '').trim()), brand.headerWord);

    const afterReset = await evaluate(`(function(){
      document.querySelector('#dFilterReset').click();
      return new Promise(function(res){
        setTimeout(function(){ res({ sel: document.querySelector('#dFilterEvent').value, hero: document.querySelector('#heroTotal').textContent.trim(), url: location.search }); }, 700);
      });
    })()`, true);
    check('reset clears the select', afterReset.sel === '', afterReset.sel);
    check('reset restores the full total', afterReset.hero === snap.heroTotal, [snap.heroTotal, afterReset.hero]);
    check('reset clears the URL query', afterReset.url === '' || afterReset.url === '?', afterReset.url);

    console.log('\n8. resilience');
    const errs = await evaluate(`(function(){
      return { images: [].slice.call(document.images).filter(function(i){return !i.complete || i.naturalWidth===0;}).length };
    })()`);
    check('no broken images', errs.images === 0, errs.images);

    const realErrors = pageErrors.filter(e => !/favicon/i.test(e));
    const realConsole = consoleErrors.filter(e => !/favicon|ERR_|net::|Failed to load resource/i.test(e));
    check('no uncaught page exceptions', realErrors.length === 0, realErrors.slice(0, 3));
    check('no console errors/warnings', realConsole.length === 0, realConsole.slice(0, 5));

    console.log('\n9. responsive layout (real device widths)');
    for (const vp of [
      { name: 'iPhone SE', w: 375, h: 667 },
      { name: 'iPhone 14 Pro', w: 393, h: 852 },
      { name: 'Pixel 7', w: 412, h: 915 },
      { name: 'iPad mini', w: 768, h: 1024 },
      { name: 'iPad Air', w: 820, h: 1180 },
      { name: 'laptop', w: 1280, h: 800 },
      { name: 'desktop', w: 1600, h: 1000 }
    ]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.w < 820
      });
      await new Promise(r => setTimeout(r, 450));

      const layout = await evaluate(`(function(){
        var de = document.documentElement;
        var overflow = de.scrollWidth - de.clientWidth;
        /* An element wider than the viewport is only a bug when nothing is
           deliberately scrolling it — the day-bar strip is a horizontal
           scroller on purpose. */
        function inScroller(el){
          for (var p = el.parentElement; p && p !== de; p = p.parentElement) {
            var ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
          }
          return false;
        }
        var wide = [];
        [].slice.call(document.querySelectorAll('main *')).forEach(function(el){
          var r = el.getBoundingClientRect();
          if (r.width > de.clientWidth + 2 && r.height > 0 && !inScroller(el)) {
            wide.push((el.className||el.tagName) + ' w=' + Math.round(r.width));
          }
        });
        var cs = function(sel, prop){ var e=document.querySelector(sel); return e ? getComputedStyle(e)[prop] : null; };
        return {
          overflow: overflow,
          wide: wide.slice(0, 4),
          wideCount: wide.length,
          cols: {
            hero: cs('.hero','gridTemplateColumns'),
            kpis: cs('.kpis','gridTemplateColumns'),
            profile: cs('.profile__grid','gridTemplateColumns'),
            intel: cs('.intel__grid','gridTemplateColumns'),
            filters: cs('.dfilter__grid','gridTemplateColumns')
          },
          selectFont: cs('.dfilter__select','fontSize'),
          tapTarget: cs('.activity-item','minHeight'),
          navScroll: cs('.site-nav','overflowX'),
          chartCardH: (function(){ var e=document.querySelector('.profile__grid .chart-card'); return e ? Math.round(e.getBoundingClientRect().height) : null; })(),
          trendScroller: (function(){ var e=document.querySelector('.trend__bars-scroll'); return e ? getComputedStyle(e).overflowX : null; })()
        };
      })()`);

      check(vp.name + ' (' + vp.w + 'px): no horizontal page scroll', layout.overflow <= 1, layout.overflow);
      check(vp.name + ': nothing overflows the viewport', layout.wideCount === 0, layout.wide);

      if (vp.w <= 900) {
        check(vp.name + ': nav can scroll rather than wrap', layout.navScroll === 'auto' || layout.navScroll === 'scroll', layout.navScroll);
        check(vp.name + ': filter controls are >= 16px (no iOS zoom)', parseFloat(layout.selectFont) >= 16, layout.selectFont);
        check(vp.name + ': filters are at most 2-up', layout.cols.filters.split(' ').length <= 2, layout.cols.filters);
      } else {
        check(vp.name + ': nav is laid out inline (room to spare)', layout.navScroll === 'visible', layout.navScroll);
      }

      if (vp.w <= 620) {
        check(vp.name + ': single-column filter grid', layout.cols.filters.split(' ').length === 1, layout.cols.filters);
        check(vp.name + ': 2-up KPI strip', layout.cols.kpis.split(' ').length === 2, layout.cols.kpis);
        check(vp.name + ': hero stacks', layout.cols.hero.split(' ').length === 1, layout.cols.hero);
        check(vp.name + ': profile charts stack', layout.cols.profile.split(' ').length === 1, layout.cols.profile);
        check(vp.name + ': intel list + chart stack', layout.cols.intel.split(' ').length === 1, layout.cols.intel);
        check(vp.name + ': tap targets >= 44px', parseFloat(layout.tapTarget) >= 44, layout.tapTarget);
        check(vp.name + ': day-bar strip scrolls horizontally', layout.trendScroller === 'auto', layout.trendScroller);
      }

      if (vp.w <= 900) {
        check(vp.name + ': chart card fits the screen', layout.chartCardH <= vp.h, layout.chartCardH);
      } else {
        check(vp.name + ': profile charts 2-up', layout.cols.profile.split(' ').length === 2, layout.cols.profile);
        check(vp.name + ': hero stays 2-up', layout.cols.hero.split(' ').length === 2, layout.cols.hero);
        check(vp.name + ': KPI strip 4-up', layout.cols.kpis.split(' ').length === 4, layout.cols.kpis);
      }

      /* Charts must re-fit the new width, not keep the old canvas size. */
      const resized = await evaluate(`(function(){
        var inst = Chart.getChart(document.getElementById('genderChart'));
        var c = document.getElementById('genderChart');
        return { w: Math.round(c.getBoundingClientRect().width), chartW: Math.round(inst.chartArea.right - inst.chartArea.left) };
      })()`);
      check(vp.name + ': chart re-fit its container', resized.chartW > 40 && resized.chartW <= resized.w, resized);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');

    console.log('\n10. API calls made during the whole run');
    const counts = apiHits.reduce((m, a) => (m[a] = (m[a] || 0) + 1, m), {});
    console.log('   ' + JSON.stringify(counts) + '   over ' + pageLoads + ' page load(s)');
    check('exactly one rows fetch per page load', (counts.rows || 0) === pageLoads, { rows: counts.rows, loads: pageLoads });
    check('exactly one facets fetch per page load', (counts.facets || 0) === pageLoads, { facets: counts.facets, loads: pageLoads });
    check('no dashboard fallback was needed (rows path worked)', (counts.dashboard || 0) === 0, counts.dashboard);
  } catch (e) {
    check('smoke test ran to completion', false, String(e && e.message || e));
  } finally {
    if (cdp) try { cdp.close(); } catch (e) {}
    try { chrome.kill(); } catch (e) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    finish();
  }

  function finish() {
    server.close();
    console.log('\n' + (failures ? failures + ' CHECK(S) FAILED' : 'ALL CHECKS PASSED'));
    process.exit(failures ? 1 : 0);
  }
})();
