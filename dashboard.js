(() => {
  const cfg = window.APP_CONFIG;
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const loginView = document.getElementById("login-view");
  const dashView = document.getElementById("dashboard-view");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");
  const userEmail = document.getElementById("user-email");

  let allRows = [];
  let charts = {};
  let sortKey = "key_id", sortDir = -1;
  let selectedProducts = new Set();
  let productExclusive = false;
  // key: lowercased product, value: { min: number|null, max: number|null, unit: string|null }
  let productRateFilters = {};
  let ddProduct = "";  // lowercased
  let ddUnit = "";     // exact match
  let costOverride = null; // number or null
  let cropPrices = loadCropPrices();
  let showDeleted = false;

  function costOverrideActive() {
    return productExclusive && selectedProducts.size > 0 && Number.isFinite(costOverride);
  }

  function loadCropPrices() {
    try {
      const saved = JSON.parse(localStorage.getItem("crop_prices") || "{}");
      return { ...cfg.CROP_PRICE, ...saved };
    } catch { return { ...cfg.CROP_PRICE }; }
  }
  function saveCropPrices() {
    localStorage.setItem("crop_prices", JSON.stringify(cropPrices));
  }

  // Recompute $-derived fields using current cropPrices (and cost override if active).
  function applyPrices(r) {
    const price = cropPrices[r.crop];
    const out = { ...r };
    if (Number.isFinite(price) && r.trt_increase != null) {
      out.dollar_per_acre_increase = +(r.trt_increase * price).toFixed(2);
    }
    const effectiveCost = costOverrideActive() ? costOverride : r.trt_cost;
    if (effectiveCost != null) out.trt_cost = effectiveCost;
    if (out.dollar_per_acre_increase != null && effectiveCost != null) {
      out.net_per_acre = +(out.dollar_per_acre_increase - effectiveCost).toFixed(2);
      out.roi = effectiveCost > 0 ? +(out.net_per_acre / effectiveCost).toFixed(4) : null;
    }
    return out;
  }

  const COLS = [
    ["key_id", "Key ID", "num"],
    ["year", "Year", "num"],
    ["trial_num", "Trial #", "num"],
    ["sales_rep", "Sales Rep"],
    ["state", "State"],
    ["zip_code", "Zip"],
    ["location", "Location"],
    ["crop", "Crop"],
    ["treatment_type", "Trt Type"],
    ["growth_stage_applied", "Stage"],
    ["check_trt", "Check"],
    ["treatment_with_rate", "Treatment"],
    ["check_yield", "Check Y", "num"],
    ["trt_yield", "TRT Y", "num"],
    ["trt_increase", "Δ Y", "num", "delta"],
    ["pct_increase", "% Δ", "num", "pct"],
    ["std_dev", "Std Dev", "num"],
    ["product_cost", "Prod $", "num"],
    ["application_cost", "App $", "num"],
    ["trt_cost", "TRT $", "num"],
    ["dollar_per_acre_increase", "$/A Δ", "num", "delta"],
    ["net_per_acre", "Net $/A", "num", "delta"],
    ["roi", "ROI", "num", "pct"],
    ["spatial_data", "Spatial"],
    ["size", "Size"],
    ["customer_info", "Notes"],
  ];

  // ---------- AUTH ----------
  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) showDashboard(session.user);
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.textContent = "";
    loginBtn.disabled = true; loginBtn.textContent = "Signing in…";
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    loginBtn.disabled = false; loginBtn.textContent = "Sign in";
    if (error) { loginError.textContent = error.message; return; }
    showDashboard(data.user);
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    location.reload();
  });

  async function showDashboard(user) {
    loginView.classList.add("hidden");
    dashView.classList.remove("hidden");
    userEmail.textContent = user.email;
    await loadData();
  }

  // ---------- DATA ----------
  async function loadData() {
    let q = supabase.from("trials").select("*")
      .order("key_id", { ascending: false }).limit(10000);
    if (!showDeleted) q = q.is("deleted_at", null);
    const { data, error } = await q;
    if (error) { alert("Error loading data: " + error.message); return; }
    allRows = data ?? [];
    for (const r of allRows) {
      r._slots = rowSlots(r);
      r._products = r._slots.map(s => s.product);
    }
    populateFilters(allRows);
    populateProductsList();
    populateDeepDiveSelectors();
    render();
  }

  // ---------- PRODUCT PARSING ----------
  function parseProducts(str) {
    if (!str) return [];
    return str.split(/\s*[+&,/]\s*/)
      .map(s => s.replace(/\s*@[^+&,/]*$/, "").trim())  // strip rate suffix like "@ 4 oz"
      .map(s => s.replace(/\s+/g, " "))                 // collapse spaces
      .filter(s => s.length > 0);
  }
  // Prefer the structured product_1..5 columns; fall back to parsing
  // treatment_with_rate for any row not yet backfilled.
  function rowSlots(r) {
    const out = [];
    for (let i = 1; i <= 5; i++) {
      const p = r[`product_${i}`];
      if (p && String(p).trim()) {
        out.push({ product: String(p).trim(), rate: r[`rate_${i}`], unit: r[`unit_${i}`] });
      }
    }
    if (out.length) return out;
    return parseProducts(r.treatment_with_rate).map(p => ({ product: p, rate: null, unit: null }));
  }
  function rowProducts(r) {
    return (r._slots ?? []).map(s => s.product);
  }

  function uniqueProducts(rows) {
    const m = new Map(); // canonical (lowercase) -> display
    for (const r of rows) {
      for (const p of r._products ?? []) {
        const key = p.toLowerCase();
        if (!m.has(key)) m.set(key, p);
      }
    }
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  }

  function populateFilters(rows) {
    const fill = (id, vals) => {
      const sel = document.getElementById(id);
      const current = sel.value;
      sel.innerHTML = '<option value="">All</option>' +
        [...new Set(vals.filter(Boolean))].sort().map(v => `<option>${escapeHtml(String(v))}</option>`).join("");
      sel.value = current;
    };
    fill("f-year", rows.map(r => r.year));
    fill("f-crop", rows.map(r => r.crop));
    fill("f-state", rows.map(r => r.state));
    fill("f-treatment-type", rows.map(r => r.treatment_type));
    fill("f-sales-rep", rows.map(r => r.sales_rep));
  }

  function getFiltered() {
    const fy = document.getElementById("f-year").value;
    const fc = document.getElementById("f-crop").value;
    const fs = document.getElementById("f-state").value;
    const ft = document.getElementById("f-treatment-type").value;
    const fr = document.getElementById("f-sales-rep").value;
    const q = document.getElementById("f-search").value.trim().toLowerCase();
    const sel = [...selectedProducts]; // lowercased canonical keys

    return allRows.filter(r => {
      if (fy && String(r.year) !== fy) return false;
      if (fc && r.crop !== fc) return false;
      if (fs && r.state !== fs) return false;
      if (ft && r.treatment_type !== ft) return false;
      if (fr && r.sales_rep !== fr) return false;
      if (sel.length) {
        const slots = r._slots ?? [];
        const slotByProduct = new Map(); // lc product -> slot
        for (const s of slots) slotByProduct.set(s.product.toLowerCase(), s);

        for (const p of sel) {
          const slot = slotByProduct.get(p);
          if (!slot) return false;
          const rf = productRateFilters[p];
          if (rf && (rf.min != null || rf.max != null || rf.unit)) {
            if (slot.rate == null) return false;
            if (rf.min != null && slot.rate < rf.min) return false;
            if (rf.max != null && slot.rate > rf.max) return false;
            if (rf.unit && (slot.unit ?? "").toLowerCase() !== rf.unit.toLowerCase()) return false;
          }
        }
        if (productExclusive && slots.length !== sel.length) return false;
      }
      if (q) {
        const hay = [r.treatment_with_rate, r.product_names, r.customer_info, r.location, r.check_trt]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  // ---------- RENDER ----------
  function render() {
    const rows = getFiltered().map(applyPrices);
    renderKpis(rows);
    renderCharts(rows);
    renderDeepDive(rows);
    renderTable(rows);
  }

  function renderKpis(rows) {
    const n = rows.length;
    const incs = rows.map(r => r.trt_increase).filter(v => v != null);
    const rois = rows.map(r => r.roi).filter(v => v != null);
    const nets = rows.map(r => r.net_per_acre).filter(v => v != null);
    const wins = incs.filter(v => v > 0).length;
    const econWins = rois.filter(v => v > 0).length;

    document.getElementById("kpi-count").textContent = n.toLocaleString();
    document.getElementById("kpi-trt-inc").textContent = avg(incs) != null ? avg(incs).toFixed(1) : "—";
    document.getElementById("kpi-econ-winrate").textContent = rois.length ? ((econWins / rois.length) * 100).toFixed(0) + "%" : "—";
    document.getElementById("kpi-net").textContent = avg(nets) != null ? "$" + avg(nets).toFixed(0) : "—";
    document.getElementById("kpi-winrate").textContent = incs.length ? ((wins / incs.length) * 100).toFixed(0) + "%" : "—";
  }

  function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : null; }

  function groupAvg(rows, keyField, valueField) {
    const m = new Map();
    for (const r of rows) {
      const k = r[keyField]; const v = r[valueField];
      if (k == null || v == null) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    return [...m.entries()].map(([k, arr]) => ({ k, v: avg(arr), n: arr.length }));
  }

  function groupCount(rows, keyField) {
    const m = new Map();
    for (const r of rows) {
      const k = r[keyField]; if (k == null) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([k, v]) => ({ k, v }));
  }

  const PALETTE = [
    [16, 185, 129],  // emerald
    [59, 130, 246],  // blue
    [245, 158, 11],  // amber
    [139, 92, 246],  // violet
    [244, 63, 94],   // rose
    [6, 182, 212],   // cyan
    [132, 204, 22],  // lime
    [249, 115, 22],  // orange
    [217, 70, 239],  // fuchsia
    [100, 116, 139], // slate
  ];
  const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

  if (window.ChartDataLabels) Chart.register(window.ChartDataLabels);

  function renderCharts(rows) {
    const dispose = (id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } };
    const mk = (id, type, labels, values, label) => {
      dispose(id);
      const ctx = document.getElementById(id);
      const colors = labels.map((_, i) => PALETTE[i % PALETTE.length]);
      charts[id] = new Chart(ctx, {
        type,
        data: {
          labels,
          datasets: [{
            label,
            data: values,
            backgroundColor: colors.map(c => rgba(c, 0.75)),
            borderColor: colors.map(c => rgba(c, 1)),
            borderWidth: 1,
          }],
        },
        options: {
          plugins: {
            legend: { display: false },
            datalabels: {
              anchor: (ctx) => (ctx.dataset.data[ctx.dataIndex] ?? 0) >= 0 ? "end" : "start",
              align: (ctx) => (ctx.dataset.data[ctx.dataIndex] ?? 0) >= 0 ? "end" : "start",
              offset: 2,
              clip: false,
              color: "rgb(28,25,23)",
              font: { weight: "600", size: 11 },
              formatter: (v) => {
                if (v == null) return "";
                if (Number.isInteger(v)) return v.toLocaleString();
                return (+v).toFixed(1);
              },
            },
          },
          layout: { padding: { top: 16, bottom: 8 } },
          scales: { y: { beginAtZero: true } },
        },
      });
    };

    const byCrop = groupAvg(rows, "crop", "trt_increase").sort((a,b)=>b.v-a.v);
    mk("chart-crop", "bar", byCrop.map(g=>`${g.k} (n=${g.n})`), byCrop.map(g=>+g.v.toFixed(2)), "Avg Yield Δ");

    const byTrt = groupAvg(rows, "treatment_type", "trt_increase").sort((a,b)=>b.v-a.v);
    mk("chart-trt", "bar", byTrt.map(g=>`${g.k} (n=${g.n})`), byTrt.map(g=>+g.v.toFixed(2)), "Avg Yield Δ");

    const byState = groupCount(rows, "state").sort((a,b)=>b.v-a.v);
    mk("chart-state", "bar", byState.map(g=>g.k), byState.map(g=>g.v), "Trials");

    // Histogram of trt_increase (bu/ac).
    const incs = rows.map(r => r.trt_increase).filter(v => v != null);
    const bounds = [-10, -5, -2, 0, 2, 5, 10, 20];
    const yLabels = ["< -10"];
    for (let i = 0; i < bounds.length - 1; i++) yLabels.push(`${bounds[i]} to ${bounds[i+1]}`);
    yLabels.push("> 20");
    const yCounts = new Array(yLabels.length).fill(0);
    for (const v of incs) {
      let i = bounds.findIndex(b => v < b);
      if (i === -1) i = yLabels.length - 1;
      yCounts[i]++;
    }
    mk("chart-yield", "bar", yLabels, yCounts, "Count");
  }

  // ---------- DEEP DIVE ----------
  function populateDeepDiveSelectors() {
    const all = uniqueProducts(allRows);
    const ddP = document.getElementById("dd-product");
    const current = ddP.value;
    ddP.innerHTML = '<option value="">— pick a product —</option>' +
      all.map(p => `<option value="${escapeHtml(p.toLowerCase())}">${escapeHtml(p)}</option>`).join("");
    if ([...ddP.options].some(o => o.value === current)) ddP.value = current;
    else ddProduct = "";
    refreshDeepDiveUnits();
  }
  function refreshDeepDiveUnits() {
    const ddU = document.getElementById("dd-unit");
    const units = new Set();
    if (ddProduct) {
      for (const r of allRows) {
        for (const s of (r._slots ?? [])) {
          if (s.product.toLowerCase() === ddProduct && s.unit) units.add(s.unit);
        }
      }
    }
    const list = [...units].sort();
    const current = ddU.value;
    ddU.innerHTML = '<option value="">any unit</option>' +
      list.map(u => `<option>${escapeHtml(u)}</option>`).join("");
    if ([...ddU.options].some(o => o.value === current)) ddU.value = current;
    else ddUnit = "";
  }

  function pointsForDeepDive(rows) {
    // Pull (rate, trt_increase, roi, label) for each row that has the chosen product (+ optional unit) with a numeric rate.
    if (!ddProduct) return [];
    const out = [];
    for (const r of rows) {
      for (const s of (r._slots ?? [])) {
        if (s.product.toLowerCase() !== ddProduct) continue;
        if (ddUnit && (s.unit ?? "") !== ddUnit) continue;
        if (s.rate == null) continue;
        out.push({
          rate: +s.rate,
          unit: s.unit ?? "",
          delta: r.trt_increase,
          roi: r.roi,
          year: r.year,
          crop: r.crop,
          key: r.key_id,
        });
      }
    }
    return out;
  }

  function renderDeepDive(rows) {
    const meta = document.getElementById("dd-meta");
    const dispose = (id) => { if (charts[id]) { charts[id].destroy(); delete charts[id]; } };

    if (!ddProduct) {
      dispose("chart-scatter");
      dispose("chart-winrate-by-rate");
      meta.textContent = "Select a product to see rate-level analysis.";
      return;
    }
    const points = pointsForDeepDive(rows);
    meta.textContent = `${points.length} trial${points.length === 1 ? "" : "s"} with this product + numeric rate${ddUnit ? ` in ${ddUnit}` : ""}.`;

    // --- Scatter: rate vs yield Δ ---
    dispose("chart-scatter");
    const scatterData = points.filter(p => p.delta != null).map(p => ({ x: p.rate, y: p.delta, _p: p }));
    // Color by unit if mixed.
    const uniqueUnits = [...new Set(points.map(p => p.unit))];
    const unitColor = (u) => PALETTE[uniqueUnits.indexOf(u) % PALETTE.length] ?? PALETTE[0];
    charts["chart-scatter"] = new Chart(document.getElementById("chart-scatter"), {
      type: "scatter",
      data: {
        datasets: uniqueUnits.length > 1 && !ddUnit
          ? uniqueUnits.map(u => ({
              label: u || "(no unit)",
              data: scatterData.filter(d => d._p.unit === u),
              backgroundColor: rgba(unitColor(u), 0.7),
              borderColor: rgba(unitColor(u), 1),
              pointRadius: 5,
            }))
          : [{
              label: "Trials",
              data: scatterData,
              backgroundColor: rgba(PALETTE[0], 0.7),
              borderColor: rgba(PALETTE[0], 1),
              pointRadius: 5,
            }],
      },
      options: {
        plugins: {
          legend: { display: uniqueUnits.length > 1 && !ddUnit },
          datalabels: { display: false },
          tooltip: { callbacks: { label: (ctx) => {
            const p = ctx.raw._p;
            return `Key ${p.key} · rate ${p.rate}${p.unit ? " " + p.unit : ""} · Δ ${p.delta}`;
          } } },
        },
        scales: {
          x: { title: { display: true, text: `Rate${ddUnit ? ` (${ddUnit})` : ""}` } },
          y: { title: { display: true, text: "Yield Δ (bu/ac)" } },
        },
      },
    });

    // --- Win rate by rate bucket ---
    dispose("chart-winrate-by-rate");
    const withRoi = points.filter(p => p.roi != null);
    const labels = [], wins = [], totals = [];
    if (withRoi.length > 0) {
      const distinct = [...new Set(withRoi.map(p => +p.rate.toFixed(4)))].sort((a, b) => a - b);
      if (distinct.length <= 6) {
        // Use each distinct rate as its own bucket.
        for (const r of distinct) {
          const group = withRoi.filter(p => +p.rate.toFixed(4) === r);
          labels.push(`${r}${ddUnit ? " " + ddUnit : ""}`);
          wins.push(group.filter(p => p.roi > 0).length);
          totals.push(group.length);
        }
      } else {
        // Auto-bucket into 4 quartiles by rate.
        const sorted = [...withRoi].sort((a, b) => a.rate - b.rate);
        const q = (frac) => sorted[Math.min(sorted.length - 1, Math.floor(frac * sorted.length))].rate;
        const cuts = [q(0.25), q(0.5), q(0.75)];
        const bucketsRaw = [[], [], [], []];
        for (const p of withRoi) {
          let bi = 0;
          if (p.rate >= cuts[2]) bi = 3;
          else if (p.rate >= cuts[1]) bi = 2;
          else if (p.rate >= cuts[0]) bi = 1;
          bucketsRaw[bi].push(p);
        }
        const fmt = (v) => +v.toFixed(2);
        labels.push(`<${fmt(cuts[0])}`);
        labels.push(`${fmt(cuts[0])}–${fmt(cuts[1])}`);
        labels.push(`${fmt(cuts[1])}–${fmt(cuts[2])}`);
        labels.push(`≥${fmt(cuts[2])}`);
        for (const bk of bucketsRaw) {
          wins.push(bk.filter(p => p.roi > 0).length);
          totals.push(bk.length);
        }
      }
    }
    const pct = totals.map((t, i) => t > 0 ? +(wins[i] / t * 100).toFixed(1) : 0);

    charts["chart-winrate-by-rate"] = new Chart(document.getElementById("chart-winrate-by-rate"), {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Win rate",
          data: pct,
          backgroundColor: pct.map((_, i) => rgba(PALETTE[i % PALETTE.length], 0.75)),
          borderColor: pct.map((_, i) => rgba(PALETTE[i % PALETTE.length], 1)),
          borderWidth: 1,
        }],
      },
      options: {
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: "end", align: "end", offset: 2, clip: false,
            color: "rgb(28,25,23)", font: { weight: "600", size: 11 },
            formatter: (v, ctx) => totals[ctx.dataIndex] > 0
              ? `${v}% (${wins[ctx.dataIndex]}/${totals[ctx.dataIndex]})`
              : "",
          },
        },
        layout: { padding: { top: 22, bottom: 8 } },
        scales: {
          x: { title: { display: true, text: `Rate bucket${ddUnit ? ` (${ddUnit})` : ""}` } },
          y: { beginAtZero: true, max: 100, title: { display: true, text: "% with ROI > 0" } },
        },
      },
    });
  }

  function renderTable(rows) {
    const thead = document.getElementById("thead-row");
    thead.innerHTML = COLS.map(([k, label]) => {
      const arrow = sortKey === k ? (sortDir > 0 ? " ▲" : " ▼") : "";
      return `<th data-key="${k}">${label}${arrow}</th>`;
    }).join("");
    thead.querySelectorAll("th").forEach(th => {
      th.addEventListener("click", () => {
        const k = th.dataset.key;
        if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = -1; }
        renderTable(rows);
      });
    });

    const sorted = [...rows].sort((a,b) => {
      const va = a[sortKey], vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sortDir;
      return String(va).localeCompare(String(vb)) * sortDir;
    });

    const tbody = document.getElementById("tbody");
    tbody.innerHTML = sorted.map(r => {
      const rowClass = "cursor-pointer" + (r.deleted_at ? " trial-deleted" : "");
      return `<tr data-id="${escapeHtml(r.id)}" class="${rowClass}">` + COLS.map(([k, _, type, mode]) => {
      let v = r[k];
      if (v == null || v === "") return `<td></td>`;
      let cls = type === "num" ? "num" : "";
      let display = v;
      if (type === "num" && typeof v === "number") {
        if (mode === "pct") display = (v * 100).toFixed(1) + "%";
        else display = (+v).toLocaleString(undefined, { maximumFractionDigits: 2 });
        if (mode === "delta") cls += v > 0 ? " pos" : v < 0 ? " neg" : "";
      } else {
        display = escapeHtml(String(v));
      }
      return `<td class="${cls}">${display}</td>`;
    }).join("") + "</tr>";
    }).join("");

    tbody.querySelectorAll("tr[data-id]").forEach(tr => {
      tr.addEventListener("click", () => {
        const row = allRows.find(x => x.id === tr.dataset.id);
        if (row) openEditDrawer(row);
      });
    });

    document.getElementById("row-count").textContent = `(${sorted.length})`;
  }

  // ---------- EXPORT ----------
  document.getElementById("export-csv").addEventListener("click", () => {
    const rows = getFiltered();
    if (!rows.length) { alert("No rows to export."); return; }
    const headers = COLS.map(c => c[0]);
    const csv = [headers.join(",")].concat(
      rows.map(r => headers.map(h => csvCell(r[h])).join(","))
    ).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trials_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  function csvCell(v) {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  // ---------- WIRE FILTERS ----------
  for (const id of ["f-year","f-crop","f-state","f-treatment-type","f-sales-rep"]) {
    document.getElementById(id).addEventListener("change", render);
  }
  document.getElementById("f-search").addEventListener("input", render);

  // ---------- CROP PRICES ----------
  const priceInputs = { Corn: "p-corn", SB: "p-sb", Wheat: "p-wheat", Other: "p-other" };
  function syncPriceInputs() {
    for (const [crop, id] of Object.entries(priceInputs)) {
      const el = document.getElementById(id);
      if (el) el.value = cropPrices[crop] ?? "";
    }
  }
  syncPriceInputs();
  for (const [crop, id] of Object.entries(priceInputs)) {
    document.getElementById(id).addEventListener("input", (e) => {
      const v = parseFloat(e.target.value);
      cropPrices[crop] = Number.isFinite(v) ? v : 0;
      saveCropPrices();
      render();
    });
  }
  document.getElementById("p-reset").addEventListener("click", () => {
    cropPrices = { ...cfg.CROP_PRICE };
    saveCropPrices();
    syncPriceInputs();
    render();
  });

  // ---------- COST OVERRIDE ----------
  const overrideWrap = document.getElementById("cost-override-wrap");
  const overrideInput = document.getElementById("cost-override");
  const overrideClear = document.getElementById("cost-override-clear");

  function updateOverrideVisibility() {
    const eligible = productExclusive && selectedProducts.size > 0;
    overrideWrap.classList.toggle("hidden", !eligible);
    if (!eligible && costOverride != null) {
      costOverride = null;
      overrideInput.value = "";
    }
  }

  overrideInput.addEventListener("input", () => {
    const v = parseFloat(overrideInput.value);
    costOverride = Number.isFinite(v) ? v : null;
    render();
  });
  overrideClear.addEventListener("click", () => {
    costOverride = null;
    overrideInput.value = "";
    render();
  });

  // ---------- PRODUCTS MULTI-SELECT ----------
  const pBtn = document.getElementById("f-products-btn");
  const pPanel = document.getElementById("f-products-panel");
  const pSearch = document.getElementById("f-products-search");
  const pList = document.getElementById("f-products-list");
  const pSummary = document.getElementById("f-products-summary");
  const pCount = document.getElementById("f-products-count");
  const pClear = document.getElementById("f-products-clear");

  pBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    pPanel.classList.toggle("hidden");
    if (!pPanel.classList.contains("hidden")) pSearch.focus();
  });

  document.addEventListener("click", (e) => {
    if (!document.getElementById("f-products-wrap").contains(e.target)) {
      pPanel.classList.add("hidden");
    }
  });

  pPanel.addEventListener("click", (e) => e.stopPropagation());

  pSearch.addEventListener("input", () => populateProductsList(pSearch.value));

  pClear.addEventListener("click", () => {
    selectedProducts.clear();
    productRateFilters = {};
    populateProductsList(pSearch.value);
    updateProductSummary();
    renderRateFilters();
    updateOverrideVisibility();
    render();
  });

  const pExclusive = document.getElementById("f-products-exclusive");
  pExclusive.addEventListener("change", () => {
    productExclusive = pExclusive.checked;
    updateProductSummary();
    updateOverrideVisibility();
    render();
  });

  function populateProductsList(filterText = "") {
    const all = uniqueProducts(allRows);
    const q = filterText.trim().toLowerCase();
    const visible = q ? all.filter(p => p.toLowerCase().includes(q)) : all;

    pList.innerHTML = visible.map(p => {
      const key = p.toLowerCase();
      const checked = selectedProducts.has(key) ? "checked" : "";
      return `<label class="flex items-center gap-2 text-sm cursor-pointer py-0.5 hover:bg-stone-50 rounded px-1">
        <input type="checkbox" data-key="${escapeHtml(key)}" ${checked} class="rounded" />
        <span>${escapeHtml(p)}</span>
      </label>`;
    }).join("") || `<p class="text-xs text-stone-500 py-2">No matches.</p>`;

    pList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", () => {
        const k = cb.dataset.key;
        if (cb.checked) {
          selectedProducts.add(k);
        } else {
          selectedProducts.delete(k);
          delete productRateFilters[k];
        }
        updateProductSummary();
        renderRateFilters();
        updateOverrideVisibility();
        render();
      });
    });

    pCount.textContent = String(selectedProducts.size);
  }

  function renderRateFilters() {
    const wrap = document.getElementById("rate-filters");
    const list = document.getElementById("rate-filters-list");
    const sel = [...selectedProducts];
    if (sel.length === 0) {
      wrap.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    wrap.classList.remove("hidden");
    const displayMap = new Map(uniqueProducts(allRows).map(p => [p.toLowerCase(), p]));
    // Collect available units per product for nicer dropdowns.
    const unitsByProduct = {};
    for (const r of allRows) {
      for (const s of (r._slots ?? [])) {
        const key = s.product.toLowerCase();
        if (!unitsByProduct[key]) unitsByProduct[key] = new Set();
        if (s.unit) unitsByProduct[key].add(s.unit);
      }
    }
    list.innerHTML = sel.map(p => {
      const display = displayMap.get(p) ?? p;
      const units = [...(unitsByProduct[p] ?? [])].sort();
      const rf = productRateFilters[p] ?? {};
      const unitOpts = `<option value="">any unit</option>` +
        units.map(u => `<option value="${escapeHtml(u)}" ${rf.unit === u ? "selected" : ""}>${escapeHtml(u)}</option>`).join("");
      return `
        <div class="grid grid-cols-12 gap-1 items-center text-xs" data-product="${escapeHtml(p)}">
          <span class="col-span-4 truncate font-medium text-stone-800" title="${escapeHtml(display)}">${escapeHtml(display)}</span>
          <input class="rate-min inp !py-1 col-span-2 text-xs" placeholder="min" type="number" step="any" value="${rf.min ?? ""}" />
          <input class="rate-max inp !py-1 col-span-2 text-xs" placeholder="max" type="number" step="any" value="${rf.max ?? ""}" />
          <select class="rate-unit inp !py-1 col-span-4 text-xs">${unitOpts}</select>
        </div>`;
    }).join("");

    list.querySelectorAll("[data-product]").forEach(row => {
      const p = row.dataset.product;
      const readAndRender = () => {
        const minRaw = row.querySelector(".rate-min").value.trim();
        const maxRaw = row.querySelector(".rate-max").value.trim();
        const unit = row.querySelector(".rate-unit").value.trim();
        const min = minRaw ? parseFloat(minRaw) : null;
        const max = maxRaw ? parseFloat(maxRaw) : null;
        if (min == null && max == null && !unit) delete productRateFilters[p];
        else productRateFilters[p] = { min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null, unit: unit || null };
        render();
      };
      row.querySelectorAll("input, select").forEach(el => el.addEventListener("input", readAndRender));
      row.querySelectorAll("select").forEach(el => el.addEventListener("change", readAndRender));
    });
  }

  function updateProductSummary() {
    const n = selectedProducts.size;
    if (n === 0) {
      pSummary.textContent = "Any treatment";
      pSummary.className = "truncate text-stone-500";
      return;
    }
    const all = uniqueProducts(allRows);
    const display = all.filter(p => selectedProducts.has(p.toLowerCase()));
    const joined = display.join(" + ");
    const base = joined.length > 60 ? `${display.length} products` : joined;
    pSummary.textContent = productExclusive ? `Only: ${base}` : base;
    pSummary.className = "truncate text-stone-900 font-medium";
  }

  // ---------- EDIT DRAWER ----------
  const drawer = document.getElementById("edit-drawer");
  const backdrop = document.getElementById("edit-backdrop");
  const editForm = document.getElementById("edit-form");
  const editStatus = document.getElementById("edit-status");
  const editDeleteBtn = document.getElementById("edit-delete");
  const editSaveBtn = document.getElementById("edit-save");

  let currentEditId = null;
  let deleteArmed = false;

  // Fields the drawer can edit. Locked fields (id, key_id, trial_num, year, created_at, deleted_at) are NOT here.
  // Note: size is set via the size_over_10 control (Yes/No) and translated to Large/Small.
  // Note: treatment_with_rate is rebuilt from the 5 product slots on save.
  const EDITABLE = [
    "sales_rep","zip_code","state","location","latitude","longitude",
    "rep","spatial_data",
    "crop","treatment_type","growth_stage_applied","check_trt",
    "product_names",
    "check_yield","trt_yield","std_dev",
    "product_cost","application_cost",
    "customer_info",
  ];
  const NUMERIC = new Set([
    "latitude","longitude","check_yield","trt_yield","std_dev",
    "product_cost","application_cost",
  ]);
  const UNITS = ["gal", "fl oz", "lbs", "dry oz"];

  // ----- Product slots inside the drawer -----
  const editProductList = document.getElementById("edit-product-list");

  function createEditProductRow(prefill = {}) {
    const row = document.createElement("div");
    row.className = "rounded-lg border border-stone-200 bg-stone-50 p-2 grid grid-cols-12 gap-2";
    row.innerHTML = `
      <label class="block col-span-12 sm:col-span-6">
        <span class="lbl">Product</span>
        <input type="text" class="inp product-name" />
      </label>
      <label class="block col-span-6 sm:col-span-3">
        <span class="lbl">Rate</span>
        <input type="number" step="any" class="inp product-rate" />
      </label>
      <label class="block col-span-6 sm:col-span-3">
        <span class="lbl">Unit</span>
        <select class="inp product-unit">
          <option value=""></option>
          ${UNITS.map(u => `<option>${u}</option>`).join("")}
        </select>
      </label>`;
    row.querySelector(".product-name").value = prefill.product ?? "";
    row.querySelector(".product-rate").value = prefill.rate ?? "";
    const unitSel = row.querySelector(".product-unit");
    if (prefill.unit) {
      // Allow values outside the standard list (legacy data).
      if (!UNITS.includes(prefill.unit)) {
        unitSel.insertAdjacentHTML("beforeend", `<option>${escapeHtml(prefill.unit)}</option>`);
      }
      unitSel.value = prefill.unit;
    }
    return row;
  }

  function parseTreatmentString(str) {
    if (!str) return [];
    return str.split(/\s*\+\s*/).map(part => {
      const m = part.match(/^(.+?)\s*@\s*([\d.]+)\s*(.*)$/);
      if (m) return { product: m[1].trim(), rate: parseFloat(m[2]), unit: m[3].trim() || null };
      return { product: part.trim(), rate: null, unit: null };
    });
  }

  function loadEditProductSlots(row) {
    editProductList.innerHTML = "";
    // Prefer the structured columns; fall back to parsed legacy string.
    const slots = [];
    for (let i = 1; i <= 5; i++) {
      if (row[`product_${i}`]) {
        slots.push({ product: row[`product_${i}`], rate: row[`rate_${i}`], unit: row[`unit_${i}`] });
      }
    }
    const filled = slots.length > 0 ? slots : parseTreatmentString(row.treatment_with_rate).slice(0, 5);
    // Always render exactly 5 rows so the user can fill in the rest.
    for (let i = 0; i < 5; i++) {
      editProductList.appendChild(createEditProductRow(filled[i] ?? {}));
    }
  }

  function gatherEditProductSlots() {
    const out = {};
    const rows = [...editProductList.children];
    const parts = [];
    for (let i = 1; i <= 5; i++) {
      const r = rows[i - 1];
      const name = r?.querySelector(".product-name").value.trim() || null;
      const rateRaw = r?.querySelector(".product-rate").value.trim() || "";
      const unit = r?.querySelector(".product-unit").value.trim() || null;
      const rate = rateRaw ? parseFloat(rateRaw) : null;
      out[`product_${i}`] = name;
      out[`rate_${i}`] = Number.isFinite(rate) ? rate : null;
      out[`unit_${i}`] = unit;
      if (name) {
        if (Number.isFinite(rate) && unit) parts.push(`${name} @ ${rate} ${unit}`);
        else if (Number.isFinite(rate)) parts.push(`${name} @ ${rate}`);
        else parts.push(name);
      }
    }
    out.treatment_with_rate = parts.join(" + ") || null;
    return out;
  }

  function openEditDrawer(row) {
    currentEditId = row.id;
    deleteArmed = false;
    setEditStatus(
      row.deleted_at ? `Soft-deleted on ${new Date(row.deleted_at).toLocaleString()}.` : "",
      row.deleted_at ? "info" : "info"
    );
    setDeleteButton(row.deleted_at ? "restore" : "delete");

    document.getElementById("edit-trial-num").textContent = row.trial_num ?? "—";
    document.getElementById("edit-year").textContent = row.year ?? "—";
    document.getElementById("edit-key-id").textContent = row.key_id ?? "—";

    for (const name of EDITABLE) {
      const el = editForm.elements[name];
      if (!el) continue;
      el.value = row[name] == null ? "" : row[name];
    }
    // Read-only preview of the auto-built treatment string.
    if (editForm.elements.treatment_with_rate) {
      editForm.elements.treatment_with_rate.value = row.treatment_with_rate ?? "";
    }
    // Map size (Large/Small) to the Over 10 acres? Yes/No control.
    editForm.elements.size_over_10.value =
      row.size === "Large" ? "Yes" : row.size === "Small" ? "No" : "";

    loadEditProductSlots(row);

    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    drawer.scrollTop = 0;
  }

  function setDeleteButton(mode) {
    // mode = "delete" | "delete-armed" | "restore"
    if (mode === "delete") {
      editDeleteBtn.textContent = "Delete";
      editDeleteBtn.className = "rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50";
    } else if (mode === "delete-armed") {
      editDeleteBtn.textContent = "Confirm delete?";
      editDeleteBtn.className = "rounded-lg border border-red-600 bg-red-600 text-white px-3 py-2 text-sm";
    } else if (mode === "restore") {
      editDeleteBtn.textContent = "Restore";
      editDeleteBtn.className = "rounded-lg border border-emerald-600 bg-white px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50";
    }
  }

  function closeDrawer() {
    drawer.classList.add("hidden");
    backdrop.classList.add("hidden");
    currentEditId = null;
  }

  function setEditStatus(msg, kind) {
    editStatus.textContent = msg;
    editStatus.className = "text-sm " + ({
      ok: "text-emerald-700", err: "text-red-600", info: "text-stone-600",
    }[kind] ?? "");
  }

  document.getElementById("edit-close").addEventListener("click", closeDrawer);
  document.getElementById("edit-cancel").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !drawer.classList.contains("hidden")) closeDrawer();
  });

  // Recompute economics using DEFAULT crop prices (not the dashboard override),
  // so stored values stay consistent. The dashboard re-applies its overrides on render.
  function recomputeEconomics(row) {
    const price = cfg.CROP_PRICE[row.crop] ?? 0;
    const ck = row.check_yield, tr = row.trt_yield;
    row.trt_increase = (ck != null && tr != null) ? +(tr - ck).toFixed(2) : null;
    row.pct_increase = (ck != null && tr != null && ck !== 0)
      ? +((tr - ck) / ck).toFixed(6) : null;
    const pc = row.product_cost, ac = row.application_cost;
    row.trt_cost = (pc != null || ac != null)
      ? +(((pc ?? 0) + (ac ?? 0))).toFixed(2) : null;
    row.dollar_per_acre_increase = (row.trt_increase != null && price)
      ? +(row.trt_increase * price).toFixed(2) : null;
    row.net_per_acre = (row.dollar_per_acre_increase != null && row.trt_cost != null)
      ? +(row.dollar_per_acre_increase - row.trt_cost).toFixed(2) : null;
    row.roi = (row.net_per_acre != null && row.trt_cost != null && row.trt_cost > 0)
      ? +(row.net_per_acre / row.trt_cost).toFixed(4) : null;
    return row;
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentEditId) return;
    editSaveBtn.disabled = true; editSaveBtn.textContent = "Saving…";
    setEditStatus("", "info");

    const update = {};
    for (const name of EDITABLE) {
      const el = editForm.elements[name];
      if (!el) continue;
      const raw = el.value.trim();
      if (raw === "") { update[name] = null; continue; }
      update[name] = NUMERIC.has(name) ? parseFloat(raw) : raw;
    }
    // Size mapping (Yes/No -> Large/Small).
    const sizeChoice = editForm.elements.size_over_10.value;
    update.size = sizeChoice === "Yes" ? "Large" : sizeChoice === "No" ? "Small" : null;
    // Pull the structured product slots and rebuild treatment_with_rate.
    Object.assign(update, gatherEditProductSlots());
    // Recompute derived $-fields from new raw inputs.
    recomputeEconomics(update);

    const { error } = await supabase.from("trials").update(update).eq("id", currentEditId);

    editSaveBtn.disabled = false; editSaveBtn.textContent = "Save";
    if (error) { setEditStatus("Error: " + error.message, "err"); return; }

    setEditStatus("Saved.", "ok");
    await loadData();
    setTimeout(closeDrawer, 400);
  });

  editDeleteBtn.addEventListener("click", async () => {
    if (!currentEditId) return;
    const row = allRows.find(x => x.id === currentEditId);
    const isDeleted = !!(row && row.deleted_at);

    // Restore: one-step, no confirmation.
    if (isDeleted) {
      editDeleteBtn.disabled = true;
      const { error } = await supabase
        .from("trials").update({ deleted_at: null }).eq("id", currentEditId);
      editDeleteBtn.disabled = false;
      if (error) { setEditStatus("Error: " + error.message, "err"); return; }
      await loadData();
      closeDrawer();
      return;
    }

    // Delete: two-step.
    if (!deleteArmed) {
      deleteArmed = true;
      setDeleteButton("delete-armed");
      setTimeout(() => {
        if (deleteArmed) { deleteArmed = false; setDeleteButton("delete"); }
      }, 4000);
      return;
    }
    editDeleteBtn.disabled = true;
    const { error } = await supabase
      .from("trials")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", currentEditId);
    editDeleteBtn.disabled = false;
    if (error) { setEditStatus("Error: " + error.message, "err"); return; }
    await loadData();
    closeDrawer();
  });

  // ---------- DEEP DIVE WIRING ----------
  document.getElementById("dd-product").addEventListener("change", (e) => {
    ddProduct = e.target.value;
    refreshDeepDiveUnits();
    render();
  });
  document.getElementById("dd-unit").addEventListener("change", (e) => {
    ddUnit = e.target.value;
    render();
  });

  // ---------- SHOW DELETED TOGGLE ----------
  const showDeletedToggle = document.getElementById("f-show-deleted");
  showDeletedToggle.addEventListener("change", async () => {
    showDeleted = showDeletedToggle.checked;
    await loadData();
  });

  init();
})();
