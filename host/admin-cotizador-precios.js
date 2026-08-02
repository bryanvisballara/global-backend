(() => {
  if (window.__adminCotizadorPreciosInitialized) {
    return;
  }
  window.__adminCotizadorPreciosInitialized = true;

  const { fetchJson, setFeedback } = window.AdminApp || {};

  const feedback = document.getElementById("cp-feedback");
  const globalLaborInput = document.getElementById("cp-global-labor");
  const globalAlistamientoInput = document.getElementById("cp-global-alistamiento");
  const saveGlobalButton = document.getElementById("cp-save-global");
  const searchInput = document.getElementById("cp-search");
  const filtersEl = document.getElementById("cp-filters");
  const listEl = document.getElementById("cp-vehicle-list");
  const editorEl = document.getElementById("cp-editor");
  const editorTitle = document.getElementById("cp-editor-title");
  const editorSub = document.getElementById("cp-editor-sub");

  let settingsCache = { laborPrice: 150000, laborAlistamiento: 30000, currency: "COP" };
  let vehiclesCache = [];
  let activeFilter = "needs";
  let selectedVehicleId = "";
  let currentQuote = null;
  let loadingQuote = false;

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function money(value) {
    return `$${Number(value || 0).toLocaleString("es-CO")}`;
  }

  function getQueryVehicleId() {
    try {
      return String(new URLSearchParams(window.location.search).get("vehicleId") || "").trim();
    } catch {
      return "";
    }
  }

  function updateStats(summary = {}) {
    const map = {
      "cp-stat-total": summary.total,
      "cp-stat-ready": summary.ready,
      "cp-stat-needs": summary.needsPricing,
      "cp-stat-miss": summary.missingStock,
    };
    Object.entries(map).forEach(([id, value]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(Number(value || 0));
    });
  }

  function vehicleMatchesFilter(vehicle) {
    if (activeFilter === "ready") return Boolean(vehicle.canService);
    if (activeFilter === "missing") return !vehicle.canService;
    if (activeFilter === "needs") return Boolean(vehicle.needsPricing);
    return true;
  }

  function vehicleMatchesSearch(vehicle, query) {
    if (!query) return true;
    const hay = [
      vehicle.brand,
      vehicle.model,
      vehicle.variantLabel,
      vehicle.engineCode,
      vehicle.yearFrom,
      vehicle.yearTo,
    ].join(" ").toLowerCase();
    return hay.includes(query);
  }

  function getFilteredVehicles() {
    const query = String(searchInput?.value || "").trim().toLowerCase();
    return vehiclesCache.filter((vehicle) =>
      vehicleMatchesFilter(vehicle) && vehicleMatchesSearch(vehicle, query)
    );
  }

  function renderVehicleList() {
    if (!listEl) return;

    const items = getFilteredVehicles();
    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">No hay versiones en este filtro.</div>`;
      return;
    }

    listEl.innerHTML = items.map((vehicle) => {
      const badge = vehicle.needsPricing
        ? `<span class="cp-badge cp-badge-warn">Sin precio</span>`
        : vehicle.canService
          ? `<span class="cp-badge cp-badge-ok">Listo</span>`
          : `<span class="cp-badge cp-badge-miss">Falta stock</span>`;

      const laborNote = vehicle.hasCustomLabor
        ? `Mantenimiento propio ${money(vehicle.effectiveLaborPrice)}`
        : `Mantenimiento ${money(vehicle.effectiveLaborPrice)}`;

      return `
        <button
          class="cp-vehicle-item ${vehicle.id === selectedVehicleId ? "is-selected" : ""}"
          type="button"
          data-vehicle-id="${escapeHtml(vehicle.id)}"
        >
          <strong>${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)}</strong>
          <div class="cp-vehicle-meta">
            <span>${escapeHtml(vehicle.variantLabel || "Sin versión")}</span>
            <span>${vehicle.yearFrom || "?"} – ${vehicle.yearTo || "?"}</span>
            ${badge}
          </div>
          <div class="cp-vehicle-meta" style="margin-top:0.35rem">
            <span>${laborNote}</span>
            <span>Insumos ${money(vehicle.partsCost)}</span>
            <span>Total ${money(vehicle.total)}</span>
          </div>
        </button>
      `;
    }).join("");

    listEl.querySelectorAll("[data-vehicle-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectVehicle(button.dataset.vehicleId || "").catch((error) => {
          setFeedback?.(feedback, error.message, "error");
        });
      });
    });
  }

  function renderEditorEmpty(message) {
    if (editorTitle) editorTitle.textContent = "Editar versión";
    if (editorSub) {
      editorSub.textContent = "Selecciona una versión a la izquierda para fijar su mano de obra y costos de insumos.";
    }
    if (editorEl) {
      editorEl.innerHTML = `<div class="cp-editor-empty">${escapeHtml(message || "Elige una versión para empezar.")}</div>`;
    }
  }

  function computeSalePrice(costTotal, mode, value) {
    const base = Math.max(0, Number(costTotal || 0));
    const amount = Math.max(0, Number(value || 0));
    if (mode === "fixed") return Math.round(amount);
    if (mode === "amount") return Math.round(base + amount);
    if (mode === "percent") return Math.round(base * (1 + (amount / 100)));
    return Math.round(base);
  }

  function getEditorCostTotal(quote) {
    const partsCost = Array.from(editorEl?.querySelectorAll("tr[data-supply-id]") || []).reduce((sum, row) => {
      const qty = Number(row.dataset.qty || 1);
      const unit = Number(row.querySelector(".cp-cost-input")?.value || 0);
      return sum + (qty * unit);
    }, 0);

    const laborMecanico = Number(settingsCache.laborPrice || 0);
    const laborAlistamiento = Number(settingsCache.laborAlistamiento || 0);
    return {
      partsCost: Math.round(partsCost),
      laborMecanico: Math.round(laborMecanico),
      laborAlistamiento: Math.round(laborAlistamiento),
      costTotal: Math.round(partsCost + laborMecanico + laborAlistamiento),
      fallback: quote?.pricing,
    };
  }

  function refreshEditorTotals(quote) {
    const totals = getEditorCostTotal(quote);
    const partsEl = document.getElementById("cp-total-parts");
    const mechEl = document.getElementById("cp-total-mech");
    const alistEl = document.getElementById("cp-total-alist");
    const costEl = document.getElementById("cp-total-cost");
    if (partsEl) partsEl.textContent = money(totals.partsCost);
    if (mechEl) mechEl.textContent = money(totals.laborMecanico);
    if (alistEl) alistEl.textContent = money(totals.laborAlistamiento);
    if (costEl) costEl.textContent = money(totals.costTotal);

    editorEl?.querySelectorAll("tr[data-supply-id]").forEach((row) => {
      const qty = Number(row.dataset.qty || 1);
      const unit = Number(row.querySelector(".cp-cost-input")?.value || 0);
      const lineEl = row.querySelector(".cp-line-cost");
      if (lineEl) lineEl.textContent = money(Math.round(qty * unit));
    });

    const mode = document.querySelector("input[name='cp-sale-mode']:checked")?.value || "fixed";
    const value = document.getElementById("cp-sale-value")?.value;
    const salePreview = document.getElementById("cp-sale-preview");
    if (salePreview) {
      salePreview.textContent = `Precio de venta: ${money(computeSalePrice(totals.costTotal, mode, value))}`;
    }

    const hint = document.getElementById("cp-sale-hint");
    if (hint) {
      if (mode === "fixed") hint.textContent = "Se cotiza exactamente este valor.";
      if (mode === "amount") hint.textContent = `Costo ${money(totals.costTotal)} + monto adicional.`;
      if (mode === "percent") hint.textContent = `Costo ${money(totals.costTotal)} + ese porcentaje.`;
    }
  }

  function renderEditor(quote) {
    if (!quote || !editorEl) {
      renderEditorEmpty();
      return;
    }

    const vehicle = quote.vehicle || {};
    const saleMode = ["fixed", "amount", "percent"].includes(vehicle.salePriceMode)
      ? vehicle.salePriceMode
      : "fixed";
    const saleValue = vehicle.salePriceValue === null || vehicle.salePriceValue === undefined
      ? ""
      : String(Number(vehicle.salePriceValue || 0));

    if (editorTitle) {
      editorTitle.textContent = `${vehicle.brand || ""} ${vehicle.model || ""}`.trim() || "Editar versión";
    }
    if (editorSub) {
      editorSub.textContent = `${vehicle.variantLabel || "Versión"}${vehicle.engineCode ? ` · ${vehicle.engineCode}` : ""} · ${vehicle.yearFrom || "?"} – ${vehicle.yearTo || "?"}`;
    }

    const partsRows = (quote.parts || []).map((part) => {
      const isServiceItem = part.type === "other";
      const title = isServiceItem
        ? (part.typeLabel || part.supply?.specification || part.supply?.name || "Ítem")
        : (part.typeLabel || part.type);
      const subtitle = isServiceItem
        ? ""
        : (part.supply?.specification || part.supply?.oemCode || "");
      const qty = Number(part.quantityValue || 1);
      const unitCost = Number(part.unitCost || 0);

      return `
      <tr data-supply-id="${escapeHtml(part.supply?.id || "")}" data-qty="${qty}">
        <td>
          <strong>${escapeHtml(title)}</strong>
          ${subtitle ? `<div class="cp-sub" style="margin:0.2rem 0 0">${escapeHtml(subtitle)}</div>` : ""}
        </td>
        <td>${escapeHtml(part.quantityLabel || String(qty))}</td>
        <td>
          <input class="cp-stock-input" type="number" min="0" step="1" value="${Number(part.stock || 0)}" ${part.ignoreStock ? "disabled" : ""} />
          <div class="cp-sub" style="margin:0.2rem 0 0">${part.ignoreStock ? "N/A" : (part.enough ? "OK" : "Falta")}</div>
        </td>
        <td>
          <input class="cp-cost-input" type="number" min="0" step="100" value="${unitCost}" />
        </td>
        <td class="cp-line-cost">${money(Math.round(unitCost * qty))}</td>
      </tr>
    `;
    }).join("");

    editorEl.innerHTML = `
      <div class="cp-totals">
        <div class="cp-total-item">
          <span>Insumos</span>
          <strong id="cp-total-parts">${money(quote.pricing?.partsCost)}</strong>
        </div>
        <div class="cp-total-item">
          <span>Mantenimiento</span>
          <strong id="cp-total-mech">${money(quote.pricing?.laborMecanico ?? quote.pricing?.laborPrice)}</strong>
        </div>
        <div class="cp-total-item">
          <span>Alistamiento</span>
          <strong id="cp-total-alist">${money(quote.pricing?.laborAlistamiento || 0)}</strong>
        </div>
        <div class="cp-total-item">
          <span>Costo total</span>
          <strong id="cp-total-cost">${money(quote.pricing?.costTotal ?? quote.pricing?.total)}</strong>
        </div>
      </div>
      <div class="cp-table-wrap">
        <table class="tracking-data-table">
          <thead>
            <tr>
              <th>Insumo</th>
              <th>Cant.</th>
              <th>Stock</th>
              <th>Costo unitario</th>
              <th>Costo línea</th>
            </tr>
          </thead>
          <tbody>
            ${partsRows || `<tr><td colspan="5"><div class="empty-state">Sin insumos en esta ficha.</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="cp-sub" style="margin-top:0.75rem">
        Los costos de insumos se editan en <a href="/app/admin-cotizador-insumos.html">Configurar precios de insumos</a>. Aquí puedes ajustarlos rápido si hace falta; el cambio aplica a todos los carros que usen ese insumo.
      </p>

      <div class="cp-sale-box">
        <h3>Precio de venta</h3>
        <p class="cp-sub" style="margin:0">Cómo quieres cotizar esta versión al cliente.</p>
        <div class="cp-sale-modes">
          <label class="cp-sale-mode">
            <input type="radio" name="cp-sale-mode" value="fixed" ${saleMode === "fixed" ? "checked" : ""} />
            Precio fijo
          </label>
          <label class="cp-sale-mode">
            <input type="radio" name="cp-sale-mode" value="amount" ${saleMode === "amount" ? "checked" : ""} />
            Aumentar un monto
          </label>
          <label class="cp-sale-mode">
            <input type="radio" name="cp-sale-mode" value="percent" ${saleMode === "percent" ? "checked" : ""} />
            Aumentar con %
          </label>
        </div>
        <div class="cp-sale-fields">
          <label>
            <span id="cp-sale-value-label">Valor</span>
            <input id="cp-sale-value" type="number" min="0" step="100" value="${escapeHtml(saleValue)}" placeholder="Ej: 750000" />
          </label>
          <div>
            <p class="cp-sub" id="cp-sale-hint" style="margin:0 0 0.35rem"></p>
            <p class="cp-sale-preview" id="cp-sale-preview">Precio de venta: ${money(quote.pricing?.salePrice ?? quote.pricing?.total)}</p>
          </div>
        </div>
      </div>

      <div class="cp-actions">
        <button id="cp-save-vehicle" class="cp-btn cp-btn-gold" type="button">Guardar esta versión</button>
      </div>
    `;

    const updateSaleLabel = () => {
      const mode = document.querySelector("input[name='cp-sale-mode']:checked")?.value || "fixed";
      const label = document.getElementById("cp-sale-value-label");
      const input = document.getElementById("cp-sale-value");
      if (label) {
        if (mode === "fixed") label.textContent = "Precio fijo (COP)";
        if (mode === "amount") label.textContent = "Monto a sumar (COP)";
        if (mode === "percent") label.textContent = "Porcentaje a sumar (%)";
      }
      if (input) {
        input.step = mode === "percent" ? "0.1" : "100";
        input.placeholder = mode === "percent" ? "Ej: 15" : "Ej: 750000";
      }
      refreshEditorTotals(quote);
    };

    document.getElementById("cp-save-vehicle")?.addEventListener("click", () => {
      saveVehiclePricing().catch((error) => {
        setFeedback?.(feedback, error.message, "error");
      });
    });

    editorEl.querySelectorAll(".cp-cost-input").forEach((input) => {
      input.addEventListener("input", () => refreshEditorTotals(quote));
    });
    editorEl.querySelectorAll("input[name='cp-sale-mode']").forEach((input) => {
      input.addEventListener("change", updateSaleLabel);
    });
    document.getElementById("cp-sale-value")?.addEventListener("input", () => refreshEditorTotals(quote));

    updateSaleLabel();
    document.getElementById("cp-editor-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function selectVehicle(vehicleId) {
    selectedVehicleId = String(vehicleId || "").trim();
    renderVehicleList();

    if (!selectedVehicleId) {
      currentQuote = null;
      renderEditorEmpty();
      return;
    }

    if (loadingQuote) return;
    loadingQuote = true;
    try {
      if (editorEl) {
        editorEl.innerHTML = `<div class="cp-editor-empty">Cargando ficha...</div>`;
      }
      const data = await fetchJson(`/api/admin/cotizador/quote?vehicleId=${encodeURIComponent(selectedVehicleId)}`);
      currentQuote = data.quote || null;
      if (data.settings) {
        settingsCache = data.settings;
      }
      renderEditor(currentQuote);
    } finally {
      loadingQuote = false;
    }
  }

  async function saveGlobalLabor() {
    const laborPrice = Math.max(0, Number(globalLaborInput?.value || 0));
    const laborAlistamiento = Math.max(0, Number(globalAlistamientoInput?.value || 0));
    const result = await fetchJson("/api/admin/cotizador/settings", {
      method: "PATCH",
      body: JSON.stringify({ laborPrice, laborAlistamiento }),
    });
    settingsCache = result.settings || { laborPrice, laborAlistamiento, currency: "COP" };
    setFeedback?.(feedback, "Mano de obra guardada.", "success");
    await loadBoard({ keepSelection: true, keepFilter: true });
  }

  async function saveVehiclePricing() {
    if (!selectedVehicleId) {
      setFeedback?.(feedback, "Selecciona una versión primero.", "error");
      return;
    }

    const supplies = Array.from(editorEl?.querySelectorAll("tr[data-supply-id]") || []).map((row) => ({
      supplyId: row.dataset.supplyId,
      stock: Number(row.querySelector(".cp-stock-input")?.value || 0),
      unitCost: Number(row.querySelector(".cp-cost-input")?.value || 0),
    }));

    const saleMode = document.querySelector("input[name='cp-sale-mode']:checked")?.value || "fixed";
    const saleRaw = String(document.getElementById("cp-sale-value")?.value || "").trim();

    const payload = {
      supplies,
      salePriceMode: saleMode,
      salePriceValue: saleRaw === "" ? null : Number(saleRaw),
    };

    const result = await fetchJson(`/api/admin/cotizador/vehicles/${encodeURIComponent(selectedVehicleId)}/pricing`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });

    currentQuote = result.quote || currentQuote;
    setFeedback?.(feedback, "Precios de la versión guardados.", "success");
    await loadBoard({ keepSelection: true, keepFilter: true });
    renderEditor(currentQuote);
  }

  async function loadBoard(options = {}) {
    const data = await fetchJson("/api/admin/cotizador/pricing");
    settingsCache = data.settings || settingsCache;
    vehiclesCache = data.vehicles || [];
    updateStats(data.summary || {});

    if (globalLaborInput) {
      globalLaborInput.value = String(Number(settingsCache.laborPrice || 0));
    }
    if (globalAlistamientoInput) {
      globalAlistamientoInput.value = String(Number(settingsCache.laborAlistamiento || 0));
    }

    const preferredId = options.vehicleId || (options.keepSelection ? selectedVehicleId : "") || getQueryVehicleId();

    if (!options.keepFilter) {
      if (Number(data.summary?.needsPricing || 0) > 0) {
        activeFilter = "needs";
      } else if (Number(data.summary?.ready || 0) > 0) {
        activeFilter = "ready";
      } else {
        activeFilter = "all";
      }
      filtersEl?.querySelectorAll("[data-filter]").forEach((chip) => {
        chip.classList.toggle("is-active", chip.dataset.filter === activeFilter);
      });
    }

    if (preferredId && vehiclesCache.some((item) => item.id === preferredId)) {
      selectedVehicleId = preferredId;
      renderVehicleList();
      await selectVehicle(preferredId);
      return;
    }

    if (options.keepSelection && selectedVehicleId) {
      renderVehicleList();
      await selectVehicle(selectedVehicleId);
      return;
    }

    selectedVehicleId = "";
    currentQuote = null;
    renderVehicleList();
    renderEditorEmpty(
      Number(data.summary?.needsPricing || 0) > 0
        ? "Hay versiones listas con stock pero sin precio. Ábrelas y cuadra mano de obra + costos."
        : "Elige una versión para empezar."
    );
  }

  filtersEl?.querySelectorAll("[data-filter]").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeFilter = chip.dataset.filter || "all";
      filtersEl.querySelectorAll("[data-filter]").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.filter === activeFilter);
      });
      renderVehicleList();
    });
  });

  searchInput?.addEventListener("input", () => {
    renderVehicleList();
  });

  saveGlobalButton?.addEventListener("click", () => {
    saveGlobalLabor().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });

  loadBoard()
    .then(() => {
      const needs = Number(document.getElementById("cp-stat-needs")?.textContent || 0);
      const ready = Number(document.getElementById("cp-stat-ready")?.textContent || 0);
      if (needs > 0) {
        setFeedback?.(feedback, `${needs} versión(es) ya tienen stock y aún necesitan precio.`, "success");
      } else if (ready > 0) {
        setFeedback?.(feedback, `${ready} versión(es) listas con stock. Puedes ajustar precios cuando quieras.`, "success");
      }
    })
    .catch((error) => setFeedback?.(feedback, error.message, "error"));
})();
