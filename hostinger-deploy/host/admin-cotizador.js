(() => {
  if (window.__adminCotizadorInitialized) {
    return;
  }
  window.__adminCotizadorInitialized = true;

  const { fetchJson, setFeedback } = window.AdminApp || {};

  const tabButtons = Array.from(document.querySelectorAll("[data-maint-tab]"));
  const panels = Array.from(document.querySelectorAll("[data-maint-panel]"));
  const feedback = document.getElementById("cotizador-feedback");
  const excelInput = document.getElementById("cotizador-excel-input");
  const importButton = document.getElementById("cotizador-import-button");
  const refreshButton = document.getElementById("cotizador-refresh-button");
  const configureQuotePricesButton = document.getElementById("cotizador-configure-quote-prices");
  const pricingBanner = document.getElementById("cotizador-pricing-banner");
  const pricingBannerText = document.getElementById("cotizador-pricing-banner-text");
  const quoteButton = document.getElementById("cotizador-quote-button");
  const quoteResult = document.getElementById("cotizador-quote-result");
  const postQuoteActions = document.getElementById("cotizador-post-quote-actions");
  const resetQuoteButton = document.getElementById("cotizador-reset-button");
  const sendQuoteButton = document.getElementById("cotizador-send-button");
  const sendModal = document.getElementById("cotizador-send-modal");
  const sendOverlay = document.getElementById("cotizador-send-overlay");
  const sendClose = document.getElementById("cotizador-send-close");
  const sendForm = document.getElementById("cotizador-send-form");
  const sendNameInput = document.getElementById("cotizador-send-name");
  const sendDocumentInput = document.getElementById("cotizador-send-document");
  const sendDateInput = document.getElementById("cotizador-send-date");
  const sendEmailInput = document.getElementById("cotizador-send-email");
  const sendPhoneInput = document.getElementById("cotizador-send-phone");
  const sendFeedback = document.getElementById("cotizador-send-feedback");
  const sendPreview = document.getElementById("cotizador-send-preview");
  const confirmSendButton = document.getElementById("cotizador-confirm-send");
  const downloadQuoteButton = document.getElementById("cotizador-download-quote");
  const confirmModal = document.getElementById("cotizador-confirm-modal");
  const confirmOverlay = document.getElementById("cotizador-confirm-overlay");
  const confirmClose = document.getElementById("cotizador-confirm-close");
  const confirmCancel = document.getElementById("cotizador-confirm-cancel");
  const confirmSubmit = document.getElementById("cotizador-confirm-submit");
  const confirmText = document.getElementById("cotizador-confirm-text");
  const confirmFeedback = document.getElementById("cotizador-confirm-feedback");
  const marketingCheckbox = document.getElementById("cotizador-marketing-checkbox");
  const successModal = document.getElementById("cotizador-success-modal");
  const successOverlay = document.getElementById("cotizador-success-overlay");
  const successClose = document.getElementById("cotizador-success-close");
  const successOk = document.getElementById("cotizador-success-ok");
  const successText = document.getElementById("cotizador-success-text");
  const brandInput = document.getElementById("cotizador-brand-input");
  const modelInput = document.getElementById("cotizador-model-input");
  const yearInput = document.getElementById("cotizador-year-input");
  const versionInput = document.getElementById("cotizador-version-input");
  const vehicleIdInput = document.getElementById("cotizador-vehicle-id");
  const brandList = document.getElementById("cotizador-brand-list");
  const modelList = document.getElementById("cotizador-model-list");
  const yearList = document.getElementById("cotizador-year-list");
  const versionList = document.getElementById("cotizador-version-list");
  const supplySearch = document.getElementById("cotizador-supply-search");
  const supplyType = document.getElementById("cotizador-supply-type");
  const supplyBrandInput = document.getElementById("cotizador-supply-brand");
  const supplyModelInput = document.getElementById("cotizador-supply-model");
  const supplyBrandList = document.getElementById("cotizador-supply-brand-list");
  const supplyModelList = document.getElementById("cotizador-supply-model-list");
  const supplyFilterInfo = document.getElementById("cotizador-supply-filter-info");
  const exportSuppliesButton = document.getElementById("cotizador-export-supplies-button");
  const suppliesBody = document.getElementById("cotizador-supplies-body");
  const vehiclesBody = document.getElementById("cotizador-vehicles-body");
  const vehiclesCount = document.getElementById("cotizador-vehicles-count");
  const vehiclesPageInfo = document.getElementById("cotizador-vehicles-page-info");
  const vehiclesPagination = document.getElementById("cotizador-vehicles-pagination");
  const suppliesCount = document.getElementById("cotizador-supplies-count");
  const zeroStockCount = document.getElementById("cotizador-zero-stock-count");
  const VEHICLES_PAGE_SIZE = 30;
  const compatModal = document.getElementById("cotizador-compat-modal");
  const compatOverlay = document.getElementById("cotizador-compat-overlay");
  const compatClose = document.getElementById("cotizador-compat-close");
  const compatTitle = document.getElementById("cotizador-compat-title");
  const compatSubtitle = document.getElementById("cotizador-compat-subtitle");
  const compatBody = document.getElementById("cotizador-compat-body");

  let loaded = false;
  let suppliesCache = [];
  let vehiclesCache = [];
  let vehiclesPage = 1;
  let selectorOptions = [];
  let settingsCache = { laborPrice: 0, currency: "COP" };
  let currentQuote = null;
  let latestQuoteDocumentHtml = "";
  let previewTimer = null;

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

  function switchTab(tabName) {
    tabButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.maintTab === tabName);
    });
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.maintPanel !== tabName;
    });

    if (tabName === "cotizador" && !loaded) {
      loadCotizador().catch((error) => setFeedback?.(feedback, error.message, "error"));
    }
  }

  function closeAllComboLists() {
    [brandList, modelList, yearList, versionList, supplyBrandList, supplyModelList].forEach((list) => {
      list?.classList.remove("is-open");
    });
  }

  function setPostQuoteActionsVisible(visible) {
    if (postQuoteActions) {
      postQuoteActions.hidden = !visible;
    }
  }

  function clearQuoteResult() {
    currentQuote = null;
    latestQuoteDocumentHtml = "";
    setPostQuoteActionsVisible(false);
    if (quoteResult) {
      quoteResult.innerHTML = `<div class="cotizador-info-banner"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg><span>Selecciona marca, modelo, año y versión/motor para ver los insumos.</span></div>`;
    }
  }

  function resetQuoteForm() {
    if (brandInput) brandInput.value = "";
    if (modelInput) modelInput.value = "";
    if (yearInput) yearInput.value = "";
    clearVersionSelection();
    clearQuoteResult();
    closeAllComboLists();
    closeSendModal();
    setFeedback?.(feedback, "Cotización reiniciada.", "success");
  }

  function todayInputValue() {
    return new Date().toISOString().slice(0, 10);
  }

  function collectSendPayload() {
    return {
      vehicleId: String(currentQuote?.vehicle?.id || vehicleIdInput?.value || "").trim(),
      brand: String(brandInput?.value || currentQuote?.vehicle?.brand || "").trim(),
      model: String(modelInput?.value || currentQuote?.vehicle?.model || "").trim(),
      year: String(yearInput?.value || "").trim(),
      clientName: String(sendNameInput?.value || "").trim(),
      clientDocument: String(sendDocumentInput?.value || "").trim(),
      clientEmail: String(sendEmailInput?.value || "").trim().toLowerCase(),
      clientPhone: String(sendPhoneInput?.value || "").trim(),
      quoteDate: String(sendDateInput?.value || todayInputValue()).trim(),
    };
  }

  function closeSendModal() {
    if (sendModal) {
      sendModal.hidden = true;
    }
    if (previewTimer) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
    closeConfirmModal();
  }

  function closeConfirmModal() {
    if (confirmModal) {
      confirmModal.hidden = true;
    }
    if (confirmFeedback) {
      confirmFeedback.textContent = "";
      confirmFeedback.className = "feedback";
    }
  }

  function closeSuccessModal() {
    if (successModal) {
      successModal.hidden = true;
    }
  }

  function openConfirmModal() {
    const payload = collectSendPayload();

    if (!payload.clientName) {
      setFeedback?.(sendFeedback, "Indica el nombre o razón social.", "error");
      sendNameInput?.focus();
      return false;
    }
    if (!payload.clientDocument) {
      setFeedback?.(sendFeedback, "Indica la cédula o NIT.", "error");
      sendDocumentInput?.focus();
      return false;
    }
    if (!payload.quoteDate) {
      setFeedback?.(sendFeedback, "Indica la fecha.", "error");
      sendDateInput?.focus();
      return false;
    }
    if (!payload.clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.clientEmail)) {
      setFeedback?.(sendFeedback, "Indica un correo válido.", "error");
      sendEmailInput?.focus();
      return false;
    }

    if (confirmText) {
      confirmText.textContent = `¿Deseas enviar esta cotización a ${payload.clientEmail}?`;
    }
    if (marketingCheckbox) {
      marketingCheckbox.checked = true;
    }
    if (confirmFeedback) {
      confirmFeedback.textContent = "";
      confirmFeedback.className = "feedback";
    }
    if (confirmModal) {
      confirmModal.hidden = false;
    }
    return true;
  }

  function openSuccessModal(message) {
    if (successText) {
      successText.textContent = message || "El correo llegó al cliente correctamente.";
    }
    if (successModal) {
      successModal.hidden = false;
    }
  }

  async function refreshQuotePreview() {
    if (!currentQuote || !sendPreview) {
      return;
    }

    const payload = collectSendPayload();
    if (!payload.vehicleId) {
      sendPreview.innerHTML = `<div class="empty-state">No hay una cotización activa.</div>`;
      return;
    }

    sendPreview.innerHTML = `<div class="empty-state">Actualizando previsualización...</div>`;

    try {
      const result = await fetchJson("/api/admin/cotizador/quote-document", {
        method: "POST",
        body: JSON.stringify(payload),
        loadingMessage: false,
      });
      latestQuoteDocumentHtml = result.html || "";
      sendPreview.innerHTML = latestQuoteDocumentHtml || `<div class="empty-state">No se pudo generar la previsualización.</div>`;
    } catch (error) {
      sendPreview.innerHTML = `<div class="empty-state">${escapeHtml(error.message || "Error al previsualizar")}</div>`;
    }
  }

  function scheduleQuotePreview() {
    if (previewTimer) {
      window.clearTimeout(previewTimer);
    }
    previewTimer = window.setTimeout(() => {
      refreshQuotePreview().catch(() => {});
    }, 250);
  }

  function openSendModal() {
    if (!currentQuote) {
      setFeedback?.(feedback, "Primero genera una cotización.", "error");
      return;
    }

    if (sendDateInput && !sendDateInput.value) {
      sendDateInput.value = todayInputValue();
    }
    if (sendFeedback) {
      sendFeedback.textContent = "";
      sendFeedback.className = "feedback";
    }
    if (sendModal) {
      sendModal.hidden = false;
    }
    refreshQuotePreview().catch((error) => setFeedback?.(sendFeedback, error.message, "error"));
    sendNameInput?.focus();
  }

  function resolveQuoteDocumentHtml() {
    if (latestQuoteDocumentHtml) {
      return latestQuoteDocumentHtml;
    }

    const previewDoc = sendPreview?.querySelector?.(".cotizador-quote-doc");
    return previewDoc ? previewDoc.outerHTML : "";
  }

  function buildPrintableQuoteHtml(documentHtml) {
    const origin = window.location.origin;
    const htmlWithAbsoluteAssets = String(documentHtml || "")
      .replaceAll('src="/', `src="${origin}/`)
      .replaceAll("src='/", `src='${origin}/`)
      .replaceAll('url("/', `url("${origin}/`)
      .replaceAll("url('/", `url('${origin}/`);

    return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Cotización Global Imports</title>
    <style>
      @page { margin: 12mm; }
      html, body { margin: 0; padding: 0; background: #ffffff; }
      body { padding: 12px; }
    </style>
  </head>
  <body>
    ${htmlWithAbsoluteAssets}
  </body>
</html>`;
  }

  async function downloadQuoteDocument() {
    try {
      if (!latestQuoteDocumentHtml) {
        await refreshQuotePreview();
      }

      const documentHtml = resolveQuoteDocumentHtml();
      if (!documentHtml) {
        setFeedback?.(sendFeedback, "Espera a que cargue la previsualización.", "error");
        return;
      }

      const fullHtml = buildPrintableQuoteHtml(documentHtml);
      const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url, "_blank", "width=900,height=1100");

      if (!printWindow) {
        URL.revokeObjectURL(url);
        setFeedback?.(sendFeedback, "Permite ventanas emergentes para descargar/imprimir.", "error");
        return;
      }

      const triggerPrint = () => {
        try {
          printWindow.focus();
          printWindow.print();
        } catch (_error) {
          // El usuario aún puede imprimir manualmente desde la ventana.
        }
      };

      printWindow.addEventListener("load", () => {
        window.setTimeout(triggerPrint, 250);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }, { once: true });

      // Safari a veces no dispara load en blob URLs; respaldo.
      window.setTimeout(triggerPrint, 700);
    } catch (error) {
      setFeedback?.(sendFeedback, error.message || "No se pudo abrir la descarga.", "error");
    }
  }

  async function sendQuoteToClient() {
    const payload = {
      ...collectSendPayload(),
      addToMarketing: Boolean(marketingCheckbox?.checked),
    };

    if (!payload.clientName) {
      setFeedback?.(confirmFeedback || sendFeedback, "Indica el nombre o razón social.", "error");
      return;
    }
    if (!payload.clientDocument) {
      setFeedback?.(confirmFeedback || sendFeedback, "Indica la cédula o NIT.", "error");
      return;
    }
    if (!payload.quoteDate) {
      setFeedback?.(confirmFeedback || sendFeedback, "Indica la fecha.", "error");
      return;
    }
    if (!payload.clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.clientEmail)) {
      setFeedback?.(confirmFeedback || sendFeedback, "Indica un correo válido.", "error");
      return;
    }

    if (confirmSubmit) confirmSubmit.disabled = true;
    if (confirmSendButton) confirmSendButton.disabled = true;

    try {
      const result = await fetchJson("/api/admin/cotizador/send-quote", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      closeConfirmModal();
      const successMessage = result.marketingSaved
        ? `${result.message || "Cotización enviada."} Cliente agendado para marketing en 6 meses.`
        : (result.message || "Cotización enviada al cliente.");
      openSuccessModal(successMessage);
      setFeedback?.(sendFeedback, result.message || "Cotización enviada.", "success");
      setFeedback?.(feedback, result.message || "Cotización enviada al cliente.", "success");
    } catch (error) {
      setFeedback?.(confirmFeedback || sendFeedback, error.message || "No se pudo enviar la cotización.", "error");
    } finally {
      if (confirmSubmit) confirmSubmit.disabled = false;
      if (confirmSendButton) confirmSendButton.disabled = false;
    }
  }

  function clearVersionSelection() {
    if (versionInput) versionInput.value = "";
    if (vehicleIdInput) vehicleIdInput.value = "";
    updateVersionInputState();
  }

  function updateVersionInputState() {
    const ready = Boolean(
      String(brandInput?.value || "").trim()
      && String(modelInput?.value || "").trim()
      && String(yearInput?.value || "").trim()
    );
    if (versionInput) {
      versionInput.disabled = !ready;
      if (!ready) {
        versionInput.placeholder = "Primero elige marca, modelo y año";
      } else {
        versionInput.placeholder = "Ej: 2.8 D-4D diésel / 2.7 gasolina";
      }
    }
  }

  function filterOptions(options, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) {
      return options.slice(0, 40);
    }
    return options.filter((item) => {
      const label = typeof item === "string" ? item : (item.label || item.value || "");
      return String(label).toLowerCase().includes(q);
    }).slice(0, 40);
  }

  function renderComboList(listEl, options, onPick) {
    if (!listEl) {
      return;
    }

    if (!options.length) {
      listEl.innerHTML = `<button class="cotizador-combo-option" type="button" disabled>Sin coincidencias</button>`;
      listEl.classList.add("is-open");
      return;
    }

    listEl.innerHTML = options.map((option) => {
      const value = typeof option === "string" ? option : String(option.value || "");
      const label = typeof option === "string" ? option : String(option.label || option.value || "");
      return `
        <button class="cotizador-combo-option" type="button" data-value="${escapeHtml(value)}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</button>
      `;
    }).join("");

    listEl.querySelectorAll(".cotizador-combo-option").forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onPick(button.dataset.value || "", button.dataset.label || button.dataset.value || "");
        listEl.classList.remove("is-open");
      });
    });

    listEl.classList.add("is-open");
  }

  function getSelectedBrandEntry() {
    const brand = String(brandInput?.value || "").trim();
    return selectorOptions.find((item) => item.brand.toLowerCase() === brand.toLowerCase()) || null;
  }

  function getSelectedModelEntry() {
    const brandEntry = getSelectedBrandEntry();
    if (!brandEntry) {
      return null;
    }
    const model = String(modelInput?.value || "").trim();
    return brandEntry.models.find((item) => item.model.toLowerCase() === model.toLowerCase()) || null;
  }

  function getMatchingVariants() {
    const brand = String(brandInput?.value || "").trim().toLowerCase();
    const model = String(modelInput?.value || "").trim().toLowerCase();
    const year = Number(String(yearInput?.value || "").trim());

    if (!brand || !model) {
      return [];
    }

    return vehiclesCache
      .filter((vehicle) => {
        if (String(vehicle.brand || "").toLowerCase() !== brand) {
          return false;
        }
        if (String(vehicle.model || "").toLowerCase() !== model) {
          return false;
        }
        if (!Number.isFinite(year) || year <= 0) {
          return true;
        }
        const from = Number(vehicle.yearFrom || 0);
        const to = Number(vehicle.yearTo || vehicle.yearFrom || 0);
        return year >= from && year <= to;
      })
      .map((vehicle) => {
        const engine = String(vehicle.engineCode || "").trim();
        const label = String(vehicle.variantLabel || "").trim()
          || `${vehicle.model || ""}${engine ? ` ${engine}` : ""}`.trim()
          || "Versión sin nombre";
        return {
          value: String(vehicle.id),
          label,
        };
      })
      .sort((left, right) => left.label.localeCompare(right.label, "es"));
  }

  function selectVersion(vehicleId, label) {
    if (vehicleIdInput) vehicleIdInput.value = vehicleId || "";
    if (versionInput) versionInput.value = label || "";
    clearQuoteResult();
  }

  function openBrandList() {
    const brands = selectorOptions.map((item) => item.brand);
    renderComboList(brandList, filterOptions(brands, brandInput?.value), (value) => {
      if (brandInput) brandInput.value = value;
      if (modelInput) modelInput.value = "";
      if (yearInput) yearInput.value = "";
      clearVersionSelection();
      clearQuoteResult();
    });
  }

  function openModelList() {
    const brandEntry = getSelectedBrandEntry();
    const models = (brandEntry?.models || []).map((item) => item.model);
    renderComboList(modelList, filterOptions(models, modelInput?.value), (value) => {
      if (modelInput) modelInput.value = value;
      if (yearInput) yearInput.value = "";
      clearVersionSelection();
      clearQuoteResult();
    });
  }

  function openYearList() {
    const modelEntry = getSelectedModelEntry();
    const years = (modelEntry?.years || []).map(String);
    renderComboList(yearList, filterOptions(years, yearInput?.value), (value) => {
      if (yearInput) yearInput.value = value;
      clearVersionSelection();
      clearQuoteResult();
      updateVersionInputState();
      window.setTimeout(() => {
        closeAllComboLists();
        openVersionList({ autoSelectSingle: true });
      }, 0);
    });
  }

  function openVersionList(options = {}) {
    updateVersionInputState();
    if (versionInput?.disabled) {
      return;
    }

    const variants = getMatchingVariants();
    if (options.autoSelectSingle && variants.length === 1) {
      selectVersion(variants[0].value, variants[0].label);
      return;
    }

    renderComboList(versionList, filterOptions(variants, versionInput?.value), (value, label) => {
      selectVersion(value, label);
    });
  }

  function bindCombo(input, openFn, onTypedChange) {
    if (!input) {
      return;
    }
    input.addEventListener("focus", () => {
      closeAllComboLists();
      openFn();
    });
    input.addEventListener("input", () => {
      closeAllComboLists();
      onTypedChange?.();
      openFn();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeAllComboLists();
      }
    });
  }

  function getSupplyBrandFilter() {
    return String(supplyBrandInput?.value || "").trim();
  }

  function getSupplyModelFilter() {
    return String(supplyModelInput?.value || "").trim();
  }

  function vehicleMatchesSupplyFilters(vehicle, brandFilter, modelFilter) {
    const brand = String(vehicle.brand || "").toLowerCase();
    const model = String(vehicle.model || "").toLowerCase();
    if (brandFilter && !brand.includes(brandFilter.toLowerCase())) {
      return false;
    }
    if (modelFilter && !model.includes(modelFilter.toLowerCase())) {
      return false;
    }
    return true;
  }

  function getMatchingVehicles(supply, brandFilter, modelFilter) {
    return (supply.compatibleVehicles || []).filter((vehicle) =>
      vehicleMatchesSupplyFilters(vehicle, brandFilter, modelFilter)
    );
  }

  function collectSupplyFilterOptions(baseSupplies) {
    const brands = new Map();
    for (const supply of baseSupplies) {
      for (const vehicle of supply.compatibleVehicles || []) {
        const brand = String(vehicle.brand || "").trim();
        const model = String(vehicle.model || "").trim();
        if (!brand) continue;
        if (!brands.has(brand)) brands.set(brand, new Set());
        if (model) brands.get(brand).add(model);
      }
    }
    return Array.from(brands.entries())
      .sort((left, right) => left[0].localeCompare(right[0], "es"))
      .map(([brand, models]) => ({
        brand,
        models: Array.from(models).sort((left, right) => left.localeCompare(right, "es")),
      }));
  }

  function closeSupplyComboLists() {
    closeAllComboLists();
  }

  function openSupplyBrandList() {
    const base = getSuppliesAfterTextAndType();
    const options = collectSupplyFilterOptions(base).map((item) => item.brand);
    renderComboList(supplyBrandList, filterOptions(options, supplyBrandInput?.value), (value) => {
      if (supplyBrandInput) supplyBrandInput.value = value;
      if (supplyModelInput) supplyModelInput.value = "";
      closeSupplyComboLists();
      applySupplyFilters();
    });
  }

  function openSupplyModelList() {
    const brandFilter = getSupplyBrandFilter();
    const base = getSuppliesAfterTextAndType();
    const optionsData = collectSupplyFilterOptions(base);
    const brandEntry = optionsData.find((item) => item.brand.toLowerCase() === brandFilter.toLowerCase());
    const models = brandEntry
      ? brandEntry.models
      : optionsData.flatMap((item) => item.models);
    const uniqueModels = Array.from(new Set(models)).sort((left, right) => left.localeCompare(right, "es"));
    renderComboList(supplyModelList, filterOptions(uniqueModels, supplyModelInput?.value), (value) => {
      if (supplyModelInput) supplyModelInput.value = value;
      // If model picked without brand, auto-fill brand when unique
      if (!brandFilter) {
        const owners = optionsData.filter((item) => item.models.some((model) => model.toLowerCase() === value.toLowerCase()));
        if (owners.length === 1 && supplyBrandInput) {
          supplyBrandInput.value = owners[0].brand;
        }
      }
      closeSupplyComboLists();
      applySupplyFilters();
    });
  }

  function getSuppliesAfterTextAndType() {
    const q = String(supplySearch?.value || "").trim().toLowerCase();
    const type = String(supplyType?.value || "").trim();
    return suppliesCache.filter((supply) => {
      if (type && supply.type !== type) {
        return false;
      }
      if (!q) {
        return true;
      }
      const hay = `${supply.specification} ${supply.oemCode} ${supply.name} ${supply.typeLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderSupplies(items) {
    if (!suppliesBody) {
      return;
    }

    if (!items.length) {
      suppliesBody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No hay insumos con ese filtro.</div></td></tr>`;
      return;
    }

    suppliesBody.innerHTML = items.map((supply) => {
      const count = Number(supply.filteredCompatibleCount ?? supply.compatibleCount ?? 0);
      const typeLabel = escapeHtml(supply.typeLabel || supply.type || "Insumo");
      return `
      <tr data-supply-id="${escapeHtml(supply.id || supply._id)}">
        <td>
          <span class="cotizador-type-cell">
            <span class="cotizador-type-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
            </span>
            ${typeLabel}
          </span>
        </td>
        <td>
          <strong>${escapeHtml(supply.specification || supply.oemCode || "—")}</strong>
          <div class="maint-panel-sub">${escapeHtml(supply.name || "")}</div>
        </td>
        <td>
          <input class="cotizador-stock-input" type="number" min="0" step="1" value="${Number(supply.stock || 0)}" style="width:90px" />
        </td>
        <td>
          <input class="cotizador-cost-input" type="number" min="0" step="100" value="${Number(supply.unitCost || 0)}" style="width:110px" />
        </td>
        <td>
          <button
            class="cotizador-compat-link"
            type="button"
            data-supply-id="${escapeHtml(supply.id || supply._id)}"
            ${count === 0 ? "disabled" : ""}
          >${count} carro(s)</button>
        </td>
        <td>
          <button class="cotizador-btn cotizador-btn-outline cotizador-save-supply" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>
            Guardar
          </button>
        </td>
      </tr>
    `;
    }).join("");

    suppliesBody.querySelectorAll(".cotizador-compat-link").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.dataset.supplyId;
        const supply = suppliesCache.find((item) => String(item.id || item._id) === String(id));
        if (!supply) return;
        const brandFilter = getSupplyBrandFilter();
        const modelFilter = getSupplyModelFilter();
        const filteredVehicles = getMatchingVehicles(supply, brandFilter, modelFilter);
        openCompatModal({
          ...supply,
          compatibleVehicles: (brandFilter || modelFilter) ? filteredVehicles : supply.compatibleVehicles,
        });
      });
    });

    suppliesBody.querySelectorAll(".cotizador-save-supply").forEach((button) => {
      button.addEventListener("click", async () => {
        const row = button.closest("tr");
        const id = row?.dataset.supplyId;
        const stock = Number(row.querySelector(".cotizador-stock-input")?.value || 0);
        const unitCost = Number(row.querySelector(".cotizador-cost-input")?.value || 0);
        try {
          await fetchJson(`/api/admin/cotizador/supplies/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify({ stock, unitCost }),
          });
          setFeedback?.(feedback, "Insumo actualizado.", "success");
          await loadCotizador();
          if (currentQuote?.vehicle?.id) {
            await loadQuote();
          }
        } catch (error) {
          setFeedback?.(feedback, error.message, "error");
        }
      });
    });
  }

  function syncCotizadorBodyScrollLock() {
    const anyOpen = Boolean(compatModal && !compatModal.hidden);
    document.body.classList.toggle("modal-open", anyOpen);
  }

  async function loadPricingBanner() {
    if (!pricingBanner || !pricingBannerText) {
      return;
    }

    try {
      const data = await fetchJson("/api/admin/cotizador/pricing");
      const ready = Number(data.summary?.ready || 0);
      const needs = Number(data.summary?.needsPricing || 0);
      if (!ready && !needs) {
        pricingBanner.hidden = true;
        return;
      }

      pricingBannerText.textContent = needs > 0
        ? `${ready} versión(es) ya tienen stock para mantenimiento. ${needs} aún necesitan precio.`
        : `${ready} versión(es) ya tienen stock para mantenimiento. Puedes ajustar precios cuando quieras.`;
      pricingBanner.hidden = false;
    } catch {
      pricingBanner.hidden = true;
    }
  }

  function openCompatModal(supply) {
    if (!compatModal || !supply) {
      return;
    }

    const vehicles = Array.isArray(supply.compatibleVehicles) ? supply.compatibleVehicles : [];
    const label = supply.specification || supply.oemCode || supply.name || "Insumo";

    if (compatTitle) {
      compatTitle.textContent = `Vehículos compatibles (${vehicles.length})`;
    }
    if (compatSubtitle) {
      compatSubtitle.textContent = `${supply.typeLabel || supply.type || "Insumo"} · ${label}`;
    }

    if (!compatBody) {
      return;
    }

    if (!vehicles.length) {
      compatBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Ningún vehículo usa este insumo todavía.</div></td></tr>`;
    } else {
      const sorted = [...vehicles].sort((left, right) => {
        const a = `${left.brand || ""} ${left.model || ""} ${left.variantLabel || ""}`;
        const b = `${right.brand || ""} ${right.model || ""} ${right.variantLabel || ""}`;
        return a.localeCompare(b, "es");
      });

      compatBody.innerHTML = sorted.map((vehicle) => `
        <tr>
          <td>${escapeHtml(vehicle.brand || "—")}</td>
          <td>
            <strong>${escapeHtml(vehicle.variantLabel || vehicle.model || "—")}</strong>
            ${vehicle.model && vehicle.variantLabel && vehicle.variantLabel !== vehicle.model
              ? `<div class="maint-panel-sub">${escapeHtml(vehicle.model)}</div>`
              : ""}
          </td>
          <td>${escapeHtml(vehicle.engineCode || "—")}</td>
          <td>${vehicle.yearFrom || "?"} - ${vehicle.yearTo || "?"}</td>
        </tr>
      `).join("");
    }

    compatModal.hidden = false;
    syncCotizadorBodyScrollLock();
    compatModal.querySelector(".cotizador-modal-scroll")?.scrollTo?.(0, 0);
  }

  function closeCompatModal() {
    if (compatModal) {
      compatModal.hidden = true;
    }
    syncCotizadorBodyScrollLock();
  }

  function getVehiclesPageCount() {
    return Math.max(1, Math.ceil(vehiclesCache.length / VEHICLES_PAGE_SIZE));
  }

  function renderVehiclesPagination() {
    if (!vehiclesPagination) {
      return;
    }

    const total = vehiclesCache.length;
    const pageCount = getVehiclesPageCount();
    vehiclesPage = Math.min(Math.max(1, vehiclesPage), pageCount);

    if (!total) {
      vehiclesPagination.innerHTML = "";
      if (vehiclesPageInfo) vehiclesPageInfo.textContent = "0 vehículos";
      return;
    }

    const from = (vehiclesPage - 1) * VEHICLES_PAGE_SIZE + 1;
    const to = Math.min(vehiclesPage * VEHICLES_PAGE_SIZE, total);
    if (vehiclesPageInfo) {
      vehiclesPageInfo.textContent = `Mostrando ${from}-${to} de ${total}`;
    }

    if (pageCount <= 1) {
      vehiclesPagination.innerHTML = "";
      return;
    }

    const buttons = [];
    buttons.push(`<button class="secondary-button cotizador-page-button" type="button" data-page="prev" ${vehiclesPage === 1 ? "disabled" : ""}>Anterior</button>`);
    for (let page = 1; page <= pageCount; page += 1) {
      buttons.push(`
        <button
          class="secondary-button cotizador-page-button ${page === vehiclesPage ? "is-active" : ""}"
          type="button"
          data-page="${page}"
        >Página ${page}</button>
      `);
    }
    buttons.push(`<button class="secondary-button cotizador-page-button" type="button" data-page="next" ${vehiclesPage === pageCount ? "disabled" : ""}>Siguiente</button>`);
    vehiclesPagination.innerHTML = buttons.join("");

    vehiclesPagination.querySelectorAll("[data-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.page;
        if (value === "prev") {
          vehiclesPage = Math.max(1, vehiclesPage - 1);
        } else if (value === "next") {
          vehiclesPage = Math.min(pageCount, vehiclesPage + 1);
        } else {
          vehiclesPage = Number(value) || 1;
        }
        renderVehiclesPage();
      });
    });
  }

  function renderVehiclesPage() {
    if (!vehiclesBody) {
      return;
    }

    if (!vehiclesCache.length) {
      vehiclesBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No hay vehículos cargados.</div></td></tr>`;
      renderVehiclesPagination();
      return;
    }

    const pageCount = getVehiclesPageCount();
    vehiclesPage = Math.min(Math.max(1, vehiclesPage), pageCount);
    const start = (vehiclesPage - 1) * VEHICLES_PAGE_SIZE;
    const pageItems = vehiclesCache.slice(start, start + VEHICLES_PAGE_SIZE);

    vehiclesBody.innerHTML = pageItems.map((vehicle) => `
      <tr>
        <td>${escapeHtml(vehicle.brand)}</td>
        <td>${escapeHtml(vehicle.variantLabel || vehicle.model)}</td>
        <td>${escapeHtml(vehicle.engineCode || "—")}</td>
        <td>${vehicle.yearFrom || "?"} - ${vehicle.yearTo || "?"}</td>
        <td>${Number(vehicle.partsCount ?? (vehicle.parts || []).length)}</td>
      </tr>
    `).join("");

    renderVehiclesPagination();
  }

  function renderQuote(quote) {
    if (!quoteResult) {
      return;
    }

    if (!quote) {
      quoteResult.innerHTML = `<div class="cotizador-info-banner"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg><span>Selecciona marca, modelo, año y versión/motor para ver los insumos.</span></div>`;
      return;
    }

    const partsRows = (quote.parts || []).map((part) => {
      const isServiceItem = part.type === "other";
      const title = isServiceItem
        ? (part.typeLabel || part.supply?.specification || part.supply?.name || "Ítem")
        : (part.typeLabel || part.type);
      const detail = isServiceItem
        ? escapeHtml(part.quantityLabel || part.quantityValue || "1")
        : `<strong>${escapeHtml(part.supply?.specification || part.supply?.oemCode || "—")}</strong>
          <div class="maint-panel-sub">${escapeHtml(part.quantityLabel || part.quantityValue || "1")}</div>`;

      return `
      <tr>
        <td><strong>${escapeHtml(title)}</strong></td>
        <td>${detail}</td>
        <td>${part.ignoreStock ? "N/A" : Number(part.stock || 0)}</td>
        <td>${part.enough ? "OK" : "Falta"}</td>
        <td>${money(part.lineCost)}</td>
      </tr>
    `;
    }).join("");

    quoteResult.innerHTML = `
      <p><strong>${escapeHtml(quote.vehicle?.brand || "")} ${escapeHtml(quote.vehicle?.model || "")}</strong>
      · ${escapeHtml(quote.vehicle?.variantLabel || "")}
      ${quote.vehicle?.engineCode ? ` · ${escapeHtml(quote.vehicle.engineCode)}` : ""}
      · ${quote.canService ? "Listo con stock" : "Falta stock"}</p>
      <div class="cotizador-table-wrap">
        <table class="tracking-data-table">
          <thead>
            <tr>
              <th>Insumo</th>
              <th>Espec / cant.</th>
              <th>Stock</th>
              <th>Estado</th>
              <th>Costo</th>
            </tr>
          </thead>
          <tbody>
            ${partsRows || `<tr><td colspan="5"><div class="empty-state">Sin insumos en esta ficha.</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="cotizador-quote-totals">
        <div class="cotizador-quote-total-item">
          <span>Insumos</span>
          <strong>${money(quote.pricing?.partsCost)}</strong>
        </div>
        <div class="cotizador-quote-total-item">
          <span>Mano de obra mantenimiento</span>
          <strong>${money(quote.pricing?.laborMecanico ?? quote.pricing?.laborPrice)}</strong>
        </div>
        <div class="cotizador-quote-total-item">
          <span>Mano de obra alistamiento</span>
          <strong>${money(quote.pricing?.laborAlistamiento || 0)}</strong>
        </div>
        <div class="cotizador-quote-total-item">
          <span>Costo total</span>
          <strong>${money(quote.pricing?.costTotal ?? quote.pricing?.total)}</strong>
        </div>
        <div class="cotizador-quote-total-item">
          <span>Precio de venta</span>
          <strong>${money(quote.pricing?.salePrice ?? quote.pricing?.total)}</strong>
        </div>
      </div>
    `;
  }

  async function loadQuote() {
    const brand = String(brandInput?.value || "").trim();
    const model = String(modelInput?.value || "").trim();
    const year = String(yearInput?.value || "").trim();
    const vehicleId = String(vehicleIdInput?.value || "").trim();

    if (!brand || !model || !year) {
      setFeedback?.(feedback, "Selecciona marca, modelo y año.", "error");
      return;
    }

    if (!vehicleId) {
      setFeedback?.(feedback, "Selecciona la versión/motor. Gasolina y diésel no usan los mismos insumos.", "error");
      openVersionList();
      return;
    }

    const params = new URLSearchParams({ brand, model, year, vehicleId });
    const data = await fetchJson(`/api/admin/cotizador/quote?${params.toString()}`);
    currentQuote = data.quote || null;
    if (data.settings) {
      settingsCache = data.settings;
    }
    renderQuote(currentQuote);
    setPostQuoteActionsVisible(Boolean(currentQuote));
    setFeedback?.(feedback, "Cotización lista.", "success");
  }

  async function loadCotizador(options = {}) {
    const overview = await fetchJson("/api/admin/cotizador");
    const suppliesData = await fetchJson("/api/admin/cotizador/supplies");
    suppliesCache = suppliesData.supplies || [];
    selectorOptions = overview.selectorOptions || [];
    settingsCache = overview.settings || settingsCache;

    if (vehiclesCount) vehiclesCount.textContent = String(overview.summary?.vehicles || 0);
    if (suppliesCount) suppliesCount.textContent = String(overview.summary?.supplies || 0);
    if (zeroStockCount) zeroStockCount.textContent = String(overview.summary?.zeroStock || 0);

    vehiclesCache = overview.vehicles || [];
    if (!options.keepVehiclesPage) {
      vehiclesPage = 1;
    }
    renderVehiclesPage();
    applySupplyFilters();
    loaded = true;
    loadPricingBanner().catch(() => {});
  }

  function applySupplyFilters() {
    const activeBrand = getSupplyBrandFilter();
    const activeModel = getSupplyModelFilter();
    const base = getSuppliesAfterTextAndType();

    const filtered = base
      .map((supply) => {
        const matching = getMatchingVehicles(supply, activeBrand, activeModel);
        return {
          ...supply,
          filteredCompatibleCount: matching.length,
          filteredCompatibleVehicles: matching,
        };
      })
      .filter((supply) => {
        if (!activeBrand && !activeModel) {
          return true;
        }
        return supply.filteredCompatibleCount > 0;
      });

    filtered.sort((left, right) => {
      const leftCount = Number(left.filteredCompatibleCount ?? left.compatibleCount ?? 0);
      const rightCount = Number(right.filteredCompatibleCount ?? right.compatibleCount ?? 0);
      const byCars = rightCount - leftCount;
      if (byCars !== 0) {
        return byCars;
      }
      return String(left.specification || "").localeCompare(String(right.specification || ""), "es");
    });

    if (supplyFilterInfo) {
      const parts = [`${filtered.length} insumo(s)`];
      if (activeBrand) parts.push(`marca ${activeBrand}`);
      if (activeModel) parts.push(`modelo ${activeModel}`);
      supplyFilterInfo.textContent = parts.join(" · ");
    }

    renderSupplies(filtered);
  }

  async function exportSuppliesXlsx() {
    const params = new URLSearchParams();
    const q = String(supplySearch?.value || "").trim();
    const type = String(supplyType?.value || "").trim();
    const brand = getSupplyBrandFilter();
    const model = getSupplyModelFilter();
    if (q) params.set("q", q);
    if (type) params.set("type", type);
    if (brand) params.set("brand", brand);
    if (model) params.set("model", model);

    const token = localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
    const url = `/api/admin/cotizador/supplies/export${params.toString() ? `?${params.toString()}` : ""}`;

    setFeedback?.(feedback, "Generando Excel de insumos...");
    const response = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: "include",
    });

    if (!response.ok) {
      let message = "No se pudo descargar el Excel";
      try {
        const data = await response.json();
        message = data.message || message;
      } catch (_error) {
        // keep default
      }
      throw new Error(message);
    }

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/i);
    const fileName = match?.[1] || `cotizador-insumos-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
    setFeedback?.(feedback, "Excel descargado (incluye compatibilidad).", "success");
  }

  async function importExcels() {
    const files = Array.from(excelInput?.files || []);
    if (!files.length) {
      setFeedback?.(feedback, "Selecciona uno o más Excel (.xlsx).", "error");
      return;
    }
    if (files.length > 10) {
      setFeedback?.(feedback, "Máximo 10 Excel por tanda.", "error");
      return;
    }

    const formData = new FormData();
    files.forEach((file) => formData.append("excelFiles", file));

    setFeedback?.(feedback, `Importando ${files.length} archivo(s)...`);
    try {
      const data = await fetchJson("/api/admin/cotizador/import", {
        method: "POST",
        body: formData,
        loadingMessage: "Importando Excel...",
      });
      const totals = data.totals || {};
      setFeedback?.(
        feedback,
        `Listo: +${totals.vehiclesCreated || 0} vehículos, ${totals.vehiclesUpdated || 0} actualizados, +${totals.suppliesCreated || 0} insumos nuevos, ${totals.suppliesReused || 0} reutilizados.`,
        "success"
      );
      if (excelInput) excelInput.value = "";
      await loadCotizador();
    } catch (error) {
      setFeedback?.(feedback, error.message, "error");
    }
  }

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.maintTab));
  });

  bindCombo(brandInput, openBrandList, () => {
    if (modelInput) modelInput.value = "";
    if (yearInput) yearInput.value = "";
    clearVersionSelection();
    clearQuoteResult();
  });
  bindCombo(modelInput, openModelList, () => {
    if (yearInput) yearInput.value = "";
    clearVersionSelection();
    clearQuoteResult();
  });
  bindCombo(yearInput, openYearList, () => {
    clearVersionSelection();
    clearQuoteResult();
    updateVersionInputState();
  });
  bindCombo(versionInput, () => openVersionList(), () => {
    if (vehicleIdInput) vehicleIdInput.value = "";
    clearQuoteResult();
  });
  updateVersionInputState();

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".cotizador-combo")) {
      closeAllComboLists();
    }
  });

  importButton?.addEventListener("click", () => {
    importExcels().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  refreshButton?.addEventListener("click", () => {
    loadCotizador().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  quoteButton?.addEventListener("click", () => {
    loadQuote().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  resetQuoteButton?.addEventListener("click", () => {
    resetQuoteForm();
  });
  sendQuoteButton?.addEventListener("click", () => {
    openSendModal();
  });
  sendOverlay?.addEventListener("click", closeSendModal);
  sendClose?.addEventListener("click", closeSendModal);
  confirmSendButton?.addEventListener("click", () => {
    openConfirmModal();
  });
  confirmOverlay?.addEventListener("click", closeConfirmModal);
  confirmClose?.addEventListener("click", closeConfirmModal);
  confirmCancel?.addEventListener("click", closeConfirmModal);
  confirmSubmit?.addEventListener("click", () => {
    sendQuoteToClient().catch((error) => setFeedback?.(confirmFeedback, error.message, "error"));
  });
  successOverlay?.addEventListener("click", closeSuccessModal);
  successClose?.addEventListener("click", closeSuccessModal);
  successOk?.addEventListener("click", closeSuccessModal);
  downloadQuoteButton?.addEventListener("click", () => {
    downloadQuoteDocument().catch((error) => setFeedback?.(sendFeedback, error.message, "error"));
  });
  [sendNameInput, sendDocumentInput, sendDateInput, sendEmailInput, sendPhoneInput].forEach((input) => {
    input?.addEventListener("input", scheduleQuotePreview);
    input?.addEventListener("change", scheduleQuotePreview);
  });
  sendForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    openConfirmModal();
  });
  configureQuotePricesButton?.addEventListener("click", () => {
    const vehicleId = currentQuote?.vehicle?.id || String(vehicleIdInput?.value || "").trim();
    if (!vehicleId) {
      setFeedback?.(feedback, "Primero cotiza una versión, o abre Configurar precios de venta.", "error");
      return;
    }
    window.location.href = `/app/admin-cotizador-precios.html?vehicleId=${encodeURIComponent(vehicleId)}`;
  });
  compatOverlay?.addEventListener("click", closeCompatModal);
  compatClose?.addEventListener("click", closeCompatModal);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (successModal && !successModal.hidden) {
      closeSuccessModal();
      return;
    }
    if (confirmModal && !confirmModal.hidden) {
      closeConfirmModal();
      return;
    }
    if (sendModal && !sendModal.hidden) {
      closeSendModal();
      return;
    }
    if (compatModal && !compatModal.hidden) {
      closeCompatModal();
    }
  });

  compatModal?.addEventListener("wheel", (event) => {
    event.stopPropagation();
  }, { passive: true });
  compatModal?.addEventListener("touchmove", (event) => {
    event.stopPropagation();
  }, { passive: true });
  supplySearch?.addEventListener("input", applySupplyFilters);
  supplyType?.addEventListener("change", () => {
    applySupplyFilters();
  });
  bindCombo(supplyBrandInput, openSupplyBrandList);
  bindCombo(supplyModelInput, openSupplyModelList);
  supplyBrandInput?.addEventListener("input", () => {
    // Clear model if brand text no longer matches selected brand family
    applySupplyFilters();
  });
  supplyModelInput?.addEventListener("input", applySupplyFilters);
  exportSuppliesButton?.addEventListener("click", () => {
    exportSuppliesXlsx().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get("tab") === "cotizador") {
    switchTab("cotizador");
  }
})();
