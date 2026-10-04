/**
 * ============================================================
    FIRST STEP EVENTS — Registration Intelligence
    js/charts.js — Chart.js visualizations
   ------------------------------------------------------------
    v3 changes:
      • A `valueLabels` plugin paints the value onto every bar. It measures the
        text and the bar first, then places the label INSIDE the bar when it
        fits and OUTSIDE when it does not — so numbers never overlap each
        other, never spill off the canvas, and never sit on top of the
        category axis labels.
      • Labels are skipped entirely for slivers (< 3px) instead of being
        drawn as unreadable overlapping glyphs.
      • Doughnuts are used only while they stay readable (<= 5 slices) and
        carry the count + percentage in the legend plus the total in the hole.
        Past that the chart becomes a horizontal bar with end-of-bar values,
        which is the only layout that does not collide.
      • Chart instances are REUSED via Chart.getChart(canvas); a filter change
        calls update() instead of destroy() + new Chart().
      • Deep option merge so per-chart overrides no longer wipe the base
        tooltip/legend config (the old Object.assign was shallow).
   ============================================================
 */

var Charts = (function () {
  'use strict';

  var animateCharts = true;
  var FONT = 'Alexandria';

  /* Beyond this many slices a doughnut turns into unreadable spaghetti and
     the legend runs off the card — switch to a bar chart instead. */
  var MAX_DOUGHNUT_SLICES = 5;

  function setAnimation(on) {
    animateCharts = !!on;
  }

  function qs(sel) {
    return document.querySelector(sel);
  }

  function hasChart() {
    return typeof Chart !== 'undefined';
  }

  /* ------------------------------------------------------------------
     valueLabels plugin
     ------------------------------------------------------------------ */

  function registerValueLabels() {
    if (!hasChart() || Chart.registry.plugins.get('valueLabels')) return;

    Chart.register({
      id: 'valueLabels',
      afterDatasetsDraw: function (chart) {
        var opts = chart.options.plugins.valueLabels;
        if (!opts || opts.enabled === false) return;

        var meta = chart.getDatasetMeta(0);
        if (!meta || meta.hidden) return;

        var data = chart.data.datasets[0].data;
        var area = chart.chartArea;
        var ctx = chart.ctx;
        var horizontal = chart.options.indexAxis === 'y';
        var total = opts.total || 0;

        ctx.save();
        ctx.font = '700 ' + (opts.fontSize || 11) + 'px ' + FONT + ', sans-serif';
        ctx.textBaseline = 'middle';

        for (var i = 0; i < meta.data.length; i++) {
          var el = meta.data[i];
          var raw = data[i];
          if (raw == null || !isFinite(raw)) continue;

          var text = opts.percent && total
            ? Util.fmtNumber(raw) + '  ' + Util.pct(raw, total)
            : Util.fmtNumber(raw);
          if (text === '—') continue;

          var w = ctx.measureText(text).width;
          var len = Math.abs(horizontal ? el.x - el.base : el.y - el.base);

          /* Too thin to hold or to clear a number — drawing it here is what
             makes dense bar charts look like noise. */
          if (len < 3) continue;

          var inside = len >= w + 16;
          var x, y, align;

          if (horizontal) {
            y = el.y;
            if (inside) {
              x = el.x + (el.x < el.base ? 8 : -8);
              align = el.x < el.base ? 'left' : 'right';
              ctx.fillStyle = opts.insideColor || '#FFFFFF';
            } else {
              /* outside the tip; fall back to inside if there is no room */
              x = el.x + (el.x < el.base ? -8 : 8);
              align = el.x < el.base ? 'right' : 'left';
              if (x < area.left || x > area.right) continue;
              ctx.fillStyle = opts.outsideColor || 'rgba(27, 40, 51, 0.9)';
            }
          } else {
            x = el.x;
            align = 'center';
            if (inside) {
              y = el.y + (el.y < el.base ? 13 : -13);
              ctx.fillStyle = opts.insideColor || '#FFFFFF';
            } else {
              y = el.y + (el.y < el.base ? -8 : 8);
              if (y < area.top || y > area.bottom) continue;
              ctx.fillStyle = opts.outsideColor || 'rgba(27, 40, 51, 0.9)';
            }
          }

          ctx.textAlign = align;
          ctx.fillText(text, x, y);
        }

        ctx.restore();
      }
    });
  }

  /* ------------------------------------------------------------------
     Centre total for doughnuts
     ------------------------------------------------------------------ */

  function registerDoughnutTotal() {
    if (!hasChart() || Chart.registry.plugins.get('doughnutTotal')) return;

    Chart.register({
      id: 'doughnutTotal',
      afterDraw: function (chart) {
        var opts = chart.options.plugins.doughnutTotal;
        if (!opts || !opts.display) return;

        var meta = chart.getDatasetMeta(0);
        if (!meta || !meta.data.length) return;

        var arc = meta.data[0];
        var area = chart.chartArea;
        var cx = (area.left + area.right) / 2;
        var cy = (area.top + area.bottom) / 2;
        var ctx = chart.ctx;

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = opts.color || '#014976';
        ctx.font = '900 ' + (opts.size || 26) + 'px ' + FONT + ', sans-serif';
        ctx.fillText(Util.fmtNumber(chart.data.datasets[0].data.reduce(function (a, b) { return a + (b || 0); }, 0)), cx, cy - (opts.label ? 9 : 0));
        if (opts.label) {
          ctx.fillStyle = opts.labelColor || 'rgba(92, 92, 84, 0.9)';
          ctx.font = '500 11px ' + FONT + ', sans-serif';
          ctx.fillText(opts.label, cx, cy + 13);
        }
        ctx.restore();
        void arc;
      }
    });
  }

  /* ------------------------------------------------------------------
     Option builders
     ------------------------------------------------------------------ */

  var TICK = { color: 'rgba(92, 92, 84, 0.65)', font: { family: FONT, size: 11 } };

  function tooltipBase(labelFn) {
    return {
      backgroundColor: 'rgba(6, 41, 63, 0.94)',
      titleFont: { family: FONT, weight: '700', size: 13 },
      bodyFont: { family: FONT, size: 12 },
      padding: 12,
      cornerRadius: 8,
      displayColors: false,
      callbacks: { label: labelFn }
    };
  }

  function axisY() {
    return {
      beginAtZero: true,
      grid: { color: 'rgba(1, 73, 118, 0.06)', drawBorder: false },
      ticks: Object.assign({}, TICK, {
        callback: function (v) { return Util.fmtNumber(v); }
      })
    };
  }

  function axisX(opts) {
    opts = opts || {};
    return {
      grid: { display: !!opts.grid, color: 'rgba(1, 73, 118, 0.06)' },
      ticks: Object.assign({}, TICK, opts.ticks || {})
    };
  }

  /** Deep merge that keeps functions/objects from the override intact. */
  function merge(base, over) {
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = merge(Object.assign({}, base[k]), v);
      } else {
        base[k] = v;
      }
    });
    return base;
  }

  function baseOptions(overrides) {
    var o = {
      responsive: true,
      maintainAspectRatio: false,
      animation: animateCharts ? { duration: 700, easing: 'easeOutQuart' } : false,
      interaction: { intersect: false, mode: 'index' },
      layout: { padding: { top: 6, right: 10, bottom: 0, left: 10 } },
      plugins: {
        legend: { display: false },
        tooltip: tooltipBase(function (ctx) {
          return ctx.dataset.label + ': ' + Util.fmtNumber(ctx.parsed.y);
        })
      },
      scales: {
        x: axisX({ maxTicksLimit: 10 }),
        y: axisY()
      }
    };
    return merge(o, overrides || {});
  }

  /* ------------------------------------------------------------------
     Upsert core — reuse the instance, update in place
     ------------------------------------------------------------------ */

  function upsert(canvas, type, data, options) {
    if (!canvas || !canvas.getContext || !hasChart()) return null;
    registerValueLabels();
    registerDoughnutTotal();

    var existing = Chart.getChart(canvas);

    /* Type changed (or first paint) — a fresh instance is genuinely needed. */
    if (existing && existing.config.type !== type) {
      existing.destroy();
      existing = null;
    }

    if (existing) {
      existing.data.labels = data.labels;
      existing.data.datasets = data.datasets;
      existing.options = options;
      existing.update(animateCharts ? undefined : 'none');
      return existing;
    }

    return new Chart(canvas.getContext('2d'), {
      type: type,
      data: data,
      options: options
    });
  }

  /* ------------------------------------------------------------------
     Horizontal bar (values at the bar end)
     ------------------------------------------------------------------ */

  function barOptions(total, opts) {
    opts = opts || {};
    var color = opts.insideColor || '#FFFFFF';

    return baseOptions({
      indexAxis: 'y',
      plugins: {
        valueLabels: {
          enabled: true,
          total: total,
          fontSize: opts.fontSize || 11,
          insideColor: color,
          outsideColor: 'rgba(27, 40, 51, 0.88)'
        },
        tooltip: tooltipBase(function (ctx) {
          return opts.label + ': ' + Util.fmtNumber(ctx.parsed.x) + ' (' + Util.pct(ctx.parsed.x, total) + ')';
        })
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { display: opts.grid !== false, color: 'rgba(1, 73, 118, 0.06)' },
          ticks: Object.assign({}, TICK, {
            maxTicksLimit: 6,
            callback: function (v) { return Util.fmtNumber(v); }
          })
        },
        y: axisX({
          ticks: {
            font: { family: FONT, size: opts.labelSize || 11, weight: '700' },
            color: 'rgba(27, 40, 51, 0.85)',
            crossAlign: 'far'
          }
        })
      }
    });
  }

  /* ------------------------------------------------------------------
     Doughnut with values in the legend + total in the hole
     ------------------------------------------------------------------ */

  function doughnutOptions(total, opts) {
    opts = opts || {};
    return {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '64%',
      animation: animateCharts ? { duration: 700, easing: 'easeOutQuart' } : false,
      layout: { padding: 4 },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            font: { family: FONT, size: opts.legendSize || 11 },
            color: '#5C5C54',
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            /* Name + count + share. The value lives in the legend rather than
               on the arc, which is the only way to guarantee no overlap. */
            generateLabels: function (chart) {
              var data = chart.data.datasets[0].data;
              return chart.data.labels.map(function (label, i) {
                var v = data[i] || 0;
                return {
                  text: label + '  ·  ' + Util.fmtNumber(v) + '  (' + Util.pct(v, total) + ')',
                  fillStyle: chart.data.datasets[0].backgroundColor[i],
                  strokeStyle: chart.data.datasets[0].backgroundColor[i],
                  lineWidth: 0,
                  hidden: false,
                  index: i
                };
              });
            }
          }
        },
        doughnutTotal: {
          display: true,
          label: opts.totalLabel || 'تسجيل',
          size: opts.totalSize || 26
        },
        tooltip: tooltipBase(function (ctx) {
          return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
        })
      }
    };
  }

  var PALETTE = ['#014976', '#FBAE42', '#4A90B8', '#F17206', '#8FC9E8', '#1E5B7E', '#C3E2F3', '#FFC46B', '#2C6E8F', '#FFD89A'];
  var BAR_PALETTE = ['#014976', '#F17206', '#1E5B7E', '#FBAE42', '#4A90B8', '#2C6E8F', '#FFC46B', '#8FC9E8', '#C3E2F3', '#FFD89A'];

  /* ------------------------------------------------------------------
     Charts
     ------------------------------------------------------------------ */

  function daily(sel, dailyData) {
    var canvas = qs(sel);
    if (!canvas) return;

    return upsert(canvas, 'line', {
      labels: dailyData.map(function (d) { return Util.formatDateLabel(d.date); }),
      datasets: [{
        label: 'التسجيلات اليومية',
        data: dailyData.map(function (d) { return d.count; }),
        borderColor: '#014976',
        backgroundColor: 'rgba(1, 73, 118, 0.08)',
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: '#014976',
        pointHoverBorderColor: '#FFFFFF',
        pointHoverBorderWidth: 2
      }]
    }, baseOptions());
  }

  function activity(sel, activities, total) {
    var canvas = qs(sel);
    if (!canvas) return;
    var top = activities.slice(0, 8);

    return upsert(canvas, 'bar', {
      labels: top.map(function (a) { return a.name; }),
      datasets: [{
        label: 'التسجيلات',
        data: top.map(function (a) { return a.count; }),
        backgroundColor: top.map(function (_, i) {
          return i === 0 ? '#F17206' : i === 1 ? '#FBAE42' : '#014976';
        }),
        borderRadius: 4,
        maxBarThickness: 30
      }]
    }, barOptions(total, { label: 'التسجيلات' }));
  }

  function governorates(sel, govs, total) {
    var canvas = qs(sel);
    if (!canvas) return;
    var top = govs.slice(0, 10);

    return upsert(canvas, 'bar', {
      labels: top.map(function (g) { return g.name; }),
      datasets: [{
        label: 'التسجيلات',
        data: top.map(function (a) { return a.count; }),
        backgroundColor: BAR_PALETTE,
        borderRadius: 4,
        maxBarThickness: 26
      }]
    }, barOptions(total, { label: 'التسجيلات', labelSize: 10 }));
  }

  /* One builder for every categorical breakdown: doughnut while it is
     readable, horizontal bar once it would not be. */
  function categorical(sel, items, total, opts) {
    var canvas = qs(sel);
    if (!canvas) return;
    opts = opts || {};

    var list = items.slice(0, opts.limit || 10);
    var labels = list.map(function (d) { return d.name; });
    var values = list.map(function (d) { return d.count; });

    if (list.length > MAX_DOUGHNUT_SLICES) {
      return upsert(canvas, 'bar', {
        labels: labels,
        datasets: [{
          label: opts.label || 'التسجيلات',
          data: values,
          backgroundColor: opts.colors || BAR_PALETTE,
          borderRadius: 4,
          maxBarThickness: 22
        }]
      }, barOptions(total, {
        label: opts.label || 'التسجيلات',
        labelSize: 10,
        fontSize: 10
      }));
    }

    return upsert(canvas, 'doughnut', {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: (opts.colors || PALETTE).slice(0, list.length),
        borderWidth: 0,
        hoverOffset: 8
      }]
    }, doughnutOptions(total, { legendSize: opts.legendSize || 11 }));
  }

  function gender(sel, items, total) {
    return categorical(sel, items, total, { colors: ['#014976', '#FBAE42', '#4A90B8', '#F17206'] });
  }

  function age(sel, items, total) {
    return categorical(sel, items, total, { limit: 12 });
  }

  function year(sel, items, total) {
    return categorical(sel, items, total, { totalLabel: 'سنة دراسية' });
  }

  function college(sel, items, total) {
    return categorical(sel, items, total, { limit: 8, legendSize: 10, totalLabel: 'كلية' });
  }

  return {
    setAnimation: setAnimation,
    daily: daily,
    activity: activity,
    governorates: governorates,
    gender: gender,
    age: age,
    year: year,
    college: college
  };
})();
