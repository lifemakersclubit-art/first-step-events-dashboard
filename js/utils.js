/**
 * ============================================================
   FIRST STEP EVENTS — Registration Intelligence
   js/utils.js — Shared utilities
   ============================================================
 */

var Util = (function () {
  'use strict';

  function qs(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }

  function qsa(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }

  function createEl(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
  }

  function fmtNumber(n) {
    if (n == null) return '—';
    return Number(n).toLocaleString('ar-EG');
  }

  function pct(part, total) {
    if (!total) return '0%';
    return Math.round((part / total) * 100) + '%';
  }

  function formatDateLabel(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function formatSubmission(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('ar-EG', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  function markDataReady() {
    var splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('splash--hide');
      setTimeout(function () {
        splash.style.display = 'none';
      }, 600);
    }
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(this, args); }, ms);
    };
  }

  return {
    qs: qs,
    qsa: qsa,
    createEl: createEl,
    fmtNumber: fmtNumber,
    pct: pct,
    formatDateLabel: formatDateLabel,
    formatSubmission: formatSubmission,
    markDataReady: markDataReady,
    debounce: debounce
  };
})();