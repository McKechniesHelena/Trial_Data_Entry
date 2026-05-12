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
  let costOverride = null; // number or null
  let cropPrices = loadCropPrices();

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
    const { data, error } = await supabase
      .from("trials")
      .select("*")
      .is("deleted_at", null)
      .order("key_id", { ascending: false })
      .limit(10000);
    if (error) { alert("Error loading data: " + error.message); return; }
    allRows = data ?? [];
    // Pre-parse products once per row so filters/render don't redo work.
    for (const r of allRows) r._products = parseProducts(r.treatment_with_rate);
    populateFilters(allRows);
    populateProductsList();
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
        const rowSet = new Set((r._products ?? []).map(p => p.toLowerCase()));
        if (!sel.every(p => rowSet.has(p))) return false;
        if (productExclusive && rowSet.size !== sel.length) return false;
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
    tbody.innerHTML = sorted.map(r => `<tr data-id="${escapeHtml(r.id)}" class="cursor-pointer">` + COLS.map(([k, _, type, mode]) => {
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
    }).join("") + "</tr>").join("");

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
    populateProductsList(pSearch.value);
    updateProductSummary();
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
        if (cb.checked) selectedProducts.add(k); else selectedProducts.delete(k);
        updateProductSummary();
        updateOverrideVisibility();
        render();
      });
    });

    pCount.textContent = String(selectedProducts.size);
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
  const EDITABLE = [
    "sales_rep","size","zip_code","state","location","latitude","longitude",
    "rep","spatial_data",
    "crop","treatment_type","growth_stage_applied","check_trt",
    "treatment_with_rate","product_names",
    "check_yield","trt_yield","std_dev",
    "product_cost","application_cost",
    "customer_info",
  ];
  const NUMERIC = new Set([
    "latitude","longitude","check_yield","trt_yield","std_dev",
    "product_cost","application_cost",
  ]);

  function openEditDrawer(row) {
    currentEditId = row.id;
    deleteArmed = false;
    editDeleteBtn.textContent = "Delete";
    editDeleteBtn.className = "rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50";
    setEditStatus("", "info");

    document.getElementById("edit-trial-num").textContent = row.trial_num ?? "—";
    document.getElementById("edit-year").textContent = row.year ?? "—";
    document.getElementById("edit-key-id").textContent = row.key_id ?? "—";

    for (const name of EDITABLE) {
      const el = editForm.elements[name];
      if (!el) continue;
      el.value = row[name] == null ? "" : row[name];
    }

    drawer.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    drawer.scrollTop = 0;
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
    if (!deleteArmed) {
      deleteArmed = true;
      editDeleteBtn.textContent = "Confirm delete?";
      editDeleteBtn.className = "rounded-lg border border-red-600 bg-red-600 text-white px-3 py-2 text-sm";
      setTimeout(() => {
        if (deleteArmed) {
          deleteArmed = false;
          editDeleteBtn.textContent = "Delete";
          editDeleteBtn.className = "rounded-lg border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-50";
        }
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

  init();
})();
