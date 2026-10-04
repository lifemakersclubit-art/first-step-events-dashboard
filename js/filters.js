/* ==========================================================================
   filters.js — Filter state + UI binding.
   Filters are global: every KPI, chart and alert re-derives from the same
   filtered record set, so the whole page always agrees with itself.
   ========================================================================== */

const Filters = (function () {
  const state = {
    event: "",
    governorate: "",
    university: "",
    gender: "",
    status: "",
    volunteer: "",
    source: "",
    range: "all", // all | 24h | 7d | 30d | custom
    from: null,
    to: null,
  };

  const listeners = [];
  let recordsRef = [];
  let facetsRef = null;

  /* ------------------------------------------------------------------
     RANGE → absolute window
     ------------------------------------------------------------------ */
  function resolveRange(now, bounds) {
    const to = state.to != null ? state.to : (bounds ? bounds.to : now.getTime());
    let from = state.from;
    if (state.range === "24h") from = to - Metrics.DAY;
    else if (state.range === "7d") from = to - 7 * Metrics.DAY;
    else if (state.range === "30d") from = to - 30 * Metrics.DAY;
    else if (state.range === "all") from = bounds ? bounds.from : null;
    return { from: from, to: to };
  }

  /** The filter object consumed by Data.applyFilters. */
  function current(now) {
    const r = resolveRange(now, Data.bounds(recordsRef));
    return {
      event: state.event,
      governorate: state.governorate,
      university: state.university,
      gender: state.gender,
      status: state.status,
      volunteer: state.volunteer,
      source: state.source,
      from: r.from,
      to: r.to,
    };
  }

  function apply(records, now) {
    return Data.applyFilters(records, current(now));
  }

  function isDirty() {
    return (
      state.event || state.governorate || state.university || state.gender ||
      state.status || state.volunteer || state.source || state.range !== "all"
    );
  }

  function activeCount() {
    let n = 0;
    ["event", "governorate", "university", "gender", "status", "volunteer", "source"].forEach(function (k) {
      if (state[k]) n++;
    });
    if (state.range !== "all") n++;
    return n;
  }

  function reset() {
    state.event = "";
    state.governorate = "";
    state.university = "";
    state.gender = "";
    state.status = "";
    state.volunteer = "";
    state.source = "";
    state.range = "all";
    state.from = null;
    state.to = null;
    emit();
  }

  function set(key, value) {
    if (!(key in state)) return;
    state[key] = value == null ? "" : value;
    // Chained dependency: governorate narrows the university list.
    if (key === "governorate" && state.university) {
      const unis = Data.universitiesIn(recordsRef, state.governorate);
      if (unis.indexOf(state.university) === -1) state.university = "";
    }
    if (key === "range" && value !== "custom") {
      state.from = null;
      state.to = null;
    }
    emit();
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  function emit() {
    listeners.forEach(function (fn) { fn(state); });
  }

  /* ------------------------------------------------------------------
     UI binding
     ------------------------------------------------------------------ */
  const LABELS = {
    event: "الإيفنت",
    governorate: "المحافظة",
    university: "الجامعة",
    gender: "النوع",
    status: "الطالب / الخريج",
    volunteer: "التطوع",
    source: "مصدر التسجيل",
  };

  function fillOptions(select, values, currentValue, allLabel) {
    select.innerHTML = "";
    const first = document.createElement("option");
    first.value = "";
    first.textContent = allLabel;
    select.appendChild(first);
    values.forEach(function (v) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      if (v === currentValue) o.selected = true;
      select.appendChild(o);
    });
  }

  function bind() {
    const f = facetsRef || Data.allFacets(recordsRef);

    const map = {
      "flt-event": f.event,
      "flt-governorate": f.governorate,
      "flt-university": f.university,
      "flt-gender": f.gender,
      "flt-status": f.status,
      "flt-volunteer": f.volunteer,
      "flt-source": f.source,
    };

    Object.keys(map).forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      const key = id.replace("flt-", "");
      fillOptions(el, map[id], state[key], "كل " + LABELS[key]);
      if (state[key] && map[id].indexOf(state[key]) === -1) {
        const o = document.createElement("option");
        o.value = state[key];
        o.textContent = state[key];
        o.selected = true;
        el.appendChild(o);
      }
      el.onchange = function () { set(key, el.value); };
    });

    /* date range */
    const rangeEl = document.getElementById("flt-range");
    if (rangeEl) {
      rangeEl.onchange = function () { set("range", rangeEl.value); };
      rangeEl.value = state.range;
    }
    ["flt-from", "flt-to"].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      const key = id === "flt-from" ? "from" : "to";
      el.onchange = function () {
        const v = el.value ? new Date(el.value + "T00:00:00").getTime() : null;
        state[key] = v;
        state.range = "custom";
        if (rangeEl) rangeEl.value = "custom";
        emit();
      };
      if (state[key]) el.value = new Date(state[key]).toISOString().slice(0, 10);
    });

    /* reset */
    const resetBtn = document.getElementById("flt-reset");
    if (resetBtn) {
      resetBtn.disabled = !isDirty();
      resetBtn.onclick = function () { reset(); };
    }

    /* active filter counter */
    const count = document.getElementById("flt-count");
    if (count) {
      const n = activeCount();
      count.textContent = n ? n + " فلتر" : "لا فلاتر";
      count.style.display = n ? "" : "none";
    }
  }

  /** Called whenever a new dataset arrives (filters must re-derive options). */
  function setRecords(records) {
    recordsRef = records;
    facetsRef = Data.allFacets(records);
  }

  return {
    state: state,
    bind: bind,
    set: set,
    reset: reset,
    apply: apply,
    current: current,
    isDirty: isDirty,
    activeCount: activeCount,
    onChange: onChange,
    setRecords: setRecords,
  };
})();

window.Filters = Filters;