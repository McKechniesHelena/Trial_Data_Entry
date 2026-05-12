(() => {
  const cfg = window.APP_CONFIG;
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const form = document.getElementById("trial-form");
  const status = document.getElementById("submit-status");
  const submitBtn = document.getElementById("submit-btn");
  const zipResolved = document.getElementById("zip-resolved");

  // Prefill year + remembered sales rep + zip.
  form.elements.year.value = new Date().getFullYear();
  const rememberedRep = localStorage.getItem("sales_rep");
  if (rememberedRep) form.elements.sales_rep.value = rememberedRep;
  const rememberedZip = localStorage.getItem("zip_code");
  if (rememberedZip) {
    form.elements.zip_code.value = rememberedZip;
    lookupZip(rememberedZip);
  }

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

    const row = {
      // trial_num + key_id are filled in by a Postgres trigger
      rep: f.rep.value || null,
      crop: f.crop.value || null,
      check_yield: checkY,
      trt_yield: trtY,
      trt_increase,
      pct_increase,
      check_trt: f.check_trt.value || null,
      treatment_type: f.treatment_type.value || null,
      treatment_with_rate: f.treatment_with_rate.value || null,
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
      customer_info: f.customer_info.value || null,
      size: f.size.value || null,
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
    localStorage.setItem("zip_code", zip);

    setStatus("Submitted! Trial # will appear on the dashboard.", "ok");

    // Keep year + sales rep + zip, clear the rest.
    const keep = {
      year: f.year.value,
      sales_rep: f.sales_rep.value,
      zip_code: f.zip_code.value,
    };
    form.reset();
    f.year.value = keep.year;
    f.sales_rep.value = keep.sales_rep;
    f.zip_code.value = keep.zip_code;
    if (keep.zip_code) showZipResult(zipCache[keep.zip_code] ?? { error: "stale" });
    recalc();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();
