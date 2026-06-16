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
  const completedStageCard = { key: "completed", label: "Completado" };

  const ordersTableBody = document.getElementById("state-orders-table-body");
  const ordersTableCount = document.getElementById("state-orders-table-count");
  const feedback = document.getElementById("state-feedback");
  const stateKeyChip = document.getElementById("state-key-chip");
  const statePageTitle = document.getElementById("state-page-title");
  const statePageLead = document.getElementById("state-page-lead");
  const stateTotalCount = document.getElementById("state-total-count");
  const stateLabelSummary = document.getElementById("state-label-summary");
  let orders = [];
  let currentAdminRole = "";
  let currentAdminEmail = "";
  let initOverlayWatchdog = null;

  const ANTHONY_GLOBAL_OWNER_EMAIL = "anthony-vergel@hotmail.com";

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

  function getLatestTrackingUpdate(updates = []) {
    if (!Array.isArray(updates) || !updates.length) {
      return null;
    }

    return updates.reduce((latestUpdate, currentUpdate) => {
      if (!latestUpdate) {
        return currentUpdate;
      }

      const latestTime = new Date(latestUpdate.updatedAt || latestUpdate.createdAt || 0).getTime();
      const currentTime = new Date(currentUpdate.updatedAt || currentUpdate.createdAt || 0).getTime();

      return currentTime >= latestTime ? currentUpdate : latestUpdate;
    }, null);
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function setEmptyResults(message) {
    if (!ordersTableBody) {
      return;
    }

    ordersTableBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  }

  function getOrderIdentifier(order) {
    return String(order?._id || order?.id || "").trim();
  }

  function isDeletionManagerRole(role) {
    return ["manager", "gerenteUSA"].includes(String(role || "").trim());
  }

  function hasPendingDeletionRequest(order) {
    return String(order?.deletionRequest?.status || "").trim().toLowerCase() === "pending";
  }

  function getClientDisplayName(order) {
    return normalizeText(order?.client?.name || "Cliente sin asignar") || "Cliente sin asignar";
  }

  function buildOrderDetailUrl(order) {
    const orderId = getOrderIdentifier(order);
    const trackingValue = String(order?.trackingNumber || "").trim();
    const vinValue = String(order?.vehicle?.vin || "").trim();
    const clientValue = String(getClientDisplayName(order) || "").trim();

    return `/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(trackingValue)}&vin=${encodeURIComponent(vinValue)}&client=${encodeURIComponent(clientValue)}`;
  }

  function formatOrderLabel(order) {
    return `${order?.vehicle?.brand || "Vehículo"} ${order?.vehicle?.model || ""}${order?.vehicle?.version ? ` ${order.vehicle.version}` : ""} ${order?.vehicle?.year || ""}`.trim();
  }

  function formatDateLabel(dateValue) {
    if (!dateValue) {
      return "Sin fecha";
    }

    if (typeof adminFormatDate === "function") {
      return adminFormatDate(dateValue);
    }

    const resolvedDate = new Date(dateValue);

    if (Number.isNaN(resolvedDate.getTime())) {
      return "Sin fecha";
    }

    return resolvedDate.toLocaleDateString("es-CO", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function isAnthonyGlobalOwner() {
    return currentAdminRole === "manager" && currentAdminEmail === ANTHONY_GLOBAL_OWNER_EMAIL;
  }

  function shouldShowOrderRegionBadge() {
    return ["admin", "manager", "adminUSA", "gerenteUSA"].includes(String(currentAdminRole || "").trim()) || isAnthonyGlobalOwner();
  }

  function renderOrderRegionBadge(order) {
    if (!shouldShowOrderRegionBadge()) {
      return "";
    }

    const orderRegion = String(order?.orderRegion || "latam").trim().toLowerCase();

    if (!["latam", "usa"].includes(orderRegion)) {
      return "";
    }

    return `<span class="tracking-order-region-badge is-${escapeHtml(orderRegion)}">${escapeHtml(orderRegion.toUpperCase())}</span>`;
  }

  function getOrderTrackingEvents(order) {
    return (Array.isArray(order?.trackingEvents) ? order.trackingEvents : [])
      .map((event) => {
        const stateKey = String(event?.stateKey || event?.stepKey || "").trim();
        const stageIndex = stageTemplates.findIndex((stage) => stage.key === stateKey);
        const parsedStateIndex = Number.isInteger(event?.stateIndex)
          ? event.stateIndex
          : Number.parseInt(String(event?.stateIndex || ""), 10);
        const parsedUpdateIndex = Number.isInteger(event?.updateIndex)
          ? event.updateIndex
          : Number.parseInt(String(event?.updateIndex || ""), 10);

        return {
          eventId: String(event?.eventId || event?._id || `${stateKey}-${parsedUpdateIndex}`),
          stateKey,
          stateIndex: Number.isNaN(parsedStateIndex) ? stageIndex : parsedStateIndex,
          updateIndex: Number.isNaN(parsedUpdateIndex) ? -1 : parsedUpdateIndex,
          notes: normalizeText(event?.notes || ""),
          media: Array.isArray(event?.media) ? event.media.filter((item) => item?.url) : [],
          clientVisible: Boolean(event?.clientVisible),
          inProgress: Boolean(event?.completed ? false : event?.inProgress),
          completed: Boolean(event?.completed),
          createdAt: event?.createdAt || null,
          updatedAt: event?.updatedAt || event?.createdAt || null,
        };
      })
      .filter((event) => event.stateKey)
      .sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();

        return rightTime - leftTime;
      });
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
    currentAdminRole = String(user.role || "").trim();
    currentAdminEmail = String(user.email || "").trim().toLowerCase();
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
    if (stageKey === completedStageCard.key) {
      return completedStageCard;
    }

    return stageTemplates.find((stage) => stage.key === stageKey) || null;
  }

  function isOrderCompleted(order) {
    if (String(order?.status || "").trim().toLowerCase() === "completed") {
      return true;
    }

    return getOrderTrackingEvents(order).some((event) => event.completed && event.stateIndex === stageTemplates.length - 1);
  }

  function resolveActiveStepIndex(normalizedSteps) {
    let highestConfirmedIndex = -1;

    normalizedSteps.forEach((step, index) => {
      if (isStepConfirmed(step?.confirmed)) {
        highestConfirmedIndex = Math.max(highestConfirmedIndex, index);
      }
    });

    for (let index = highestConfirmedIndex + 1; index < normalizedSteps.length; index += 1) {
      const step = normalizedSteps[index];

      if (!isStepConfirmed(step?.confirmed) && step?.inProgress) {
        return index;
      }
    }

    for (let index = highestConfirmedIndex + 1; index < normalizedSteps.length; index += 1) {
      if (!isStepConfirmed(normalizedSteps[index]?.confirmed)) {
        return index;
      }
    }

    return highestConfirmedIndex >= 0 ? highestConfirmedIndex : 0;
  }

  function getOrderTrackingSteps(order) {
    const orderSteps = Array.isArray(order?.trackingSteps) ? order.trackingSteps : [];
    const stepsByKey = new Map(orderSteps.map((step, index) => [String(step?.key || stageTemplates[index]?.key || ""), step]));
    const trackingEvents = getOrderTrackingEvents(order);
    const trackingEventsByKey = new Map();
    const isCompletedOrder = isOrderCompleted(order);

    trackingEvents.forEach((event) => {
      if (!trackingEventsByKey.has(event.stateKey)) {
        trackingEventsByKey.set(event.stateKey, []);
      }

      trackingEventsByKey.get(event.stateKey).push(event);
    });

    const normalizedSteps = stageTemplates.map((template, index) => {
      const sourceStep = stepsByKey.get(template.key) || orderSteps[index] || {};
      const eventUpdates = (trackingEventsByKey.get(template.key) || [])
        .slice()
        .sort((left, right) => left.updateIndex - right.updateIndex)
        .map((event) => ({
          eventId: event.eventId,
          notes: event.notes,
          media: event.media,
          clientVisible: event.clientVisible,
          inProgress: event.inProgress,
          completed: event.completed,
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
        }));
      const updates = eventUpdates.length
        ? eventUpdates
        : (Array.isArray(sourceStep?.updates)
          ? sourceStep.updates.map((update) => ({
              eventId: String(update?.eventId || "").trim(),
              notes: normalizeText(update?.notes || ""),
              media: Array.isArray(update?.media) ? update.media.filter((item) => item?.url) : [],
              clientVisible: Boolean(update?.clientVisible),
              inProgress: Boolean(update?.completed ? false : update?.inProgress),
              completed: Boolean(update?.completed),
              createdAt: update?.createdAt || null,
              updatedAt: update?.updatedAt || null,
            }))
          : []);
      const latestUpdate = getLatestTrackingUpdate(updates);
      const derivedConfirmed =
        Boolean(sourceStep?.confirmed) ||
        updates.some((update) => Boolean(update?.completed));
      const derivedInProgress =
        !derivedConfirmed &&
        (Boolean(sourceStep?.inProgress) ||
          updates.some((update) => Boolean(update?.inProgress) && !Boolean(update?.completed)));

      return {
        key: template.key,
        label: String(sourceStep?.label || template.label),
        confirmed: isCompletedOrder ? true : derivedConfirmed,
        inProgress: isCompletedOrder ? false : derivedInProgress,
        updates,
        updatedAt: sourceStep?.updatedAt || latestUpdate?.updatedAt || latestUpdate?.createdAt || null,
        confirmedAt: sourceStep?.confirmedAt || (isCompletedOrder ? order?.updatedAt || order?.createdAt || null : null),
      };
    });

    const activeIndex = resolveActiveStepIndex(normalizedSteps);

    if (isCompletedOrder) {
      return normalizedSteps.map((step) => ({
        ...step,
        confirmed: true,
        inProgress: false,
        confirmedAt: step.confirmedAt || order?.updatedAt || order?.createdAt || null,
      }));
    }

    return normalizedSteps.map((step, index) => ({
      ...step,
      inProgress: !step.confirmed && index === activeIndex,
    }));
  }

  function resolveCurrentStageKey(order) {
    if (order?.status === "cancelled") {
      return null;
    }

    const steps = getOrderTrackingSteps(order);
    const activeStep = steps.find((step) => Boolean(step?.inProgress) && !isStepConfirmed(step?.confirmed));

    if (activeStep?.key) {
      return activeStep.key;
    }

    const firstPendingIndex = steps.findIndex((step) => !isStepConfirmed(step?.confirmed));

    if (firstPendingIndex === -1) {
      return stageTemplates[stageTemplates.length - 1]?.key || null;
    }

    return stageTemplates[firstPendingIndex]?.key || null;
  }

  function resolveStateBucketKey(order) {
    if (isOrderCompleted(order)) {
      return completedStageCard.key;
    }

    return resolveCurrentStageKey(order);
  }

  function renderCurrentStageLabel(order) {
    if (resolveStateBucketKey(order) === completedStageCard.key) {
      return "E10: Completado";
    }

    const currentStageKey = resolveCurrentStageKey(order);
    const currentStageIndex = stageTemplates.findIndex((stage) => stage.key === currentStageKey);

    if (currentStageIndex === -1) {
      return "Sin estado definido";
    }

    const currentStageLabel = stageTemplates[currentStageIndex]?.label || "Estado";
    return `E${currentStageIndex + 1}: ${currentStageLabel}`;
  }

  function getCurrentStageMeta(order) {
    const currentStageKey = resolveStateBucketKey(order);

    if (currentStageKey === completedStageCard.key) {
      return {
        key: completedStageCard.key,
        index: stageTemplates.length,
        code: `E${stageTemplates.length + 1}`,
        label: completedStageCard.label,
      };
    }

    const stageIndex = stageTemplates.findIndex((stage) => stage.key === currentStageKey);

    if (stageIndex === -1) {
      return { key: "", index: -1, code: "-", label: "Sin etapa" };
    }

    return {
      key: currentStageKey,
      index: stageIndex,
      code: `E${stageIndex + 1}`,
      label: String(stageTemplates[stageIndex]?.label || "Estado"),
    };
  }

  function renderOrderTrackingSummary(order) {
    const steps = getOrderTrackingSteps(order);
    const currentStageKey = resolveCurrentStageKey(order);
    const completedStateChip = resolveStateBucketKey(order) === completedStageCard.key
      ? `<span class="order-step-chip is-confirmed">E10 ${escapeHtml(completedStageCard.label)}</span>`
      : "";

    return steps
      .map((step, index) => {
        const statusClass = step?.key === currentStageKey
          ? "is-active"
          : isStepConfirmed(step?.confirmed)
            ? "is-confirmed"
            : "is-pending";
        return `<span class="order-step-chip ${statusClass}">E${index + 1} ${escapeHtml(step?.label || "Estado")}</span>`;
      })
      .join("") + completedStateChip;
  }

  function renderOrders(orders) {
    if (ordersTableCount) {
      ordersTableCount.textContent = `${orders.length} pedido(s)`;
    }

    if (!orders.length) {
      setEmptyResults("No hay pedidos en este estado actualmente.");
      return;
    }

    ordersTableBody.innerHTML = orders
      .map((order) => {
        const orderId = getOrderIdentifier(order);
        const trackingValue = String(order?.trackingNumber || "").trim();
        const vinValue = String(order?.vehicle?.vin || "").trim();
        const detailUrl = buildOrderDetailUrl(order);
        const stageMeta = getCurrentStageMeta(order);
        const vehicleLabel = formatOrderLabel(order);
        const rowDate = formatDateLabel(order?.purchaseDate || order?.createdAt);
        const pendingDeletion = hasPendingDeletionRequest(order);
        const deleteLabel = pendingDeletion ? "Solicitud pendiente" : "Eliminar pedido";

        return `
          <tr
            class="tracking-order-row"
            data-order-row-select="true"
            data-order-id="${escapeHtml(orderId)}"
            tabindex="0"
            aria-label="Seleccionar pedido ${escapeHtml(trackingValue || vehicleLabel || orderId)}"
          >
            <td data-label="Tracking">
              <div class="tracking-order-link-stack">
                <button class="tracking-order-link-button" type="button" data-order-detail-link="${escapeHtml(detailUrl)}" data-order-id="${escapeHtml(orderId)}">
                  ${escapeHtml(trackingValue || "-")}
                </button>
                ${renderOrderRegionBadge(order)}
              </div>
            </td>
            <td data-label="VIN">${escapeHtml(vinValue || "Sin VIN")}</td>
            <td data-label="Cliente">${escapeHtml(getClientDisplayName(order))}</td>
            <td data-label="Destino">${escapeHtml(order?.vehicle?.destination || "-")}</td>
            <td data-label="Estado">${escapeHtml(`${stageMeta.code} · ${stageMeta.label}`)}</td>
            <td data-label="Vehículo"><strong>${escapeHtml(vehicleLabel)}</strong></td>
            <td data-label="Fecha">${escapeHtml(rowDate)}</td>
            <td data-label="Acción" class="tracking-order-actions-cell">
              <div class="tracking-order-actions">
                <button class="tracking-order-action-button" type="button" data-order-edit="${escapeHtml(orderId)}" aria-label="Editar pedido ${escapeHtml(trackingValue || orderId)}">&#9998;</button>
                <button class="tracking-order-action-button is-danger" type="button" data-order-delete="${escapeHtml(orderId)}" ${pendingDeletion ? 'disabled aria-disabled="true"' : ""} aria-label="${escapeHtml(deleteLabel)} ${escapeHtml(trackingValue || orderId)}">&times;</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  async function handleDeleteOrderAction(orderId) {
    const order = orders.find((item) => getOrderIdentifier(item) === String(orderId || "").trim()) || null;

    if (!order) {
      setFeedback(feedback, "No se pudo identificar el pedido.", "error");
      return;
    }

    if (hasPendingDeletionRequest(order)) {
      setFeedback(feedback, "Este pedido ya tiene una solicitud de eliminación pendiente.", "error");
      return;
    }

    try {
      if (isDeletionManagerRole(currentAdminRole)) {
        if (!window.confirm("¿Seguro que deseas eliminar este pedido?")) {
          return;
        }

        await adminFetchJson(`/api/admin/orders/${getOrderIdentifier(order)}/deletion-request`, {
          method: "POST",
          body: JSON.stringify({}),
          loadingMessage: false,
        });

        await loadPage();
        setFeedback(feedback, "Pedido eliminado correctamente.", "success");
        return;
      }

      const reason = normalizeText(window.prompt("Indica el motivo de la solicitud de eliminación:", "") || "");

      if (!reason) {
        return;
      }

      await adminFetchJson(`/api/admin/orders/${getOrderIdentifier(order)}/deletion-request`, {
        method: "POST",
        body: JSON.stringify({ reason }),
        loadingMessage: false,
      });

      await loadPage();
      setFeedback(feedback, "Solicitud de eliminación enviada correctamente.", "success");
    } catch (error) {
      setFeedback(feedback, error.message || "No se pudo procesar la eliminación del pedido.", "error");
    }
  }

  function handleStateOrdersClick(event) {
    const detailButton = event.target.closest("[data-order-detail-link]");

    if (detailButton) {
      const href = normalizeText(detailButton.dataset.orderDetailLink || "");

      if (href) {
        window.location.href = href;
      }

      return;
    }

    const editButton = event.target.closest("[data-order-edit]");

    if (editButton) {
      const order = orders.find((item) => getOrderIdentifier(item) === String(editButton.dataset.orderEdit || "").trim()) || null;

      if (order) {
        window.location.href = buildOrderDetailUrl(order);
      }

      return;
    }

    const deleteButton = event.target.closest("[data-order-delete]");

    if (deleteButton) {
      handleDeleteOrderAction(String(deleteButton.dataset.orderDelete || "")).catch(() => null);
      return;
    }

    const orderRow = event.target.closest("[data-order-row-select]");

    if (orderRow) {
      const order = orders.find((item) => getOrderIdentifier(item) === String(orderRow.dataset.orderId || "").trim()) || null;

      if (order) {
        window.location.href = buildOrderDetailUrl(order);
      }
    }
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
        setEmptyResults("No se pudo determinar el estado solicitado.");
        return;
      }

      stateKeyChip.textContent = selectedStage.label;
      statePageTitle.textContent = `Pedidos en estado: ${selectedStage.label}`;
      statePageLead.textContent = selectedStateKey === completedStageCard.key
        ? "Listado de pedidos finalizados para LATAM y USA."
        : "Listado de pedidos filtrados por su estado actual en tracking.";
      stateLabelSummary.textContent = selectedStage.label;

      if (typeof adminFetchJson !== "function") {
        throw new Error("No se pudo inicializar el cliente de datos del admin.");
      }

      const ordersData = await adminFetchJson("/api/admin/orders", { loadingMessage: false });
      orders = normalizeCollectionPayload(ordersData, ["orders"]);
      const filteredOrders = orders.filter((order) => resolveStateBucketKey(order) === selectedStateKey);

      stateTotalCount.textContent = String(filteredOrders.length);
      renderOrders(filteredOrders);
      setFeedback(feedback, `Se cargaron ${filteredOrders.length} pedido(s) en este estado.`, "success");
    } catch (error) {
      setFeedback(feedback, error.message || "No se pudo cargar el estado.", "error");
      setEmptyResults("No fue posible cargar los pedidos de este estado.");
    } finally {
      stopInitOverlayWatchdog();
      forceClearLoadingState();
    }
  }

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);
  ordersTableBody?.addEventListener("click", handleStateOrdersClick);

  loadPage().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    setFeedback(feedback, error.message || "No se pudo iniciar la pantalla.", "error");
  });
})();
