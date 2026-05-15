(() => {
  const cfg = window.APP_CONFIG;
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const form = document.getElementById("trial-form");
  const status = document.getElementById("submit-status");
  const submitBtn = document.getElementById("submit-btn");
  const zipResolved = document.getElementById("zip-resolved");

  // ---------- PRODUCT ROWS ----------
  const MAX_PRODUCTS = 5;
  const UNITS = ["gal", "qt", "pt", "fl oz", "lbs", "dry oz"];
  const productList = document.getElementById("product-list");
  const addProductBtn = document.getElementById("add-product");

  function createProductRow() {
    const row = document.createElement("div");
    row.className = "product-row rounded-lg border border-stone-200 bg-stone-50 p-3 relative";
    row.innerHTML = `
      <button type="button" class="remove-product absolute top-2 right-2 text-stone-400 hover:text-red-600 text-lg leading-none px-1" aria-label="Remove product">×</button>
      <label class="block mb-2">
        <span class="lbl">Product</span>
        <input type="text" class="inp product-name" placeholder="e.g. Avaris 2XS" />
      </label>
      <div class="grid grid-cols-2 gap-2">
        <label class="block">
          <span class="lbl">Rate</span>
          <input type="number" step="any" inputmode="decimal" class="inp product-rate" />
        </label>
        <label class="block">
          <span class="lbl">Unit</span>
          <select class="inp product-unit">
            <option value=""></option>
            ${UNITS.map(u => `<option>${u}</option>`).join("")}
          </select>
        </label>
      </div>
    `;
    row.querySelector(".remove-product").addEventListener("click", () => removeProductRow(row));
    productList.appendChild(row);
    syncProductControls();
    return row;
  }
  function removeProductRow(row) {
    if (productList.children.length <= 1) return;
    row.remove();
    syncProductControls();
  }
  function syncProductControls() {
    const n = productList.children.length;
    addProductBtn.disabled = n >= MAX_PRODUCTS;
    addProductBtn.classList.toggle("opacity-50", n >= MAX_PRODUCTS);
    productList.querySelectorAll(".remove-product").forEach(b => {
      b.style.visibility = n > 1 ? "visible" : "hidden";
    });
  }
  function resetProductRows() {
    productList.innerHTML = "";
    createProductRow();
  }
  function buildTreatmentString() {
    const parts = [];
    for (const row of productList.children) {
      const name = row.querySelector(".product-name").value.trim();
      if (!name) continue;
      const rate = row.querySelector(".product-rate").value.trim();
      const unit = row.querySelector(".product-unit").value.trim();
      if (rate && unit) parts.push(`${name} @ ${rate} ${unit}`);
      else if (rate) parts.push(`${name} @ ${rate}`);
      else parts.push(name);
    }
    return parts.join(" + ");
  }
  addProductBtn.addEventListener("click", () => {
    if (productList.children.length >= MAX_PRODUCTS) return;
    createProductRow();
  });
  createProductRow(); // start with one row

  // Prefill year + remembered sales rep + zip.
  form.elements.year.value = new Date().getFullYear();
  const rememberedRep = localStorage.getItem("sales_rep");
  if (rememberedRep) form.elements.sales_rep.value = rememberedRep;
  const rememberedBranch = localStorage.getItem("branch");
  if (rememberedBranch) form.elements.branch.value = rememberedBranch;
  const rememberedZip = localStorage.getItem("zip_code");
  if (rememberedZip) {
    form.elements.zip_code.value = rememberedZip;
    lookupZip(rememberedZip);
  }

  // Branch suggestions: build a local history of branches this phone has used.
  function refreshBranchSuggestions() {
    const seen = JSON.parse(localStorage.getItem("branch_history") || "[]");
    const dl = document.getElementById("branch-suggest");
    dl.innerHTML = seen.map(b => `<option value="${String(b).replace(/"/g, "&quot;")}"></option>`).join("");
  }
  refreshBranchSuggestions();

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  // ---------- Zip lookup ----------
  let zipCache = {}; // "55104" -> { city, state, lat, lng } or { error: "..." }
  let zipDebounce = null;

  async function lookupZip(zip) {
    zip = (zip || "").trim();
    if (!/^\d{5}$/.test(zip)) {
      zipResolved.textContent = "Enter a 5-digit US zip to look up location.";
      zipResolved.className = "mt-1 block text-xs text-stone-500";
      return null;
    }
    if (zipCache[zip]) {
      showZipResult(zipCache[zip]);
      return zipCache[zip];
    }
    zipResolved.textContent = "Looking up…";
    zipResolved.className = "mt-1 block text-xs text-stone-500";
    try {
      const res = await fetch(`https://api.zippopotam.us/us/${zip}`);
      if (!res.ok) throw new Error(res.status === 404 ? "Zip not found" : `HTTP ${res.status}`);
      const data = await res.json();
      const p = data.places && data.places[0];
      if (!p) throw new Error("No place data");
      const result = {
        city: p["place name"],
        state: p["state abbreviation"],
        lat: parseFloat(p.latitude),
        lng: parseFloat(p.longitude),
      };
      zipCache[zip] = result;
      showZipResult(result);
      return result;
    } catch (e) {
      const result = { error: e.message };
      zipCache[zip] = result;
      showZipResult(result);
      return result;
    }
  }

  function showZipResult(r) {
    if (r.error) {
      zipResolved.textContent = `Couldn't resolve zip: ${r.error}. You can still submit.`;
      zipResolved.className = "mt-1 block text-xs text-amber-600";
    } else {
      zipResolved.textContent = `${r.city}, ${r.state} (${r.lat.toFixed(3)}, ${r.lng.toFixed(3)})`;
      zipResolved.className = "mt-1 block text-xs text-emerald-700";
    }
  }

  form.elements.zip_code.addEventListener("input", (e) => {
    clearTimeout(zipDebounce);
    const v = e.target.value;
    zipDebounce = setTimeout(() => lookupZip(v), 400);
  });

  // ---------- Recalculate ----------
  function recalc() {
    const f = form.elements;
    const checkY = num(f.check_yield.value);
    const trtY = num(f.trt_yield.value);
    const prodCost = num(f.product_cost.value);
    const appCost = num(f.application_cost.value);
    const price = cfg.CROP_PRICE[f.crop.value] ?? 0;

    let trtInc = null, pctInc = null, trtCost = null, dollarInc = null, net = null, roi = null;

    if (checkY != null && trtY != null) {
      trtInc = +(trtY - checkY).toFixed(2);
      if (checkY !== 0) pctInc = +((trtY - checkY) / checkY * 100).toFixed(2);
    }
    if (prodCost != null || appCost != null) {
      trtCost = +(((prodCost ?? 0) + (appCost ?? 0))).toFixed(2);
    }
    if (trtInc != null && price) {
      dollarInc = +(trtInc * price).toFixed(2);
    }
    if (dollarInc != null && trtCost != null) {
      net = +(dollarInc - trtCost).toFixed(2);
      if (trtCost > 0) roi = +(net / trtCost).toFixed(2);
    }

    f.trt_increase.value = trtInc ?? "";
    f.pct_increase.value = pctInc != null ? `${pctInc}%` : "";
    f.trt_cost.value = trtCost != null ? `$${trtCost}` : "";
    f.dollar_per_acre_increase.value = dollarInc != null ? `$${dollarInc}` : "";
    f.net_per_acre.value = net != null ? `$${net}` : "";
    f.roi.value = roi != null ? `${(roi * 100).toFixed(0)}%` : "";
  }

  form.addEventListener("input", recalc);
  form.addEventListener("change", recalc);
  recalc();

  function setStatus(msg, kind) {
    status.textContent = msg;
    status.className = "text-sm " + ({
      ok: "text-emerald-700",
      err: "text-red-600",
      info: "text-stone-600",
    }[kind] ?? "");
  }

  // ---------- Submit ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    setStatus("", "info");

    const f = form.elements;
    const zip = f.zip_code.value.trim();
    const zipResult = await lookupZip(zip);

    const checkY = num(f.check_yield.value);
    const trtY = num(f.trt_yield.value);
    const prodCost = num(f.product_cost.value);
    const appCost = num(f.application_cost.value);
    const price = cfg.CROP_PRICE[f.crop.value] ?? 0;
    const year = num(f.year.value);

    const trt_increase = (checkY != null && trtY != null) ? +(trtY - checkY).toFixed(2) : null;
    const pct_increase = (checkY != null && trtY != null && checkY !== 0)
      ? +((trtY - checkY) / checkY).toFixed(6) : null;
    const trt_cost = (prodCost != null || appCost != null)
      ? +(((prodCost ?? 0) + (appCost ?? 0))).toFixed(2) : null;
    const dollar_per_acre_increase = (trt_increase != null && price)
      ? +(trt_increase * price).toFixed(2) : null;
    const net_per_acre = (dollar_per_acre_increase != null && trt_cost != null)
      ? +(dollar_per_acre_increase - trt_cost).toFixed(2) : null;
    const roi = (net_per_acre != null && trt_cost != null && trt_cost > 0)
      ? +(net_per_acre / trt_cost).toFixed(4) : null;

    // Pull structured product slots (1..5) from the dynamic rows.
    const productCols = {};
    const productRows = [...productList.children];
    for (let i = 1; i <= 5; i++) {
      const rowEl = productRows[i - 1];
      if (rowEl) {
        const name = rowEl.querySelector(".product-name").value.trim() || null;
        const rateRaw = rowEl.querySelector(".product-rate").value.trim();
        const unit = rowEl.querySelector(".product-unit").value.trim() || null;
        productCols[`product_${i}`] = name;
        productCols[`rate_${i}`] = rateRaw ? parseFloat(rateRaw) : null;
        productCols[`unit_${i}`] = unit;
      } else {
        productCols[`product_${i}`] = null;
        productCols[`rate_${i}`] = null;
        productCols[`unit_${i}`] = null;
      }
    }

    const sizeOver10 = f.size_over_10.value;
    const sizeStored = sizeOver10 === "Yes" ? "Large" : sizeOver10 === "No" ? "Small" : null;

    const row = {
      // trial_num + key_id are filled in by a Postgres trigger
      ...productCols,
      rep: f.rep.value || null,
      crop: f.crop.value || null,
      check_yield: checkY,
      trt_yield: trtY,
      trt_increase,
      pct_increase,
      check_trt: f.check_trt.value || null,
      treatment_type: f.treatment_type.value || null,
      treatment_with_rate: buildTreatmentString() || null,
      product_cost: prodCost,
      application_cost: appCost,
      trt_cost,
      dollar_per_acre_increase,
      net_per_acre,
      roi,
      growth_stage_applied: f.growth_stage_applied.value || null,
      year,
      zip_code: zip || null,
      state: zipResult && !zipResult.error ? zipResult.state : null,
      location: zipResult && !zipResult.error ? `${zipResult.city}, ${zipResult.state}` : null,
      latitude: zipResult && !zipResult.error ? zipResult.lat : null,
      longitude: zipResult && !zipResult.error ? zipResult.lng : null,
      sales_rep: f.sales_rep.value || null,
      branch: f.branch.value || null,
      customer_info: f.customer_info.value || null,
      size: sizeStored,
      submitted_by: f.sales_rep.value || null,
    };

    const { error } = await supabase.from("trials").insert(row);

    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Trial";

    if (error) {
      setStatus("Error: " + error.message, "err");
      return;
    }

    localStorage.setItem("sales_rep", row.sales_rep ?? "");
    if (row.branch) {
      localStorage.setItem("branch", row.branch);
      const hist = JSON.parse(localStorage.getItem("branch_history") || "[]");
      if (!hist.includes(row.branch)) {
        hist.unshift(row.branch);
        localStorage.setItem("branch_history", JSON.stringify(hist.slice(0, 20)));
        refreshBranchSuggestions();
      }
    }
    localStorage.setItem("zip_code", zip);

    setStatus("Submitted! Trial # will appear on the dashboard.", "ok");

    // Keep year + sales rep + zip, clear the rest.
    const keep = {
      year: f.year.value,
      sales_rep: f.sales_rep.value,
      branch: f.branch.value,
      zip_code: f.zip_code.value,
    };
    form.reset();
    f.year.value = keep.year;
    f.sales_rep.value = keep.sales_rep;
    f.branch.value = keep.branch;
    f.zip_code.value = keep.zip_code;
    if (keep.zip_code) showZipResult(zipCache[keep.zip_code] ?? { error: "stale" });
    resetProductRows();
    recalc();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
