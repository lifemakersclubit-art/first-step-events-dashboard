/**
 * ============================================================
   FIRST STEP EVENTS — Registration Intelligence
   js/api.js — Transport layer for Google Apps Script endpoint
   Supports: get(action, params, opts), prefetch(action, params, opts), isError(payload)
   ============================================================
 */

var API = (function () {
  'use strict';

  var CACHE_KEY = 'fse_dashboard_payload_v1';
  var META_KEY = 'fse_dashboard_meta_v1';
  var JSONP_TIMEOUT = 20000;

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var payload = JSON.parse(raw);
      var meta = JSON.parse(localStorage.getItem(META_KEY) || 'null') || {};
      var age = Date.now() - (meta.storedAt || 0);
      if (age > 120000) return null;
      return { payload: payload, meta: meta, age: age, fresh: age <= 120000 };
    } catch (e) {
      return null;
    }
  }

  function writeCache(payload) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
      localStorage.setItem(META_KEY, JSON.stringify({ storedAt: Date.now(), at: payload.updatedAt || null }));
    } catch (e) { /* quota / private mode */ }
  }

  function buildUrl(action, params) {
    var base = String(API_CONFIG.BASE_URL || '').trim();
    if (!base) throw new Error('API_CONFIG.BASE_URL غير مضبوط');
    var qs = new URLSearchParams();
    qs.set('action', action || 'dashboard');
    qs.set('v', '1');
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] != null && params[k] !== '') qs.set(k, params[k]);
      });
    }
    return base + (base.indexOf('?') === -1 ? '?' : '&') + qs.toString();
  }

  function fetchJSON(url, timeout) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout || API_CONFIG.FETCH_TIMEOUT_MS);
    var opts = { method: 'GET', redirect: 'follow', credentials: 'omit' };
    if (ctrl) opts.signal = ctrl.signal;

    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cb = 'hmccCb_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      var script = document.createElement('script');
      var done = false;

      var cleanup = function () {
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('انتهت مهلة الاتصال'));
      }, JSONP_TIMEOUT);

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

  function request(action, params, opts) {
    var o = opts || {};
    var timeout = o.timeoutMs || API_CONFIG.FETCH_TIMEOUT_MS;
    var allowJsonp = o.allowJsonp !== false;
    var retries = o.retries !== undefined ? o.retries : API_CONFIG.MAX_RETRIES;

    if (API_CONFIG.DEMO_MODE) {
      return Promise.resolve({ success: true, demo: true });
    }
    if (!API_CONFIG.BASE_URL) {
      return Promise.reject(new Error('DEMO_MODE = false ولكن API_CONFIG.BASE_URL فارغ'));
    }

    var attempt = 0;

    function run() {
      var url = buildUrl(action, params);
      return fetchJSON(url, timeout)
        .catch(function () {
          if (!allowJsonp) throw new Error('JSONP fallback disabled');
          return jsonp(url);
        })
        .then(function (data) {
          var payload = validate(data);
          payload.fetchedAt = Date.now();
          writeCache(payload);
          return payload;
        });
    }

    function withRetry() {
      return run().catch(function (err) {
        if (attempt++ < retries) return withRetry();
        var cached = readCache();
        if (cached) {
          return { success: true, cached: true, age: cached.age, stale: !cached.fresh, payload: cached.payload, _error: err };
        }
        throw err;
      });
    }

    return withRetry();
  }

  function get(action, params, opts) {
    return request(action, params, opts);
  }

  function prefetch(action, params, opts) {
    // Fire-and-forget style: returns promise but doesn't cache result for UI
    var o = Object.assign({}, opts, { retries: 1 });
    return request(action, params, o).catch(function () { /* silent */ });
  }

  function ping() {
    var url = buildUrl('ping');
    return fetchJSON(url, 12000)
      .catch(function () { return jsonp(url); })
      .then(validate);
  }

  return {
    get: get,
    prefetch: prefetch,
    isError: isError,
    ping: ping,
    buildUrl: buildUrl,
    readCache: readCache,
    writeCache: writeCache
  };
})();