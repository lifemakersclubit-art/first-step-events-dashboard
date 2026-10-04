/**
 * ============================================================
    FIRST STEP EVENTS — Registration Intelligence
    js/api.js — Transport layer for Google Apps Script endpoint
   ------------------------------------------------------------
    v2 changes:
      • In-flight request de-duplication: the same action+params never hits
        the network twice concurrently (kills duplicate /exec calls when the
        facets request and the rows request overlap).
      • The raw dataset is NO LONGER written to localStorage. It is far too
        large for the 5MB quota, and the failed write was costing a full
        JSON.stringify on the critical path. Small dashboard payloads are
        still cached; the dataset lives in memory for the page session.
      • Per-action timeouts, so the tiny facets call is not blocked behind
        the 120s cold-start budget of the full rows call.
      • Cold-start aware: a single retry with backoff, then cached fallback.
   ============================================================
 */

var API = (function () {
  'use strict';

  var VIEW_CACHE_PREFIX = 'fse_dash_v3:';
  var MAX_CACHED_VIEWS = 6;
  var VIEW_FRESH_MS = 300000;   /* 5 min */

  var inFlight = Object.create(null); /* url -> Promise */
  var dataset = null;                 /* in-memory dataset (rows action) */
  var datasetPromise = null;

  function buildUrl(action, params) {
    var base = String(API_CONFIG.BASE_URL || '').trim();
    if (!base) throw new Error('API_CONFIG.BASE_URL غير مضبوط');

    var qs = new URLSearchParams();
    qs.set('action', action || 'dashboard');
    qs.set('v', '3');
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] != null && params[k] !== '' && params[k] !== 'all') qs.set(k, params[k]);
      });
    }
    return base + (base.indexOf('?') === -1 ? '?' : '&') + qs.toString();
  }

  /* ------------------------------------------------------------------
     Transport
     ------------------------------------------------------------------ */

  function fetchJSON(url, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs);
    var opts = { method: 'GET', redirect: 'follow', credentials: 'omit', cache: 'no-store' };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (text) {
      try { return JSON.parse(text); }
      catch (e) { throw new Error('استجابة غير صالحة من الـ API'); }
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function jsonp(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var cb = 'fseCb_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      var script = document.createElement('script');
      var done = false;

      function cleanup() {
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('انتهت مهلة الاتصال'));
      }, timeoutMs || API_CONFIG.JSONP_TIMEOUT_MS);

      window[cb] = function (data) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      script.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error('فشل الاتصال بالـ API'));
      };

      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + cb;
      document.head.appendChild(script);
    });
  }

  function validate(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('استجابة غير صالحة من الـ API');
    if (payload.success === false) throw new Error(payload.error || 'الـ API أرجع خطأ');
    return payload;
  }

  function isError(payload) {
    return !payload || payload.success === false;
  }

  /* ------------------------------------------------------------------
     De-duplicated request
     ------------------------------------------------------------------ */

  function rawRequest(url, timeoutMs, allowJsonp, retries) {
    var attempt = 0;

    function run() {
      var started = Date.now();
      return fetchJSON(url, timeoutMs)
        .catch(function (err) {
          if (!allowJsonp) throw err;
          return jsonp(url, Math.max(timeoutMs, API_CONFIG.JSONP_TIMEOUT_MS));
        })
        .then(function (data) {
          var payload = validate(data);
          payload.fetchedAt = Date.now();
          payload.transportMs = Date.now() - started;
          return payload;
        });
    }

    function withRetry() {
      return run().catch(function (err) {
        if (attempt++ >= retries) throw err;
        return new Promise(function (resolve) {
          setTimeout(resolve, 800 * attempt);
        }).then(run);
      });
    }

    return withRetry();
  }

  function request(action, params, opts) {
    var o = opts || {};
    if (API_CONFIG.DEMO_MODE) return Promise.resolve({ success: true, demo: true });
    if (!API_CONFIG.BASE_URL) {
      return Promise.reject(new Error('DEMO_MODE = false ولكن API_CONFIG.BASE_URL فارغ'));
    }

    var url;
    try { url = buildUrl(action, params); }
    catch (e) { return Promise.reject(e); }

    var timeoutMs = o.timeoutMs || API_CONFIG.FETCH_TIMEOUT_MS;
    var allowJsonp = o.allowJsonp !== false;
    var retries = o.retries != null ? o.retries : API_CONFIG.MAX_RETRIES;

    /* Same URL already running -> join it instead of hitting the API again. */
    if (inFlight[url]) return inFlight[url];

    var attempt = rawRequest(url, timeoutMs, allowJsonp, retries);

    var p = attempt.then(
      function (payload) {
        delete inFlight[url];
        return payload;
      },
      function (err) {
        delete inFlight[url];
        throw err;
      }
    );

    inFlight[url] = p;
    return p;
  }

  function get(action, params, opts) {
    return request(action, params, opts);
  }

  function ping() {
    var url = buildUrl('ping');
    return fetchJSON(url, 15000)
      .catch(function () { return jsonp(url, 15000); })
      .then(validate);
  }

  /* ------------------------------------------------------------------
     View cache (small dashboard payloads only)
     ------------------------------------------------------------------ */

  function viewKey(filters) {
    var keys = ['event', 'governorate', 'university', 'gender', 'status', 'volunteer', 'source', 'from', 'to'];
    return keys.map(function (k) { return (filters && filters[k]) || ''; }).join('\u0001');
  }

  function readView(key) {
    try {
      var raw = localStorage.getItem(VIEW_CACHE_PREFIX + key);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || !rec.payload || rec.payload.success !== true) return null;
      return rec;
    } catch (e) { return null; }
  }

  function isFresh(rec) {
    return !!rec && typeof rec.at === 'number' && (Date.now() - rec.at) < VIEW_FRESH_MS;
  }

  function writeView(key, payload) {
    try {
      localStorage.setItem(VIEW_CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), payload: payload }));
    } catch (e) { /* quota / private mode */ }
    pruneViews(key);
  }

  function pruneViews(keepKey) {
    try {
      var entries = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(VIEW_CACHE_PREFIX) !== 0) continue;
        var at = 0;
        try { at = (JSON.parse(localStorage.getItem(k)) || {}).at || 0; } catch (e) { at = 0; }
        entries.push({ k: k, at: at });
      }
      entries.sort(function (a, b) { return b.at - a.at; });
      for (var j = MAX_CACHED_VIEWS; j < entries.length; j++) {
        if (entries[j].k === VIEW_CACHE_PREFIX + keepKey) continue;
        localStorage.removeItem(entries[j].k);
      }
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------
     Dataset (rows) — in-memory only, fetched at most once per session
     ------------------------------------------------------------------ */

  var ROWS_OPTS = {
    timeoutMs: API_CONFIG.DATASET_FETCH_TIMEOUT_MS,
    allowJsonp: false,
    retries: 1
  };

  function getDataset() {
    if (dataset) return Promise.resolve(dataset);
    if (datasetPromise) return datasetPromise;

    datasetPromise = get('rows', null, ROWS_OPTS).then(function (payload) {
      if (!payload || !payload.rows || !payload.rows.length) {
        throw new Error('لم يُرجع الـ API أي سجلات');
      }
      dataset = payload;
      datasetPromise = null;
      return payload;
    }).catch(function (err) {
      datasetPromise = null;
      throw err;
    });

    return datasetPromise;
  }

  function hasDataset() { return !!dataset; }
  function getDatasetSync() { return dataset; }

  function prefetchDataset() {
    if (dataset || datasetPromise) return datasetPromise || Promise.resolve(dataset);
    return getDataset().catch(function () { /* the caller surfaces the real error */ });
  }

  return {
    get: get,
    ping: ping,
    isError: isError,
    buildUrl: buildUrl,
    viewKey: viewKey,
    readView: readView,
    isFresh: isFresh,
    writeView: writeView,
    getDataset: getDataset,
    prefetchDataset: prefetchDataset,
    hasDataset: hasDataset,
    getDatasetSync: getDatasetSync
  };
})();
