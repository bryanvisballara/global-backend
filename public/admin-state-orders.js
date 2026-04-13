(() => {
  const adminApp = window.AdminApp || {};
  const {
    attachLogout: adminAttachLogout,
    fetchJson: adminFetchJson,
    formatDate: adminFormatDate,
    renderEmptyState,
    resetLoadingOverlay,
    setFeedback,
    trackingTemplates,
  } = adminApp;

  const fallbackTrackingTemplates = [
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

  const stageTemplates = Array.isArray(trackingTemplates) && trackingTemplates.length
    ? trackingTemplates
    : fallbackTrackingTemplates;

  const ordersList = document.getElementById("state-orders-list");
  const feedback = document.getElementById("state-feedback");
  const stateKeyChip = document.getElementById("state-key-chip");
  const statePageTitle = document.getElementById("state-page-title");
  const statePageLead = document.getElementById("state-page-lead");
  const stateTotalCount = document.getElementById("state-total-count");
  const stateLabelSummary = document.getElementById("state-label-summary");
  let initOverlayWatchdog = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isStepConfirmed(value) {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "number") {
      return value === 1;
    }

    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();
      return ["true", "1", "yes", "on"].includes(normalizedValue);
    }

    return false;
  }

  function normalizeCollectionPayload(payload, keys = []) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }

    return [];
  }

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

  async function loadSessionProfile() {
    if (typeof adminFetchJson !== "function") {
      return;
    }

    const data = await adminFetchJson("/api/auth/me", { loadingMessage: false });
    const user = data.user || {};
    const nameElement = document.getElementById("admin-name");
    const emailElement = document.getElementById("admin-email");

    if (nameElement) {
      nameElement.textContent = user.name || "Administrador";
    }

    if (emailElement) {
      emailElement.textContent = user.email || "admin@globalimports.com";
    }
  }

  function getSelectedStateKey() {
    const url = new URL(window.location.href);
    return String(url.searchParams.get("state") || "").trim();
  }

  function getStageByKey(stageKey) {
    return stageTemplates.find((stage) => stage.key === stageKey) || null;
  }

  function getOrderTrackingSteps(order) {
    if (!Array.isArray(order?.trackingSteps)) {
      return [];
    }

    return stageTemplates.map((template, index) => {
      const matchingStep = order.trackingSteps.find((step) => step?.key === template.key);
      return matchingStep || order.trackingSteps[index] || { ...template, confirmed: false };
    });
  }

  function resolveCurrentStageKey(order) {
    if (order?.status === "cancelled") {
      return null;
    }

    const steps = getOrderTrackingSteps(order);
    const firstPendingIndex = steps.findIndex((step) => !isStepConfirmed(step?.confirmed));

    if (firstPendingIndex === -1) {
      return stageTemplates[stageTemplates.length - 1]?.key || null;
    }

    return stageTemplates[firstPendingIndex]?.key || null;
  }

  function renderOrderTrackingSummary(order) {
    const steps = getOrderTrackingSteps(order);

    return steps
      .map((step, index) => {
        const statusClass = isStepConfirmed(step?.confirmed) ? "is-confirmed" : "is-pending";
        return `<span class="order-step-chip ${statusClass}">E${index + 1} ${escapeHtml(step?.label || "Estado")}</span>`;
      })
      .join("");
  }

  function renderOrders(orders) {
    if (!orders.length) {
      renderEmptyState(ordersList, "No hay vehículos en este estado actualmente.");
      return;
    }

    ordersList.innerHTML = orders
      .map((order) => {
        const vehicle = order.vehicle || {};
        const client = order.client || {};
        const mediaCount = Array.isArray(order.media) ? order.media.length : 0;
        const orderId = String(order._id || order.id || "").trim();
        const trackingValue = String(order.trackingNumber || "").trim();
        const vinValue = String(vehicle.vin || "").trim();
        const internalIdentifierValue = String(vehicle.internalIdentifier || vehicle.description || "").trim();
        const trackingEditorUrl = `/app/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(trackingValue)}&vin=${encodeURIComponent(vinValue)}&internal=${encodeURIComponent(internalIdentifierValue)}`;

        return `
          <a class="state-order-item state-order-link" href="${trackingEditorUrl}">
            <header class="state-order-header">
              <h3>${escapeHtml(vehicle.brand || "Vehículo")} ${escapeHtml(vehicle.model || "")}</h3>
              <span class="section-tag">Tracking ${escapeHtml(order.trackingNumber || "-")}</span>
            </header>

            <div class="state-order-grid">
              <p><strong>Versión:</strong> ${escapeHtml(vehicle.version || "Sin versión")}</p>
              <p><strong>Año:</strong> ${escapeHtml(vehicle.year || "-")}</p>
              <p><strong>VIN:</strong> ${escapeHtml(vehicle.vin || "-")}</p>
              <p><strong>Color:</strong> ${escapeHtml(vehicle.color || "-")}</p>
              <p><strong>Cliente:</strong> ${escapeHtml(client.name || "Sin asignar")}</p>
              <p><strong>Email cliente:</strong> ${escapeHtml(client.email || "-")}</p>
              <p><strong>Teléfono:</strong> ${escapeHtml(client.phone || "-")}</p>
              <p><strong>Estado pedido:</strong> ${escapeHtml(order.status || "-")}</p>
              <p><strong>Compra:</strong> ${escapeHtml(adminFormatDate(order.purchaseDate))}</p>
              <p><strong>Llegada estimada:</strong> ${escapeHtml(adminFormatDate(order.expectedArrivalDate))}</p>
              <p><strong>Media del pedido:</strong> ${escapeHtml(mediaCount)} archivo(s)</p>
              <p><strong>ID interno:</strong> ${escapeHtml(vehicle.internalIdentifier || "-")}</p>
            </div>

            <p class="state-order-notes"><strong>Notas:</strong> ${escapeHtml(order.notes || "Sin notas internas")}</p>
            <div class="order-steps-row">${renderOrderTrackingSummary(order)}</div>
          </a>
        `;
      })
      .join("");
  }

  async function loadPage() {
    try {
      if (typeof adminAttachLogout === "function") {
        adminAttachLogout();
      }

      await loadSessionProfile();

      const selectedStateKey = getSelectedStateKey();
      const selectedStage = getStageByKey(selectedStateKey);

      if (!selectedStage) {
        setFeedback(feedback, "Estado inválido. Vuelve al dashboard y selecciona un estado válido.", "error");
        renderEmptyState(ordersList, "No se pudo determinar el estado solicitado.");
        return;
      }

      stateKeyChip.textContent = selectedStage.label;
      statePageTitle.textContent = `Vehículos en estado: ${selectedStage.label}`;
      statePageLead.textContent = "Listado de vehículos filtrados por su estado actual en tracking.";
      stateLabelSummary.textContent = selectedStage.label;

      if (typeof adminFetchJson !== "function") {
        throw new Error("No se pudo inicializar el cliente de datos del admin.");
      }

      const ordersData = await adminFetchJson("/api/admin/orders", { loadingMessage: false });
      const orders = normalizeCollectionPayload(ordersData, ["orders"]);
      const filteredOrders = orders.filter((order) => resolveCurrentStageKey(order) === selectedStateKey);

      stateTotalCount.textContent = String(filteredOrders.length);
      renderOrders(filteredOrders);
      setFeedback(feedback, `Se cargaron ${filteredOrders.length} vehículo(s) en este estado.`, "success");
    } catch (error) {
      setFeedback(feedback, error.message || "No se pudo cargar el estado.", "error");
      renderEmptyState(ordersList, "No fue posible cargar los vehículos de este estado.");
    } finally {
      stopInitOverlayWatchdog();
      forceClearLoadingState();
    }
  }

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);

  loadPage().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    setFeedback(feedback, error.message || "No se pudo iniciar la pantalla.", "error");
  });
})();
