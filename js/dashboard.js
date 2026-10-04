/**
 * ============================================================
    FIRST STEP EVENTS — Registration Intelligence
    js/dashboard.js — Main Controller
   ------------------------------------------------------------
    v2 changes:
      • Boot issues two requests in PARALLEL: `facets` (small, answers from the
        Apps Script cache) paints the filter bar immediately, while `rows`
        (large, may hit a cold start) streams in behind it. The dashboard
        becomes interactive long before the dataset lands.
      • Filter changes are debounced and rendered from an in-memory payload
        memo, so no request and no recompute happens for a filter state that
        was already visited.
      • Stale-while-revalidate: a cached view paints instantly and refreshes
        in the background instead of blocking on the network.
      • List rendering uses DocumentFragment + one innerHTML write.
      • Per-phase timings are logged under the "FSE perf" console group.
   ============================================================
 */

(function () {
  'use strict';

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    var T0 = performance.now();
    var marks = [];
    function mark(label) {
      marks.push(label + ' @ ' + Math.round(performance.now() - T0) + 'ms');
    }

    var FILTER_LABELS = {
      event: 'كل الإيفنتات',
      governorate: 'كل المحافظات',
      university: 'كل الجامعات',
      gender: 'كل الأنواع',
      status: 'كل الحالات',
      volunteer: 'كل الحالات',
      source: 'كل المصادر'
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

      filterEvent: Util.qs('#dFilterEvent'),
      filterGov: Util.qs('#dFilterGov'),
      filterGender: Util.qs('#dFilterGender'),
      filterStatus: Util.qs('#dFilterStatus'),
      filterVolunteer: Util.qs('#dFilterVolunteer'),
      filterSource: Util.qs('#dFilterSource'),
      filterReset: Util.qs('#dFilterReset'),
      filterHint: Util.qs('#dFilterHint'),
      filterBusy: Util.qs('#dFilterBusy')
    };

    /* Drives the URL sync, the facet wiring and the debounced change handler.
       Drop a key here and its <select> disappears from every path at once. */
    var FILTER_FIELDS = [
      { el: els.filterEvent, key: 'event', options: 'events' },
      { el: els.filterGov, key: 'governorate', options: 'governorates' },
      { el: els.filterGender, key: 'gender', options: 'genders' },
      { el: els.filterStatus, key: 'status', options: 'statuses' },
      { el: els.filterVolunteer, key: 'volunteer', options: 'volunteers' },
      { el: els.filterSource, key: 'source', options: 'sources' }
    ];

    var state = {
      filters: readFiltersFromUrl(),
      options: null,
      optionsReady: false,
      datasetReady: false,
      payload: null,
      serverFallback: false
    };

    /* payload memo: filter key -> payload. Avoids recomputing a view twice. */
    var memo = new Map();

    /* ------------------------------------------------------------------
       Filters <-> URL
       ------------------------------------------------------------------ */

    function readFiltersFromUrl() {
      var params = new URLSearchParams(window.location.search);
      var out = {};
      FILTER_FIELDS.forEach(function (f) { out[f.key] = params.get(f.key) || ''; });
      return out;
    }

    function syncUrl() {
      var params = new URLSearchParams();
      FILTER_FIELDS.forEach(function (f) {
        if (state.filters[f.key]) params.set(f.key, state.filters[f.key]);
      });
      var qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : ''));
    }

    function hasActiveFilters() {
      return FILTER_FIELDS.some(function (f) { return !!state.filters[f.key]; });
    }

    function currentKey() {
      return API.viewKey(state.filters);
    }

    /* ------------------------------------------------------------------
       Filter options
       ------------------------------------------------------------------ */

    function applyOptions(options) {
      if (!options || !Object.keys(options).length) return false;

      state.options = options;

      var changed = false;

      FILTER_FIELDS.forEach(function (f) {
        if (!f.el) return;
        var values = options[f.options] || [];

        var group = document.createDocumentFragment();
        group.appendChild(buildOption(f.key, ''));
        values.forEach(function (v) { group.appendChild(buildOption(f.key, v)); });

        f.el.textContent = '';
        f.el.appendChild(group);

        /* If the deep-linked value no longer exists, drop it silently. */
        var current = state.filters[f.key];
        if (current && values.indexOf(current) === -1) {
          state.filters[f.key] = '';
          changed = true;
        }
        f.el.value = state.filters[f.key] || '';
        f.el.disabled = false;
      });

      if (changed) syncUrl();
      state.optionsReady = true;
      mark('filter options');
      return changed;
    }

    function buildOption(key, value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value || FILTER_LABELS[key];
      return opt;
    }

    function primeEmptyFilters() {
      FILTER_FIELDS.forEach(function (f) {
        if (f.el) f.el.disabled = true;
      });
    }

    function renderFilterStatus(payload) {
      if (!els.filterHint) return;
      els.filterHint.classList.remove('is-stale');

      if (!hasActiveFilters()) {
        els.filterHint.textContent = '';
        els.filterHint.classList.remove('is-active');
        return;
      }

      var summary = (payload && payload.summary) || {};
      var shown = summary.totalRegistrations || 0;
      var all = summary.totalUnfiltered || shown;
      var labels = FILTER_FIELDS
        .filter(function (f) { return !!state.filters[f.key]; })
        .map(function (f) { return state.filters[f.key]; })
        .join(' · ');

      els.filterHint.classList.add('is-active');
      els.filterHint.textContent = 'عرض ' + Util.fmtNumber(shown) + ' من ' + Util.fmtNumber(all)
        + ' تسجيل · ' + labels
        + (state.serverFallback ? ' · محسوب على السيرفر' : '');
    }

    /* ------------------------------------------------------------------
       States
       ------------------------------------------------------------------ */

    function staggerReveal() {
      Util.qsa('.reveal').forEach(function (el, i) {
        el.style.setProperty('--rd', (i * 90) + 'ms');
      });
    }

    function showLoadingPlaceholders() {
      ['heroTotal', 'heroUpdated', 'pulseDelta', 'pulseMeta', 'kpiTotal', 'kpiEvents', 'kpiGovernorates', 'kpiDays']
        .forEach(function (id) { if (els[id]) els[id].textContent = 'جاري التحميل…'; });
    }

    function showError() {
      Util.qsa('.reveal').forEach(function (el) { el.classList.add('is-error'); });
      if (els.error) els.error.hidden = false;
    }

    function hideError() {
      if (els.error) els.error.hidden = true;
      Util.qsa('.reveal').forEach(function (el) { el.classList.remove('is-error'); });
    }

    function showStaleNotice(message) {
      if (!els.filterHint) return;
      els.filterHint.classList.add('is-stale');
      els.filterHint.textContent = message || 'تعذّر التحديث — الأرقام المعروضة محفوظة من آخر تحميل ناجح';
    }

    function setBusy(on) {
      if (els.filterBusy) els.filterBusy.hidden = !on;
    }

    function painted() {
      document.body.classList.add('ready');
      Util.markDataReady();
    }

    /* ------------------------------------------------------------------
       Rendering
       ------------------------------------------------------------------ */

    function paint(payload, animate) {
      var summary = payload.summary || {};
      var total = summary.totalRegistrations || 0;

      Charts.setAnimation(!!animate);

      renderFilterStatus(payload);

      /* HERO */
      if (els.heroTotal) els.heroTotal.textContent = Util.fmtNumber(total);
      if (els.heroUpdated) els.heroUpdated.textContent = Util.formatSubmission(summary.lastSubmissionAt || payload.generatedAt);

      var daily = payload.daily || [];

      /* PULSE + TREND */
      renderPulse(daily);
      renderTrend(daily);
      Charts.daily('#dailyChart', daily);

      /* KPI STRIP */
      if (els.kpiTotal) els.kpiTotal.textContent = Util.fmtNumber(total);
      if (els.kpiEvents) els.kpiEvents.textContent = Util.fmtNumber(summary.uniqueEvents || 0);
      if (els.kpiGovernorates) els.kpiGovernorates.textContent = Util.fmtNumber(summary.governorates || 0);
      if (els.kpiDays) els.kpiDays.textContent = Util.fmtNumber(summary.activeDays || 0);

      /* EVENT INTELLIGENCE */
      renderEvents(payload.events || [], total);
      Charts.activity('#eventChart', payload.events || [], total);

      /* GEOGRAPHIC */
      renderGovernorates(payload.governorates || [], total);
      Charts.governorates('#govChart', payload.governorates || [], total);

      /* PROFILE */
      Charts.gender('#genderChart', payload.genders || [], total);
      Charts.age('#ageChart', payload.ages || [], total);
      Charts.year('#yearChart', payload.years || [], total);
      Charts.college('#collegeChart', payload.colleges || [], total);

      /* FOOT */
      if (els.footUpdated) els.footUpdated.textContent = Util.formatSubmission(summary.lastSubmissionAt || payload.generatedAt);

      Charts.setAnimation(true);
    }

    function renderPulse(daily) {
      if (!els.pulseDelta) return;
      var last = daily[daily.length - 1];
      var prev = daily[daily.length - 2];

      if (!last) {
        els.pulseDelta.textContent = '—';
        if (els.pulseMeta) els.pulseMeta.textContent = 'لا توجد بيانات يومية بعد';
        return;
      }

      els.pulseDelta.textContent = Util.fmtNumber(last.count);
      if (els.pulseMeta) els.pulseMeta.textContent = 'تسجيل في ' + Util.formatDateLabel(last.date);

      if (prev && els.pulseTrend) {
        var diff = last.count - prev.count;
        els.pulseTrend.textContent = (diff >= 0 ? '▲ +' : '▼ ') + diff;
        els.pulseTrend.className = 'pulse__trend ' + (diff >= 0 ? 'is-up' : 'is-down');
      }
    }

    function renderTrend(daily) {
      if (!els.trendBars) return;

      if (!daily.length) {
        if (els.trendAverage) els.trendAverage.textContent = '—';
        if (els.trendPeak) els.trendPeak.textContent = '—';
        els.trendBars.textContent = '';
        return;
      }

      var sum = 0;
      var peak = daily[0];
      for (var i = 0; i < daily.length; i++) {
        sum += daily[i].count;
        if (daily[i].count > peak.count) peak = daily[i];
      }

      if (els.trendAverage) els.trendAverage.textContent = Math.round(sum / daily.length);
      if (els.trendPeak) {
        els.trendPeak.textContent = peak.count;
        els.trendPeak.setAttribute('data-hint', Util.formatDateLabel(peak.date));
        els.trendPeak.title = Util.formatDateLabel(peak.date);
      }

      var max = peak.count || 1;
      var frag = document.createDocumentFragment();

      /* Past this many active days the per-bar number no longer has room, so
         it is dropped from the drawing (it stays in the aria-label) and the
         row scrolls sideways instead of squashing the columns together. */
      var dense = daily.length > 14;
      els.trendBars.classList.toggle('trend__bars--dense', dense);

      daily.forEach(function (d) {
        var col = Util.createEl('div', 'tbar' + (d.count === max && max > 0 ? ' tbar--peak' : ''));
        col.style.setProperty('--h', Math.max(8, Math.round((d.count / max) * 100)) + '%');

        var num = Util.createEl('span', 'tbar__num', Util.fmtNumber(d.count));
        num.setAttribute('aria-hidden', 'true');
        col.appendChild(num);
        col.appendChild(Util.createEl('span', 'tbar__bar'));
        col.appendChild(Util.createEl('span', 'tbar__label', Util.formatDateLabel(d.date)));
        col.setAttribute('aria-label', Util.fmtNumber(d.count) + ' تسجيل في ' + Util.formatDateLabel(d.date));

        frag.appendChild(col);
      });

      els.trendBars.textContent = '';
      els.trendBars.appendChild(frag);

      /* Always start the scroller at the newest day (the left edge in RTL). */
      var scroller = els.trendBars.parentNode;
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollLeft = scroller.scrollWidth;
      }
    }

    function renderEvents(events, total) {
      if (!els.eventList) return;

      if (!events.length) {
        els.eventList.textContent = '';
        els.eventList.appendChild(Util.createEl('li', 'empty-note', 'لا توجد بيانات عن الإيفنتات بعد.'));
        return;
      }

      var frag = document.createDocumentFragment();

      events.forEach(function (ev, i) {
        var li = Util.createEl('li', 'activity-item');
        li.tabIndex = 0;
        li.setAttribute('role', 'button');
        li.setAttribute('aria-label', 'عرض تسجيلات: ' + ev.name);
        li.style.setProperty('--w', Math.min(100, ev.percentage || 0) + '%');

        li.appendChild(Util.createEl('span', 'activity-item__index', String(i + 1).padStart(2, '0')));

        var body = Util.createEl('div', 'activity-item__body');
        body.appendChild(Util.createEl('h3', 'activity-item__name', ev.name));
        body.appendChild(Util.createEl('p', 'activity-item__meta', ev.digest || ''));
        li.appendChild(body);

        var count = Util.createEl('div', 'activity-item__count');
        count.appendChild(Util.createEl('span', 'activity-item__num', Util.fmtNumber(ev.count)));
        count.appendChild(Util.createEl('span', 'activity-item__pct', Util.pct(ev.count, total)));
        li.appendChild(count);

        var open = function () { applyFilter('event', ev.name); };
        li.addEventListener('click', open);
        li.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
        });

        frag.appendChild(li);
      });

      els.eventList.textContent = '';
      els.eventList.appendChild(frag);
    }

    function renderGovernorates(governorates, total) {
      if (!els.govList) return;

      if (!governorates.length) {
        els.govList.textContent = '';
        els.govList.appendChild(Util.createEl('li', 'empty-note', 'لا توجد بيانات عن المحافظات بعد.'));
        return;
      }

      var frag = document.createDocumentFragment();

      governorates.forEach(function (g, i) {
        var li = Util.createEl('li', 'rank-item');
        li.style.setProperty('--w', Math.min(100, g.percentage || 0) + '%');

        li.appendChild(Util.createEl('span', 'rank-item__index', String(i + 1).padStart(2, '0')));

        var name = Util.createEl('span', 'rank-item__name', g.name);
        name.appendChild(Util.createEl('span', 'rank-item__bar'));
        li.appendChild(name);

        li.appendChild(Util.createEl('span', 'rank-item__count', Util.fmtNumber(g.count) + ' · ' + Util.pct(g.count, total)));

        frag.appendChild(li);
      });

      els.govList.textContent = '';
      els.govList.appendChild(frag);
    }

    /* ------------------------------------------------------------------
       Data sources
       ------------------------------------------------------------------ */

    /** Local path: dataset in memory -> recompute locally (instant). */
    function localPayload() {
      var t = performance.now();
      var ds = API.getDatasetSync();
      var payload = FilterEngine.buildPayload(ds, state.filters);
      payload._computeMs = Math.round(performance.now() - t);
      return payload;
    }

    /** Server path: pre-aggregated payload (used only if rows are missing). */
    function serverPayload() {
      setBusy(true);
      return API.get('dashboard', state.filters, { allowJsonp: true, retries: 1 })
        .then(function (payload) {
          state.serverFallback = true;
          return payload;
        });
    }

    function usePayload(payload, animate, cacheIt) {
      state.payload = payload;
      if (cacheIt) {
        API.writeView(currentKey(), payload);
        memo.set(currentKey(), payload);
      }
      paint(payload, animate);
      painted();
      hideError();
      setBusy(false);
    }

    /**
     * Renders the current filter state from the best available source:
     *   memo -> local dataset -> server aggregation.
     * Falls back to a stale cached view if everything fails.
     */
    function renderCurrent(opts) {
      opts = opts || {};
      var key = currentKey();

      /* 1. memoized payload for this exact filter state */
      if (memo.has(key)) {
        usePayload(memo.get(key), false, false);
        return Promise.resolve(state.payload);
      }

      /* 2. dataset available -> compute locally, no network at all */
      if (API.hasDataset()) {
        state.serverFallback = false;
        var payload = localPayload();
        usePayload(payload, opts.animate !== false, true);
        return Promise.resolve(payload);
      }

      /* 3. try the localStorage view cache first (may be stale but instant) */
      var cached = API.readView(key);
      if (cached && opts.preferCache) {
        state.payload = cached.payload;
        paint(cached.payload, false);
        painted();
        hideError();
      }

      /* 4. server-side aggregation */
      return serverPayload().then(function (remote) {
        if (opts.preferCache && cached) {
          API.writeView(key, remote);
          memo.set(key, remote);
          paint(remote, false);
          painted();
          return remote;
        }
        usePayload(remote, opts.animate !== false, true);
        return remote;
      }).catch(function (err) {
        if (cached) {
          state.payload = cached.payload;
          paint(cached.payload, false);
          painted();
          showStaleNotice();
          setBusy(false);
          return cached.payload;
        }
        showError();
        setBusy(false);
        throw err;
      });
    }

    /* ------------------------------------------------------------------
       Boot
       ------------------------------------------------------------------ */

    function boot() {
      hideError();
      memo.clear();
      FilterEngine.reset();

      /* Normalise the URL on load: drops params for filters that no longer
         exist (?university=…) and anything unknown, so a stale shared link
         does not keep dead query params forever. */
      syncUrl();

      var key = currentKey();
      var cached = API.readView(key);

      /* Stale-while-revalidate: paint what we have, refresh behind it. */
      if (cached) {
        state.payload = cached.payload;
        paint(cached.payload, false);
        painted();
        renderFilterStatus(cached.payload);
        mark('cached paint');
      } else {
        document.body.classList.remove('ready');
        showLoadingPlaceholders();
      }

      /* Two requests in parallel: small/fast facets + large/slow rows. */
      var facetsPromise = API.get('facets', null, {
        timeoutMs: API_CONFIG.FACETS_TIMEOUT_MS,
        allowJsonp: true,
        retries: 1
      }).then(function (payload) {
        if (payload && payload.options) {
          if (applyOptions(payload.options)) {
            /* a deep-linked filter was invalid — re-render with clean filters */
            renderCurrent({ animate: false });
          }
        }
        mark('facets');
      }).catch(function () {
        mark('facets failed');
      });

      var rowsPromise = API.getDataset().then(function (ds) {
        state.datasetReady = true;
        mark('rows (' + ds.rows.length + ')');
        return renderCurrent({ animate: !cached });
      }).catch(function (err) {
        mark('rows failed');
        console.warn('[FSE] dataset unavailable, using server aggregation:', err && err.message);
        return renderCurrent({ animate: !cached, preferCache: !!cached }).catch(function () {});
      });

      Promise.all([facetsPromise, rowsPromise]).then(function () {
        mark('boot complete');
        if (window.console && console.groupCollapsed) {
          console.groupCollapsed('FSE perf');
          marks.forEach(function (m) { console.log(m); });
          console.groupEnd();
        }
      });
    }

    /* ------------------------------------------------------------------
       Filter interaction
       ------------------------------------------------------------------ */

    var applyFilter = Util.debounce(function (key2, value) {
      state.filters[key2] = value || '';

      /* keep every <select> in sync — also covers programmatic clicks
         (clicking an event row sets the event filter for you) */
      FILTER_FIELDS.forEach(function (f) {
        if (f.el) f.el.value = state.filters[f.key] || '';
      });

      syncUrl();

      if (API.hasDataset()) {
        state.serverFallback = false;
        renderCurrent({ animate: false });
        return;
      }

      setBusy(true);
      renderCurrent({ animate: false, preferCache: true }).catch(function () {
        setBusy(false);
      });
    }, API_CONFIG.FILTER_DEBOUNCE_MS);

    FILTER_FIELDS.forEach(function (f) {
      if (!f.el) return;
      f.el.value = state.filters[f.key] || '';
      f.el.addEventListener('change', function () { applyFilter(f.key, f.el.value); });
    });

    if (els.filterReset) {
      els.filterReset.addEventListener('click', function () {
        if (!hasActiveFilters()) return;
        FILTER_FIELDS.forEach(function (f) {
          state.filters[f.key] = '';
          if (f.el) f.el.value = '';
        });
        syncUrl();
        renderCurrent({ animate: false, preferCache: true }).catch(function () {});
      });
    }

    if (els.retry) els.retry.addEventListener('click', boot);

    staggerReveal();
    primeEmptyFilters();

    Util.qsa('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('href').slice(1);
        var target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    boot();
  });
})();
