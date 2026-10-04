/**
 * ============================================================
   FIRST STEP EVENTS — Registration Intelligence
   js/dashboard.js — Main Controller
   ============================================================
 */

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    if (API_CONFIG.DEMO_MODE) initDemoData();

    var FILTER_LABELS = {
      event: 'كل الإيفنتات',
      governorate: 'كل المحافظات',
      university: 'كل الجامعات',
      gender: 'كل الأنواع',
      status: 'كل الحالات',
      volunteer: 'كل الحالات',
      source: 'كل المصادر'
    };

    var CACHE_PREFIX = 'fse_dash_v1:';
    var MAX_CACHED_VIEWS = 8;
    var FRESH_MS = 60000;

    var DATASET_KEY = 'fse_dash_rows_v1';
    var DATASET_TTL_MS = 10 * 60 * 1000;

    var DATASET_FETCH_OPTS = {
      timeoutMs: API_CONFIG.DATASET_FETCH_TIMEOUT_MS,
      allowJsonp: false,
      retries: 1
    };

    var els = {
      error: Util.qs('#errorState'),
      retry: Util.qs('#retryBtn'),
      heroTotal: Util.qs('#heroTotal'),
      heroUpdated: Util.qs('#heroUpdated'),
      pulseDelta: Util.qs('#pulseDelta'),
      pulseMeta: Util.qs('#pulseMeta'),
      pulseTrend: Util.qs('#pulseTrend'),
      kpiTotal: Util.qs('#kpiTotal'),
      kpiEvents: Util.qs('#kpiEvents'),
      kpiGovernorates: Util.qs('#kpiGovernorates'),
      kpiDays: Util.qs('#kpiDays'),
      eventList: Util.qs('#eventList'),
      govList: Util.qs('#govList'),
      trendAverage: Util.qs('#trendAverage'),
      trendPeak: Util.qs('#trendPeak'),
      trendBars: Util.qs('#trendBars'),
      footUpdated: Util.qs('#footUpdated'),
      qualityScore: Util.qs('#qualityScore'),
      qualityBar: Util.qs('#qualityBar'),
      issueList: Util.qs('#issueList'),

      filterEvent: Util.qs('#dFilterEvent'),
      filterGov: Util.qs('#dFilterGov'),
      filterUni: Util.qs('#dFilterUni'),
      filterGender: Util.qs('#dFilterGender'),
      filterStatus: Util.qs('#dFilterStatus'),
      filterVolunteer: Util.qs('#dFilterVolunteer'),
      filterSource: Util.qs('#dFilterSource'),
      filterReset: Util.qs('#dFilterReset'),
      filterStatus: Util.qs('#dFilterStatus'),
      filterBusy: Util.qs('#dFilterBusy')
    };

    var FILTER_FIELDS = [
      { el: els.filterEvent, key: 'event', options: 'events' },
      { el: els.filterGov, key: 'governorate', options: 'governorates' },
      { el: els.filterUni, key: 'university', options: 'universities' },
      { el: els.filterGender, key: 'gender', options: 'genders' },
      { el: els.filterStatus, key: 'status', options: 'statuses' },
      { el: els.filterVolunteer, key: 'volunteer', options: 'volunteers' },
      { el: els.filterSource, key: 'source', options: 'sources' }
    ];

    var state = {
      payload: null,
      filters: readFiltersFromUrl(),
      optionsReady: false,
      generation: 0,
      inFlight: {},
      dataset: null
    };

    var bootPrefetch = hasActiveFilters()
      ? null
      : API.prefetch('rows', null, DATASET_FETCH_OPTS);

    function readFiltersFromUrl() {
      var params = new URLSearchParams(window.location.search);
      var out = {};
      FILTER_FIELDS.forEach(function (f) {
        out[f.key] = params.get(f.key) || '';
      });
      return out;
    }

    function syncUrl() {
      var params = new URLSearchParams();
      FILTER_FIELDS.forEach(function (f) {
        var v = state.filters[f.key];
        if (v) params.set(f.key, v);
      });
      var qs = params.toString();
      var url = window.location.pathname + (qs ? '?' + qs : '');
      window.history.replaceState(null, '', url);
    }

    function hasActiveFilters() {
      return FILTER_FIELDS.some(function (f) { return !!state.filters[f.key]; });
    }

    function ensureFilterOptions(payload) {
      if (state.optionsReady) return false;

      var options = (payload && payload.options) || {};
      if (!Object.keys(options).length) return false;

      var changed = false;

      FILTER_FIELDS.forEach(function (f) {
        if (!f.el) return;
        var values = options[f.options] || [];

        f.el.innerHTML = '';
        f.el.appendChild(buildOption(f.key, ''));
        values.forEach(function (v) {
          f.el.appendChild(buildOption(f.key, v));
        });

        var current = state.filters[f.key];
        if (current && values.indexOf(current) === -1) {
          state.filters[f.key] = '';
          changed = true;
        }
        f.el.value = state.filters[f.key] || '';
      });

      state.optionsReady = true;
      if (changed) syncUrl();
      return changed;
    }

    function buildOption(key, value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value || FILTER_LABELS[key];
      return opt;
    }

    function renderFilterStatus(payload) {
      if (!els.filterStatus) return;

      els.filterStatus.classList.remove('is-stale');

      if (!hasActiveFilters()) {
        els.filterStatus.textContent = '';
        els.filterStatus.classList.remove('is-active');
        return;
      }

      var summary = (payload && payload.summary) || {};
      var shown = summary.totalRegistrations || 0;
      var all = summary.totalUnfiltered || shown;
      var labels = FILTER_FIELDS
        .filter(function (f) { return !!state.filters[f.key]; })
        .map(function (f) { return state.filters[f.key]; })
        .join(' · ');

      els.filterStatus.classList.add('is-active');
      els.filterStatus.textContent = 'عرض ' + Util.fmtNumber(shown) + ' من ' + Util.fmtNumber(all) + ' تسجيل · ' + labels
        + (state.dataset ? '' : ' · تحميل كل فلتر من السيرفر');
    }

    function staggerReveal() {
      Util.qsa('.reveal').forEach(function (el, i) {
        el.style.setProperty('--rd', (i * 90) + 'ms');
      });
    }

    function showError() {
      Util.qsa('.reveal').forEach(function (el) { el.classList.add('is-error'); });
      els.error.hidden = false;
    }

    function hideError() {
      els.error.hidden = true;
      Util.qsa('.reveal').forEach(function (el) { el.classList.remove('is-error'); });
    }

    function showStaleNotice() {
      if (!els.filterStatus) return;
      els.filterStatus.classList.add('is-stale');
      els.filterStatus.textContent = 'تعذّر التحديث — الأرقام المعروضة محفوظة من آخر تحميل ناجح';
    }

    function viewKey(filters) {
      return FILTER_FIELDS.map(function (f) { return filters[f.key] || ''; }).join('\u0001');
    }

    function readView(key) {
      try {
        var raw = window.localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        var rec = JSON.parse(raw);
        if (!rec || !rec.payload || rec.payload.success !== true) return null;
        return rec;
      } catch (e) {
        return null;
      }
    }

    function isFresh(rec) {
      return !!rec && typeof rec.at === 'number' && (Date.now() - rec.at) < FRESH_MS;
    }

    function writeView(key, payload) {
      try {
        window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
          at: Date.now(),
          payload: payload
        }));
      } catch (e) { /* ignore */ }
      pruneViews(key);
    }

    function pruneViews(keepKey) {
      try {
        var entries = [];
        for (var i = 0; i < window.localStorage.length; i++) {
          var k = window.localStorage.key(i);
          if (!k || k.indexOf(CACHE_PREFIX) !== 0) continue;
          var raw = window.localStorage.getItem(k);
          var at = 0;
          try { at = (JSON.parse(raw) || {}).at || 0; } catch (e) { at = 0; }
          entries.push({ k: k, at: at });
        }
        entries.sort(function (a, b) { return b.at - a.at; });
        for (var j = MAX_CACHED_VIEWS; j < entries.length; j++) {
          if (entries[j].k === CACHE_PREFIX + keepKey) continue;
          window.localStorage.removeItem(entries[j].k);
        }
      } catch (e) { /* ignore */ }
    }

    function setBusy(on) {
      if (els.filterBusy) els.filterBusy.hidden = !on;
    }

    function loadDataset(prefetched) {
      if (state.datasetPromise) return state.datasetPromise;

      var stored = readDatasetCache();
      if (stored) {
        state.dataset = stored;
        state.datasetPromise = Promise.resolve(stored);
        return state.datasetPromise;
      }

      var pending = prefetched || API.get('rows', null, DATASET_FETCH_OPTS);
      state.datasetPromise = pending.then(function (payload) {
        if (API.isError(payload)) throw new Error(payload.error || 'API error');
        if (!payload || !payload.rows || !payload.rows.length) {
          throw new Error('empty row projection');
        }
        state.dataset = payload;
        datasetRetries = 0;
        writeDatasetCache(payload);
        return payload;
      }).catch(function (err) {
        state.datasetPromise = null;
        scheduleDatasetRetry();
        throw err;
      });

      return state.datasetPromise;
    }

    var datasetRetries = 0;
    var datasetRetryTimer = null;

    function scheduleDatasetRetry() {
      if (datasetRetryTimer || state.dataset) return;
      if (datasetRetries >= 3) return;

      datasetRetries++;
      var wait = Math.min(5000 * datasetRetries, 20000);
      datasetRetryTimer = setTimeout(function () {
        datasetRetryTimer = null;
        if (state.dataset) return;

        loadDataset().then(function () {
          applyLocalView(false);
          renderFilterStatus(state.payload);
        }).catch(function () {});
      }, wait);
    }

    function readDatasetCache() {
      try {
        var raw = window.localStorage.getItem(DATASET_KEY);
        if (!raw) return null;
        var rec = JSON.parse(raw);
        if (!rec || !rec.payload || !rec.payload.rows || !rec.payload.rows.length) return null;
        if (typeof rec.at !== 'number' || (Date.now() - rec.at) > DATASET_TTL_MS) return null;
        return rec.payload;
      } catch (e) {
        return null;
      }
    }

    function writeDatasetCache(payload) {
      try {
        window.localStorage.setItem(DATASET_KEY, JSON.stringify({
          at: Date.now(),
          payload: payload
        }));
      } catch (e) { /* quota or private mode — the cache is optional */ }
    }

    function payloadFor(filters) {
      return FilterEngine.buildPayload(state.dataset, filters || state.filters);
    }

    function applyLocalView(initial) {
      var payload = payloadFor(state.filters);

      Charts.setAnimation(!!initial);
      state.payload = payload;
      render(payload);
      Charts.setAnimation(true);

      document.body.classList.add('ready');
      hideError();
      painted();
      return payload;
    }

    function requestView(initial, prefetched) {
      var key = viewKey(state.filters);

      if (state.inFlight[key]) return;
      state.inFlight[key] = true;

      var gen = ++state.generation;
      setBusy(true);
      Charts.setAnimation(!!initial);

      var pending = prefetched || API.get('dashboard', state.filters);

      pending.then(function (payload) {
        delete state.inFlight[key];
        if (gen !== state.generation) return;
        if (API.isError(payload)) throw new Error(payload.error || 'API error');

        state.payload = payload;
        writeView(key, payload);
        render(payload);
        document.body.classList.add('ready');
        hideError();
        painted();
      }).catch(function () {
        delete state.inFlight[key];
        if (gen !== state.generation) return;

        var stale = readView(key);
        if (stale) {
          state.payload = stale.payload;
          render(stale.payload);
          document.body.classList.add('ready');
          showStaleNotice();
        } else {
          showError();
        }
        painted();
      }).then(function () {
        if (gen !== state.generation) return;
        setBusy(false);
        Charts.setAnimation(true);
      });
    }

    function painted() {
      if (Util && typeof Util.markDataReady === 'function') Util.markDataReady();
    }

    function load() {
      hideError();

      var key = viewKey(state.filters);
      var cached = readView(key);

      if (cached && isFresh(cached)) {
        Charts.setAnimation(false);
        state.payload = cached.payload;
        render(cached.payload);
        document.body.classList.add('ready');
        painted();
        if (!state.dataset) loadDataset().catch(function () {});
        renderFilterStatus(cached.payload);
        return;
      }

      if (cached) {
        Charts.setAnimation(false);
        state.payload = cached.payload;
        render(cached.payload);
        document.body.classList.add('ready');
        painted();
      } else {
        document.body.classList.remove('ready');
      }

      var prefetched = bootPrefetch;
      bootPrefetch = null;

      loadDataset(prefetched).then(function () {
        var payload = applyLocalView(!cached);
        writeView(viewKey(state.filters), payload);
        renderFilterStatus(payload);
      }).catch(function () {
        requestView(!cached, null);
      });
    }

    function applyFilter(key, value) {
      state.filters[key] = value || '';
      syncUrl();

      if (state.dataset) {
        var payload = applyLocalView(false);
        writeView(viewKey(state.filters), payload);
        renderFilterStatus(payload);
        return;
      }

      var cached = readView(viewKey(state.filters));
      if (cached) {
        Charts.setAnimation(false);
        state.payload = cached.payload;
        render(cached.payload);
        document.body.classList.add('ready');
        hideError();
        if (isFresh(cached)) {
          Charts.setAnimation(true);
          renderFilterStatus(cached.payload);
          loadDataset().catch(function () {});
          return;
        }
      }

      loadDataset().then(function () {
        var local = applyLocalView(false);
        writeView(viewKey(state.filters), local);
        renderFilterStatus(local);
      }).catch(function () {
        requestView(false);
      });
    }

    function render(payload) {
      var summary = payload.summary || {};
      var total = summary.totalRegistrations || 0;

      if (ensureFilterOptions(payload)) {
        state.filters = readFiltersFromUrl();
        FILTER_FIELDS.forEach(function (f) { if (f.el) f.el.value = ''; });
        syncUrl();
        requestView(false);
        return;
      }

      renderFilterStatus(payload);

      // HERO
      els.heroTotal.textContent = Util.fmtNumber(total);
      els.heroUpdated.textContent = Util.formatSubmission(summary.lastSubmissionAt || payload.generatedAt);

      // PULSE + TREND
      var daily = payload.daily || [];
      renderPulse(daily);
      renderTrend(daily);
      Charts.daily('#dailyChart', daily);

      // KPI STRIP
      els.kpiTotal.textContent = Util.fmtNumber(total);
      els.kpiEvents.textContent = Util.fmtNumber(summary.uniqueEvents || 0);
      els.kpiGovernorates.textContent = Util.fmtNumber(summary.governorates || 0);
      els.kpiDays.textContent = Util.fmtNumber(summary.activeDays || 0);

      // EVENT INTELLIGENCE
      renderEvents(payload.events || [], total);
      Charts.activity('#eventChart', payload.events || [], total);

      // GEOGRAPHIC
      renderGovernorates(payload.governorates || [], total);
      Charts.governorates('#govChart', payload.governorates || [], total);

      // PROFILE
      Charts.gender('#genderChart', payload.genders || [], total);
      Charts.age('#ageChart', payload.ages || [], total);
      Charts.year('#yearChart', payload.years || [], total);
      Charts.college('#collegeChart', payload.colleges || [], total);

      // QUALITY
      renderQuality(payload.quality || {});

      // FOOT
      els.footUpdated.textContent = Util.formatSubmission(summary.lastSubmissionAt || payload.generatedAt);
    }

    function renderPulse(daily) {
      var last = daily[daily.length - 1];
      var prev = daily[daily.length - 2];
      if (!last) {
        els.pulseDelta.textContent = '—';
        els.pulseMeta.textContent = 'لا توجد بيانات يومية بعد';
        return;
      }

      els.pulseDelta.textContent = Util.fmtNumber(last.count);
      els.pulseMeta.textContent = 'تسجيل في ' + Util.formatDateLabel(last.date);

      if (prev && prev.count !== undefined) {
        var diff = last.count - prev.count;
        var trend = els.pulseTrend;
        if (trend) {
          trend.textContent = (diff >= 0 ? '▲ +' : '▼ ') + diff;
          trend.className = 'pulse__trend ' + (diff >= 0 ? 'is-up' : 'is-down');
        }
      }
    }

    function renderTrend(daily) {
      if (!daily.length) {
        els.trendAverage.textContent = '—';
        els.trendPeak.textContent = '—';
        return;
      }

      var sum = 0;
      var peak = daily[0];
      daily.forEach(function (d) {
        sum += d.count;
        if (d.count > peak.count) peak = d;
      });

      els.trendAverage.textContent = Math.round(sum / daily.length);
      els.trendPeak.textContent = peak.count;
      els.trendPeak.setAttribute('data-hint', Util.formatDateLabel(peak.date));
      els.trendPeak.title = Util.formatDateLabel(peak.date);

      var max = Math.max.apply(null, daily.map(function (d) { return d.count; })) || 1;
      els.trendBars.innerHTML = '';

      daily.forEach(function (d, i) {
        var col = Util.createEl('div', 'tbar' + (d.count === max && max > 0 ? ' tbar--peak' : ''));
        col.style.setProperty('--h', Math.max(8, Math.round((d.count / max) * 100)) + '%');

        var num = Util.createEl('span', 'tbar__num', Util.fmtNumber(d.count));
        num.setAttribute('aria-hidden', 'true');

        var bar = Util.createEl('span', 'tbar__bar');
        var label = Util.createEl('span', 'tbar__label', Util.formatDateLabel(d.date));

        col.appendChild(num);
        col.appendChild(bar);
        col.appendChild(label);
        col.setAttribute('aria-label', Util.fmtNumber(d.count) + ' تسجيل في ' + Util.formatDateLabel(d.date));
        els.trendBars.appendChild(col);
      });
    }

    function renderEvents(events, total) {
      els.eventList.innerHTML = '';

      if (!events.length) {
        var empty = Util.createEl('li', 'empty-note', 'لا توجد بيانات عن الإيفنتات بعد.');
        els.eventList.appendChild(empty);
        return;
      }

      events.forEach(function (ev, i) {
        var li = Util.createEl('li', 'activity-item');
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', 'عرض تسجيلات: ' + ev.name);
        li.style.setProperty('--w', Math.min(100, ev.percentage || 0) + '%');

        var index = Util.createEl('span', 'activity-item__index', String(i + 1).padStart(2, '0'));
        var body = Util.createEl('div', 'activity-item__body');
        var name = Util.createEl('h3', 'activity-item__name', ev.name);
        var meta = Util.createEl('p', 'activity-item__meta', ev.digest || '');

        body.appendChild(name);
        body.appendChild(meta);

        var count = Util.createEl('div', 'activity-item__count');
        var num = Util.createEl('span', 'activity-item__num', Util.fmtNumber(ev.count));
        var pct = Util.createEl('span', 'activity-item__pct', Util.pct(ev.count, total));
        count.appendChild(num);
        count.appendChild(pct);

        li.appendChild(index);
        li.appendChild(body);
        li.appendChild(count);

        li.addEventListener('click', function () { openEvent(ev.name); });
        li.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvent(ev.name); }
        });

        els.eventList.appendChild(li);
      });
    }

    function renderGovernorates(governorates, total) {
      els.govList.innerHTML = '';

      if (!governorates.length) {
        var empty = Util.createEl('li', 'empty-note', 'لا توجد بيانات عن المحافظات بعد.');
        els.govList.appendChild(empty);
        return;
      }

      governorates.forEach(function (g, i) {
        var li = Util.createEl('li', 'rank-item');
        li.style.setProperty('--w', Math.min(100, g.percentage || 0) + '%');

        var idx = Util.createEl('span', 'rank-item__index', String(i + 1).padStart(2, '0'));
        var name = Util.createEl('span', 'rank-item__name', g.name);
        var bar = Util.createEl('span', 'rank-item__bar');
        var count = Util.createEl('span', 'rank-item__count', Util.fmtNumber(g.count) + ' · ' + Util.pct(g.count, total));

        name.appendChild(bar);
        li.appendChild(idx);
        li.appendChild(name);
        li.appendChild(count);

        els.govList.appendChild(li);
      });
    }

    function renderQuality(quality) {
      var score = quality.score || 0;
      els.qualityScore.textContent = Math.round(score);
      if (els.qualityBar) {
        els.qualityBar.style.setProperty('--w', score + '%');
        els.qualityBar.setAttribute('aria-valuenow', score);
      }

      var issues = quality.issues || [];
      els.issueList.innerHTML = '';

      if (!issues.length) {
        var empty = Util.createEl('li', 'empty-note', 'لا توجد مشاكل في البيانات — جودة ممتازة');
        els.issueList.appendChild(empty);
        return;
      }

      issues.forEach(function (i) {
        var li = Util.createEl('li', 'issue-item');
        var name = Util.createEl('span', 'issue-item__name', i.label);
        var count = Util.createEl('span', 'issue-item__count', Util.fmtNumber(i.count));
        var pct = Util.createEl('span', 'issue-item__pct', Util.pct(i.count, quality.total || 1));
        li.appendChild(name);
        li.appendChild(count);
        li.appendChild(pct);
        els.issueList.appendChild(li);
      });
    }

    function openEvent(eventName) {
      var params = new URLSearchParams();
      FILTER_FIELDS.forEach(function (f) {
        if (state.filters[f.key]) params.set(f.key, state.filters[f.key]);
      });
      params.set('event', eventName);
      window.location.href = 'event.html?' + params.toString();
    }

    FILTER_FIELDS.forEach(function (f) {
      if (!f.el) return;
      f.el.value = state.filters[f.key] || '';
      f.el.addEventListener('change', function () {
        applyFilter(f.key, f.el.value);
      });
    });

    if (els.filterReset) {
      els.filterReset.addEventListener('click', function () {
        if (!hasActiveFilters()) return;
        FILTER_FIELDS.forEach(function (f) {
          state.filters[f.key] = '';
          if (f.el) f.el.value = '';
        });
        syncUrl();
        var cached = readView(viewKey(state.filters));
        if (cached) {
          Charts.setAnimation(false);
          state.payload = cached.payload;
          render(cached.payload);
          document.body.classList.add('ready');
          hideError();
        }
        requestView(false);
      });
    }

    els.retry.addEventListener('click', load);

    staggerReveal();

    Util.qsa('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href').slice(1);
        var target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

    load();
  });
})();