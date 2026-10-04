/**
 * ============================================================
   FIRST STEP EVENTS — Registration Intelligence
   js/charts.js — Chart.js visualizations
   ============================================================
 */

var Charts = (function () {
  'use strict';

  var animateCharts = true;

  function setAnimation(on) {
    animateCharts = !!on;
  }

  var defaultOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 800,
      easing: 'easeOutQuart'
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        backgroundColor: 'rgba(6, 41, 63, 0.92)',
        titleFont: { family: 'Alexandria', weight: '700', size: 13 },
        bodyFont: { family: 'Alexandria', size: 12 },
        padding: 12,
        cornerRadius: 8,
        displayColors: false,
        callbacks: {
          label: function (ctx) {
            return ctx.dataset.label + ': ' + Util.fmtNumber(ctx.parsed.y);
          }
        }
      }
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: 'rgba(92, 92, 84, 0.6)',
          font: { family: 'Alexandria', size: 11 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10
        }
      },
      y: {
        grid: {
          color: 'rgba(1, 73, 118, 0.06)',
          drawBorder: false
        },
        ticks: {
          color: 'rgba(92, 92, 84, 0.6)',
          font: { family: 'Alexandria', size: 11 },
          callback: function (v) { return Util.fmtNumber(v); }
        },
        beginAtZero: true
      }
    }
  };

  function daily(ctx, dailyData) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var labels = dailyData.map(function (d) { return Util.formatDateLabel(d.date); });
    var values = dailyData.map(function (d) { return d.count; });

    new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'التسجيلات اليومية',
          data: values,
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
      },
      options: Object.assign({}, defaultOptions, {
        interaction: { intersect: false, mode: 'index' }
      })
    });
  }

  function activity(ctx, activities, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var top = activities.slice(0, 8);
    var labels = top.map(function (a) { return a.name; });
    var values = top.map(function (a) { return a.count; });
    var colors = top.map(function (_, i) {
      return i === 0 ? '#F17206' : (i === 1 ? '#FBAE42' : '#014976');
    });

    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'التسجيلات',
          data: values,
          backgroundColor: colors,
          borderRadius: 4,
          barThickness: 28,
          maxBarThickness: 36
        }]
      },
      options: Object.assign({}, defaultOptions, {
        indexAxis: 'y',
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return 'التسجيلات: ' + Util.fmtNumber(ctx.parsed.x) + ' (' + Util.pct(ctx.parsed.x, total) + ')';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: 'rgba(92, 92, 84, 0.6)',
              font: { family: 'Alexandria', size: 11 },
              callback: function (v) { return Util.fmtNumber(v); }
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: 'rgba(92, 92, 84, 0.6)',
              font: { family: 'Alexandria', size: 11 }
            }
          }
        }
      })
    });
  }

  function governorates(ctx, govs, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var top = govs.slice(0, 10);
    var labels = top.map(function (g) { return g.name; });
    var values = top.map(function (g) { return g.count; });

    new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'التسجيلات',
          data: values,
          backgroundColor: '#014976',
          borderRadius: 4,
          barThickness: 28,
          maxBarThickness: 36
        }]
      },
      options: Object.assign({}, defaultOptions, {
        indexAxis: 'y',
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return 'التسجيلات: ' + Util.fmtNumber(ctx.parsed.x) + ' (' + Util.pct(ctx.parsed.x, total) + ')';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(1, 73, 118, 0.06)' },
            ticks: {
              color: 'rgba(92, 92, 84, 0.6)',
              font: { family: 'Alexandria', size: 11 },
              callback: function (v) { return Util.fmtNumber(v); }
            }
          },
          y: {
            grid: { display: false },
            ticks: {
              color: 'rgba(92, 92, 84, 0.6)',
              font: { family: 'Alexandria', size: 11 }
            }
          }
        }
      })
    });
  }

  function englishLevels(ctx, levels, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var labels = levels.map(function (l) { return l.name; });
    var values = levels.map(function (l) { return l.count; });
    var colors = ['#014976', '#1E5B7E', '#4A90B8', '#8FC9E8', '#C3E2F3'];

    new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Alexandria', size: 11 },
              color: '#5C5C54',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
              }
            }
          }
        }
      }
    });
  }

  function eventTypes(ctx, types, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var labels = types.map(function (t) { return t.name; });
    var values = types.map(function (t) { return t.count; });
    var colors = ['#FBAE42', '#F17206', '#FFC46B', '#FFD89A', '#FDEFd6'];

    new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Alexandria', size: 11 },
              color: '#5C5C54',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
              }
            }
          }
        }
      }
    });
  }

  function gender(ctx, genders, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var labels = genders.map(function (g) { return g.name; });
    var values = genders.map(function (g) { return g.count; });
    var colors = ['#014976', '#FBAE42'];

    new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Alexandria', size: 11 },
              color: '#5C5C54',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
              }
            }
          }
        }
      }
    });
  }

  function age(ctx, ages, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var labels = ages.map(function (a) { return a.name; });
    var values = ages.map(function (a) { return a.count; });
    var colors = ['#014976', '#1E5B7E', '#4A90B8', '#8FC9E8'];

    new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Alexandria', size: 11 },
              color: '#5C5C54',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
              }
            }
          }
        }
      }
    });
  }

  function year(ctx, years, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var labels = years.map(function (y) { return y.name; });
    var values = years.map(function (y) { return y.count; });
    var colors = ['#014976', '#1E5B7E', '#4A90B8', '#8FC9E8', '#FBAE42', '#F17206'];

    new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Alexandria', size: 11 },
              color: '#5C5C54',
              padding: 16,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
              }
            }
          }
        }
      }
    });
  }

  function college(ctx, colleges, total) {
    var canvas = qs(ctx);
    if (!canvas || !canvas.getContext) return;

    var top = colleges.slice(0, 6);
    var labels = top.map(function (c) { return c.name; });
    var values = top.map(function (c) { return c.count; });
    var colors = ['#014976', '#1E5B7E', '#4A90B8', '#8FC9E8', '#FBAE42', '#F17206'];

    new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              font: { family: 'Alexandria', size: 10 },
              color: '#5C5C54',
              padding: 12,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.label + ': ' + Util.fmtNumber(ctx.parsed) + ' (' + Util.pct(ctx.parsed, total) + ')';
              }
            }
          }
        }
      }
    });
  }

  function qs(sel) {
    return document.querySelector(sel);
  }

  return {
    setAnimation: setAnimation,
    daily: daily,
    activity: activity,
    governorates: governorates,
    englishLevels: englishLevels,
    eventTypes: eventTypes,
    gender: gender,
    age: age,
    year: year,
    college: college
  };
})();