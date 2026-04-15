const {
  attachLogout: adminAttachLogout,
  renderEmptyState: adminRenderEmptyState,
  redirectToLogin: adminRedirectToLogin,
  resetLoadingOverlay: adminResetLoadingOverlay,
  setFeedback: adminSetFeedback,
  trackingTemplates: adminTrackingTemplates,
} = window.AdminApp;

function resolveTrackingApiBaseUrl() {
  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${port || "10000"}`;
  }

  return "https://global-backend-bdbx.onrender.com";
}

async function fetchTrackingPageJson(path, options = {}) {
  const authToken = localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
  const isFormDataBody = options.body instanceof FormData;

  const response = await fetch(`${resolveTrackingApiBaseUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });

  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 || data.message === "Authentication required" || data.message === "Invalid or expired token") {
      adminRedirectToLogin();
    }

    throw new Error(data.message || "Request failed");
  }

  return data;
}

async function loadTrackingPageSession() {
  const data = await fetchTrackingPageJson("/api/auth/me");
  const user = data.user || {};
  currentAdminRole = String(user.role || "");


  if (user.role) {
    localStorage.setItem("globalAppRole", user.role);
    sessionStorage.setItem("globalAppRole", user.role);
  }
  if (user._id) {
    localStorage.setItem("globalAppUserId", user._id);
    sessionStorage.setItem("globalAppUserId", user._id);
  }

  document.getElementById("admin-name").textContent = user.name || "Administrador";
  document.getElementById("admin-email").textContent = user.email || "admin@globalimports.com";

  return user;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

adminAttachLogout();
document.body.classList.add("tracking-search-page");

const trackingRoot = document.getElementById("tracking-form");
const trackingFeedback = document.getElementById("tracking-feedback");
const trackingOrderInput = document.getElementById("tracking-order-id");
const trackingPreview = document.getElementById("tracking-preview");
const trackingEditorFields = document.getElementById("tracking-editor-fields");
const trackingSelectorPanel = document.getElementById("tracking-selector-panel");
const trackingSearchButton = document.getElementById("tracking-search-button");
const trackingClearButton = document.getElementById("tracking-clear-button");
const trackingSearchResults = document.getElementById("tracking-search-results");
const trackingStateFilter = document.getElementById("tracking-search-state");
const trackingDateFromFilter = document.getElementById("tracking-search-date-from");
const trackingDateToFilter = document.getElementById("tracking-search-date-to");
const trackingOrderSummary = document.getElementById("tracking-order-summary");
const trackingStatesList = document.getElementById("tracking-states-list");
const trackingSuccessModal = document.getElementById("tracking-success-modal");
const trackingSuccessClose = document.getElementById("tracking-success-close");
const searchConfigs = [
  {
    key: "tracking",
    input: document.getElementById("tracking-search-tracking"),
    list: document.getElementById("tracking-search-tracking-list"),
    getValue(order) {
      return String(order.trackingNumber || "");
    },
    placeholder: "Escribe o selecciona tracking",
  },
  {
    key: "vin",
    input: document.getElementById("tracking-search-vin"),
    list: document.getElementById("tracking-search-vin-list"),
    getValue(order) {
      return String(order.vehicle?.vin || "");
    },
    placeholder: "Escribe o selecciona VIN",
  },
  {
    key: "internal",
    input: document.getElementById("tracking-search-internal"),
    list: document.getElementById("tracking-search-internal-list"),
    getValue(order) {
      return getInternalIdentifier(order);
    },
    placeholder: "Escribe o selecciona identificador interno",
  },
];

let orders = [];
let selectedOrderId = "";
let expandedStateKey = "";
let expandedOverviewStateKey = "";
const expandedOverviewEventIds = new Set();
let currentAdminRole = "";
let initOverlayWatchdog = null;
const savingStates = new Set();
const pendingMediaByState = new Map();
const videoSourceMethodByState = new Map();
const videoLinkByState = new Map();
const draftStateValuesByState = new Map();

function createEmptyPendingMedia() {
  return {
    document: [],
    photoSingle: [],
    photoCarousel: [],
    video: [],
  };
}

function getPendingMediaForState(stateKey) {
  if (!pendingMediaByState.has(stateKey)) {
    pendingMediaByState.set(stateKey, createEmptyPendingMedia());
  }

  return pendingMediaByState.get(stateKey);
}

function getStateDraftDefaults(state) {
  return {
    notes: "",
    inProgress: isStateEffectivelyInProgress(state),
    confirmed: Boolean(state?.confirmed),
  };
}

function isStateEffectivelyInProgress(state, order = getSelectedOrder()) {
  if (!state || state.confirmed) {
    return false;
  }

  if (state.inProgress) {
    return true;
  }

  const currentStageKey = resolveCurrentStageKey(order);
  return Boolean(currentStageKey && currentStageKey === state.key);
}

function getStateDisplayUpdates(state, order = getSelectedOrder()) {
  const persistedUpdates = getStateUpdates(state);

  if (persistedUpdates.length) {
    return persistedUpdates;
  }

  const effectiveInProgress = isStateEffectivelyInProgress(state, order);
  const stateMedia = Array.isArray(state?.media) ? state.media : [];
  const hasNotes = Boolean(String(state?.notes || "").trim());
  const hasMedia = stateMedia.length > 0;
  const syntheticTimestamp = state?.confirmedAt || state?.updatedAt || order?.purchaseDate || order?.createdAt || null;
  const shouldCreateSyntheticUpdate = Boolean(state?.confirmed || effectiveInProgress || hasNotes || hasMedia || syntheticTimestamp);

  if (!shouldCreateSyntheticUpdate) {
    return [];
  }

  const syntheticNotes = hasNotes
    ? String(state.notes).trim()
    : state?.key === "order-received"
      ? "Orden creada."
      : state?.confirmed
        ? "Etapa completada."
        : effectiveInProgress
          ? "Estado en curso."
          : "";

  return [
    {
      notes: syntheticNotes,
      media: stateMedia,
      clientVisible: Boolean(state?.clientVisible),
      inProgress: effectiveInProgress,
      completed: Boolean(state?.confirmed),
      createdAt: syntheticTimestamp,
      updatedAt: syntheticTimestamp,
      isSynthetic: true,
    },
  ];
}

function getDraftStateValues(state) {
  const stateKey = String(state?.key || "");
  const defaults = getStateDraftDefaults(state);

  if (!stateKey) {
    return defaults;
  }

  return {
    ...defaults,
    ...(draftStateValuesByState.get(stateKey) || {}),
  };
}

function setDraftStateValues(stateKey, patch = {}) {
  const selectedOrder = getSelectedOrder();
  const state = (selectedOrder?.trackingSteps || []).find((item) => item.key === stateKey) || { key: stateKey };
  const currentDraft = getDraftStateValues(state);

  draftStateValuesByState.set(stateKey, {
    ...currentDraft,
    ...patch,
  });
}

function clearDraftStateValues(stateKey = "") {
  if (stateKey) {
    draftStateValuesByState.delete(stateKey);
    return;
  }

  draftStateValuesByState.clear();
}

function getCategoryByField(fieldName = "") {
  const mapping = {
    documentFile: "document",
    singlePhotoFile: "photoSingle",
    carouselPhotoFiles: "photoCarousel",
    videoFile: "video",
  };

  return mapping[fieldName] || "";
}

function getVideoMethodForState(stateKey) {
  return videoSourceMethodByState.get(stateKey) || "file";
}

function openSuccessModal() {
  if (!trackingSuccessModal) {
    return;
  }

  trackingSuccessModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeSuccessModal() {
  if (!trackingSuccessModal) {
    return;
  }

  trackingSuccessModal.hidden = true;
  document.body.classList.remove("modal-open");
}

window.__closeTrackingSuccessModal = closeSuccessModal;
closeSuccessModal();

function forceClearLoadingState() {
  if (typeof adminResetLoadingOverlay === "function") {
    adminResetLoadingOverlay();
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

function getInternalIdentifier(order) {
  return String(order?.vehicle?.internalIdentifier || order?.vehicle?.description || "");
}

function getOrderIdentifier(order) {
  return String(order?._id || order?.id || "").trim();
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

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  if (payload.data && typeof payload.data === "object") {
    for (const key of keys) {
      if (Array.isArray(payload.data[key])) {
        return payload.data[key];
      }
    }
  }

  return [];
}

function getActiveOrders() {
  return orders.filter((order) => order.status === "active");
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

function isUsaAdministrativeRole(role) {
  return ["adminUSA", "gerenteUSA"].includes(String(role || ""));
}

function canEditStateForRole(role, stateKey) {
  return Boolean(String(stateKey || "").trim());
}

function setLockedStateFeedback(stateKey) {
  const message = "No tienes permisos para modificar este estado.";
  const stateFeedback = trackingStatesList.querySelector(`[data-state-feedback="${stateKey}"]`);

  if (stateFeedback) {
    adminSetFeedback(stateFeedback, message, "error");
  }

  adminSetFeedback(trackingFeedback, message, "error");
}

function getOrderTrackingSteps(order) {
  const orderSteps = Array.isArray(order?.trackingSteps) ? order.trackingSteps : [];

  const normalizedSteps = adminTrackingTemplates.map((template, index) => {
    const matchingStep = orderSteps.find((step) => step?.key === template.key);
    const step = matchingStep || orderSteps[index] || {};

    return {
      ...template,
      ...step,
      confirmed: Boolean(step?.confirmed),
      inProgress: Boolean(step?.confirmed ? false : step?.inProgress),
      clientVisible: typeof step?.clientVisible === "boolean" ? step.clientVisible : false,
      notes: String(step?.notes || "").trim(),
      media: Array.isArray(step?.media) ? step.media : [],
      updates: Array.isArray(step?.updates) ? step.updates : [],
      updatedAt: step?.updatedAt || null,
      confirmedAt: step?.confirmedAt || null,
    };
  });

  const explicitActiveIndex = normalizedSteps.findIndex((step) => step.inProgress && !step.confirmed);
  const fallbackActiveIndex = normalizedSteps.findIndex((step) => !step.confirmed);
  const activeIndex = explicitActiveIndex >= 0 ? explicitActiveIndex : fallbackActiveIndex;

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
  const activeStep = steps.find((step) => step?.inProgress && !step?.confirmed);

  if (activeStep?.key) {
    return activeStep.key;
  }

  const firstPendingIndex = steps.findIndex((step) => !isStepConfirmed(step?.confirmed));

  if (firstPendingIndex === -1) {
    return adminTrackingTemplates[adminTrackingTemplates.length - 1]?.key || null;
  }

  return adminTrackingTemplates[firstPendingIndex]?.key || null;
}

function normalizeToDateStart(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

function normalizeToDateEnd(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setHours(23, 59, 59, 999);
  return date;
}

function getSelectedOrder() {
  const selectedOrder = orders.find((order) => getOrderIdentifier(order) === selectedOrderId) || null;

  if (!selectedOrder) {
    return null;
  }

  selectedOrder.trackingSteps = getOrderTrackingSteps(selectedOrder);
  return selectedOrder;
}

function formatOrderLabel(order) {
  return `${order.vehicle?.brand || "Vehiculo"} ${order.vehicle?.model || ""}${order.vehicle?.version ? ` ${order.vehicle.version}` : ""} ${order.vehicle?.year || ""}`.trim();
}

function formatDateLabel(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Date(value).toLocaleDateString("es-CO", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getClientDisplayName(order) {
  return String(order?.client?.name || "Cliente sin asignar").trim() || "Cliente sin asignar";
}

function getCurrentStageMeta(order) {
  const currentStageKey = resolveCurrentStageKey(order);

  if (!currentStageKey) {
    return {
      code: "-",
      label: "Sin etapa",
    };
  }

  const stageIndex = adminTrackingTemplates.findIndex((stage) => stage.key === currentStageKey);

  if (stageIndex === -1) {
    return {
      code: "-",
      label: "Sin etapa",
    };
  }

  return {
    code: `E${stageIndex + 1}`,
    label: String(adminTrackingTemplates[stageIndex]?.label || "Estado").trim(),
  };
}

function populateSearchSelects() {
  const activeOrders = getActiveOrders();

  searchConfigs.forEach((config) => {
    const values = [];

    activeOrders.forEach((order) => {
      const rawValue = String(config.getValue(order) || "").trim();

      if (!rawValue) {
        return;
      }

      values.push(`<option value="${escapeHtml(rawValue)}"></option>`);
    });

    config.input.placeholder = config.placeholder;
    config.list.innerHTML = values.join("");
  });

  if (trackingStateFilter) {
    const selectedState = String(trackingStateFilter.value || "");
    const options = ['<option value="">Todos los estados</option>']
      .concat(
        adminTrackingTemplates.map(
          (stage, index) => `<option value="${escapeHtml(stage.key)}">E${index + 1}: ${escapeHtml(stage.label || "Estado")}</option>`
        )
      );

    trackingStateFilter.innerHTML = options.join("");

    if (selectedState && adminTrackingTemplates.some((stage) => stage.key === selectedState)) {
      trackingStateFilter.value = selectedState;
    }
  }
}

function applySelectedOrderToInputs(order = getSelectedOrder()) {
  if (!order) {
    return;
  }

  searchConfigs[0].input.value = String(order.trackingNumber || "");
  searchConfigs[1].input.value = String(order.vehicle?.vin || "");
  searchConfigs[2].input.value = getInternalIdentifier(order);
}

function getFilteredOrders() {
  const activeOrders = getActiveOrders();
  const typedFilters = searchConfigs
    .map((config) => ({ config, query: String(config.input.value || "").trim().toUpperCase() }))
    .filter((item) => item.query);

  if (!typedFilters.length) {
    return activeOrders.filter((order) => {
      const selectedState = String(trackingStateFilter?.value || "").trim();
      const dateFromValue = String(trackingDateFromFilter?.value || "").trim();
      const dateToValue = String(trackingDateToFilter?.value || "").trim();
      const currentStageKey = resolveCurrentStageKey(order);
      const orderDate = order?.purchaseDate || order?.createdAt || null;
      const orderDateValue = orderDate ? new Date(orderDate) : null;
      const dateFrom = dateFromValue ? normalizeToDateStart(dateFromValue) : null;
      const dateTo = dateToValue ? normalizeToDateEnd(dateToValue) : null;

      if (selectedState && currentStageKey !== selectedState) {
        return false;
      }

      if (dateFrom && (!orderDateValue || Number.isNaN(orderDateValue.getTime()) || orderDateValue < dateFrom)) {
        return false;
      }

      if (dateTo && (!orderDateValue || Number.isNaN(orderDateValue.getTime()) || orderDateValue > dateTo)) {
        return false;
      }

      return true;
    });
  }

  return activeOrders.filter((order) => {
    const selectedState = String(trackingStateFilter?.value || "").trim();
    const dateFromValue = String(trackingDateFromFilter?.value || "").trim();
    const dateToValue = String(trackingDateToFilter?.value || "").trim();
    const currentStageKey = resolveCurrentStageKey(order);
    const orderDate = order?.purchaseDate || order?.createdAt || null;
    const orderDateValue = orderDate ? new Date(orderDate) : null;
    const dateFrom = dateFromValue ? normalizeToDateStart(dateFromValue) : null;
    const dateTo = dateToValue ? normalizeToDateEnd(dateToValue) : null;

    if (!typedFilters.every(({ config, query }) => String(config.getValue(order) || "").trim().toUpperCase().includes(query))) {
      return false;
    }

    if (selectedState && currentStageKey !== selectedState) {
      return false;
    }

    if (dateFrom && (!orderDateValue || Number.isNaN(orderDateValue.getTime()) || orderDateValue < dateFrom)) {
      return false;
    }

    if (dateTo && (!orderDateValue || Number.isNaN(orderDateValue.getTime()) || orderDateValue > dateTo)) {
      return false;
    }

    return true;
  });
}

function findUniqueExactMatch(matches) {
  return matches.find((order) =>
    searchConfigs.every((config) => {
      const query = String(config.input.value || "").trim().toUpperCase();

      if (!query) {
        return true;
      }

      return String(config.getValue(order) || "").trim().toUpperCase() === query;
    })
  ) || null;
}

function getOrderIdFromUrl() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get("orderId") || "").trim();
}

function getOrderFiltersFromUrl() {
  const url = new URL(window.location.href);
  return {
    tracking: String(url.searchParams.get("tracking") || "").trim().toUpperCase(),
    vin: String(url.searchParams.get("vin") || "").trim().toUpperCase(),
    internal: String(url.searchParams.get("internal") || "").trim().toUpperCase(),
  };
}

function hasDirectOrderUrlParams(preservedOrderId = "", preservedFilters = null) {
  return Boolean(
    String(preservedOrderId || "").trim() ||
    preservedFilters?.tracking ||
    preservedFilters?.vin ||
    preservedFilters?.internal
  );
}

function applyDetailMode(isDetailMode) {
  document.body.classList.toggle("tracking-detail-mode", Boolean(isDetailMode));
}

function resolveOrderIdFromUrlFilters(filters) {
  if (!filters || (!filters.tracking && !filters.vin && !filters.internal)) {
    return "";
  }

  const matches = getActiveOrders().filter((order) => {
    const trackingValue = String(order.trackingNumber || "").trim().toUpperCase();
    const vinValue = String(order.vehicle?.vin || "").trim().toUpperCase();
    const internalValue = String(getInternalIdentifier(order) || "").trim().toUpperCase();

    const trackingMatches = filters.tracking && trackingValue === filters.tracking;
    const vinMatches = filters.vin && vinValue === filters.vin;
    const internalMatches = filters.internal && internalValue === filters.internal;

    return trackingMatches || vinMatches || internalMatches;
  });

  if (!matches.length) {
    return "";
  }

  return getOrderIdentifier(matches[0]);
}

function resolveOrderIdFromFiltersInCollection(filters, collection = []) {
  if (!filters || (!filters.tracking && !filters.vin && !filters.internal)) {
    return "";
  }

  const matches = (Array.isArray(collection) ? collection : []).filter((order) => {
    const trackingValue = String(order.trackingNumber || "").trim().toUpperCase();
    const vinValue = String(order.vehicle?.vin || "").trim().toUpperCase();
    const internalValue = String(getInternalIdentifier(order) || "").trim().toUpperCase();

    const trackingMatches = filters.tracking && trackingValue === filters.tracking;
    const vinMatches = filters.vin && vinValue === filters.vin;
    const internalMatches = filters.internal && internalValue === filters.internal;

    return trackingMatches || vinMatches || internalMatches;
  });

  if (!matches.length) {
    return "";
  }

  return getOrderIdentifier(matches[0]);
}

function normalizeForMatch(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function resolveDirectEntryOrderId(preservedOrderId = "", preservedFilters = null, collection = []) {
  const normalizedOrderId = normalizeForMatch(preservedOrderId);
  const normalizedTracking = normalizeForMatch(preservedFilters?.tracking || "");
  const normalizedVin = normalizeForMatch(preservedFilters?.vin || "");
  const normalizedInternal = normalizeForMatch(preservedFilters?.internal || "");

  const candidates = Array.isArray(collection)
    ? collection.filter((order) => {
      const idValue = normalizeForMatch(getOrderIdentifier(order));
      const trackingValue = normalizeForMatch(order?.trackingNumber || "");
      const vinValue = normalizeForMatch(order?.vehicle?.vin || "");
      const internalValue = normalizeForMatch(getInternalIdentifier(order) || "");

      if (normalizedOrderId && idValue === normalizedOrderId) {
        return true;
      }

      if (normalizedTracking && (trackingValue === normalizedTracking || trackingValue.includes(normalizedTracking))) {
        return true;
      }

      if (normalizedVin && (vinValue === normalizedVin || vinValue.includes(normalizedVin))) {
        return true;
      }

      if (normalizedInternal && (internalValue === normalizedInternal || internalValue.includes(normalizedInternal))) {
        return true;
      }

      return false;
    })
    : [];

  if (!candidates.length) {
    return "";
  }

  const exactByOrderId = candidates.find((order) => normalizeForMatch(getOrderIdentifier(order)) === normalizedOrderId);

  if (exactByOrderId) {
    return getOrderIdentifier(exactByOrderId);
  }

  const exactByTracking = candidates.find((order) => normalizeForMatch(order?.trackingNumber || "") === normalizedTracking);

  if (exactByTracking) {
    return getOrderIdentifier(exactByTracking);
  }

  return getOrderIdentifier(candidates[0]);
}

function renderSearchResults(matches) {
  if (!matches.length) {
    trackingSearchResults.innerHTML = '<div class="empty-state">No encontramos pedidos activos con esos filtros.</div>';
    return;
  }

  trackingSearchResults.innerHTML = `
    <div class="tracking-table-wrap tracking-search-results-table-wrap">
      <table class="tracking-data-table tracking-search-results-table">
        <thead>
          <tr>
            <th>Tracking</th>
            <th>VIN</th>
            <th>Cliente</th>
            <th>Destino</th>
            <th>Estado</th>
            <th>Vehículo</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          ${matches
            .map((order) => {
              const orderId = getOrderIdentifier(order);
              const trackingValue = String(order.trackingNumber || "").trim();
              const vinValue = String(order.vehicle?.vin || "").trim();
              const internalValue = String(getInternalIdentifier(order) || "").trim();
              const detailUrl = `/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(trackingValue)}&vin=${encodeURIComponent(vinValue)}&internal=${encodeURIComponent(internalValue)}`;
              const stageMeta = getCurrentStageMeta(order);
              const vehicleLabel = formatOrderLabel(order);
              const rowDate = formatDateLabel(order.purchaseDate || order.createdAt);

              return `
                <tr
                  class="tracking-order-row ${orderId === selectedOrderId ? "selected" : ""}"
                  data-order-link="true"
                  data-order-id="${escapeHtml(orderId)}"
                  data-href="${escapeHtml(detailUrl)}"
                  tabindex="0"
                  role="link"
                  aria-label="Abrir pedido ${escapeHtml(trackingValue || vehicleLabel || orderId)}"
                >
                  <td data-label="Tracking">${escapeHtml(trackingValue || "-")}</td>
                  <td data-label="VIN">${escapeHtml(vinValue || "Sin VIN")}</td>
                  <td data-label="Cliente">${escapeHtml(getClientDisplayName(order))}</td>
                  <td data-label="Destino">${escapeHtml(order.vehicle?.destination || "-")}</td>
                  <td data-label="Estado">${escapeHtml(`${stageMeta.code} · ${stageMeta.label}`)}</td>
                  <td data-label="Vehículo"><strong>${escapeHtml(vehicleLabel)}</strong></td>
                  <td data-label="Fecha">${escapeHtml(rowDate)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOrderSummary(order) {
  if (!order) {
    trackingOrderSummary.innerHTML = "";
    return;
  }

  const stageMeta = getCurrentStageMeta(order);

  trackingOrderSummary.innerHTML = `
    <div class="tracking-card-header">
      <strong>${escapeHtml(formatOrderLabel(order))}</strong>
      <p>${escapeHtml(getClientDisplayName(order))} · Tracking ${escapeHtml(order.trackingNumber)}</p>
      <p>VIN ${escapeHtml(order.vehicle?.vin || "Sin VIN")} · Llegada estimada ${escapeHtml(formatDateLabel(order.expectedArrivalDate))}</p>
      <p>Destino ${escapeHtml(order.vehicle?.destination || "-")} · ${escapeHtml(`${stageMeta.code} ${stageMeta.label}`)}</p>
    </div>
  `;
}

function renderMediaItems(media = []) {
  if (!media.length) {
    return '<p class="tracking-state-empty">Sin adjuntos para este estado.</p>';
  }

  return `
    <div class="tracking-state-media-list">
      ${media.map((item, index) => {
        const label = item.caption || item.name || `Adjunto ${index + 1}`;
        const isHiddenForClient = item?.clientVisible === false;
        const hiddenBadge = isHiddenForClient
          ? `<span class="tracking-media-hidden-pill" title="Oculto al cliente" aria-label="Oculto al cliente">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.7 1.3-1.4 1.4 3 3C2.6 7 1.4 8.4.6 9.5c-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6 2 0 3.8-.5 5.4-1.3l3 3 1.4-1.4L2.7 1.3Zm8.8 8.8 3 3a2.4 2.4 0 0 1-3-3Zm7.9 2.8a15.5 15.5 0 0 0-3.8-3.5l1.5 1.5c.6.5 1.2 1.1 1.7 1.7-.8 1-2.1 2.4-3.8 3.4l1.5 1.5c2-1.3 3.4-3.1 4.2-4.1.2-.3.2-.7 0-1ZM12 6.5c.8 0 1.5.1 2.1.3L15.7 8c-1-.7-2.3-1.1-3.7-1.1-1 0-1.9.2-2.7.6l1.3 1.3c.4-.2.9-.3 1.4-.3Z"></path></svg>
            </span>`
          : "";

        if (item.type === "video") {
          return `
            <article class="tracking-media-card video">
              ${hiddenBadge}
              <video controls playsinline preload="metadata" src="${escapeHtml(item.url)}"></video>
              <strong>${escapeHtml(label)}</strong>
            </article>
          `;
        }

        if (item.type === "document") {
          return `
            <article class="tracking-media-card document">
              <strong>${escapeHtml(label)}</strong>
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Abrir documento</a>
            </article>
          `;
        }

        return `
          <article class="tracking-media-card image">
            ${hiddenBadge}
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(label)}" loading="lazy" />
            <strong>${escapeHtml(label)}</strong>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function buildStateMediaBuckets(media = []) {
  const indexedMedia = media.map((item, index) => ({
    ...item,
    __index: index,
    updateIndex: typeof item.updateIndex === "number" ? item.updateIndex : -1,
    mediaIndex: typeof item.mediaIndex === "number" ? item.mediaIndex : index,
  }));

  return {
    document: indexedMedia.filter((item) => item.category === "document" || item.type === "document"),
    photoSingle: indexedMedia.filter((item) => item.category === "photo-single"),
    photoCarousel: indexedMedia.filter((item) => item.category === "photo-carousel" || (item.type === "image" && !item.category)),
    video: indexedMedia.filter((item) => item.category === "video" || item.type === "video"),
  };
}

function renderSavedFileList(mediaItems = [], stateKey) {
  if (!mediaItems.length) {
    return "";
  }

  return `
    <div class="tracking-saved-files-list">
      ${mediaItems.map((item) => {
        const fileName = item.name || item.caption || "Archivo";
        const isClientVisible = typeof item.clientVisible === "boolean" ? item.clientVisible : true;

        return `
          <div class="tracking-saved-file-row">
            <span>${escapeHtml(fileName)}</span>
            <div class="tracking-saved-file-actions">
              ${renderMediaVisibilityButton(stateKey, item.updateIndex, item.mediaIndex, !isClientVisible, isClientVisible)}
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderPendingFileList(files = [], stateKey, category) {
  if (!files.length) {
    return "";
  }

  return `
    <div class="tracking-saved-files-list">
      ${files.map((file, index) => `
        <div class="tracking-saved-file-row pending">
          <span>${escapeHtml(file.name || "Archivo")}</span>
          <button class="tracking-file-remove-button" type="button" data-remove-pending-state="${escapeHtml(stateKey)}" data-remove-pending-category="${escapeHtml(category)}" data-remove-pending-index="${index}">x</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderFileQueueBlocks(savedFiles = [], pendingFiles = [], stateKey, category) {
  const blocks = [];

  if (pendingFiles.length) {
    blocks.push(`<small class="tracking-file-group-label">Pendientes por subir</small>${renderPendingFileList(pendingFiles, stateKey, category)}`);
  }

  if (savedFiles.length) {
    blocks.push(`<small class="tracking-file-group-label">Archivos subidos</small>${renderSavedFileList(savedFiles, stateKey)}`);
  }

  return blocks.join("");
}

function renderCategorizedMediaSections(media = []) {
  const buckets = buildStateMediaBuckets(media);

  return `
    <div class="tracking-state-media-groups">
      <section class="tracking-state-media-block">
        <strong>Documento PDF</strong>
        ${renderMediaItems(buckets.document)}
      </section>
      <section class="tracking-state-media-block">
        <strong>Foto unica</strong>
        ${renderMediaItems(buckets.photoSingle)}
      </section>
      <section class="tracking-state-media-block">
        <strong>Carrusel</strong>
        ${renderMediaItems(buckets.photoCarousel)}
      </section>
      <section class="tracking-state-media-block">
        <strong>Video</strong>
        ${renderMediaItems(buckets.video)}
      </section>
    </div>
  `;
}

function formatDateTimeLabel(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getStateCode(index) {
  return `E${index + 1}`;
}

function getStateUpdates(state) {
  return Array.isArray(state?.updates) ? state.updates : [];
}

function buildTrackingMediaEntryFingerprint(item = {}) {
  return [
    String(item.type || "").trim().toLowerCase(),
    String(item.category || "").trim().toLowerCase(),
    String(item.url || "").trim(),
    String(item.name || "").trim().toLowerCase(),
    String(item.caption || "").trim().toLowerCase(),
    String(item.updateIndex ?? "").trim(),
    String(item.mediaIndex ?? "").trim(),
  ].join("::");
}

function getFlattenedStateMediaForUpdate(state, update, updateIndex) {
  const stateMedia = Array.isArray(state?.media) ? state.media : [];
  const nestedMedia = Array.isArray(update?.media) ? update.media : [];
  const fallbackMedia = update?.isSynthetic
    ? stateMedia
    : stateMedia.filter((item) => Number(item?.updateIndex) === updateIndex);
  const mergedMedia = [...nestedMedia, ...fallbackMedia];
  const seenMedia = new Set();

  return mergedMedia.filter((item, mediaIndex) => {
    if (!item?.url) {
      return false;
    }

    const fingerprint = buildTrackingMediaEntryFingerprint({
      ...item,
      updateIndex: typeof item?.updateIndex === "number" ? item.updateIndex : updateIndex,
      mediaIndex: typeof item?.mediaIndex === "number" ? item.mediaIndex : mediaIndex,
    });

    if (seenMedia.has(fingerprint)) {
      return false;
    }

    seenMedia.add(fingerprint);
    return true;
  }).map((item, mediaIndex) => ({
    ...item,
    updateIndex: typeof item?.updateIndex === "number" ? item.updateIndex : updateIndex,
    mediaIndex: typeof item?.mediaIndex === "number" ? item.mediaIndex : mediaIndex,
  }));
}

function getLatestStateUpdate(state, order = getSelectedOrder()) {
  return getStateDisplayUpdates(state, order).reduce((latestUpdate, currentUpdate) => {
    if (!latestUpdate) {
      return currentUpdate;
    }

    const latestTime = new Date(latestUpdate.updatedAt || latestUpdate.createdAt || 0).getTime();
    const currentTime = new Date(currentUpdate.updatedAt || currentUpdate.createdAt || 0).getTime();
    return currentTime >= latestTime ? currentUpdate : latestUpdate;
  }, null);
}

function resolveTimelineStateVariant(state, index, states) {
  if (state?.confirmed) {
    return "is-completed";
  }

  if (state?.inProgress) {
    return "is-current";
  }

  const firstPendingIndex = states.findIndex((item) => !item?.confirmed);

  if (firstPendingIndex === -1) {
    return "is-pending";
  }

  if (index === firstPendingIndex) {
    return "is-current";
  }

  return "is-pending";
}

function resolveTimelineStateStatusLabel(variant) {
  if (variant === "is-completed") {
    return "Completada";
  }

  if (variant === "is-current") {
    return "En curso";
  }

  return "Pendiente";
}

function renderVisibilityButton(stateKey, updateIndex, nextVisible, isCurrentlyVisible) {
  return `
    <button
      type="button"
      class="tracking-visibility-button ${isCurrentlyVisible ? "is-visible" : "is-hidden"}"
      data-toggle-client-visible="true"
      data-state-key="${escapeHtml(stateKey)}"
      data-update-index="${updateIndex}"
      data-next-visible="${nextVisible ? "true" : "false"}"
      title="${isCurrentlyVisible ? "Ocultar al cliente" : "Mostrar al cliente"}"
      aria-label="${isCurrentlyVisible ? "Ocultar al cliente" : "Mostrar al cliente"}"
    >
      ${isCurrentlyVisible
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.6 4.3-10.9 6-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6s9.6-4.3 10.9-6c.2-.3.2-.7 0-1C21.6 9.3 17.5 5 12 5Zm0 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.7 1.3-1.4 1.4 3 3C2.6 7 1.4 8.4.6 9.5c-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6 2 0 3.8-.5 5.4-1.3l3 3 1.4-1.4L2.7 1.3Zm8.8 8.8 3 3a2.4 2.4 0 0 1-3-3Zm7.9 2.8a15.5 15.5 0 0 0-3.8-3.5l1.5 1.5c.6.5 1.2 1.1 1.7 1.7-.8 1-2.1 2.4-3.8 3.4l1.5 1.5c2-1.3 3.4-3.1 4.2-4.1.2-.3.2-.7 0-1ZM12 6.5c.8 0 1.5.1 2.1.3L15.7 8c-1-.7-2.3-1.1-3.7-1.1-1 0-1.9.2-2.7.6l1.3 1.3c.4-.2.9-.3 1.4-.3Z"></path></svg>'}
    </button>
  `;
}

function renderMediaVisibilityButton(stateKey, updateIndex, mediaIndex, nextVisible, isCurrentlyVisible) {
  return `
    <button
      type="button"
      class="tracking-visibility-button ${isCurrentlyVisible ? "is-visible" : "is-hidden"}"
      data-toggle-media-client-visible="true"
      data-state-key="${escapeHtml(stateKey)}"
      data-update-index="${updateIndex}"
      data-media-index="${mediaIndex}"
      data-next-visible="${nextVisible ? "true" : "false"}"
      title="${isCurrentlyVisible ? "Ocultar archivo al cliente" : "Mostrar archivo al cliente"}"
      aria-label="${isCurrentlyVisible ? "Ocultar archivo al cliente" : "Mostrar archivo al cliente"}"
    >
      ${isCurrentlyVisible
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.6 4.3-10.9 6-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6s9.6-4.3 10.9-6c.2-.3.2-.7 0-1C21.6 9.3 17.5 5 12 5Zm0 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.7 1.3-1.4 1.4 3 3C2.6 7 1.4 8.4.6 9.5c-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6 2 0 3.8-.5 5.4-1.3l3 3 1.4-1.4L2.7 1.3Zm8.8 8.8 3 3a2.4 2.4 0 0 1-3-3Zm7.9 2.8a15.5 15.5 0 0 0-3.8-3.5l1.5 1.5c.6.5 1.2 1.1 1.7 1.7-.8 1-2.1 2.4-3.8 3.4l1.5 1.5c2-1.3 3.4-3.1 4.2-4.1.2-.3.2-.7 0-1ZM12 6.5c.8 0 1.5.1 2.1.3L15.7 8c-1-.7-2.3-1.1-3.7-1.1-1 0-1.9.2-2.7.6l1.3 1.3c.4-.2.9-.3 1.4-.3Z"></path></svg>'}
    </button>
  `;
}

function renderStateHistory(state) {
  const updates = [...getStateDisplayUpdates(state)].reverse();

  if (!updates.length) {
    return '<div class="tracking-state-history-empty">Todavia no hay actualizaciones en el historial de esta etapa.</div>';
  }

  return `
    <div class="tracking-state-history-list">
      ${updates.map((update, reverseIndex) => {
        const updateIndex = updates.length - reverseIndex - 1;
        const updateMedia = getFlattenedStateMediaForUpdate(state, update, updateIndex);
        const updateStatus = update.completed
          ? "Etapa completada"
          : update.inProgress
            ? "Estado en curso"
            : "Actualizacion interna";
        const updateDate = update.updatedAt || update.createdAt || null;
        const updateFilesCount = updateMedia.length;

        return `
          <article class="tracking-state-history-item ${update.clientVisible ? "is-client-visible" : "is-internal"}">
            <div class="tracking-state-history-header">
              <div>
                <strong>${escapeHtml(updateStatus)}</strong>
                <p>${escapeHtml(updateDate ? formatDateTimeLabel(updateDate) : "Sin fecha")}</p>
              </div>
              ${update.isSynthetic ? "" : renderVisibilityButton(state.key, updateIndex, !update.clientVisible, update.clientVisible)}
            </div>
            <p>${escapeHtml(update.notes || "Sin nota registrada en esta actualización.")}</p>
            <small>${escapeHtml(update.isSynthetic ? "Registro derivado del estado actual" : update.clientVisible ? "Visible al cliente" : "Oculto al cliente")}${updateFilesCount ? ` · ${escapeHtml(updateFilesCount)} archivo(s)` : ""}</small>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function buildRecentEvents(order) {
  const states = getOrderTrackingSteps(order);

  return states
    .map((state, index) => {
      const stateCode = getStateCode(index);
      const items = getStateDisplayUpdates(state, order)
        .flatMap((update, updateIndex) => {
          const eventDate = update.updatedAt || update.createdAt || null;
          const updateNotes = String(update.notes || "").trim();
          const updateMedia = getFlattenedStateMediaForUpdate(state, update, updateIndex);
          const shouldIncludeUpdateEvent = Boolean(update.completed || update.inProgress || updateNotes || !updateMedia.length);
          const updateItems = shouldIncludeUpdateEvent
            ? [{
                id: `${state.key}-update-${updateIndex}`,
                itemType: "update",
                stateKey: state.key,
              updateIndex: update.isSynthetic ? -1 : updateIndex,
                stateCode,
                stateLabel: state.label,
                date: eventDate,
                title: update.completed
                  ? "Etapa completada"
                  : update.inProgress
                    ? "Estado en curso"
                    : "Actualizacion interna",
                description: updateNotes || ((updateMedia || []).length ? `${updateMedia.length} adjunto(s) cargados.` : "Sin descripcion registrada."),
                clientVisible: Boolean(update.clientVisible),
              }]
            : [];
          const mediaItems = updateMedia.map((item, mediaIndex) => ({
            id: `${state.key}-media-${item.updateIndex}-${item.mediaIndex}`,
            itemType: "media",
            stateKey: state.key,
            updateIndex: typeof item.updateIndex === "number" ? item.updateIndex : updateIndex,
            mediaIndex: typeof item.mediaIndex === "number" ? item.mediaIndex : mediaIndex,
            stateCode,
            stateLabel: state.label,
            date: eventDate,
            title: `${resolveDocumentTypeLabel(item)} · ${item.name || item.caption || `Archivo ${mediaIndex + 1}`}`,
            description: item.caption || updateNotes || "Archivo asociado a esta actualizacion.",
            fileName: item.name || item.caption || `Archivo ${mediaIndex + 1}`,
            fileUrl: item.url,
            clientVisible: typeof item.clientVisible === "boolean" ? item.clientVisible : false,
          }));

          return updateItems.concat(mediaItems);
        })
        .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      if (!items.length) {
        return null;
      }

      return {
        stateKey: state.key,
        stateCode,
        stateLabel: state.label,
        latestDate: items[0]?.date || null,
        items,
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.latestDate || 0).getTime() - new Date(a.latestDate || 0).getTime());
}

function resolveDocumentTypeLabel(item) {
  const category = String(item?.category || "").toLowerCase();
  const type = String(item?.type || "").toLowerCase();

  if (category === "document" || type === "document") {
    return "DOCUMENTO";
  }

  if (category === "video" || type === "video") {
    return "VIDEO";
  }

  if (category === "photo-single" || category === "photo-carousel" || type === "image") {
    return "FOTOS";
  }

  return "OTRO";
}

function renderRecentEventItem(item) {
  const eventId = String(item.id || "");
  const isExpanded = expandedOverviewEventIds.has(eventId);

  if (item.itemType === "media") {
    return `
      <article class="tracking-stage-event-item is-media ${isExpanded ? "is-open" : ""}">
        <div class="tracking-stage-event-head">
          <button
            type="button"
            class="tracking-stage-event-toggle"
            data-overview-event-toggle="${escapeHtml(eventId)}"
            aria-expanded="${isExpanded ? "true" : "false"}"
          >
            <div class="tracking-stage-event-main">
              <span class="tracking-stage-event-kind">Archivo</span>
              <strong>${escapeHtml(item.title)}</strong>
              <div class="tracking-stage-event-meta">
                <span>${escapeHtml(formatDateTimeLabel(item.date))}</span>
                <span>${escapeHtml(item.fileName || "Archivo adjunto")}</span>
              </div>
            </div>
            <span class="tracking-stage-event-chevron" aria-hidden="true">${isExpanded ? "−" : "+"}</span>
          </button>
          <div class="tracking-stage-event-actions">
            ${renderMediaVisibilityButton(item.stateKey, item.updateIndex, item.mediaIndex, !item.clientVisible, item.clientVisible)}
          </div>
        </div>
        <div class="tracking-stage-event-body" ${isExpanded ? "" : "hidden"}>
          <p>${escapeHtml(item.description || "Sin descripcion registrada.")}</p>
          <a class="tracking-document-link" href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noreferrer">${escapeHtml(item.fileName || "Abrir archivo")}</a>
        </div>
      </article>
    `;
  }

  return `
    <article class="tracking-stage-event-item ${isExpanded ? "is-open" : ""}">
      <div class="tracking-stage-event-head">
        <button
          type="button"
          class="tracking-stage-event-toggle"
          data-overview-event-toggle="${escapeHtml(eventId)}"
          aria-expanded="${isExpanded ? "true" : "false"}"
        >
          <div class="tracking-stage-event-main">
            <span class="tracking-stage-event-kind">Evento</span>
            <strong>${escapeHtml(item.title)}</strong>
            <div class="tracking-stage-event-meta">
              <span>${escapeHtml(formatDateTimeLabel(item.date))}</span>
              <span>${escapeHtml(item.clientVisible ? "Visible al cliente" : "Oculto al cliente")}</span>
            </div>
          </div>
          <span class="tracking-stage-event-chevron" aria-hidden="true">${isExpanded ? "−" : "+"}</span>
        </button>
        <div class="tracking-stage-event-actions">
            ${renderVisibilityButton(item.stateKey, item.updateIndex, !item.clientVisible, item.clientVisible)}
        </div>
      </div>
      <div class="tracking-stage-event-body" ${isExpanded ? "" : "hidden"}>
        <p>${escapeHtml(item.description || "Sin descripcion registrada.")}</p>
      </div>
    </article>
  `;
}

function renderRecentEventStage(stageGroup, isExpanded) {
  return `
    <article class="tracking-stage-events-card ${isExpanded ? "is-open" : ""}">
      <button
        type="button"
        class="tracking-stage-events-toggle"
        data-overview-stage-toggle="${escapeHtml(stageGroup.stateKey)}"
        aria-expanded="${isExpanded ? "true" : "false"}"
      >
        <div class="tracking-stage-events-toggle-copy">
          <span>${escapeHtml(stageGroup.stateCode)}</span>
          <strong>${escapeHtml(stageGroup.stateLabel)}</strong>
          <p>${escapeHtml(formatDateTimeLabel(stageGroup.latestDate))} · ${escapeHtml(stageGroup.items.length)} evento(s)</p>
        </div>
        <span class="tracking-stage-events-chevron" aria-hidden="true">${isExpanded ? "−" : "+"}</span>
      </button>
      <div class="tracking-stage-events-body" ${isExpanded ? "" : "hidden"}>
        <div class="tracking-stage-events-list">
          ${stageGroup.items.map((item) => renderRecentEventItem(item)).join("")}
        </div>
      </div>
    </article>
  `;
}

async function updateStateClientVisibility(stateKey, updateIndex, nextVisible) {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    return;
  }

  const state = (selectedOrder.trackingSteps || []).find((item) => item.key === stateKey);

  if (!state) {
    return;
  }

  const persistedUpdates = getStateUpdates(state);

  if (updateIndex >= 0 && updateIndex >= persistedUpdates.length) {
    return;
  }

  const existingMedia = updateIndex < 0
    ? (state.media || []).map((item) => ({ ...item, clientVisible: nextVisible }))
    : state.media || [];

  const formData = new FormData();
  formData.append("notes", "");
  formData.append("inProgress", state.inProgress ? "true" : "false");
  formData.append("confirmed", state.confirmed ? "true" : "false");
  formData.append("clientVisible", nextVisible ? "true" : "false");
  formData.append("existingMedia", JSON.stringify(existingMedia));
  formData.append("visibilityOnly", "true");
  formData.append("updateIndex", String(updateIndex));
  formData.append("mediaMeta", "[]");

  const response = await fetchTrackingPageJson(`/api/admin/orders/${selectedOrder._id}/tracking-states/${stateKey}`, {
    method: "PATCH",
    body: formData,
  });

  orders = orders.map((order) => (order._id === response.order._id ? response.order : order));
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());
  adminSetFeedback(trackingFeedback, nextVisible ? "Actualizacion visible para cliente." : "Actualizacion oculta para cliente.", "success");
}

async function updateStateMediaClientVisibility(stateKey, updateIndex, mediaIndex, nextVisible) {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    return;
  }

  const state = (selectedOrder.trackingSteps || []).find((item) => item.key === stateKey);

  const stateUpdates = getStateUpdates(state);
  const targetUpdate = stateUpdates[updateIndex];
  const flattenedUpdateMedia = (state?.media || []).filter((item) => item.updateIndex === updateIndex);
  const resolvedUpdateMedia = Array.isArray(targetUpdate?.media) && targetUpdate.media.length
    ? targetUpdate.media.map((item, index) => ({
        ...item,
        mediaIndex: typeof item?.mediaIndex === "number" ? item.mediaIndex : index,
      }))
    : flattenedUpdateMedia;

  if (!state || !resolvedUpdateMedia.length || mediaIndex < 0 || mediaIndex >= resolvedUpdateMedia.length) {
    return;
  }

  const updatedMedia = state.media.map((item, index) => (
    item.updateIndex === updateIndex && item.mediaIndex === mediaIndex
      ? { ...item, clientVisible: nextVisible }
      : item
  ));

  const formData = new FormData();
  formData.append("notes", "");
  formData.append("inProgress", state.inProgress ? "true" : "false");
  formData.append("confirmed", state.confirmed ? "true" : "false");
  formData.append(
    "clientVisible",
    (nextVisible || Boolean(targetUpdate?.clientVisible) || resolvedUpdateMedia.some((item, index) => index !== mediaIndex && item?.clientVisible))
      ? "true"
      : "false"
  );
  formData.append("existingMedia", JSON.stringify(updatedMedia));
  formData.append("visibilityOnly", "true");
  formData.append("updateIndex", String(updateIndex));
  formData.append("mediaMeta", "[]");

  const response = await fetchTrackingPageJson(`/api/admin/orders/${selectedOrder._id}/tracking-states/${stateKey}`, {
    method: "PATCH",
    body: formData,
  });

  orders = orders.map((order) => (order._id === response.order._id ? response.order : order));
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());
  adminSetFeedback(trackingFeedback, nextVisible ? "Archivo visible para cliente." : "Archivo oculto para cliente.", "success");
}

function renderTrackingOverview(order) {
  const states = order?.trackingSteps || adminTrackingTemplates;
  const eventGroups = buildRecentEvents(order);
  const resolvedExpandedOverviewStateKey = eventGroups.some((group) => group.stateKey === expandedOverviewStateKey)
    ? expandedOverviewStateKey
    : "";

  trackingPreview.innerHTML = `
    <div class="tracking-overview-stack">
      <article class="state-order-item tracking-overview-card">
        <header class="state-order-header">
          <h3>${escapeHtml(formatOrderLabel(order))}</h3>
          <span class="section-tag">Tracking ${escapeHtml(order.trackingNumber || "-")}</span>
        </header>
        <div class="state-order-grid">
          <p><strong>Version:</strong> ${escapeHtml(order.vehicle?.version || "Sin version")}</p>
          <p><strong>Ano:</strong> ${escapeHtml(order.vehicle?.year || "-")}</p>
          <p><strong>VIN:</strong> ${escapeHtml(order.vehicle?.vin || "-")}</p>
          <p><strong>Color:</strong> ${escapeHtml(order.vehicle?.color || "-")}</p>
          <p><strong>Cliente:</strong> ${escapeHtml(order.client?.name || "Sin asignar")}</p>
          <p><strong>Email cliente:</strong> ${escapeHtml(order.client?.email || "-")}</p>
          <p><strong>Telefono:</strong> ${escapeHtml(order.client?.phone || "-")}</p>
          <p><strong>Estado pedido:</strong> ${escapeHtml(order.status || "-")}</p>
          <p><strong>Compra:</strong> ${escapeHtml(formatDateLabel(order.purchaseDate))}</p>
          <p><strong>Llegada estimada:</strong> ${escapeHtml(formatDateLabel(order.expectedArrivalDate))}</p>
          <p><strong>Media del pedido:</strong> ${escapeHtml((order.media || []).length)} archivo(s)</p>
          <p><strong>ID interno:</strong> ${escapeHtml(getInternalIdentifier(order) || "-")}</p>
        </div>
        <p class="state-order-notes"><strong>Notas:</strong> ${escapeHtml(order.notes || "Sin notas internas")}</p>
      </article>

      <article class="dashboard-card tracking-table-card tracking-timeline-card">
        <div class="card-heading">
          <h2>Timeline de etapas</h2>
        </div>
        <div class="tracking-timeline-grid">
          ${states
            .map((state, index) => {
              const variant = resolveTimelineStateVariant(state, index, states);
              const statusLabel = resolveTimelineStateStatusLabel(variant);
              const statusIcon = variant === "is-completed" ? "✅" : variant === "is-current" ? "⭐" : "◻";
              const canEditState = canEditStateForRole(currentAdminRole, state.key);

              return `
                <button
                  type="button"
                  class="tracking-timeline-item ${variant}"
                  ${canEditState ? `data-edit-state-key="${escapeHtml(state.key)}"` : ""}
                  ${canEditState ? "" : 'disabled title="Estado bloqueado por permisos"'}
                >
                  <span class="tracking-timeline-code">${escapeHtml(getStateCode(index))}</span>
                  <span class="tracking-timeline-status">${statusIcon} ${escapeHtml(statusLabel)}</span>
                  <strong>${escapeHtml(state.label || "Estado")}</strong>
                </button>
              `;
            })
            .join("")}
        </div>
      </article>

      <article class="dashboard-card tracking-table-card">
        <div class="card-heading">
          <h2>Eventos recientes</h2>
        </div>
        <div class="tracking-stage-events-stack">
          ${eventGroups.length
            ? eventGroups
                .map((stageGroup) => renderRecentEventStage(stageGroup, stageGroup.stateKey === resolvedExpandedOverviewStateKey))
                .join("")
            : '<div class="empty-state">No hay eventos registrados para esta orden.</div>'}
        </div>
      </article>
    </div>
  `;
}

function renderStates() {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    trackingStatesList.innerHTML = "";
    adminRenderEmptyState(trackingPreview, "Busca un pedido y seleccionalo para trabajar sus estados.");
    return;
  }

  const states = getOrderTrackingSteps(selectedOrder);

  trackingStatesList.innerHTML = states
    .map((state, index) => {
      const isExpanded = expandedStateKey === state.key;
      const effectiveInProgress = isStateEffectivelyInProgress(state, selectedOrder);
      const latestUpdate = getLatestStateUpdate(state, selectedOrder);
      const updatedAtValue = latestUpdate?.updatedAt || latestUpdate?.createdAt || state.updatedAt || selectedOrder?.purchaseDate || selectedOrder?.createdAt || null;
      const updatedText = updatedAtValue ? `Actualizado ${formatDateLabel(updatedAtValue)}` : "Sin actualizaciones todavia";
      const mediaBuckets = buildStateMediaBuckets(state.media || []);
      const pendingMedia = getPendingMediaForState(state.key);
      const videoMethod = getVideoMethodForState(state.key);
      const videoLink = videoLinkByState.get(state.key) || "";
      const draft = getDraftStateValues(state);
      const historyCount = getStateDisplayUpdates(state, selectedOrder).length;
      const canEditState = canEditStateForRole(currentAdminRole, state.key);
      const lockMessage = "No tienes permisos para modificar este estado.";
      const editButtonText = state.confirmed ? "Completado" : effectiveInProgress ? "En curso" : "Editar";

      return `
        <article class="tracking-state-card ${state.confirmed ? "is-confirmed" : ""} ${effectiveInProgress ? "is-in-progress" : ""} ${isExpanded ? "is-open" : ""}" data-state-card="${escapeHtml(state.key)}">
          <div class="tracking-state-header">
            <div class="tracking-state-copy">
              <small>Estado ${index + 1}</small>
              <strong>${escapeHtml(state.label)}</strong>
              <p>${escapeHtml(updatedText)} · ${escapeHtml(historyCount)} actualizacion(es)</p>
            </div>
            <button
              class="tracking-state-edit-button ${state.confirmed ? "is-confirmed" : ""}"
              type="button"
              ${canEditState ? `data-edit-state-key="${escapeHtml(state.key)}"` : ""}
              ${canEditState ? "" : 'disabled title="Estado bloqueado por permisos"'}
            >${canEditState ? editButtonText : "Bloqueado"}</button>
          </div>
          <div class="tracking-state-body" ${isExpanded ? "" : "hidden"}>
            ${canEditState ? "" : `<p class="feedback error">${escapeHtml(lockMessage)}</p>`}
            <div class="tracking-state-switches">
              <label class="dashboard-checkbox"><input type="checkbox" data-field="inProgress" ${draft.inProgress ? "checked" : ""} ${canEditState ? "" : "disabled"} /> Activar estado en curso</label>
              <label class="dashboard-checkbox"><input type="checkbox" data-field="confirmed" ${draft.confirmed ? "checked" : ""} ${canEditState ? "" : "disabled"} /> Completar estado</label>
            </div>
            <p class="tracking-state-helper-copy">Cada guardado crea una entrada interna en el historial. El cliente solo recibe push/correo cuando publicas ese evento con el ojo.</p>
            <div class="tracking-state-upload-grid two-up">
              <label>
                <span>Subir documento (PDF)</span>
                <input type="file" data-field="documentFile" data-state-key="${escapeHtml(state.key)}" accept=".pdf,application/pdf" ${canEditState ? "" : "disabled"} />
                ${renderFileQueueBlocks(mediaBuckets.document, pendingMedia.document, state.key, "document")}
              </label>
              <label>
                <span>Subir foto unica</span>
                <input type="file" data-field="singlePhotoFile" data-state-key="${escapeHtml(state.key)}" accept="image/*" ${canEditState ? "" : "disabled"} />
                ${renderFileQueueBlocks(mediaBuckets.photoSingle, pendingMedia.photoSingle, state.key, "photoSingle")}
              </label>
            </div>
            <div class="tracking-state-upload-grid two-up">
              <label>
                <span>Subir carrusel</span>
                <input type="file" data-field="carouselPhotoFiles" data-state-key="${escapeHtml(state.key)}" multiple accept="image/*" ${canEditState ? "" : "disabled"} />
                ${renderFileQueueBlocks(mediaBuckets.photoCarousel, pendingMedia.photoCarousel, state.key, "photoCarousel")}
              </label>
              <label>
                <span>Video</span>
                <select data-field="videoSourceMethod" data-state-key="${escapeHtml(state.key)}" ${canEditState ? "" : "disabled"}>
                  <option value="file" ${videoMethod === "file" ? "selected" : ""}>Subir archivo del dispositivo</option>
                  <option value="link" ${videoMethod === "link" ? "selected" : ""}>Pegar link (YouTube / Vimeo)</option>
                </select>
                ${videoMethod === "link"
                  ? `<input type="url" data-field="videoLink" data-state-key="${escapeHtml(state.key)}" value="${escapeHtml(videoLink)}" placeholder="https://www.youtube.com/watch?v=..." ${canEditState ? "" : "disabled"} />`
                  : `<input type="file" data-field="videoFile" data-state-key="${escapeHtml(state.key)}" accept="video/*" ${canEditState ? "" : "disabled"} />`}
                ${videoMethod === "file" ? renderFileQueueBlocks(mediaBuckets.video, pendingMedia.video, state.key, "video") : ""}
              </label>
            </div>
            <label>
              <span>Nueva actualizacion</span>
              <textarea rows="4" data-field="notes" placeholder="Describe lo ocurrido en esta actualizacion" ${canEditState ? "" : "disabled"}>${escapeHtml(draft.notes || "")}</textarea>
            </label>
            <div class="tracking-state-actions">
              <button class="primary-button" type="button" data-save-state-key="${escapeHtml(state.key)}" ${canEditState ? "" : "disabled"}>Guardar estado</button>
              <p class="feedback" data-state-feedback="${escapeHtml(state.key)}"></p>
            </div>
            <section class="tracking-state-history-block">
              <div class="card-heading compact">
                <h3>Historial de esta etapa</h3>
              </div>
              ${renderStateHistory(state)}
            </section>
            ${renderCategorizedMediaSections(state.media || [])}
          </div>
        </article>
      `;
    })
    .join("");

  renderTrackingOverview(selectedOrder);
}

function selectOrder(orderId) {
  selectedOrderId = String(orderId || "").trim();
  trackingOrderInput.value = selectedOrderId;
  trackingEditorFields.hidden = !selectedOrderId;
  expandedStateKey = "";
  expandedOverviewStateKey = "";
  expandedOverviewEventIds.clear();
  clearDraftStateValues();

  const selectedOrder = getSelectedOrder();
  applySelectedOrderToInputs(selectedOrder);
  renderOrderSummary(selectedOrder);
  renderStates();
  renderSearchResults(getFilteredOrders());
}

async function loadTrackingPage(preservedOrderId = "", preservedFilters = null) {
  const isDirectEntry = hasDirectOrderUrlParams(preservedOrderId, preservedFilters);
  await loadTrackingPageSession();
  const ordersData = await fetchTrackingPageJson("/api/admin/orders");
  orders = normalizeCollectionPayload(ordersData, ["orders"]);
  selectedOrderId = resolveDirectEntryOrderId(preservedOrderId, preservedFilters, orders) || String(preservedOrderId || "").trim();

  if (!selectedOrderId) {
    selectedOrderId = resolveDirectEntryOrderId("", preservedFilters, orders) || resolveOrderIdFromUrlFilters(preservedFilters);
  }

  trackingOrderInput.value = selectedOrderId;
  populateSearchSelects();

  if (isDirectEntry && preservedFilters) {
    if (preservedFilters.tracking) {
      searchConfigs[0].input.value = preservedFilters.tracking;
    }

    if (preservedFilters.vin) {
      searchConfigs[1].input.value = preservedFilters.vin;
    }

    if (preservedFilters.internal) {
      searchConfigs[2].input.value = preservedFilters.internal;
    }
  }

  if (selectedOrderId && !getSelectedOrder()) {
    const resolvedFromFilters = resolveOrderIdFromFiltersInCollection(preservedFilters, orders);

    if (resolvedFromFilters) {
      selectedOrderId = resolvedFromFilters;
      trackingOrderInput.value = selectedOrderId;
    }
  }

  if (selectedOrderId && !getSelectedOrder()) {
    try {
      const orderData = await fetchTrackingPageJson(`/api/admin/orders/${encodeURIComponent(selectedOrderId)}`);
      const orderFromDetail = orderData?.order || null;

      if (orderFromDetail && getOrderIdentifier(orderFromDetail)) {
        orders = [orderFromDetail, ...orders.filter((order) => getOrderIdentifier(order) !== getOrderIdentifier(orderFromDetail))];
      } else {
        selectedOrderId = "";
        trackingOrderInput.value = "";
      }
    } catch {
      selectedOrderId = "";
      trackingOrderInput.value = "";
    }
  }

  const hasUrlPrefill = isDirectEntry;
  const hasSelectedOrder = Boolean(selectedOrderId && getSelectedOrder());

  applyDetailMode(hasUrlPrefill);

  if (trackingSelectorPanel) {
    trackingSelectorPanel.hidden = hasUrlPrefill && hasSelectedOrder;
  }

  if (isDirectEntry && !hasSelectedOrder) {
    adminSetFeedback(trackingFeedback, "No se encontro esta orden con los parametros del enlace. Verifica que siga disponible.", "error");
  }

  renderSearchResults(getFilteredOrders());
  renderOrderSummary(getSelectedOrder());
  trackingEditorFields.hidden = !selectedOrderId;
  renderStates();
  stopInitOverlayWatchdog();
  forceClearLoadingState();
}

async function handleSearchClick() {
  const matches = getFilteredOrders();
  renderSearchResults(matches);

  if (!matches.length) {
    trackingEditorFields.hidden = true;
    selectedOrderId = "";
    trackingOrderInput.value = "";
    renderOrderSummary(null);
    renderStates();
    adminSetFeedback(trackingFeedback, "No hay pedidos activos que coincidan con esos filtros.", "error");
    return;
  }

  const exactMatch = findUniqueExactMatch(matches);

  if (exactMatch || matches.length === 1) {
    adminSetFeedback(trackingFeedback, "Pedido listo para gestionar sus estados.", "success");
    selectOrder((exactMatch || matches[0])._id);
    return;
  }

  if (matches.length > 1) {
    const internalQuery = String(searchConfigs[2].input.value || "").trim().toUpperCase();
    const trackingQuery = String(searchConfigs[0].input.value || "").trim().toUpperCase();
    const vinQuery = String(searchConfigs[1].input.value || "").trim().toUpperCase();
    const prioritizedMatch = matches.find((order) => {
      const internalValue = String(getInternalIdentifier(order) || "").trim().toUpperCase();
      const trackingValue = String(order.trackingNumber || "").trim().toUpperCase();
      const vinValue = String(order.vehicle?.vin || "").trim().toUpperCase();

      return (internalQuery && internalValue === internalQuery) || (trackingQuery && trackingValue === trackingQuery) || (vinQuery && vinValue === vinQuery);
    });

    if (prioritizedMatch) {
      adminSetFeedback(trackingFeedback, "Pedido listo para gestionar sus estados.", "success");
      selectOrder(prioritizedMatch._id);
      return;
    }
  }

  trackingEditorFields.hidden = true;
  selectedOrderId = "";
  trackingOrderInput.value = "";
  renderOrderSummary(null);
  renderStates();
  adminSetFeedback(trackingFeedback, "Selecciona uno de los pedidos encontrados para ver sus estados.");
}

function clearSearchFilters() {
  searchConfigs.forEach((config) => {
    config.input.value = "";
  });

  if (trackingStateFilter) {
    trackingStateFilter.value = "";
  }

  if (trackingDateFromFilter) {
    trackingDateFromFilter.value = "";
  }

  if (trackingDateToFilter) {
    trackingDateToFilter.value = "";
  }

  const matches = getFilteredOrders();
  renderSearchResults(matches);
  trackingEditorFields.hidden = true;
  selectedOrderId = "";
  clearDraftStateValues();
  trackingOrderInput.value = "";
  renderOrderSummary(null);
  renderStates();
  adminSetFeedback(trackingFeedback, "Filtros limpiados. Mostrando todos los pedidos activos.", "success");
}

async function saveState(stateKey) {
  if (savingStates.has(stateKey)) {
    return;
  }

  if (!canEditStateForRole(currentAdminRole, stateKey)) {
    setLockedStateFeedback(stateKey);
    return;
  }

  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    adminSetFeedback(trackingFeedback, "Selecciona un pedido antes de guardar un estado.", "error");
    return;
  }

  const state = (selectedOrder.trackingSteps || []).find((item) => item.key === stateKey);
  const stateCard = trackingStatesList.querySelector(`[data-state-card="${stateKey}"]`);
  const stateFeedback = trackingStatesList.querySelector(`[data-state-feedback="${stateKey}"]`);
  const stateSaveButton = trackingStatesList.querySelector(`[data-save-state-key="${stateKey}"]`);

  if (!state || !stateCard || !stateFeedback) {
    return;
  }

  const notesField = stateCard.querySelector('[data-field="notes"]');
  const inProgressField = stateCard.querySelector('[data-field="inProgress"]');
  const confirmedField = stateCard.querySelector('[data-field="confirmed"]');
  const videoSourceField = stateCard.querySelector('[data-field="videoSourceMethod"]');
  const videoLinkField = stateCard.querySelector('[data-field="videoLink"]');
  const formData = new FormData();
  const mediaMeta = [];
  const pendingMedia = getPendingMediaForState(stateKey);

  savingStates.add(stateKey);
  if (stateSaveButton) {
    stateSaveButton.disabled = true;
    stateSaveButton.textContent = "Guardando...";
  }

  const appendFiles = (files, category) => {
    Array.from(files || []).forEach((file) => {
      formData.append("mediaFiles", file);
      mediaMeta.push({ category });
    });
  };

  formData.append("notes", notesField.value || "");
  formData.append("inProgress", inProgressField?.checked ? "true" : "false");
  formData.append("confirmed", confirmedField.checked ? "true" : "false");
  formData.append("clientVisible", "false");
  formData.append("forceCreateUpdate", "true");
  formData.append("existingMedia", JSON.stringify(state.media || []));
  appendFiles(pendingMedia.document, "document");
  appendFiles(pendingMedia.photoSingle, "photo-single");
  appendFiles(pendingMedia.photoCarousel, "photo-carousel");

  const videoSourceMethod = String(videoSourceField?.value || getVideoMethodForState(stateKey));

  if (videoSourceMethod === "link") {
    const videoLinkValue = String(videoLinkField?.value || "").trim();

    if (!videoLinkValue) {
      adminSetFeedback(stateFeedback, "Debes pegar el link del video.", "error");
      savingStates.delete(stateKey);
      if (stateSaveButton) {
        stateSaveButton.disabled = false;
        stateSaveButton.textContent = "Guardar estado";
      }
      return;
    }

    formData.append("videoLinks", videoLinkValue);
    videoLinkByState.set(stateKey, videoLinkValue);
  } else {
    appendFiles(pendingMedia.video, "video");
    videoLinkByState.delete(stateKey);
  }

  formData.append("mediaMeta", JSON.stringify(mediaMeta));

  adminSetFeedback(stateFeedback, "Guardando estado...");

  try {
    const response = await fetchTrackingPageJson(`/api/admin/orders/${selectedOrder._id}/tracking-states/${stateKey}`, {
      method: "PATCH",
      body: formData,
    });

    orders = orders.map((order) => (order._id === response.order._id ? response.order : order));
    expandedStateKey = stateKey;
    renderOrderSummary(getSelectedOrder());
    renderStates();
    renderSearchResults(getFilteredOrders());
    adminSetFeedback(trackingFeedback, "Estado actualizado correctamente.", "success");
    clearDraftStateValues(stateKey);
    pendingMediaByState.set(stateKey, createEmptyPendingMedia());
    videoSourceMethodByState.delete(stateKey);
    videoLinkByState.delete(stateKey);
    renderStates();
    openSuccessModal();
  } catch (error) {
    adminSetFeedback(stateFeedback, error.message, "error");
  } finally {
    savingStates.delete(stateKey);

    if (stateSaveButton) {
      stateSaveButton.disabled = false;
      stateSaveButton.textContent = "Guardar estado";
    }
  }
}

window.__adminTrackingHandleSearch = () => {
  handleSearchClick().catch((error) => {
    adminSetFeedback(trackingFeedback, error.message, "error");
  });
};

trackingSearchButton.addEventListener("click", () => {
  handleSearchClick().catch((error) => {
    adminSetFeedback(trackingFeedback, error.message, "error");
  });
});

trackingClearButton?.addEventListener("click", clearSearchFilters);

trackingRoot.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-tracking-modal]")) {
    closeSuccessModal();
    return;
  }

  const orderLink = event.target.closest("[data-order-link='true']");

  if (orderLink) {
    const detailUrl = orderLink.dataset.href || orderLink.getAttribute("href") || "";

    if (detailUrl) {
      window.location.href = detailUrl;
    }

    return;
  }

  const orderButton = event.target.closest("[data-order-id]");

  if (orderButton) {
    expandedStateKey = "";
    selectOrder(orderButton.dataset.orderId);
    adminSetFeedback(trackingFeedback, "Pedido seleccionado. Ya puedes editar sus estados.", "success");
    return;
  }

  const toggleButton = event.target.closest("[data-edit-state-key]");

  if (toggleButton) {
    if (!canEditStateForRole(currentAdminRole, toggleButton.dataset.editStateKey)) {
      setLockedStateFeedback(toggleButton.dataset.editStateKey);
      return;
    }

    expandedStateKey = expandedStateKey === toggleButton.dataset.editStateKey ? "" : toggleButton.dataset.editStateKey;
    renderStates();
    return;
  }

  const saveButton = event.target.closest("[data-save-state-key]");

  if (saveButton) {
    saveState(saveButton.dataset.saveStateKey).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message, "error");
    });
    return;
  }

  const mediaVisibilityButton = event.target.closest("[data-toggle-media-client-visible][data-state-key][data-update-index][data-media-index][data-next-visible]");

  if (mediaVisibilityButton) {
    const stateKey = String(mediaVisibilityButton.dataset.stateKey || "");
    const updateIndex = Number.parseInt(String(mediaVisibilityButton.dataset.updateIndex || ""), 10);
    const mediaIndex = Number.parseInt(String(mediaVisibilityButton.dataset.mediaIndex || ""), 10);
    const nextVisible = String(mediaVisibilityButton.dataset.nextVisible || "") === "true";

    if (!stateKey || Number.isNaN(updateIndex) || Number.isNaN(mediaIndex)) {
      return;
    }

    updateStateMediaClientVisibility(stateKey, updateIndex, mediaIndex, nextVisible).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message || "No se pudo actualizar la visibilidad del archivo.", "error");
    });
    return;
  }

  const removeMediaButton = event.target.closest("[data-remove-media-state][data-remove-media-index]");

  if (removeMediaButton) {
    const stateKey = String(removeMediaButton.dataset.removeMediaState || "");
    const mediaIndex = Number.parseInt(removeMediaButton.dataset.removeMediaIndex || "", 10);
    const selectedOrder = getSelectedOrder();

    if (!canEditStateForRole(currentAdminRole, stateKey)) {
      setLockedStateFeedback(stateKey);
      return;
    }

    if (!selectedOrder || !stateKey || Number.isNaN(mediaIndex)) {
      return;
    }

    const state = (selectedOrder.trackingSteps || []).find((item) => item.key === stateKey);

    if (!state || !Array.isArray(state.media)) {
      return;
    }

    state.media = state.media.filter((item, index) => index !== mediaIndex);
    expandedStateKey = stateKey;
    renderStates();
    return;
  }

  const removePendingButton = event.target.closest("[data-remove-pending-state][data-remove-pending-category][data-remove-pending-index]");

  if (removePendingButton) {
    const stateKey = String(removePendingButton.dataset.removePendingState || "");
    const category = String(removePendingButton.dataset.removePendingCategory || "");
    const index = Number.parseInt(removePendingButton.dataset.removePendingIndex || "", 10);

    if (!canEditStateForRole(currentAdminRole, stateKey)) {
      setLockedStateFeedback(stateKey);
      return;
    }

    if (!stateKey || !category || Number.isNaN(index)) {
      return;
    }

    const pendingMedia = getPendingMediaForState(stateKey);

    if (!Array.isArray(pendingMedia[category])) {
      return;
    }

    pendingMedia[category] = pendingMedia[category].filter((_, itemIndex) => itemIndex !== index);
    expandedStateKey = stateKey;
    renderStates();
  }
});

trackingRoot.addEventListener("keydown", (event) => {
  const orderLink = event.target.closest("[data-order-link='true']");

  if (!orderLink) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const detailUrl = orderLink.dataset.href || orderLink.getAttribute("href") || "";

  if (!detailUrl) {
    return;
  }

  event.preventDefault();
  window.location.href = detailUrl;
});

trackingPreview.addEventListener("click", (event) => {
  const overviewToggleButton = event.target.closest("[data-overview-stage-toggle]");

  if (overviewToggleButton) {
    const stateKey = String(overviewToggleButton.dataset.overviewStageToggle || "");

    if (!stateKey) {
      return;
    }

    expandedOverviewStateKey = expandedOverviewStateKey === stateKey ? "" : stateKey;
    renderTrackingOverview(getSelectedOrder());
    return;
  }

  const overviewEventToggleButton = event.target.closest("[data-overview-event-toggle]");

  if (overviewEventToggleButton) {
    const eventId = String(overviewEventToggleButton.dataset.overviewEventToggle || "");

    if (!eventId) {
      return;
    }

    if (expandedOverviewEventIds.has(eventId)) {
      expandedOverviewEventIds.delete(eventId);
    } else {
      expandedOverviewEventIds.add(eventId);
    }

    renderTrackingOverview(getSelectedOrder());
    return;
  }

  const editStateButton = event.target.closest("[data-edit-state-key]");

  if (editStateButton) {
    const stateKey = String(editStateButton.dataset.editStateKey || "");

    if (!canEditStateForRole(currentAdminRole, stateKey)) {
      setLockedStateFeedback(stateKey);
      return;
    }

    expandedStateKey = stateKey;
    trackingEditorFields.hidden = false;
    renderStates();
    trackingStatesList.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const mediaVisibilityButton = event.target.closest("[data-toggle-media-client-visible][data-state-key][data-update-index][data-media-index][data-next-visible]");

  if (mediaVisibilityButton) {
    const stateKey = String(mediaVisibilityButton.dataset.stateKey || "");
    const updateIndex = Number.parseInt(String(mediaVisibilityButton.dataset.updateIndex || ""), 10);
    const mediaIndex = Number.parseInt(String(mediaVisibilityButton.dataset.mediaIndex || ""), 10);
    const nextVisible = String(mediaVisibilityButton.dataset.nextVisible || "") === "true";

    if (!stateKey || Number.isNaN(updateIndex) || Number.isNaN(mediaIndex)) {
      return;
    }

    updateStateMediaClientVisibility(stateKey, updateIndex, mediaIndex, nextVisible).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message || "No se pudo actualizar la visibilidad del archivo.", "error");
    });
    return;
  }

  const visibilityButton = event.target.closest("[data-toggle-client-visible][data-state-key][data-update-index][data-next-visible]");

  if (!visibilityButton) {
    return;
  }

  const stateKey = String(visibilityButton.dataset.stateKey || "");
  const updateIndex = Number.parseInt(String(visibilityButton.dataset.updateIndex || ""), 10);
  const nextVisible = String(visibilityButton.dataset.nextVisible || "") === "true";

  if (!stateKey || Number.isNaN(updateIndex)) {
    return;
  }

  updateStateClientVisibility(stateKey, updateIndex, nextVisible).catch((error) => {
    adminSetFeedback(trackingFeedback, error.message || "No se pudo actualizar la visibilidad del cliente.", "error");
  });
});

trackingRoot.addEventListener("change", (event) => {
  const videoMethodField = event.target.closest('select[data-field="videoSourceMethod"][data-state-key]');

  if (videoMethodField) {
    const stateKey = String(videoMethodField.dataset.stateKey || "");

    if (!stateKey) {
      return;
    }

    videoSourceMethodByState.set(stateKey, String(videoMethodField.value || "file"));
    expandedStateKey = stateKey;
    renderStates();
    return;
  }

  const mediaField = event.target.closest("input[type='file'][data-field][data-state-key]");

  if (mediaField) {
    const stateKey = String(mediaField.dataset.stateKey || "");
    const category = getCategoryByField(mediaField.dataset.field || "");

    if (!stateKey || !category) {
      return;
    }

    const pendingMedia = getPendingMediaForState(stateKey);
    const files = Array.from(mediaField.files || []);

    if (files.length) {
      pendingMedia[category] = [...pendingMedia[category], ...files];
      mediaField.value = "";
      expandedStateKey = stateKey;
      renderStates();
    }

    return;
  }

  const stateField = event.target.closest('[data-field="confirmed"], [data-field="inProgress"]');

  if (!stateField) {
    return;
  }

  const stateCard = stateField.closest("[data-state-card]");
  const stateKey = stateCard?.dataset.stateCard || "";

  if (!stateCard || !stateKey) {
    return;
  }

  const confirmedField = stateCard.querySelector('[data-field="confirmed"]');
  const inProgressField = stateCard.querySelector('[data-field="inProgress"]');
  const editButton = stateCard.querySelector("[data-edit-state-key]");

  if (stateField === confirmedField && confirmedField?.checked && inProgressField) {
    inProgressField.checked = false;
  }

  if (stateField === inProgressField && inProgressField?.checked && confirmedField) {
    confirmedField.checked = false;
  }

  setDraftStateValues(stateKey, {
    confirmed: Boolean(confirmedField?.checked),
    inProgress: Boolean(inProgressField?.checked),
  });

  stateCard.classList.toggle("is-confirmed", Boolean(confirmedField?.checked));
  stateCard.classList.toggle("is-in-progress", Boolean(inProgressField?.checked) && !Boolean(confirmedField?.checked));

  if (editButton) {
    editButton.classList.toggle("is-confirmed", Boolean(confirmedField?.checked));
    editButton.textContent = confirmedField?.checked ? "Completado" : inProgressField?.checked ? "En curso" : "Editar";
  }
});

trackingRoot.addEventListener("input", (event) => {
  const notesField = event.target.closest('textarea[data-field="notes"]');

  if (notesField) {
    const stateCard = notesField.closest("[data-state-card]");
    const stateKey = stateCard?.dataset.stateCard || "";

    if (stateKey) {
      setDraftStateValues(stateKey, { notes: String(notesField.value || "") });
    }

    return;
  }

  const videoLinkField = event.target.closest('input[data-field="videoLink"][data-state-key]');

  if (!videoLinkField) {
    return;
  }

  const stateKey = String(videoLinkField.dataset.stateKey || "");

  if (!stateKey) {
    return;
  }

  videoLinkByState.set(stateKey, String(videoLinkField.value || ""));
});

trackingSuccessClose?.addEventListener("click", closeSuccessModal);

trackingSuccessModal?.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-tracking-modal")) {
    closeSuccessModal();
  }
});

searchConfigs.forEach((config) => {
  config.input.addEventListener("input", () => {
    renderSearchResults(getFilteredOrders());
  });
});

trackingStateFilter?.addEventListener("change", () => {
  renderSearchResults(getFilteredOrders());
});

trackingDateFromFilter?.addEventListener("change", () => {
  renderSearchResults(getFilteredOrders());
});

trackingDateToFilter?.addEventListener("change", () => {
  renderSearchResults(getFilteredOrders());
});

forceClearLoadingState();
initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
window.addEventListener("pageshow", forceClearLoadingState);
window.addEventListener("load", forceClearLoadingState);

loadTrackingPage(getOrderIdFromUrl(), getOrderFiltersFromUrl()).catch((error) => {
  stopInitOverlayWatchdog();
  forceClearLoadingState();
  trackingEditorFields.hidden = true;
  searchConfigs.forEach((config) => {
    config.input.value = "";
    config.input.placeholder = error.message;
    config.list.innerHTML = "";
  });
  adminRenderEmptyState(trackingPreview, error.message);
  adminSetFeedback(trackingFeedback, error.message, "error");
});
