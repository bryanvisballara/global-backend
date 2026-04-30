(() => {
if (window.__adminVehiclesScriptInitialized) {
  return;
}

window.__adminVehiclesScriptInitialized = true;

const {
  attachLogout,
  fetchJson,
  loadAdminSession,
  resetLoadingOverlay,
  requireAdminAccess,
  setFeedback,
  trackingTemplates = [],
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const vehiclePricingModal = document.getElementById("vehicle-pricing-modal");
  const vehiclePricingForm = document.getElementById("vehicle-pricing-form");
  const vehiclePricingCancel = document.getElementById("vehicle-pricing-cancel");
  const vehiclePricingSave = document.getElementById("vehicle-pricing-save");
  const vehiclePlateInput = document.getElementById("vehicle-plate");
  const vehiclePurchasePriceInput = document.getElementById("vehicle-purchase-price");
  const vehicleSalePriceInput = document.getElementById("vehicle-sale-price");
  const vehicleModalSummary = document.getElementById("vehicle-modal-summary");
  const vehicleModalFeedback = document.getElementById("vehicle-modal-feedback");
  const vehiclesTotalCount = document.getElementById("vehicles-total-count");
  const vehiclesWithPlateCount = document.getElementById("vehicles-with-plate-count");
  const vehiclesWithoutPlateCount = document.getElementById("vehicles-without-plate-count");
  const vehiclesStageE8Count = document.getElementById("vehicles-stage-e8-count");
  const vehiclesResultsCount = document.getElementById("vehicles-results-count");
  const vehiclesResultsBody = document.getElementById("vehicles-results-body");
  const vehiclesFeedback = document.getElementById("vehicles-feedback");
  const vehiclesSearchInput = document.getElementById("vehicles-search-input");
  const vehiclesClientFilter = document.getElementById("vehicles-client-filter");
  const vehiclesOrderIdFilter = document.getElementById("vehicles-order-id-filter");
  const vehiclesVinFilter = document.getElementById("vehicles-vin-filter");
  const vehiclesYearFilter = document.getElementById("vehicles-year-filter");
  const vehiclesStageFilter = document.getElementById("vehicles-stage-filter");
  const vehiclesFilterButton = document.getElementById("vehicles-filter-button");
  const vehiclesClearButton = document.getElementById("vehicles-clear-button");

  const stageTemplates = Array.isArray(trackingTemplates) && trackingTemplates.length
    ? trackingTemplates
    : [
        { key: "order-received", label: "Orden recibida" },
        { key: "vehicle-search", label: "Búsqueda del carro" },
        { key: "booking-and-shipping", label: "Booking y tracking naviera" },
        { key: "in-transit", label: "En tránsito" },
        { key: "nationalization", label: "Proceso de nacionalización" },
        { key: "port-exit", label: "Salida del puerto" },
        { key: "vehicle-preparation", label: "Alistamiento" },
        { key: "delivery", label: "Entrega" },
        { key: "registration", label: "Matrícula" },
      ];

  let allVehicles = [];
  let selectedVehicleId = "";
  let initOverlayWatchdog = null;

  function forceClearLoadingState() {
    if (typeof resetLoadingOverlay === "function") {
      resetLoadingOverlay();
    }

    document.querySelectorAll(".global-loading-overlay").forEach((overlay) => {
      overlay.hidden = true;
    });

    document.body.classList.remove("loading-active");
  }

  function stopInitOverlayWatchdog() {
    if (!initOverlayWatchdog) {
      return;
    }

    window.clearInterval(initOverlayWatchdog);
    initOverlayWatchdog = null;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeSearchValue(value) {
    return normalizeText(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function setEmptyResults(message) {
    vehiclesResultsBody.innerHTML = `<tr><td colspan="7"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  }

  function fillClientFilter(clients) {
    const selectedClient = normalizeText(vehiclesClientFilter.value);
    const clientNames = [...new Set((clients || []).map((client) => normalizeText(client?.name)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, "es"));

    vehiclesClientFilter.innerHTML = '<option value="">Todos</option>';
    clientNames.forEach((clientName) => {
      const option = document.createElement("option");
      option.value = clientName;
      option.textContent = clientName;
      vehiclesClientFilter.appendChild(option);
    });

    if (selectedClient && clientNames.includes(selectedClient)) {
      vehiclesClientFilter.value = selectedClient;
    }
  }

  function fillStageFilter() {
    vehiclesStageFilter.innerHTML = '<option value="">Todas</option>';
    stageTemplates.forEach((stage, index) => {
      const option = document.createElement("option");
      option.value = stage.key;
      option.textContent = `E${index + 1} - ${stage.label}`;
      vehiclesStageFilter.appendChild(option);
    });
  }

  function resolveCurrentStage(order) {
    const steps = Array.isArray(order?.trackingSteps) ? order.trackingSteps : [];
    const normalizedSteps = stageTemplates.map((template, index) => {
      const step = steps.find((item) => String(item?.key || "") === template.key) || steps[index] || {};
      return {
        key: template.key,
        label: String(step?.label || template.label || "Etapa"),
        confirmed: Boolean(step?.confirmed),
        inProgress: Boolean(step?.confirmed ? false : step?.inProgress),
      };
    });

    const explicitActive = normalizedSteps.findIndex((step) => step.inProgress && !step.confirmed);
    const activeIndex = explicitActive >= 0
      ? explicitActive
      : normalizedSteps.findIndex((step) => !step.confirmed);
    const resolvedIndex = activeIndex >= 0 ? activeIndex : normalizedSteps.length - 1;
    const resolvedStep = normalizedSteps[resolvedIndex] || normalizedSteps[0] || { key: "", label: "Sin etapa" };

    return {
      key: resolvedStep.key,
      label: resolvedStep.label,
      index: resolvedIndex,
      display: `E${resolvedIndex + 1} — ${resolvedStep.label}`,
    };
  }

  function formatVehicleLabel(order) {
    return [
      order?.vehicle?.brand,
      order?.vehicle?.model,
      order?.vehicle?.version,
      order?.vehicle?.year,
    ].filter(Boolean).join(" ").trim() || "Vehículo";
  }

  function formatCurrency(value) {
    if (value === null || value === undefined || value === "") {
      return "Sin definir";
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return "Sin definir";
    }

    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    }).format(numericValue);
  }

  function getOrderIdentifier(order) {
    return normalizeText(order?._id || order?.id);
  }

  function buildOrderDetailUrl(order) {
    const orderId = getOrderIdentifier(order);
    const trackingValue = normalizeText(order?.trackingNumber);
    const vinValue = normalizeText(order?.vehicle?.vin);
    const clientValue = normalizeText(order?.client?.name);
    const internalIdentifierValue = normalizeText(order?.vehicle?.internalIdentifier || order?.vehicle?.description);

    return `/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(trackingValue)}&vin=${encodeURIComponent(vinValue)}&client=${encodeURIComponent(clientValue)}&internal=${encodeURIComponent(internalIdentifierValue)}`;
  }

  function normalizeVehicles(orders) {
    return (orders || [])
      .filter((order) => order?.status !== "cancelled")
      .map((order) => {
        const currentStage = resolveCurrentStage(order);
        const plate = normalizeText(order?.vehicle?.plate);
        return {
          id: String(order?._id || order?.id || ""),
          order,
          orderRegion: normalizeText(order?.orderRegion || "latam"),
          vin: normalizeText(order?.vehicle?.vin),
          plate,
          clientName: normalizeText(order?.client?.name),
          vehicleLabel: formatVehicleLabel(order),
          trackingNumber: normalizeText(order?.trackingNumber),
          orderIdentifier: normalizeText(order?.vehicle?.internalIdentifier || order?.trackingNumber || order?._id),
          brand: normalizeText(order?.vehicle?.brand),
          model: normalizeText(order?.vehicle?.model),
          version: normalizeText(order?.vehicle?.version),
          year: order?.vehicle?.year || "",
          color: normalizeText(order?.vehicle?.color || order?.vehicle?.exteriorColor || order?.vehicle?.interiorColor),
          purchasePrice: order?.vehicle?.purchasePrice ?? null,
          salePrice: order?.vehicle?.salePrice ?? null,
          currentStage,
        };
      })
      .sort((left, right) => new Date(right.order?.createdAt || 0).getTime() - new Date(left.order?.createdAt || 0).getTime());
  }

  function renderStats(vehicles) {
    const withPlate = vehicles.filter((vehicle) => vehicle.plate).length;
    const withoutPlate = vehicles.length - withPlate;
    const inDeliveryOrMore = vehicles.filter((vehicle) => vehicle.currentStage.index >= 7).length;

    vehiclesTotalCount.textContent = String(vehicles.length);
    vehiclesWithPlateCount.textContent = String(withPlate);
    vehiclesWithoutPlateCount.textContent = String(withoutPlate);
    vehiclesStageE8Count.textContent = String(inDeliveryOrMore);
  }

  function renderVehiclesTable(vehicles) {
    vehiclesResultsCount.textContent = `${vehicles.length} vehículo(s)`;

    if (!vehicles.length) {
      setEmptyResults("No hay vehículos que coincidan con los filtros.");
      return;
    }

    vehiclesResultsBody.innerHTML = vehicles.map((vehicle) => `
      <tr>
        <td data-label="VIN">
          <strong>${escapeHtml(vehicle.vin || "-")}</strong>
          <small>${escapeHtml(vehicle.color || "Sin color")}</small>
        </td>
        <td data-label="Vehículo">
          <strong>${escapeHtml(vehicle.vehicleLabel)}</strong>
          <small>${escapeHtml(vehicle.brand || "Sin marca")}</small>
        </td>
        <td data-label="Placa">${escapeHtml(vehicle.plate || "—")}</td>
        <td data-label="Cliente">${escapeHtml(vehicle.clientName || "Sin cliente")}</td>
        <td data-label="Tracking" class="vehicle-tracking-cell">
          <button class="vehicle-tracking-link" type="button" data-open-vehicle-order="${escapeHtml(vehicle.id)}">${escapeHtml(vehicle.trackingNumber || vehicle.orderIdentifier || "Sin tracking")}</button>
        </td>
        <td data-label="Etapa">${escapeHtml(vehicle.currentStage.display)}</td>
        <td data-label="Acciones" class="vehicles-actions-cell">
          ${vehicle.orderRegion === "latam" ? `
          <button class="compact-action-button vehicle-edit-action" type="button" data-edit-vehicle-pricing="${escapeHtml(vehicle.id)}" aria-label="Editar precios del vehículo">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58ZM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.13 1.13 3.75 3.75 1.13-1.13Z"></path>
            </svg>
          </button>
          ` : "<span aria-hidden=\"true\">—</span>"}
        </td>
      </tr>
    `).join("");
  }

  function applyFilters() {
    const rawSearch = normalizeSearchValue(vehiclesSearchInput.value);
    const clientName = normalizeText(vehiclesClientFilter.value);
    const orderIdentifier = normalizeSearchValue(vehiclesOrderIdFilter.value);
    const vin = normalizeSearchValue(vehiclesVinFilter.value);
    const year = normalizeText(vehiclesYearFilter.value);
    const stageKey = normalizeText(vehiclesStageFilter.value);

    const filteredVehicles = allVehicles.filter((vehicle) => {
      if (clientName && vehicle.clientName !== clientName) {
        return false;
      }

      if (orderIdentifier && !normalizeSearchValue(vehicle.orderIdentifier).includes(orderIdentifier)) {
        return false;
      }

      if (vin && !normalizeSearchValue(vehicle.vin).includes(vin)) {
        return false;
      }

      if (year && String(vehicle.year || "") !== year) {
        return false;
      }

      if (stageKey && vehicle.currentStage.key !== stageKey) {
        return false;
      }

      if (rawSearch) {
        const searchable = [
          vehicle.vin,
          vehicle.plate,
          vehicle.trackingNumber,
          vehicle.brand,
          vehicle.model,
          vehicle.version,
          vehicle.color,
          vehicle.clientName,
          vehicle.orderIdentifier,
        ].map(normalizeSearchValue).join(" ");

        if (!searchable.includes(rawSearch)) {
          return false;
        }
      }

      return true;
    });

    renderStats(filteredVehicles);
    renderVehiclesTable(filteredVehicles);
  }

  function openPricingModal(vehicleId) {
    const vehicle = allVehicles.find((item) => item.id === vehicleId);

    if (!vehicle || !vehiclePricingModal) {
      return;
    }

    selectedVehicleId = vehicle.id;
    vehiclePlateInput.value = vehicle.plate ?? "";
    vehiclePurchasePriceInput.value = vehicle.purchasePrice ?? "";
    vehicleSalePriceInput.value = vehicle.salePrice ?? "";
    vehicleModalSummary.innerHTML = `
      <strong>${escapeHtml(vehicle.vehicleLabel)}</strong><br />
      Cliente: ${escapeHtml(vehicle.clientName || "Sin cliente")} · Tracking: ${escapeHtml(vehicle.trackingNumber || vehicle.orderIdentifier || "Sin tracking")}<br />
      Placa actual: ${escapeHtml(vehicle.plate || "Sin placa")}<br />
      Compra actual: ${escapeHtml(formatCurrency(vehicle.purchasePrice))} · Venta actual: ${escapeHtml(formatCurrency(vehicle.salePrice))}
    `;
    setFeedback(vehicleModalFeedback, "");
    vehiclePricingModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  function closePricingModal() {
    if (!vehiclePricingModal) {
      return;
    }

    selectedVehicleId = "";
    vehiclePricingModal.hidden = true;
    document.body.classList.remove("modal-open");
    vehiclePricingForm.reset();
    setFeedback(vehicleModalFeedback, "");
  }

  async function loadVehiclesPage() {
    try {
      await loadAdminSession();
      const [ordersData, clientsData] = await Promise.all([
        fetchJson("/api/admin/orders"),
        fetchJson("/api/admin/clients"),
      ]);

      allVehicles = normalizeVehicles(ordersData.orders || []);
      fillClientFilter(clientsData.clients || []);
      fillStageFilter();
      applyFilters();
    } finally {
      stopInitOverlayWatchdog();
      forceClearLoadingState();
    }
  }

  vehiclePricingForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedVehicleId) {
      return;
    }

    vehiclePricingSave.disabled = true;
    setFeedback(vehicleModalFeedback, "Guardando precios...");

    try {
      const result = await fetchJson(`/api/admin/orders/${encodeURIComponent(selectedVehicleId)}/vehicle-pricing`, {
        method: "PATCH",
        body: JSON.stringify({
          plate: normalizeText(vehiclePlateInput.value),
          purchasePrice: normalizeText(vehiclePurchasePriceInput.value),
          salePrice: normalizeText(vehicleSalePriceInput.value),
        }),
      });

      const updatedVehicle = normalizeVehicles([result.order])[0] || null;

      if (updatedVehicle) {
        allVehicles = allVehicles.map((vehicle) => vehicle.id === updatedVehicle.id ? updatedVehicle : vehicle);
      }

      setFeedback(vehiclesFeedback, "Precios del vehículo actualizados correctamente.", "success");
      closePricingModal();
      applyFilters();
    } catch (error) {
      setFeedback(vehicleModalFeedback, error.message, "error");
    } finally {
      vehiclePricingSave.disabled = false;
    }
  });

  vehiclesResultsBody?.addEventListener("click", (event) => {
    const detailButton = event.target.closest("[data-open-vehicle-order]");

    if (detailButton) {
      const vehicle = allVehicles.find((item) => item.id === (detailButton.getAttribute("data-open-vehicle-order") || ""));

      if (vehicle?.order) {
        window.location.href = buildOrderDetailUrl(vehicle.order);
      }

      return;
    }

    const button = event.target.closest("[data-edit-vehicle-pricing]");

    if (!button) {
      return;
    }

    openPricingModal(button.getAttribute("data-edit-vehicle-pricing") || "");
  });

  vehiclesFilterButton?.addEventListener("click", applyFilters);
  vehiclesClearButton?.addEventListener("click", () => {
    vehiclesSearchInput.value = "";
    vehiclesClientFilter.value = "";
    vehiclesOrderIdFilter.value = "";
    vehiclesVinFilter.value = "";
    vehiclesYearFilter.value = "";
    vehiclesStageFilter.value = "";
    applyFilters();
  });
  vehiclePricingCancel?.addEventListener("click", closePricingModal);
  vehiclePricingModal?.querySelector('[data-close-modal="vehicle-pricing-modal"]')?.addEventListener("click", closePricingModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && vehiclePricingModal && !vehiclePricingModal.hidden) {
      closePricingModal();
    }
  });

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);

  loadVehiclesPage().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    setEmptyResults(error.message);
    setFeedback(vehiclesFeedback, error.message, "error");
  });
}
})();