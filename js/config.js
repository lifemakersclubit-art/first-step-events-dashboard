/**
 * ============================================================
    FIRST STEP EVENTS — Registration Intelligence
    js/config.js — API Configuration (Frontend)
   ============================================================
 */

var API_CONFIG = {
  BASE_URL: 'https://script.google.com/macros/s/AKfycbwZZd0vWeA7oaHs9Y046f1TeinoOIODo87j3L4ENjpIV1lvoT-z82m8X9hU0DqZZ80/exec',

  /* Facets are tiny and answer from the Apps Script cache — keep them snappy
     so the filter bar is usable while the full dataset is still loading. */
  FACETS_TIMEOUT_MS: 25000,

  /* The rows payload may hit a cold Apps Script instance on first load. */
  DATASET_FETCH_TIMEOUT_MS: 120000,

  /* Server-side aggregated dashboards (fallback when rows are unavailable). */
  FETCH_TIMEOUT_MS: 60000,

  JSONP_TIMEOUT_MS: 45000,

  MAX_RETRIES: 1,

  /* Filter changes are debounced so a fast multi-select does not queue
     several redundant re-renders. */
  FILTER_DEBOUNCE_MS: 180,

  DEMO_MODE: false
};

var UI_TEXT = {
  APP_NAME: 'FIRST STEP EVENTS',
  EVENTS: 'EVENTS 2026',
  TAGLINE: 'Registration Intelligence',
  SUBTITLE: 'صناع الحياة بالجامعات المصرية',
  ERROR_TITLE: 'تعذر الاتصال ببيانات التسجيلات',
  ERROR_BODY: 'حاول تحديث الصفحة مرة أخرى.',
  DEMO_BADGE: 'بيانات تجريبية — للعرض فقط'
};
