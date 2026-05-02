const {
  attachLogout: adminAttachLogout,
  renderEmptyState: adminRenderEmptyState,
  redirectToLogin: adminRedirectToLogin,
  resetLoadingOverlay: adminResetLoadingOverlay,
  setFeedback: adminSetFeedback,
  trackingTemplates: adminTrackingTemplates,
} = window.AdminApp;

function resolveTrackingApiBaseUrl() {
  const { origin, hostname } = window.location;

  const isPrivateIpv4Address = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(
    hostname
  );

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    isPrivateIpv4Address ||
    hostname === "global-backend-bdbx.onrender.com"
  ) {
    return origin;
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

    const error = new Error(data.message || "Request failed");
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function loadTrackingPageSession() {
  const data = await fetchTrackingPageJson("/api/auth/me");
  const user = data.user || {};
  currentAdminRole = String(user.role || "");
  currentAdminEmail = String(user.email || "").trim().toLowerCase();
  currentAdminId = String(user._id || user.id || "").trim();

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

  const sidebarNameElement = document.getElementById("admin-name-sidebar");
  const sidebarEmailElement = document.getElementById("admin-email-sidebar");

  if (sidebarNameElement) {
    sidebarNameElement.textContent = user.name || "Administrador";
  }

  if (sidebarEmailElement) {
    sidebarEmailElement.textContent = user.email || "admin@globalimports.com";
  }

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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSearchValue(value) {
  return normalizeText(value).toUpperCase();
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

function getOrderIdentifier(order) {
  return String(order?._id || order?.id || "").trim();
}

function buildOrderDetailUrl(order) {
  const orderId = getOrderIdentifier(order);
  const trackingValue = String(order?.trackingNumber || "").trim();
  const vinValue = String(order?.vehicle?.vin || "").trim();
  const clientValue = String(getClientDisplayName(order) || "").trim();

  return `/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(trackingValue)}&vin=${encodeURIComponent(vinValue)}&client=${encodeURIComponent(clientValue)}`;
}

function buildOrderAccountingUrl(order) {
  const orderId = getOrderIdentifier(order);
  return `/admin-order-accounting.html?orderId=${encodeURIComponent(orderId)}`;
}

function isDeletionManagerRole(role) {
  return ["manager", "gerenteUSA"].includes(String(role || "").trim());
}

function hasPendingDeletionRequest(order) {
  return String(order?.deletionRequest?.status || "").trim().toLowerCase() === "pending";
}

function getInternalIdentifier(order) {
  return String(order?.vehicle?.internalIdentifier || order?.vehicle?.description || "").trim();
}

function getClientDisplayName(order) {
  return normalizeText(order?.client?.name || "Cliente sin asignar") || "Cliente sin asignar";
}

function getClientOrInternalSearchValues(order) {
  return [...new Set([
    getClientDisplayName(order),
    getInternalIdentifier(order),
  ].map((value) => normalizeText(value)).filter(Boolean))];
}

function getConfigSearchValues(config, order) {
  if (typeof config?.getSearchValues === "function") {
    return config.getSearchValues(order).map((value) => normalizeText(value)).filter(Boolean);
  }

  const value = normalizeText(typeof config?.getValue === "function" ? config.getValue(order) : "");
  return value ? [value] : [];
}

function getConfigInputValue(config, order) {
  if (typeof config?.getInputValue === "function") {
    return normalizeText(config.getInputValue(order));
  }

  return getConfigSearchValues(config, order)[0] || "";
}

function formatOrderLabel(order) {
  return `${order?.vehicle?.brand || "Vehículo"} ${order?.vehicle?.model || ""}${order?.vehicle?.version ? ` ${order.vehicle.version}` : ""} ${order?.vehicle?.year || ""}`.trim();
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

function shouldShowOrderRegionBadge() {
  return ["adminUSA", "gerenteUSA"].includes(String(currentAdminRole || "").trim()) || isAnthonyGlobalOwner();
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

function formatDateTimeLabel(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Date(value).toLocaleString("es-CO", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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

adminAttachLogout();
document.body.classList.add("tracking-search-page");

function isWindowsDesktopEnvironment() {
  const platform = String(navigator.userAgentData?.platform || navigator.platform || "").toLowerCase();
  const userAgent = String(navigator.userAgent || "").toLowerCase();

  return platform.includes("win") || userAgent.includes("windows");
}

document.body.classList.toggle("host-windows-desktop", isWindowsDesktopEnvironment());

const trackingRoot = document.getElementById("tracking-form");
const trackingFeedback = document.getElementById("tracking-feedback");
const trackingOrderInput = document.getElementById("tracking-order-id");
const trackingPreview = document.getElementById("tracking-preview");
const trackingEditorFields = document.getElementById("tracking-editor-fields");
const trackingSearchButton = document.getElementById("tracking-search-button");
const trackingClearButton = document.getElementById("tracking-clear-button");
const trackingSearchResults = document.getElementById("tracking-search-results");
const trackingStateFilter = document.getElementById("tracking-search-state");
const trackingDateFromFilter = document.getElementById("tracking-search-date-from");
const trackingDateToFilter = document.getElementById("tracking-search-date-to");
const trackingOrderSummary = document.getElementById("tracking-order-summary");
const trackingStatesList = document.getElementById("tracking-states-list");
const trackingStageTransitionCard = document.getElementById("tracking-stage-transition-card");
const trackingHeroActions = document.querySelector(".tracking-hero-actions");
const trackingSuccessModal = document.getElementById("tracking-success-modal");
const trackingSuccessTitle = document.getElementById("tracking-success-title");
const trackingSuccessMessage = document.getElementById("tracking-success-message");
const trackingSuccessClose = document.getElementById("tracking-success-close");
const trackingDeleteUpdateModal = document.getElementById("tracking-delete-update-modal");
const trackingDeleteUpdateTitle = document.getElementById("tracking-delete-update-title");
const trackingDeleteUpdateConfirm = document.getElementById("tracking-delete-update-confirm");
const trackingDeleteUpdateFeedback = document.getElementById("tracking-delete-update-feedback");
const trackingDeleteUpdateCopy = trackingDeleteUpdateModal?.querySelector(".tracking-delete-confirm-copy") || null;
const trackingDeleteUpdateCancel = trackingDeleteUpdateModal?.querySelector(".tracking-modal-actions [data-close-delete-update-modal]") || null;
const orderSuccessModal = document.getElementById("order-success-modal");
const createOrderModal = document.getElementById("tracking-create-order-modal");
const createOrderModalCard = createOrderModal?.querySelector(".tracking-create-order-modal-card") || null;
const openCreateOrderModalButton = document.getElementById("open-create-order-modal");
const createOrderForm = document.getElementById("order-form");
const createOrderTrackingInput = document.getElementById("order-tracking-number");
const createOrderGenerateTrackingButton = document.getElementById("generate-tracking-button");
const createOrderClientSelect = document.getElementById("order-client-select");
const createOrderClientSummary = document.getElementById("order-client-summary");
const createOrderBrokerField = document.getElementById("order-broker-field");
const createOrderBrokerSelect = document.getElementById("order-broker-select");
const createOrderBrokerSummary = document.getElementById("order-broker-summary");
const createOrderModalTitle = document.getElementById("tracking-create-order-title");
const createOrderModalCopy = document.getElementById("tracking-create-order-copy");
const createOrderSubmitButton = document.getElementById("tracking-create-order-submit");
const createOrderFeedback = document.getElementById("order-feedback");
const brokerDocumentModal = document.getElementById("broker-document-modal");
const brokerDocumentForm = document.getElementById("broker-document-form");
const brokerDocumentOrderSummary = document.getElementById("broker-document-order-summary");
const brokerDocumentOrderCopy = document.getElementById("broker-document-order-copy");
const brokerDocumentTypeField = document.getElementById("broker-document-type");
const brokerDocumentFilesField = document.getElementById("broker-document-files");
const brokerDocumentFeedback = document.getElementById("broker-document-feedback");
const brokerDocumentSubmitButton = document.getElementById("broker-document-submit");
const orderDeleteRequestModal = document.getElementById("order-delete-request-modal");
const orderDeleteRequestForm = document.getElementById("order-delete-request-form");
const orderDeleteRequestSummary = document.getElementById("order-delete-request-summary");
const orderDeleteRequestReason = document.getElementById("order-delete-request-reason");
const orderDeleteRequestFeedback = document.getElementById("order-delete-request-feedback");
let createOrderModalResizeHandlerBound = false;
let pendingDeletionOrderId = "";
let pendingTrackingDeleteAction = null;
let pendingBrokerDocumentOrderId = "";

const searchConfigs = [
  {
    key: "tracking",
    input: document.getElementById("tracking-search-tracking"),
    list: document.getElementById("tracking-search-tracking-list"),
    placeholder: "Escribe o selecciona tracking",
    getValue(order) {
      return String(order?.trackingNumber || "");
    },
  },
  {
    key: "vin",
    input: document.getElementById("tracking-search-vin"),
    list: document.getElementById("tracking-search-vin-list"),
    placeholder: "Escribe o selecciona VIN",
    getValue(order) {
      return String(order?.vehicle?.vin || "");
    },
  },
  {
    key: "clientOrInternal",
    input: document.getElementById("tracking-search-client"),
    list: document.getElementById("tracking-search-client-list"),
    placeholder: "Escribe cliente o identificador interno",
    getSearchValues(order) {
      return getClientOrInternalSearchValues(order);
    },
    getInputValue(order) {
      return getClientDisplayName(order) || getInternalIdentifier(order);
    },
  },
];

let orders = [];
let selectedOrderId = "";
let currentAdminRole = "";
let currentAdminEmail = "";
let currentAdminId = "";
let expandedStateKey = "";
let expandedOverviewStateKey = "";
let initOverlayWatchdog = null;
const expandedOverviewEventIds = new Set();
const savingStates = new Set();
const stateDrafts = new Map();
let createOrderClients = [];
const ANTHONY_GLOBAL_OWNER_EMAIL = "anthony-vergel@hotmail.com";
const COMPLETED_TIMELINE_STAGE = { key: "completed", label: "Completado" };
const ORDER_DOCUMENT_TYPES = [
  { value: "FACTURA", label: "FACTURA" },
  { value: "BL", label: "BL" },
  { value: "CEPD", label: "CEPD" },
  { value: "TITULO", label: "TÍTULO" },
  { value: "BUYERS_ORDER", label: "BUYERS ORDER" },
  { value: "WIRE_INSTRUCTIONS", label: "WIRE INSTRUCTIONS" },
  { value: "BOOKING", label: "BOOKING" },
  { value: "TRACKING", label: "TRACKING" },
  { value: "PLAQUETA VIN", label: "PLAQUETA VIN" },
  { value: "REGISTRO DE IMPORTACION", label: "REGISTRO DE IMPORTACION" },
  { value: "FOTOS", label: "FOTOS" },
  { value: "AES", label: "AES" },
  { value: "CONTRATO", label: "CONTRATO" },
  { value: "SWIFT", label: "SWIFT" },
  { value: "SOPORTE_DE_PAGO", label: "SOPORTE DE PAGO" },
  { value: "PRE_APOSTILLA", label: "PRE-APOSTILLA" },
  { value: "OTRO", label: "OTRO" },
];
const ORDER_DOCUMENT_TYPE_LABELS = new Map(
  ORDER_DOCUMENT_TYPES.flatMap((option) => {
    const normalizedValue = String(option.value || "").trim().toUpperCase();
    const normalizedLabel = String(option.label || normalizedValue).trim().toUpperCase();

    return [
      [normalizedValue, option.label],
      [normalizedLabel, option.label],
      [normalizedLabel.replaceAll("-", "_"), option.label],
      [normalizedLabel.replaceAll("-", " "), option.label],
    ];
  })
);
const LEGACY_TRACKING_TRANSITION_STORAGE_KEY = "globalAdminTrackingLegacyTransition";
let useLegacyTrackingTransition = sessionStorage.getItem(LEGACY_TRACKING_TRANSITION_STORAGE_KEY) === "1";
let createOrderBrokers = [];

function getOrderDocumentTypeLabel(value) {
  const normalizedValue = normalizeText(value || "OTRO").toUpperCase();

  return ORDER_DOCUMENT_TYPE_LABELS.get(normalizedValue)
    || ORDER_DOCUMENT_TYPE_LABELS.get(normalizedValue.replaceAll("_", " "))
    || ORDER_DOCUMENT_TYPE_LABELS.get(normalizedValue.replaceAll("_", "-"))
    || normalizedValue
    || "OTRO";
}

function buildCreateOrderTrackingNumber() {
  const existingTrackings = new Set(
    orders.map((order) => normalizeSearchValue(order?.trackingNumber || "")).filter(Boolean)
  );

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = `GI-${Math.floor(100000 + Math.random() * 99999999)}`;

    if (!existingTrackings.has(normalizeSearchValue(candidate))) {
      return candidate;
    }
  }

  return `GI-${Math.floor(100000 + Math.random() * 99999999)}`;
}

function applyCreateOrderTrackingNumber() {
  if (!createOrderTrackingInput) {
    return;
  }

  createOrderTrackingInput.readOnly = true;
  createOrderTrackingInput.value = buildCreateOrderTrackingNumber();
  createOrderTrackingInput.placeholder = createOrderTrackingInput.value;
}

function regenerateTrackingFromModal(options = {}) {
  applyCreateOrderTrackingNumber();

  if (!options.silent) {
    adminSetFeedback(trackingFeedback, "Tracking generado correctamente.", "success");
  }

  return false;
}

function getDocumentZoomFactor() {
  const computedZoom = Number.parseFloat(window.getComputedStyle(document.documentElement).zoom || "");

  if (Number.isFinite(computedZoom) && computedZoom > 0) {
    return computedZoom;
  }

  const rootRect = document.documentElement.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;

  if (rootRect.width > 0 && viewportWidth > 0) {
    const inferredZoom = rootRect.width / viewportWidth;

    if (Number.isFinite(inferredZoom) && inferredZoom > 0) {
      return inferredZoom;
    }
  }

  return 1;
}

function layoutCreateOrderModal() {
  if (!createOrderModal || !createOrderModalCard || createOrderModal.hidden) {
    return;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const zoomFactor = getDocumentZoomFactor();
  const isCompactViewport = viewportWidth <= 900;
  const horizontalMargin = isCompactViewport ? 12 : 48;
  const verticalMargin = isCompactViewport ? 12 : 36;
  const visualModalWidth = Math.min(isCompactViewport ? viewportWidth - horizontalMargin * 2 : 1120, viewportWidth - horizontalMargin * 2);
  const visualMaxHeight = Math.max(320, viewportHeight - verticalMargin * 2);
  const cssViewportWidth = viewportWidth / zoomFactor;
  const cssViewportHeight = viewportHeight / zoomFactor;
  const cssModalWidth = Math.max(320 / zoomFactor, visualModalWidth / zoomFactor);
  const cssMaxHeight = visualMaxHeight / zoomFactor;

  createOrderModal.style.setProperty("display", "block", "important");
  createOrderModal.style.setProperty("position", "fixed", "important");
  createOrderModal.style.setProperty("top", "0", "important");
  createOrderModal.style.setProperty("left", "0", "important");
  createOrderModal.style.setProperty("right", "auto", "important");
  createOrderModal.style.setProperty("bottom", "auto", "important");
  createOrderModal.style.setProperty("width", `${cssViewportWidth}px`, "important");
  createOrderModal.style.setProperty("height", `${cssViewportHeight}px`, "important");
  createOrderModal.style.setProperty("min-height", `${cssViewportHeight}px`, "important");
  createOrderModal.style.setProperty("padding", "0", "important");

  createOrderModalCard.style.setProperty("position", "fixed", "important");
  createOrderModalCard.style.setProperty("width", `${cssModalWidth}px`, "important");
  createOrderModalCard.style.setProperty("max-width", `${cssModalWidth}px`, "important");
  createOrderModalCard.style.setProperty("max-height", `${cssMaxHeight}px`, "important");
  createOrderModalCard.style.setProperty("right", "auto", "important");
  createOrderModalCard.style.setProperty("bottom", "auto", "important");
  createOrderModalCard.style.setProperty("transform", "none", "important");
  createOrderModalCard.style.setProperty("margin", "0", "important");
  createOrderModalCard.style.setProperty("overflow", "auto", "important");
  createOrderModalCard.style.setProperty("box-sizing", "border-box", "important");

  const visualCardHeight = Math.min((createOrderModalCard.scrollHeight || 0) * zoomFactor, visualMaxHeight);
  const cssCardHeight = visualCardHeight / zoomFactor;
  const cssHorizontalMargin = horizontalMargin / zoomFactor;
  const cssVerticalMargin = verticalMargin / zoomFactor;
  const left = Math.max(cssHorizontalMargin, Math.round((cssViewportWidth - cssModalWidth) / 2));
  const top = Math.max(cssVerticalMargin, Math.round((cssViewportHeight - cssCardHeight) / 2));

  createOrderModalCard.style.setProperty("left", `${left}px`, "important");
  createOrderModalCard.style.setProperty("top", `${top}px`, "important");
}

createOrderTrackingInput?.addEventListener("keydown", (event) => {
  event.preventDefault();
});

createOrderTrackingInput?.addEventListener("paste", (event) => {
  event.preventDefault();
});

createOrderGenerateTrackingButton?.addEventListener("click", () => {
  regenerateTrackingFromModal();
});

function renderCreateOrderClientOptions() {
  if (!createOrderClientSelect) {
    return;
  }

  if (!createOrderClients.length) {
    createOrderClientSelect.innerHTML = '<option value="">No hay clientes disponibles</option>';

    if (createOrderClientSummary) {
      createOrderClientSummary.textContent = "Primero crea al menos un cliente en el módulo Clientes.";
    }

    return;
  }

  const sortedClients = [...createOrderClients].sort((left, right) => (
    String(left?.name || "Cliente").localeCompare(String(right?.name || "Cliente"), "es", { sensitivity: "base" })
  ));

  createOrderClientSelect.innerHTML = [
    '<option value="">Selecciona cliente</option>',
    ...sortedClients.map((client) => `<option value="${escapeHtml(client._id || client.id || "")}">${escapeHtml(client.name || "Cliente")}</option>`),
  ].join("");

  if (createOrderClientSummary) {
    createOrderClientSummary.textContent = `${createOrderClients.length} cliente(s) disponible(s).`;
  }
}

function renderCreateOrderBrokerOptions() {
  if (!createOrderBrokerField || !createOrderBrokerSelect) {
    return;
  }

  const fallbackOrderRegion = ["gerenteUSA", "adminUSA", "brokerUSA"].includes(String(currentAdminRole || "").trim())
    ? "usa"
    : "latam";
  const orderRegion = String(createOrderForm?.dataset.orderRegion || fallbackOrderRegion).trim().toLowerCase();
  const canAssignBroker = canAssignBrokerToOrders() && orderRegion === "usa";
  createOrderBrokerField.hidden = !canAssignBroker;
  createOrderBrokerSelect.disabled = !canAssignBroker;

  if (!canAssignBroker) {
    createOrderBrokerSelect.innerHTML = '<option value="">Sin broker asignado</option>';
    return;
  }

  const sortedBrokers = [...createOrderBrokers].sort((left, right) => (
    String(left?.name || "Broker").localeCompare(String(right?.name || "Broker"), "es", { sensitivity: "base" })
  ));

  createOrderBrokerSelect.innerHTML = [
    '<option value="">Sin broker asignado</option>',
    ...sortedBrokers.map((broker) => `<option value="${escapeHtml(broker._id || broker.id || "")}">${escapeHtml(broker.name || broker.email || "Broker USA")}</option>`),
  ].join("");

  if (createOrderBrokerSummary) {
    createOrderBrokerSummary.textContent = sortedBrokers.length
      ? `${sortedBrokers.length} broker(s) USA disponible(s).`
      : "No hay brokers USA creados todavía.";
  }
}

async function loadCreateOrderModalData() {
  const [clientsData, adminsData] = await Promise.all([
    fetchTrackingPageJson("/api/admin/clients"),
    canAssignBrokerToOrders() ? fetchTrackingPageJson("/api/admin/users/admins") : Promise.resolve({ users: [] }),
  ]);
  createOrderClients = normalizeCollectionPayload(clientsData, ["clients"]);
  createOrderBrokers = normalizeCollectionPayload(adminsData, ["users"]).filter((user) => String(user?.role || "").trim() === "brokerUSA");
  renderCreateOrderClientOptions();
  renderCreateOrderBrokerOptions();
  applyCreateOrderTrackingNumber();
}

function syncTrackingPageMode(order) {
  document.body.classList.toggle("tracking-detail-mode", Boolean(order));

  if (trackingPreview) {
    trackingPreview.hidden = isUsaBrokerRole();
  }

  if (openCreateOrderModalButton) {
    openCreateOrderModalButton.hidden = Boolean(order) || !canCreateOrEditOrders();
  }

  if (trackingHeroActions) {
    trackingHeroActions.hidden = Boolean(order);
  }

  if (trackingStageTransitionCard) {
    trackingStageTransitionCard.hidden = true;
  }
}

function getActiveOrders() {
  return orders.filter((order) => order?.status === "active");
}

function isAnthonyGlobalOwner() {
  return currentAdminRole === "manager" && currentAdminEmail === ANTHONY_GLOBAL_OWNER_EMAIL;
}

function isUsaBrokerRole(role = currentAdminRole) {
  return String(role || "").trim() === "brokerUSA";
}

function canCreateOrEditOrders() {
  return !isUsaBrokerRole();
}

function canAssignBrokerToOrders() {
  return currentAdminRole === "gerenteUSA";
}

function canManageOrderDocumentActions() {
  return !isUsaBrokerRole();
}

function normalizeEntityId(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "object") {
    return String(value._id || value.id || "").trim();
  }

  return String(value).trim();
}

function isCurrentAdminOrderCreator(order) {
  const creatorId = normalizeEntityId(order?.createdBy);
  const creatorEmail = String(order?.createdBy?.email || "").trim().toLowerCase();

  if (creatorId && currentAdminId) {
    return creatorId === currentAdminId;
  }

  return Boolean(creatorEmail) && creatorEmail === currentAdminEmail;
}

function getTrackingStateIndex(stateKey) {
  return adminTrackingTemplates.findIndex((template) => template.key === String(stateKey || "").trim());
}

function canEditStateForRole(role, stateKey) {
  const normalizedRole = String(role || "").trim();
  const stateIndex = getTrackingStateIndex(stateKey);

  if (!normalizedRole || stateIndex === -1) {
    return false;
  }

  if (isAnthonyGlobalOwner()) {
    return true;
  }

  if (["adminUSA", "gerenteUSA"].includes(normalizedRole)) {
    return stateIndex <= 3;
  }

  if (["admin", "manager"].includes(normalizedRole)) {
    return stateIndex >= 3;
  }

  return false;
}

function canTransitionTrackingState(currentIndex, targetIndex) {
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= adminTrackingTemplates.length) {
    return false;
  }

  if (isAnthonyGlobalOwner()) {
    return true;
  }

  if (["adminUSA", "gerenteUSA"].includes(currentAdminRole)) {
    return currentIndex <= 2 && targetIndex <= 3;
  }

  if (["admin", "manager"].includes(currentAdminRole)) {
    return currentIndex >= 3 && targetIndex >= 3;
  }

  return false;
}

function canFinalizeTrackingOrder(order, currentIndex) {
  const orderRegion = String(order?.orderRegion || "latam").trim().toLowerCase();

  if (isAnthonyGlobalOwner()) {
    return currentIndex === adminTrackingTemplates.length - 1 || (orderRegion === "usa" && currentIndex === 3);
  }

  if (orderRegion === "usa") {
    return ["adminUSA", "gerenteUSA"].includes(currentAdminRole) && currentIndex === 3 && isCurrentAdminOrderCreator(order);
  }

  return currentIndex === adminTrackingTemplates.length - 1 && ["admin", "manager"].includes(currentAdminRole);
}

function canAdvanceTrackingState(states = [], stateIndex = -1) {
  if (!Array.isArray(states) || stateIndex <= 0) {
    return true;
  }

  return Boolean(states[stateIndex - 1]?.confirmed);
}

function getLatestUpdate(step) {
  return (Array.isArray(step?.updates) ? step.updates : []).reduce((latestUpdate, currentUpdate) => {
    if (!latestUpdate) {
      return currentUpdate;
    }

    const latestTime = new Date(latestUpdate.updatedAt || latestUpdate.createdAt || 0).getTime();
    const currentTime = new Date(currentUpdate.updatedAt || currentUpdate.createdAt || 0).getTime();

    return currentTime >= latestTime ? currentUpdate : latestUpdate;
  }, null);
}

function getTrackingTemplateMeta(stateKey) {
  const resolvedStateKey = String(stateKey || "").trim();
  const stateIndex = adminTrackingTemplates.findIndex((template) => template.key === resolvedStateKey);

  return {
    key: resolvedStateKey,
    index: stateIndex,
    label: stateIndex >= 0 ? adminTrackingTemplates[stateIndex].label : resolvedStateKey,
    code: stateIndex >= 0 ? getStateCode(stateIndex) : "-",
  };
}

function getOrderTrackingEvents(order) {
  return (Array.isArray(order?.trackingEvents) ? order.trackingEvents : [])
    .map((event) => {
      const stateMeta = getTrackingTemplateMeta(event?.stateKey || event?.stepKey || "");
      const parsedStateIndex = Number.isInteger(event?.stateIndex)
        ? event.stateIndex
        : Number.parseInt(String(event?.stateIndex || ""), 10);
      const parsedUpdateIndex = Number.isInteger(event?.updateIndex)
        ? event.updateIndex
        : Number.parseInt(String(event?.updateIndex || ""), 10);

      return {
        eventId: String(event?.eventId || event?._id || `${stateMeta.key}-${parsedUpdateIndex}`),
        stateKey: stateMeta.key,
        stateLabel: String(event?.stateLabel || stateMeta.label || "Estado"),
        stateIndex: Number.isNaN(parsedStateIndex) ? stateMeta.index : parsedStateIndex,
        stateCode: String(event?.stateCode || stateMeta.code || "-"),
        updateIndex: Number.isNaN(parsedUpdateIndex) ? -1 : parsedUpdateIndex,
        title: normalizeText(event?.title || ""),
        location: normalizeText(event?.location || ""),
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

      if (rightTime !== leftTime) {
        return rightTime - leftTime;
      }

      if (left.completed !== right.completed) {
        return left.completed ? -1 : 1;
      }

      return right.stateIndex - left.stateIndex;
    });
}

function getOrderTrackingSteps(order) {
  const orderSteps = Array.isArray(order?.trackingSteps) ? order.trackingSteps : [];
  const stepsByKey = new Map(orderSteps.map((step, index) => [String(step?.key || adminTrackingTemplates[index]?.key || ""), step]));
  const trackingEvents = getOrderTrackingEvents(order);
  const trackingEventsByKey = new Map();

  trackingEvents.forEach((event) => {
    if (!trackingEventsByKey.has(event.stateKey)) {
      trackingEventsByKey.set(event.stateKey, []);
    }

    trackingEventsByKey.get(event.stateKey).push(event);
  });

  const normalizedSteps = adminTrackingTemplates.map((template, index) => {
    const sourceStep = stepsByKey.get(template.key) || orderSteps[index] || {};
    const eventUpdates = (trackingEventsByKey.get(template.key) || [])
      .slice()
      .sort((left, right) => left.updateIndex - right.updateIndex)
      .map((event) => ({
        eventId: event.eventId,
        title: event.title,
        location: event.location,
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
    const hasEventUpdates = eventUpdates.length > 0;
    const latestUpdate = getLatestUpdate({ updates });
    const lastCompletedUpdate = [...updates].reverse().find((item) => item.completed) || null;
    const hasExplicitReopenState = typeof sourceStep?.confirmed === "boolean"
      && sourceStep.confirmed === false
      && Boolean(
        (typeof sourceStep?.inProgress === "boolean" && sourceStep.inProgress)
        || latestUpdate?.inProgress
      );
    const derivedConfirmed = hasExplicitReopenState
      ? false
      : Boolean(
          (typeof sourceStep?.confirmed === "boolean" && sourceStep.confirmed)
          || lastCompletedUpdate
          || latestUpdate?.completed
        );
    const derivedInProgress = derivedConfirmed
      ? false
      : Boolean(
          hasExplicitReopenState
          || (typeof sourceStep?.inProgress === "boolean"
            ? sourceStep.inProgress
            : latestUpdate?.inProgress)
        );

    return {
      key: template.key,
      label: String(sourceStep?.label || template.label),
      updates,
      confirmed: derivedConfirmed,
      inProgress: derivedInProgress,
      clientVisible: updates.some((item) => item.clientVisible),
      updatedAt: sourceStep?.updatedAt || latestUpdate?.updatedAt || latestUpdate?.createdAt || null,
      confirmedAt: sourceStep?.confirmedAt || lastCompletedUpdate?.updatedAt || lastCompletedUpdate?.createdAt || null,
      notes: normalizeText(sourceStep?.notes || latestUpdate?.notes || ""),
      media: Array.isArray(sourceStep?.media) ? sourceStep.media.filter((item) => item?.url) : [],
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

function getSelectedOrder() {
  const selectedOrder = orders.find((order) => getOrderIdentifier(order) === selectedOrderId) || null;

  if (!selectedOrder) {
    return null;
  }

  selectedOrder.trackingSteps = getOrderTrackingSteps(selectedOrder);
  return selectedOrder;
}

function getStateCode(index) {
  return `E${index + 1}`;
}

function resolveCurrentStageKey(order) {
  const steps = getOrderTrackingSteps(order);
  const activeStep = steps.find((step) => step.inProgress && !step.confirmed);

  if (activeStep?.key) {
    return activeStep.key;
  }

  const firstPendingStep = steps.find((step) => !step.confirmed);
  return firstPendingStep?.key || adminTrackingTemplates[adminTrackingTemplates.length - 1]?.key || "";
}

function getCurrentStageMeta(order) {
  const currentStageKey = resolveCurrentStageKey(order);
  const stageIndex = adminTrackingTemplates.findIndex((stage) => stage.key === currentStageKey);

  if (stageIndex === -1) {
    return { key: "", index: -1, code: "-", label: "Sin etapa" };
  }

  return {
    key: currentStageKey,
    index: stageIndex,
    code: getStateCode(stageIndex),
    label: String(adminTrackingTemplates[stageIndex]?.label || "Estado"),
  };
}

function getTimelineSteps(order) {
  const steps = getOrderTrackingSteps(order);
  const allTrackingStepsCompleted = steps.length > 0 && steps.every((step) => Boolean(step?.confirmed));

  return [
    ...steps,
    {
      key: COMPLETED_TIMELINE_STAGE.key,
      label: COMPLETED_TIMELINE_STAGE.label,
      confirmed: allTrackingStepsCompleted || String(order?.status || "").trim().toLowerCase() === "completed",
      inProgress: false,
    },
  ];
}

function getTransitionHelperCopy(order, currentStageMeta) {
  const orderRegion = String(order?.orderRegion || "latam").trim().toLowerCase();

  if (isAnthonyGlobalOwner()) {
    return "Puedes avanzar o retroceder libremente. La etapa actual queda EN PROCESO.";
  }

  if (["adminUSA", "gerenteUSA"].includes(currentAdminRole) && orderRegion === "usa" && currentStageMeta.index === 3) {
    if (isCurrentAdminOrderCreator(order)) {
      return "Llegaste a la etapa 4. Puedes finalizar este pedido para completar todas las etapas restantes.";
    }

    return "Los usuarios de USA solo pueden mover pedidos hasta la etapa 4. Solo el creador del pedido puede finalizarlo desde aqui.";
  }

  if (["adminUSA", "gerenteUSA"].includes(currentAdminRole) && currentStageMeta.index >= 3) {
    return "Los usuarios de USA solo pueden mover pedidos hasta la etapa 4. Desde aqui la transicion queda bloqueada.";
  }

  if (["admin", "manager"].includes(currentAdminRole) && currentStageMeta.index >= 0 && currentStageMeta.index < 3) {
    return "Las primeras 3 etapas solo las puede modificar gerencia LATAM. La etapa actual queda EN PROCESO.";
  }

  return "Solo se permite avanzar a la siguiente o retroceder a la anterior. La etapa actual queda EN PROCESO.";
}

function renderStageTransitionCard(order) {
  if (!trackingStageTransitionCard) {
    return;
  }

  trackingStageTransitionCard.hidden = true;
  trackingStageTransitionCard.innerHTML = "";
}

function renderStageTransitionCardMarkup(order) {
  if (!order) {
    return "";
  }

  const currentStageMeta = getCurrentStageMeta(order);
  const previousEnabled = canTransitionTrackingState(currentStageMeta.index, currentStageMeta.index - 1);
  const nextEnabled = canTransitionTrackingState(currentStageMeta.index, currentStageMeta.index + 1);
  const finalizeEnabled = canFinalizeTrackingOrder(order, currentStageMeta.index);

  return `
    <article class="tracking-stage-transition-card tracking-stage-transition-card-inline">
    <strong>Transición de etapa</strong>
    <div class="tracking-stage-transition-actions">
      <button class="secondary-button tracking-stage-transition-button" type="button" data-transition-direction="previous" ${previousEnabled ? "" : "disabled"}>
        <span aria-hidden="true">←</span>
        <span>Anterior</span>
      </button>
      <button class="secondary-button tracking-stage-transition-button" type="button" data-transition-direction="next" ${nextEnabled ? "" : "disabled"}>
        <span>Siguiente</span>
        <span aria-hidden="true">→</span>
      </button>
    </div>
    ${finalizeEnabled ? `
    <div class="tracking-stage-transition-complete-row">
      <button class="primary-button tracking-stage-transition-complete-button" type="button" data-finalize-order="true">
        Finalizar pedido
      </button>
    </div>
    ` : ""}
    <p>${escapeHtml(getTransitionHelperCopy(order, currentStageMeta))}</p>
    </article>
  `;
}

function populateSearchSelects() {
  const activeOrders = getActiveOrders();

  searchConfigs.forEach((config) => {
    const values = new Set();

    activeOrders.forEach((order) => {
      getConfigSearchValues(config, order).forEach((rawValue) => {
        values.add(rawValue);
      });
    });

    config.input.placeholder = config.placeholder;
    config.list.innerHTML = [...values].map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  });

  const selectedState = String(trackingStateFilter?.value || "");
  const stateOptions = ['<option value="">Todos los estados</option>'].concat(
    adminTrackingTemplates.map(
      (stage, index) => `<option value="${escapeHtml(stage.key)}">${escapeHtml(`${getStateCode(index)}: ${stage.label}`)}</option>`
    )
  );

  if (trackingStateFilter) {
    trackingStateFilter.innerHTML = stateOptions.join("");
    if (selectedState) {
      trackingStateFilter.value = selectedState;
    }
  }
}

function getFilteredOrders() {
  const activeOrders = getActiveOrders();
  const selectedState = String(trackingStateFilter?.value || "").trim();
  const dateFrom = trackingDateFromFilter?.value ? normalizeToDateStart(trackingDateFromFilter.value) : null;
  const dateTo = trackingDateToFilter?.value ? normalizeToDateEnd(trackingDateToFilter.value) : null;

  return activeOrders.filter((order) => {
    const matchesSearch = searchConfigs.every((config) => {
      const query = normalizeSearchValue(config.input.value);

      if (!query) {
        return true;
      }

      return getConfigSearchValues(config, order).some((value) => normalizeSearchValue(value).includes(query));
    });

    if (!matchesSearch) {
      return false;
    }

    const currentStageKey = resolveCurrentStageKey(order);

    if (selectedState && currentStageKey !== selectedState) {
      return false;
    }

    const orderDate = order?.purchaseDate || order?.createdAt || null;
    const orderDateValue = orderDate ? new Date(orderDate) : null;

    if (dateFrom && (!orderDateValue || Number.isNaN(orderDateValue.getTime()) || orderDateValue < dateFrom)) {
      return false;
    }

    if (dateTo && (!orderDateValue || Number.isNaN(orderDateValue.getTime()) || orderDateValue > dateTo)) {
      return false;
    }

    return true;
  });
}

function hasActiveSearchFilters() {
  const hasTextQuery = searchConfigs.some((config) => normalizeSearchValue(config.input.value));
  const hasStateFilter = Boolean(String(trackingStateFilter?.value || "").trim());
  const hasDateFrom = Boolean(String(trackingDateFromFilter?.value || "").trim());
  const hasDateTo = Boolean(String(trackingDateToFilter?.value || "").trim());

  return hasTextQuery || hasStateFilter || hasDateFrom || hasDateTo;
}

function findExactMatch(matches) {
  const activeSearchConfigs = searchConfigs.filter((config) => normalizeSearchValue(config.input.value));

  if (!activeSearchConfigs.length) {
    return null;
  }

  return matches.find((order) => activeSearchConfigs.every((config) => {
    const query = normalizeSearchValue(config.input.value);

    return getConfigSearchValues(config, order).some((value) => normalizeSearchValue(value) === query);
  })) || null;
}

function updateUrlForOrder(order) {
  const url = new URL(window.location.href);

  if (!order) {
    url.searchParams.delete("orderId");
    url.searchParams.delete("tracking");
    url.searchParams.delete("vin");
    url.searchParams.delete("client");
    url.searchParams.delete("internal");
    window.history.replaceState({}, document.title, url.toString());
    return;
  }

  url.searchParams.set("orderId", getOrderIdentifier(order));
  url.searchParams.set("tracking", String(order?.trackingNumber || ""));
  url.searchParams.set("vin", String(order?.vehicle?.vin || ""));
  url.searchParams.set("client", getClientDisplayName(order));
  url.searchParams.delete("internal");
  window.history.replaceState({}, document.title, url.toString());
}

function applySelectedOrderToInputs(order) {
  if (!order) {
    return;
  }

  searchConfigs.forEach((config) => {
    config.input.value = getConfigInputValue(config, order);
  });
}

function getUrlFilters() {
  const url = new URL(window.location.href);
  return {
    orderId: normalizeText(url.searchParams.get("orderId") || ""),
    tracking: normalizeSearchValue(url.searchParams.get("tracking") || ""),
    vin: normalizeSearchValue(url.searchParams.get("vin") || ""),
    client: normalizeSearchValue(url.searchParams.get("client") || ""),
    internal: normalizeSearchValue(url.searchParams.get("internal") || ""),
  };
}

function resolveInitialOrderId(filters) {
  if (!filters.orderId && !filters.tracking && !filters.vin && !filters.client && !filters.internal) {
    return "";
  }

  const match = getActiveOrders().find((order) => {
    if (filters.orderId && getOrderIdentifier(order) === filters.orderId) {
      return true;
    }

    if (filters.tracking && normalizeSearchValue(order?.trackingNumber) === filters.tracking) {
      return true;
    }

    if (filters.vin && normalizeSearchValue(order?.vehicle?.vin) === filters.vin) {
      return true;
    }

    if (filters.client && normalizeSearchValue(getClientDisplayName(order)) === filters.client) {
      return true;
    }

    if (filters.internal && normalizeSearchValue(getInternalIdentifier(order)) === filters.internal) {
      return true;
    }

    return false;
  });

  return match ? getOrderIdentifier(match) : "";
}

function renderSearchResults(matches) {
  if (!matches.length) {
    trackingSearchResults.innerHTML = '<div class="empty-state">No encontramos pedidos activos con esos filtros.</div>';
    return;
  }

  if (isUsaBrokerRole()) {
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
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${matches.map((order) => {
              const orderId = getOrderIdentifier(order);
              const trackingValue = String(order?.trackingNumber || "").trim();
              const vinValue = String(order?.vehicle?.vin || "").trim();
              const stageMeta = getCurrentStageMeta(order);
              const vehicleLabel = formatOrderLabel(order);
              const rowDate = formatDateLabel(order?.purchaseDate || order?.createdAt);

              return `
                <tr class="tracking-order-row is-broker-view" data-order-id="${escapeHtml(orderId)}">
                  <td data-label="Tracking">
                    <div class="tracking-order-link-stack">
                      <span class="tracking-order-static-value">${escapeHtml(trackingValue || "-")}</span>
                      ${renderOrderRegionBadge(order)}
                    </div>
                  </td>
                  <td data-label="VIN">${escapeHtml(vinValue || "Sin VIN")}</td>
                  <td data-label="Cliente">${escapeHtml(getClientDisplayName(order))}</td>
                  <td data-label="Destino">${escapeHtml(order?.vehicle?.destination || "-")}</td>
                  <td data-label="Estado">${escapeHtml(`${stageMeta.code} · ${stageMeta.label}`)}</td>
                  <td data-label="Vehículo"><strong>${escapeHtml(vehicleLabel)}</strong></td>
                  <td data-label="Fecha">${escapeHtml(rowDate)}</td>
                  <td data-label="Acciones" class="tracking-order-actions-cell">
                    <div class="tracking-order-actions broker-actions">
                      <button class="tracking-order-action-button" type="button" data-broker-upload="${escapeHtml(orderId)}">Subir archivos</button>
                      <button class="tracking-order-action-button" type="button" data-broker-documents="${escapeHtml(orderId)}">Ver docs</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    `;
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
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${matches.map((order) => {
            const orderId = getOrderIdentifier(order);
            const trackingValue = String(order?.trackingNumber || "").trim();
            const vinValue = String(order?.vehicle?.vin || "").trim();
            const detailUrl = buildOrderDetailUrl(order);
            const stageMeta = getCurrentStageMeta(order);
            const vehicleLabel = formatOrderLabel(order);
            const rowDate = formatDateLabel(order?.purchaseDate || order?.createdAt);
            const pendingDeletion = hasPendingDeletionRequest(order);
            const deleteLabel = pendingDeletion ? "Solicitud pendiente" : "Eliminar pedido";
            const canManageOrder = canCreateOrEditOrders();
            const actionMarkup = canManageOrder
              ? `
                  <div class="tracking-order-actions">
                    <button class="tracking-order-action-button" type="button" data-order-edit="${escapeHtml(orderId)}" aria-label="Editar pedido ${escapeHtml(trackingValue || orderId)}">&#9998;</button>
                    <button class="tracking-order-action-button is-danger" type="button" data-order-delete="${escapeHtml(orderId)}" ${pendingDeletion ? 'disabled aria-disabled="true"' : ""} aria-label="${escapeHtml(deleteLabel)} ${escapeHtml(trackingValue || orderId)}">&times;</button>
                  </div>
                `
              : '<span class="admin-user-delete-placeholder">-</span>';

            return `
              <tr
                class="tracking-order-row ${orderId === selectedOrderId ? "selected" : ""}"
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
                  ${actionMarkup}
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function getStateDraftDefaults(state) {
  return {
    notes: "",
    inProgress: Boolean(state?.inProgress && !state?.confirmed),
    confirmed: Boolean(state?.confirmed),
    videoLinks: "",
  };
}

function getStateDraft(state) {
  const stateKey = String(state?.key || "");

  if (!stateKey) {
    return getStateDraftDefaults(state);
  }

  return {
    ...getStateDraftDefaults(state),
    ...(stateDrafts.get(stateKey) || {}),
  };
}

function setStateDraft(stateKey, patch = {}) {
  const selectedOrder = getSelectedOrder();
  const state = (selectedOrder?.trackingSteps || []).find((item) => item.key === stateKey) || { key: stateKey };

  stateDrafts.set(stateKey, {
    ...getStateDraft(state),
    ...patch,
  });
}

function clearStateDrafts(stateKey = "") {
  if (stateKey) {
    stateDrafts.delete(stateKey);
    return;
  }

  stateDrafts.clear();
}

function renderVisibilityButton(stateKey, updateIndex, nextVisible, isVisible, eventId = "") {
  return `
    <button
      type="button"
      class="tracking-visibility-button ${isVisible ? "is-visible" : "is-hidden"}"
      data-toggle-update-visibility="true"
      data-state-key="${escapeHtml(stateKey)}"
      data-update-index="${updateIndex}"
      data-event-id="${escapeHtml(eventId)}"
      data-next-visible="${nextVisible ? "true" : "false"}"
      title="${isVisible ? "Ocultar al cliente" : "Mostrar al cliente"}"
      aria-label="${isVisible ? "Ocultar al cliente" : "Mostrar al cliente"}"
    >
      ${isVisible
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.6 4.3-10.9 6-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6s9.6-4.3 10.9-6c.2-.3.2-.7 0-1C21.6 9.3 17.5 5 12 5Zm0 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.7 1.3-1.4 1.4 3 3C2.6 7 1.4 8.4.6 9.5c-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6 2 0 3.8-.5 5.4-1.3l3 3 1.4-1.4L2.7 1.3Zm8.8 8.8 3 3a2.4 2.4 0 0 1-3-3Zm7.9 2.8a15.5 15.5 0 0 0-3.8-3.5l1.5 1.5c.6.5 1.2 1.1 1.7 1.7-.8 1-2.1 2.4-3.8 3.4l1.5 1.5c2-1.3 3.4-3.1 4.2-4.1.2-.3.2-.7 0-1ZM12 6.5c.8 0 1.5.1 2.1.3L15.7 8c-1-.7-2.3-1.1-3.7-1.1-1 0-1.9.2-2.7.6l1.3 1.3c.4-.2.9-.3 1.4-.3Z"></path></svg>'}
    </button>
  `;
}

function renderDeleteButton(stateKey, updateIndex, eventId = "") {
  return `
    <button
      type="button"
      class="tracking-file-remove-button"
      data-delete-update="true"
      data-state-key="${escapeHtml(stateKey)}"
      data-update-index="${updateIndex}"
      data-event-id="${escapeHtml(eventId)}"
      title="Borrar evento"
      aria-label="Borrar evento"
    >x</button>
  `;
}

function renderDeleteEventTableButton(stateKey, updateIndex, eventId = "") {
  return `
    <button
      type="button"
      class="tracking-event-delete-button"
      data-delete-update="true"
      data-state-key="${escapeHtml(stateKey)}"
      data-update-index="${updateIndex}"
      data-event-id="${escapeHtml(eventId)}"
      title="Borrar evento"
      aria-label="Borrar evento"
    >&times;</button>
  `;
}

function renderMediaItems(media = []) {
  if (!media.length) {
    return "";
  }

  return `
    <div class="tracking-state-media-list">
      ${media.map((item, index) => {
        const label = item?.caption || item?.name || `Adjunto ${index + 1}`;

        if (item?.type === "video") {
          return `
            <article class="tracking-media-card video">
              <video controls playsinline preload="metadata" src="${escapeHtml(item.url)}"></video>
              <strong>${escapeHtml(label)}</strong>
            </article>
          `;
        }

        if (item?.type === "document") {
          return `
            <article class="tracking-media-card document">
              <strong>${escapeHtml(label)}</strong>
              <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Abrir documento</a>
            </article>
          `;
        }

        return `
          <article class="tracking-media-card image">
            <img src="${escapeHtml(item.url)}" alt="${escapeHtml(label)}" loading="lazy" />
            <strong>${escapeHtml(label)}</strong>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function releaseUploadPreviewUrls(previewElement) {
  const objectUrls = Array.isArray(previewElement?.__previewObjectUrls) ? previewElement.__previewObjectUrls : [];

  objectUrls.forEach((objectUrl) => {
    URL.revokeObjectURL(objectUrl);
  });

  if (previewElement) {
    previewElement.__previewObjectUrls = [];
  }
}

function renderPendingUploadPreview(previewElement, files = []) {
  if (!previewElement) {
    return;
  }

  releaseUploadPreviewUrls(previewElement);

  const selectedFiles = Array.from(files || []);

  if (!selectedFiles.length) {
    previewElement.innerHTML = "";
    previewElement.hidden = true;
    return;
  }

  const objectUrls = [];

  previewElement.innerHTML = selectedFiles.map((file, index) => {
    const objectUrl = URL.createObjectURL(file);
    const label = escapeHtml(file.name || `Adjunto ${index + 1}`);

    objectUrls.push(objectUrl);

    if (file.type.startsWith("video/")) {
      return `
        <article class="tracking-media-card video">
          <video controls playsinline preload="metadata" src="${escapeHtml(objectUrl)}"></video>
          <strong>${label}</strong>
        </article>
      `;
    }

    if (file.type.startsWith("image/")) {
      return `
        <article class="tracking-media-card image">
          <img src="${escapeHtml(objectUrl)}" alt="${label}" loading="lazy" />
          <strong>${label}</strong>
        </article>
      `;
    }

    return `
      <article class="tracking-media-card document">
        <strong>${label}</strong>
        <span>Vista previa no disponible para este archivo.</span>
      </article>
    `;
  }).join("");

  previewElement.__previewObjectUrls = objectUrls;
  previewElement.hidden = false;
}

function getFlattenedStateMedia(step) {
  return getIndexedUpdates(step).flatMap((update) =>
    (Array.isArray(update?.media) ? update.media : []).map((item, mediaIndex) => ({
      ...item,
      updateIndex: update.updateIndex,
      mediaIndex,
    }))
  );
}

function buildStateMediaBuckets(media = []) {
  return {
    document: media.filter((item) => item?.category === "document" || item?.type === "document"),
    photoSingle: media.filter((item) => item?.category === "photo-single"),
    photoCarousel: media.filter(
      (item) => item?.category === "photo-carousel" || ((!item?.category || item.category === "image") && item?.type !== "video" && item?.type !== "document")
    ),
    video: media.filter((item) => item?.category === "video" || item?.type === "video"),
  };
}

function renderCategorizedMediaSections(media = []) {
  const buckets = buildStateMediaBuckets(media);
  const sections = [];

  if (buckets.document.length) {
    sections.push(`
      <section class="tracking-state-media-block">
        <strong>Documento PDF</strong>
        ${renderMediaItems(buckets.document)}
      </section>
    `);
  }

  if (buckets.photoSingle.length) {
    sections.push(`
      <section class="tracking-state-media-block">
        <strong>Foto unica</strong>
        ${renderMediaItems(buckets.photoSingle)}
      </section>
    `);
  }

  if (buckets.photoCarousel.length) {
    sections.push(`
      <section class="tracking-state-media-block">
        <strong>Carrusel</strong>
        ${renderMediaItems(buckets.photoCarousel)}
      </section>
    `);
  }

  if (buckets.video.length) {
    sections.push(`
      <section class="tracking-state-media-block">
        <strong>Video</strong>
        ${renderMediaItems(buckets.video)}
      </section>
    `);
  }

  if (!sections.length) {
    return "";
  }

  return `
    <div class="tracking-state-media-groups">
      ${sections.join("")}
    </div>
  `;
}

function resolveTimelineProgression(states = []) {
  let completedUntil = -1;

  for (let index = 0; index < states.length; index += 1) {
    if (!states[index]?.confirmed) {
      break;
    }

    completedUntil = index;
  }

  if (!states.length) {
    return { completedUntil: -1, currentIndex: -1 };
  }

  if (completedUntil >= states.length - 1) {
    return { completedUntil, currentIndex: -1 };
  }

  return {
    completedUntil,
    currentIndex: completedUntil + 1,
  };
}

function resolveTimelineStateVariant(state, index, states) {
  const progression = resolveTimelineProgression(states);

  if (index <= progression.completedUntil) {
    return "is-completed";
  }

  if (index === progression.currentIndex) {
    return "is-current";
  }

  return "is-pending";
}

function resolveTimelineStateStatusLabel(variant) {
  if (variant === "is-completed") {
    return "Completada";
  }

  if (variant === "is-current") {
    return "En proceso";
  }

  return "Pendiente";
}

function getIndexedUpdates(step) {
  return (Array.isArray(step?.updates) ? step.updates : [])
    .map((update, updateIndex) => ({
      ...update,
      updateIndex,
    }))
    .sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightTime - leftTime;
    });
}

function getUpdateStatusLabel(update) {
  if (update?.completed) {
    return "Etapa completada";
  }

  if (update?.inProgress) {
    return "Estado en curso";
  }

  return "Actualizacion interna";
}

function getRecentEventSummary(item) {
  const statusLabel = String(item?.title || "Evento").trim();
  const description = String(item?.description || "").trim();
  const attachmentCount = Array.isArray(item?.media) ? item.media.length : 0;
  const attachmentLabel = attachmentCount === 1 ? "1 documento adjunto" : `${attachmentCount} documentos adjuntos`;
  const summaryParts = [];

  if (description) {
    summaryParts.push(`${statusLabel}: ${description}`);
  } else {
    summaryParts.push(statusLabel);
  }

  if (attachmentCount > 0) {
    summaryParts.push(attachmentLabel);
  }

  return summaryParts.join(" - ");
}

function renderStateUpdates(step) {
  const indexedUpdates = getIndexedUpdates(step);

  if (!indexedUpdates.length) {
    return '<div class="tracking-state-history-empty">Todavía no hay actualizaciones en el historial de esta etapa.</div>';
  }

  return `
    <div class="tracking-state-history-list">
      ${indexedUpdates.map((update) => `
        <article class="tracking-state-history-item ${update.clientVisible ? "is-client-visible" : "is-internal"}">
          <div class="tracking-state-history-header">
            <div>
              <strong>${escapeHtml(getUpdateStatusLabel(update))}</strong>
              <p>${escapeHtml(formatDateTimeLabel(update.updatedAt || update.createdAt))}</p>
            </div>
            <div class="tracking-stage-event-actions">
              ${renderVisibilityButton(step.key, update.updateIndex, !update.clientVisible, update.clientVisible, update.eventId)}
              ${renderDeleteButton(step.key, update.updateIndex, update.eventId)}
            </div>
          </div>
          <p>${escapeHtml(update.notes || "Sin descripción registrada.")}</p>
          ${renderCategorizedMediaSections(update.media || [])}
        </article>
      `).join("")}
    </div>
  `;
}

function buildRecentEvents(order) {
  const trackingEvents = getOrderTrackingEvents(order);

  if (trackingEvents.length) {
    const groupedEvents = new Map();

    trackingEvents.forEach((event) => {
      if (!groupedEvents.has(event.stateKey)) {
        groupedEvents.set(event.stateKey, {
          stateKey: event.stateKey,
          stateCode: event.stateCode,
          stateLabel: event.stateLabel,
          latestDate: event.updatedAt || event.createdAt || null,
          items: [],
        });
      }

      const stageGroup = groupedEvents.get(event.stateKey);
      stageGroup.items.push({
        id: event.eventId || `${event.stateKey}-${event.updateIndex}`,
        eventId: event.eventId || "",
        itemType: "update",
        stateKey: event.stateKey,
        updateIndex: event.updateIndex,
        stateCode: event.stateCode,
        stateLabel: event.stateLabel,
        date: event.updatedAt || event.createdAt || null,
        title: getUpdateStatusLabel(event),
        description: event.notes || "Sin descripción registrada.",
        clientVisible: event.clientVisible,
        media: event.media || [],
      });

      const stageGroupTime = new Date(stageGroup.latestDate || 0).getTime();
      const eventTime = new Date(event.updatedAt || event.createdAt || 0).getTime();

      if (eventTime > stageGroupTime) {
        stageGroup.latestDate = event.updatedAt || event.createdAt || null;
      }
    });

    return Array.from(groupedEvents.values())
      .map((group) => ({
        ...group,
        items: group.items.sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime()),
      }))
      .sort((left, right) => new Date(right.latestDate || 0).getTime() - new Date(left.latestDate || 0).getTime());
  }

  return getOrderTrackingSteps(order)
    .map((step, index) => {
      const stateCode = getStateCode(index);
      const items = getIndexedUpdates(step)
        .map((update) => ({
          id: `${step.key}-${update.updateIndex}`,
          eventId: String(update.eventId || ""),
          itemType: "update",
          stateKey: step.key,
          updateIndex: update.updateIndex,
          stateCode,
          stateLabel: step.label,
          date: update.updatedAt || update.createdAt || null,
          title: getUpdateStatusLabel(update),
          description: update.notes || "Sin descripción registrada.",
          clientVisible: Boolean(update.clientVisible),
          media: Array.isArray(update.media) ? update.media : [],
        }))
        .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime());

      if (!items.length) {
        return null;
      }

      return {
        stateKey: step.key,
        stateCode,
        stateLabel: step.label,
        latestDate: items[0]?.date || null,
        items,
      };
    })
    .filter(Boolean)
    .sort((left, right) => new Date(right.latestDate || 0).getTime() - new Date(left.latestDate || 0).getTime());
}

function renderRecentEventItem(item) {
  const eventId = String(item.id || "");
  const isExpanded = expandedOverviewEventIds.has(eventId);
  const eventSummary = getRecentEventSummary(item);

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
            <strong>${escapeHtml(eventSummary)}</strong>
            <div class="tracking-stage-event-meta">
              <span>${escapeHtml(formatDateTimeLabel(item.date))}</span>
              <span>${escapeHtml(item.clientVisible ? "Visible al cliente" : "Oculto al cliente")}</span>
              <span>${escapeHtml(`${item.media.length} adjunto(s)`)}</span>
            </div>
          </div>
          <span class="tracking-stage-event-chevron" aria-hidden="true">${isExpanded ? "−" : "+"}</span>
        </button>
        <div class="tracking-stage-event-actions">
          ${renderVisibilityButton(item.stateKey, item.updateIndex, !item.clientVisible, item.clientVisible, item.eventId)}
          ${renderDeleteButton(item.stateKey, item.updateIndex, item.eventId)}
        </div>
      </div>
      <div class="tracking-stage-event-body" ${isExpanded ? "" : "hidden"}>
        <p>${escapeHtml(item.description || "Sin descripción registrada.")}</p>
        ${renderCategorizedMediaSections(item.media || [])}
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

function renderRecentEvents(order) {
  const eventGroups = buildRecentEvents(order);
  const resolvedExpandedOverviewStateKey = eventGroups.some((group) => group.stateKey === expandedOverviewStateKey)
    ? expandedOverviewStateKey
    : "";

  if (!eventGroups.length) {
    return '<div class="empty-state">No hay eventos recientes registrados para esta orden.</div>';
  }

  return `
    <div class="tracking-stage-events-stack">
      ${eventGroups.map((stageGroup) => renderRecentEventStage(stageGroup, stageGroup.stateKey === resolvedExpandedOverviewStateKey)).join("")}
    </div>
  `;
}

function buildAdminEventTableRows(order) {
  return getOrderTrackingEvents(order).map((event) => ({
    eventId: event.eventId,
    stateKey: event.stateKey,
    updateIndex: event.updateIndex,
    date: event.updatedAt || event.createdAt || null,
    stage: event.stateCode || "-",
    title: event.title || getUpdateStatusLabel(event),
    location: event.location || "-",
    description: event.notes || "-",
    clientVisible: Boolean(event.clientVisible),
  }));
}

function renderAdminEventsTable(order) {
  const rows = buildAdminEventTableRows(order);

  if (!rows.length) {
    return '<div class="empty-state">No hay eventos recientes registrados para esta orden.</div>';
  }

  return `
    <div class="tracking-table-wrap">
      <table class="tracking-data-table admin-tracking-events-table" aria-label="Eventos recientes del pedido">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Etapa</th>
            <th>Título</th>
            <th>Ubicación</th>
            <th>Descripción</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td data-label="Fecha">${escapeHtml(formatDateTimeLabel(row.date))}</td>
              <td data-label="Etapa">${escapeHtml(row.stage)}</td>
              <td data-label="Título">${escapeHtml(row.title)}</td>
              <td data-label="Ubicación">${escapeHtml(row.location)}</td>
              <td data-label="Descripción">${escapeHtml(row.description)}</td>
              <td data-label="Acciones" class="admin-tracking-events-actions-cell">
                <div class="admin-tracking-event-actions">
                  ${renderVisibilityButton(row.stateKey, row.updateIndex, !row.clientVisible, row.clientVisible, row.eventId)}
                  ${renderDeleteEventTableButton(row.stateKey, row.updateIndex, row.eventId)}
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderNewEventCard(order) {
  const currentStageMeta = getCurrentStageMeta(order);
  const stageOptions = adminTrackingTemplates
    .filter((template) => canEditStateForRole(currentAdminRole, template.key))
    .map((template) => {
      const templateIndex = getTrackingStateIndex(template.key);
      const isSelected = template.key === currentStageMeta.key;
      return `<option value="${escapeHtml(template.key)}" ${isSelected ? "selected" : ""}>${escapeHtml(`E${templateIndex + 1} — ${template.label}`)}</option>`;
    })
    .join("");

  return `
    <article class="dashboard-card tracking-table-card tracking-new-event-card">
      <div class="card-heading compact">
        <h2>Nuevo evento</h2>
      </div>
      <form class="tracking-new-event-form" data-new-event-form>
        <label>
          <span>Título *</span>
          <input name="title" class="tracking-native-select" type="text" placeholder="Ej: E3 — Booking confirmado / Tracking iniciado" required />
        </label>
        <label>
          <span>Descripción</span>
          <textarea name="description" rows="4" class="tracking-native-select tracking-native-textarea"></textarea>
        </label>
        <div class="form-row two-up tracking-new-event-grid">
          <label>
            <span>Etapa relacionada</span>
            <select name="stageKey" class="tracking-native-select">${stageOptions}</select>
          </label>
          <label>
            <span>Ubicación</span>
            <input name="location" class="tracking-native-select" type="text" placeholder="Ej: Puerto de Miami, Bodega Panamá, etc." />
          </label>
        </div>
        <div class="tracking-new-event-actions">
          <button class="primary-button" type="submit">+ Registrar</button>
        </div>
        <p class="feedback" data-new-event-feedback aria-live="polite"></p>
      </form>
    </article>
  `;
}

function getOrderDocuments(order) {
  return (Array.isArray(order?.media) ? order.media : [])
    .filter((item) => item?.url && (item?.category === "document" || item?.type === "document"))
    .map((item) => ({
      documentId: String(item.documentId || "").trim(),
      documentType: getOrderDocumentTypeLabel(item.documentType || "OTRO"),
      name: normalizeText(item.name || item.caption || "Documento sin nombre") || "Documento sin nombre",
      note: normalizeText(item.note || ""),
      url: String(item.url || ""),
      clientVisible: Boolean(item.clientVisible),
      createdAt: item.createdAt || null,
      updatedAt: item.updatedAt || item.createdAt || null,
    }))
    .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime());
}

function renderOrderDocumentVisibilityButton(documentId, nextVisible, isVisible) {
  return `
    <button
      type="button"
      class="tracking-visibility-button ${isVisible ? "is-visible" : "is-hidden"}"
      data-toggle-order-document-visibility="true"
      data-document-id="${escapeHtml(documentId)}"
      data-next-visible="${nextVisible ? "true" : "false"}"
      title="${isVisible ? "Ocultar al cliente" : "Mostrar al cliente"}"
      aria-label="${isVisible ? "Ocultar al cliente" : "Mostrar al cliente"}"
    >
      ${isVisible
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5c-5.5 0-9.6 4.3-10.9 6-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6s9.6-4.3 10.9-6c.2-.3.2-.7 0-1C21.6 9.3 17.5 5 12 5Zm0 11a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m2.7 1.3-1.4 1.4 3 3C2.6 7 1.4 8.4.6 9.5c-.2.3-.2.7 0 1 1.3 1.7 5.4 6 10.9 6 2 0 3.8-.5 5.4-1.3l3 3 1.4-1.4L2.7 1.3Zm8.8 8.8 3 3a2.4 2.4 0 0 1-3-3Zm7.9 2.8a15.5 15.5 0 0 0-3.8-3.5l1.5 1.5c.6.5 1.2 1.1 1.7 1.7-.8 1-2.1 2.4-3.8 3.4l1.5 1.5c2-1.3 3.4-3.1 4.2-4.1.2-.3.2-.7 0-1ZM12 6.5c.8 0 1.5.1 2.1.3L15.7 8c-1-.7-2.3-1.1-3.7-1.1-1 0-1.9.2-2.7.6l1.3 1.3c.4-.2.9-.3 1.4-.3Z"></path></svg>'}
    </button>
  `;
}

function renderOrderDocumentDeleteButton(documentId) {
  return `
    <button
      type="button"
      class="tracking-event-delete-button"
      data-delete-order-document="true"
      data-document-id="${escapeHtml(documentId)}"
      title="Eliminar documento"
      aria-label="Eliminar documento"
    >&times;</button>
  `;
}

function renderOrderDocumentsTable(order) {
  const documents = getOrderDocuments(order);

  if (!documents.length) {
    return '<div class="empty-state">No hay documentos cargados para esta orden.</div>';
  }

  return `
    <div class="tracking-table-wrap">
      <table class="tracking-data-table admin-tracking-documents-table" aria-label="Documentos del pedido">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Archivo</th>
            <th>Nota</th>
            <th>Fecha</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${documents.map((document) => `
            <tr>
              <td data-label="Tipo">${escapeHtml(document.documentType)}</td>
              <td data-label="Archivo">
                <div class="tracking-document-link-cell">
                  <a class="tracking-document-link" href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.name)}</a>
                </div>
              </td>
              <td data-label="Nota">${escapeHtml(document.note || "-")}</td>
              <td data-label="Fecha">${escapeHtml(formatDateTimeLabel(document.updatedAt || document.createdAt))}</td>
              <td data-label="Acciones" class="admin-tracking-events-actions-cell">
                ${canManageOrderDocumentActions()
                  ? `<div class="admin-tracking-event-actions">
                      ${renderOrderDocumentVisibilityButton(document.documentId, !document.clientVisible, document.clientVisible)}
                      ${renderOrderDocumentDeleteButton(document.documentId)}
                    </div>`
                  : '<span class="admin-user-delete-placeholder">-</span>'}
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderOrderDocumentUploadCard() {
  return `
    <article class="dashboard-card tracking-table-card tracking-document-upload-card">
      <div class="card-heading compact">
        <h2>Subir documento(s)</h2>
      </div>
      <form class="tracking-document-form" data-order-document-form>
        <div class="tracking-document-upload-grid">
          <label>
            <span>Tipo</span>
            <select name="documentType" class="tracking-native-select">
              ${ORDER_DOCUMENT_TYPES.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Archivo(s) *</span>
            <input name="mediaFiles" class="tracking-document-file-input" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.rtf,.txt,.zip" multiple required />
            <small>Puedes seleccionar varias imagenes o documentos a la vez, incluyendo ZIP.</small>
          </label>
        </div>
        <label>
          <span>Notas</span>
          <input name="note" class="tracking-native-select" type="text" placeholder="Agrega una nota corta para identificar el documento" />
        </label>
        <div class="tracking-new-event-actions">
          <button class="primary-button" type="submit">Guardar</button>
        </div>
        <p class="feedback" data-order-document-feedback aria-live="polite"></p>
      </form>
    </article>
  `;
}

function closeBrokerDocumentModal() {
  if (!brokerDocumentModal) {
    return;
  }

  brokerDocumentModal.hidden = true;
  pendingBrokerDocumentOrderId = "";

  if (brokerDocumentForm) {
    brokerDocumentForm.reset();
  }

  adminSetFeedback(brokerDocumentFeedback, "");
  document.body.classList.remove("modal-open");
}

function openBrokerDocumentModal(orderId) {
  const order = orders.find((item) => getOrderIdentifier(item) === String(orderId || "").trim()) || null;

  if (!order || !brokerDocumentModal) {
    return;
  }

  pendingBrokerDocumentOrderId = getOrderIdentifier(order);

  if (brokerDocumentOrderSummary) {
    brokerDocumentOrderSummary.value = `${order?.trackingNumber || "Sin tracking"} · ${formatOrderLabel(order)}`;
  }

  if (brokerDocumentOrderCopy) {
    brokerDocumentOrderCopy.textContent = `${getClientDisplayName(order)} · VIN ${order?.vehicle?.vin || "Sin VIN"}`;
  }

  if (brokerDocumentTypeField) {
    brokerDocumentTypeField.value = "";
  }

  if (brokerDocumentFilesField) {
    brokerDocumentFilesField.value = "";
  }

  adminSetFeedback(brokerDocumentFeedback, "");
  brokerDocumentModal.hidden = false;
  document.body.classList.add("modal-open");
}

async function submitBrokerDocumentForm() {
  const orderId = String(pendingBrokerDocumentOrderId || "").trim();

  if (!orderId) {
    throw new Error("No se encontro el pedido para subir documentos.");
  }

  if (!brokerDocumentForm) {
    throw new Error("No se encontro el formulario de carga.");
  }

  const formData = new FormData(brokerDocumentForm);
  const selectedType = String(formData.get("documentType") || "").trim();
  const files = Array.from(brokerDocumentFilesField?.files || []);

  if (!selectedType) {
    throw new Error("Debes seleccionar un tipo de archivo.");
  }

  if (!files.length) {
    throw new Error("Debes seleccionar al menos un archivo.");
  }

  if (brokerDocumentSubmitButton) {
    brokerDocumentSubmitButton.disabled = true;
  }

  adminSetFeedback(brokerDocumentFeedback, "Subiendo archivos...");

  try {
    const response = await fetchTrackingPageJson(`/api/admin/orders/${orderId}/documents`, {
      method: "POST",
      body: formData,
    });

    orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
    renderSearchResults(getFilteredOrders());
    closeBrokerDocumentModal();
    adminSetFeedback(trackingFeedback, "Archivo(s) cargado(s) correctamente.", "success");
  } finally {
    if (brokerDocumentSubmitButton) {
      brokerDocumentSubmitButton.disabled = false;
    }
  }
}

function renderOrderSummary(order) {
  if (!trackingOrderSummary) {
    return;
  }

  if (!order) {
    trackingOrderSummary.innerHTML = "";
    return;
  }

  const stageMeta = getCurrentStageMeta(order);

  trackingOrderSummary.innerHTML = `
    <div class="tracking-card-header">
      <strong>${escapeHtml(formatOrderLabel(order))}</strong>
      <p>${escapeHtml(getClientDisplayName(order))} · Tracking ${escapeHtml(order?.trackingNumber || "-")}</p>
      <p>VIN ${escapeHtml(order?.vehicle?.vin || "Sin VIN")} · Exterior ${escapeHtml(order?.vehicle?.exteriorColor || order?.vehicle?.color || "-")}</p>
      <p>Interior ${escapeHtml(order?.vehicle?.interiorColor || "-")}</p>
      <p>Destino ${escapeHtml(order?.vehicle?.destination || "-")} · ${escapeHtml(`${stageMeta.code} ${stageMeta.label}`)}</p>
    </div>
  `;
}

function renderTrackingOverview(order) {
  if (!order) {
    adminRenderEmptyState(trackingPreview, "Selecciona un pedido para ver sus eventos recientes.");
    renderStageTransitionCard(null);
    return;
  }

  const states = getOrderTrackingSteps(order);

  trackingPreview.innerHTML = `
    <div class="tracking-overview-stack">
      <div class="tracking-order-hero-grid">
        <article class="state-order-item tracking-overview-card">
          <header class="state-order-header tracking-overview-header" style="display:block;width:100%;text-align:center;">
            <div class="tracking-overview-heading" style="display:inline-grid;gap:12px;justify-items:center;margin:0 auto;text-align:center;">
              <h3 style="margin:0;text-align:center;">${escapeHtml(formatOrderLabel(order))}</h3>
              <strong class="tracking-overview-tracking" style="display:block;text-align:center;">Tracking ${escapeHtml(order?.trackingNumber || "-")}</strong>
            </div>
          </header>
          <div class="state-order-grid tracking-overview-grid">
            <article class="tracking-overview-detail tracking-overview-detail-client">
              <span class="tracking-overview-label">Cliente</span>
              <strong class="tracking-overview-value">${escapeHtml(getClientDisplayName(order))}</strong>
            </article>
            <article class="tracking-overview-detail">
              <span class="tracking-overview-label">VIN</span>
              <strong class="tracking-overview-value">${escapeHtml(order?.vehicle?.vin || "-")}</strong>
            </article>
            <article class="tracking-overview-detail">
              <span class="tracking-overview-label">Exterior</span>
              <strong class="tracking-overview-value">${escapeHtml(order?.vehicle?.exteriorColor || order?.vehicle?.color || "-")}</strong>
            </article>
            <article class="tracking-overview-detail">
              <span class="tracking-overview-label">Interior</span>
              <strong class="tracking-overview-value">${escapeHtml(order?.vehicle?.interiorColor || "-")}</strong>
            </article>
          </div>
          ${String(order?.orderRegion || "latam") === "latam" ? `
          <div class="tracking-new-event-actions tracking-order-accounting-action">
            <a class="secondary-button tracking-accounting-button" href="${escapeHtml(buildOrderAccountingUrl(order))}">Contabilidad</a>
          </div>
          ` : ""}
        </article>
        ${renderStageTransitionCardMarkup(order)}
      </div>

      <article class="dashboard-card tracking-table-card tracking-timeline-card">
        <div class="card-heading">
          <h2>Timeline de etapas</h2>
        </div>
        <div class="tracking-timeline-grid">
          ${getTimelineSteps(order).map((state, index, timelineStates) => {
            const variant = resolveTimelineStateVariant(state, index, timelineStates);
            const statusLabel = resolveTimelineStateStatusLabel(variant);
            const statusIcon = variant === "is-completed" ? "✅" : variant === "is-current" ? "⭐" : "◻";
            const canEditState = state.key === COMPLETED_TIMELINE_STAGE.key
              ? false
              : canEditStateForRole(currentAdminRole, state.key);

            return `
              <button
                type="button"
                class="tracking-timeline-item ${variant}"
                ${canEditState ? `data-edit-state-key="${escapeHtml(state.key)}"` : "disabled"}
                ${canEditState ? "" : 'title="Estado bloqueado por permisos"'}
              >
                <span class="tracking-timeline-code">${escapeHtml(getStateCode(index))}</span>
                <span class="tracking-timeline-status">${statusIcon} ${escapeHtml(statusLabel)}</span>
                <strong>${escapeHtml(state.label || "Estado")}</strong>
              </button>
            `;
          }).join("")}
        </div>
      </article>

      <article class="dashboard-card tracking-table-card">
        <div class="tracking-events-editor-grid">
          <div class="tracking-events-column tracking-events-column-main">
            <article class="dashboard-card tracking-table-card tracking-events-general-card">
              <div class="card-heading compact">
                <h2>Eventos recientes</h2>
              </div>
              ${renderAdminEventsTable(order)}
            </article>
            <article class="dashboard-card tracking-table-card tracking-order-documents-card">
              <div class="card-heading compact">
                <h2>Documentos</h2>
              </div>
              ${renderOrderDocumentsTable(order)}
            </article>
          </div>
          <div class="tracking-events-column tracking-events-column-side">
            ${renderNewEventCard(order)}
            ${renderOrderDocumentUploadCard()}
          </div>
        </div>
      </article>
    </div>
  `;

  renderStageTransitionCard(order);
}

function renderStates() {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    syncTrackingPageMode(null);
    renderStageTransitionCard(null);
    adminRenderEmptyState(trackingPreview, "Busca un pedido y selecciona uno para gestionar sus eventos.");
    return;
  }

  syncTrackingPageMode(selectedOrder);

  renderTrackingOverview(selectedOrder);
}

function selectOrder(orderId) {
  selectedOrderId = String(orderId || "").trim();
  expandedStateKey = "";
  expandedOverviewStateKey = "";
  expandedOverviewEventIds.clear();
  clearStateDrafts();
  trackingOrderInput.value = selectedOrderId;
  if (trackingEditorFields) {
    trackingEditorFields.hidden = !selectedOrderId;
  }

  const selectedOrder = getSelectedOrder();
  syncTrackingPageMode(selectedOrder);
  updateUrlForOrder(selectedOrder);
  applySelectedOrderToInputs(selectedOrder);
  renderOrderSummary(selectedOrder);
  renderStates();
  renderSearchResults(getFilteredOrders());
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

  selectedOrderId = "";
  trackingOrderInput.value = "";
  if (trackingEditorFields) {
    trackingEditorFields.hidden = true;
  }
  expandedStateKey = "";
  expandedOverviewStateKey = "";
  expandedOverviewEventIds.clear();
  clearStateDrafts();
  syncTrackingPageMode(null);
  updateUrlForOrder(null);
  renderOrderSummary(null);
  renderStates();
  renderSearchResults(getFilteredOrders());
  adminSetFeedback(trackingFeedback, "Filtros limpiados. Mostrando todos los pedidos activos.", "success");
}

async function toggleUpdateVisibility(stateKey, updateIndex, nextVisible, eventId = "") {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder || !eventId) {
    adminSetFeedback(trackingFeedback, "No se pudo identificar el evento del ojito.", "error");
    return;
  }

  const response = await fetchTrackingPageJson(`/api/admin/orders/${selectedOrder._id}/tracking-events/${eventId}/visibility`, {
    method: "PATCH",
    body: JSON.stringify({
      clientVisible: nextVisible,
    }),
  });

  orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
  expandedOverviewStateKey = stateKey;
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());
  const clientPushSent = Number(response?.notificationSummary?.clientPushSent || 0);
  adminSetFeedback(
    trackingFeedback,
    nextVisible
      ? clientPushSent > 0
        ? "Evento visible para el cliente. Push enviado."
        : "Evento visible para el cliente. No se encontro un dispositivo push activo para este cliente."
      : "Evento oculto para el cliente.",
    "success"
  );

  if (nextVisible && clientPushSent > 0) {
    openSuccessModal({
      title: "Evento notificado",
      message: "El evento fue notificado al cliente y le aparecera en su app.",
    });
  }
}

async function deleteUpdate(stateKey, updateIndex, eventId = "") {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    return;
  }

  const deleteUrl = new URL(`/api/admin/orders/${selectedOrder._id}/tracking-states/${stateKey}/updates/${updateIndex}`, window.location.origin);

  if (eventId) {
    deleteUrl.searchParams.set("eventId", eventId);
  }

  const response = await fetchTrackingPageJson(`${deleteUrl.pathname}${deleteUrl.search}`, {
    method: "DELETE",
  });

  orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
  expandedStateKey = stateKey;
  expandedOverviewStateKey = stateKey;
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());
  adminSetFeedback(
    trackingFeedback,
    response?.message || (response?.requestPending
      ? "Solicitud de eliminación enviada correctamente."
      : "Evento eliminado correctamente."),
    "success"
  );

  return response;
}

async function saveState(stateKey) {
  if (savingStates.has(stateKey)) {
    return;
  }

  if (!canEditStateForRole(currentAdminRole, stateKey)) {
    adminSetFeedback(trackingFeedback, "No tienes permisos para modificar este estado.", "error");
    return;
  }

  const selectedOrder = getSelectedOrder();
  const stateCard = trackingStatesList?.querySelector(`[data-state-card="${stateKey}"]`) || null;
  const stateFeedback = trackingStatesList?.querySelector(`[data-state-feedback="${stateKey}"]`) || null;
  const saveButton = trackingStatesList?.querySelector(`[data-save-state-key="${stateKey}"]`) || null;

  if (!selectedOrder || !stateCard || !stateFeedback) {
    return;
  }

  const notesField = stateCard.querySelector('[data-field="notes"]');
  const inProgressField = stateCard.querySelector('[data-field="inProgress"]');
  const confirmedField = stateCard.querySelector('[data-field="confirmed"]');
  const attachmentsField = stateCard.querySelector('[data-field="attachments"]');
  const videoLinksField = stateCard.querySelector('[data-field="videoLinks"]');
  const notes = normalizeText(notesField?.value || "");
  const inProgress = Boolean(inProgressField?.checked);
  const confirmed = Boolean(confirmedField?.checked);
  const files = Array.from(attachmentsField?.files || []);
  const videoLinks = normalizeText(videoLinksField?.value || "");
  const states = getOrderTrackingSteps(selectedOrder);
  const stateIndex = states.findIndex((item) => item.key === stateKey);

  if (!notes && !files.length && !videoLinks && !inProgress && !confirmed) {
    adminSetFeedback(stateFeedback, "Agrega una nota, un adjunto o marca el estado para crear el evento.", "error");
    return;
  }

  if ((confirmed || inProgress) && !canAdvanceTrackingState(states, stateIndex)) {
    adminSetFeedback(stateFeedback, "Completa el estado anterior antes de avanzar este.", "error");
    return;
  }

  savingStates.add(stateKey);

  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "Guardando...";
  }

  const formData = new FormData();
  formData.append("operation", "add-update");
  formData.append("notes", notes);
  formData.append("inProgress", inProgress ? "true" : "false");
  formData.append("confirmed", confirmed ? "true" : "false");
  formData.append("videoLinks", videoLinks);

  files.forEach((file) => {
    formData.append("mediaFiles", file);
  });

  adminSetFeedback(stateFeedback, "Guardando evento...");

  try {
    const response = await fetchTrackingPageJson(`/api/admin/orders/${selectedOrder._id}/tracking-states/${stateKey}`, {
      method: "PATCH",
      body: formData,
    });

    orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
    expandedStateKey = stateKey;
    expandedOverviewStateKey = stateKey;
    clearStateDrafts(stateKey);
    renderOrderSummary(getSelectedOrder());
    renderStates();
    renderSearchResults(getFilteredOrders());
    adminSetFeedback(trackingFeedback, "Evento agregado correctamente.", "success");
    openSuccessModal();
  } catch (error) {
    adminSetFeedback(stateFeedback, error.message, "error");
  } finally {
    savingStates.delete(stateKey);

    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "Agregar evento";
    }
  }
}

async function submitNewTrackingEventForm(form) {
  const selectedOrder = getSelectedOrder();
  const feedbackElement = form.querySelector("[data-new-event-feedback]");
  const submitButton = form.querySelector('button[type="submit"]');

  if (!selectedOrder) {
    adminSetFeedback(feedbackElement, "Selecciona un pedido primero.", "error");
    return;
  }

  const formData = new FormData(form);
  const title = normalizeText(formData.get("title") || "");
  const description = normalizeText(formData.get("description") || "");
  const stageKey = normalizeText(formData.get("stageKey") || "");
  const location = normalizeText(formData.get("location") || "");

  if (!title) {
    adminSetFeedback(feedbackElement, "El título es obligatorio.", "error");
    return;
  }

  if (!canEditStateForRole(currentAdminRole, stageKey)) {
    adminSetFeedback(feedbackElement, "No tienes permisos para registrar eventos en esta etapa.", "error");
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
  }

  adminSetFeedback(feedbackElement, "Registrando evento...");

  try {
    const response = await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(selectedOrder)}/tracking-states/${stageKey}`, {
      method: "PATCH",
      body: JSON.stringify({
        operation: "add-update",
        forceCreateUpdate: true,
        title,
        location,
        notes: description,
        clientVisible: false,
        confirmed: false,
        inProgress: false,
      }),
    });

    orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
    expandedOverviewStateKey = stageKey;
    renderOrderSummary(getSelectedOrder());
    renderStates();
    renderSearchResults(getFilteredOrders());
    adminSetFeedback(trackingFeedback, "Evento registrado correctamente.", "success");
  } catch (error) {
    adminSetFeedback(feedbackElement, error.message, "error");
    return;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function submitOrderDocumentForm(form) {
  const selectedOrder = getSelectedOrder();
  const feedbackElement = form.querySelector("[data-order-document-feedback]");
  const submitButton = form.querySelector('button[type="submit"]');
  const fileField = form.querySelector('input[name="mediaFiles"]');

  if (!selectedOrder) {
    adminSetFeedback(feedbackElement, "Selecciona un pedido primero.", "error");
    return;
  }

  const files = Array.from(fileField?.files || []);

  if (!files.length) {
    adminSetFeedback(feedbackElement, "Debes seleccionar al menos un archivo.", "error");
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
  }

  adminSetFeedback(feedbackElement, "Subiendo documentos...");

  try {
    const formData = new FormData(form);
    const response = await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(selectedOrder)}/documents`, {
      method: "POST",
      body: formData,
    });

    orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
    form.reset();
    renderOrderSummary(getSelectedOrder());
    renderStates();
    renderSearchResults(getFilteredOrders());
    adminSetFeedback(trackingFeedback, "Documento(s) cargado(s) correctamente.", "success");
  } catch (error) {
    adminSetFeedback(feedbackElement, error.message, "error");
    return;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

async function toggleOrderDocumentVisibility(documentId, nextVisible) {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder || !documentId) {
    adminSetFeedback(trackingFeedback, "Selecciona un pedido primero.", "error");
    return;
  }

  const response = await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(selectedOrder)}/documents/${encodeURIComponent(documentId)}/visibility`, {
    method: "PATCH",
    body: JSON.stringify({ clientVisible: nextVisible }),
  });

  orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());
  const clientPushSent = Number(response?.notificationSummary?.clientPushSent || 0);
  adminSetFeedback(
    trackingFeedback,
    nextVisible
      ? clientPushSent > 0
        ? "Documento visible para el cliente. Push enviado."
        : "Documento visible para el cliente. No se encontro un dispositivo push activo para este cliente."
      : "Documento oculto para el cliente.",
    "success"
  );

  if (nextVisible && clientPushSent > 0) {
    openSuccessModal({
      title: "Documento notificado",
      message: "El documento fue notificado al cliente y ya aparece en su app.",
    });
  }
}

async function deleteOrderDocument(documentId) {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder || !documentId) {
    adminSetFeedback(trackingFeedback, "Selecciona un pedido primero.", "error");
    return;
  }

  const response = await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(selectedOrder)}/documents/${encodeURIComponent(documentId)}`, {
    method: "DELETE",
  });

  orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());
  adminSetFeedback(trackingFeedback, "Documento eliminado correctamente.", "success");
}

async function transitionSelectedOrder(direction) {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    adminSetFeedback(trackingFeedback, "Selecciona un pedido primero.", "error");
    return;
  }

  const runLegacyTransition = async () => {
    const states = getOrderTrackingSteps(selectedOrder);
    const currentStepIndex = states.findIndex((state) => state?.inProgress && !state?.confirmed);

    if (currentStepIndex < 0) {
      throw new Error("No se pudo determinar la etapa actual del pedido.");
    }

    const targetStepIndex = direction === "next" ? currentStepIndex + 1 : currentStepIndex - 1;

    if (targetStepIndex < 0 || targetStepIndex >= states.length) {
      throw new Error(direction === "next" ? "El pedido ya esta en la ultima etapa." : "El pedido ya esta en la primera etapa.");
    }

    const currentStep = states[currentStepIndex] || null;
    const targetStep = states[targetStepIndex] || null;

    if (direction === "next") {
      if (!currentStep?.key || !targetStep?.key) {
        throw new Error("No se pudo resolver la transición de etapa.");
      }

      const completePayload = new FormData();
      completePayload.append("operation", "add-update");
      completePayload.append("confirmed", "true");
      completePayload.append("inProgress", "false");

      await fetchTrackingPageJson(
        `/api/admin/orders/${getOrderIdentifier(selectedOrder)}/tracking-states/${currentStep.key}`,
        {
          method: "PATCH",
          body: completePayload,
        }
      );

      const activatePayload = new FormData();
      activatePayload.append("operation", "add-update");
      activatePayload.append("forceCreateUpdate", "true");
      activatePayload.append("confirmed", "false");
      activatePayload.append("inProgress", "true");
      activatePayload.append("clientVisible", "true");
      activatePayload.append("title", `Cambio de etapa a ${getStateCode(targetStepIndex)} - ${targetStep.label || "Estado"}`);
      activatePayload.append("notes", `La orden avanzo a ${targetStep.label || "la siguiente etapa"}.`);

      return fetchTrackingPageJson(
        `/api/admin/orders/${getOrderIdentifier(selectedOrder)}/tracking-states/${targetStep.key}`,
        {
          method: "PATCH",
          body: activatePayload,
        }
      );
    }

    if (!targetStep?.key) {
      throw new Error("No se pudo resolver la etapa a actualizar.");
    }

    const fallbackPayload = new FormData();
    fallbackPayload.append("operation", "add-update");
    fallbackPayload.append("confirmed", "false");
    fallbackPayload.append("inProgress", "true");

    return fetchTrackingPageJson(
      `/api/admin/orders/${getOrderIdentifier(selectedOrder)}/tracking-states/${targetStep.key}`,
      {
        method: "PATCH",
        body: fallbackPayload,
      }
    );
  };

  let response;

  try {
    response = await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(selectedOrder)}/tracking-transition`, {
      method: "PATCH",
      body: JSON.stringify({ direction }),
    });
    useLegacyTrackingTransition = false;
    sessionStorage.removeItem(LEGACY_TRACKING_TRANSITION_STORAGE_KEY);
  } catch (error) {
    if (error?.status !== 404) {
      throw error;
    }

    useLegacyTrackingTransition = true;
    sessionStorage.setItem(LEGACY_TRACKING_TRANSITION_STORAGE_KEY, "1");
    response = await runLegacyTransition();
  }

  orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());

  adminSetFeedback(
    trackingFeedback,
    direction === "next"
      ? "Etapa actualizada y cliente notificado por push/correo."
      : "Transición aplicada correctamente.",
    "success"
  );
}

async function finalizeSelectedOrder() {
  const selectedOrder = getSelectedOrder();

  if (!selectedOrder) {
    throw new Error("Selecciona un pedido antes de finalizarlo.");
  }

  const currentStageMeta = getCurrentStageMeta(selectedOrder);

  if (!canFinalizeTrackingOrder(selectedOrder, currentStageMeta.index)) {
    throw new Error("No tienes permisos para finalizar este pedido.");
  }

  const response = await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(selectedOrder)}/tracking-finalize`, {
    method: "PATCH",
  });

  orders = orders.map((order) => (getOrderIdentifier(order) === getOrderIdentifier(response.order) ? response.order : order));
  renderOrderSummary(getSelectedOrder());
  renderStates();
  renderSearchResults(getFilteredOrders());

  adminSetFeedback(trackingFeedback, "Pedido finalizado correctamente. Todas las etapas quedaron completadas.", "success");
}

function handleSearchClick() {
  if (!hasActiveSearchFilters()) {
    adminSetFeedback(trackingFeedback, "Debes seleccionar al menos un filtro antes de buscar.", "error");
    openSuccessModal({
      title: "Debe seleccionar un filtro",
      message: "Selecciona al menos un filtro antes de presionar Filtrar.",
    });
    return;
  }

  const matches = getFilteredOrders();
  renderSearchResults(matches);

  if (!matches.length) {
    selectedOrderId = "";
    trackingOrderInput.value = "";
    if (trackingEditorFields) {
      trackingEditorFields.hidden = true;
    }
    updateUrlForOrder(null);
    renderOrderSummary(null);
    renderStates();
    adminSetFeedback(trackingFeedback, "No hay pedidos activos que coincidan con esos filtros.", "error");
    return;
  }

  const exactMatch = findExactMatch(matches);

  if (exactMatch || matches.length === 1) {
    selectOrder(getOrderIdentifier(exactMatch || matches[0]));
    adminSetFeedback(trackingFeedback, "Pedido listo para gestionar sus estados.", "success");
    return;
  }

  adminSetFeedback(trackingFeedback, "Selecciona uno de los pedidos encontrados para trabajar su tracking.", "success");
}

function openSuccessModal(options = {}) {
  if (!trackingSuccessModal) {
    return;
  }

  const title = normalizeText(options.title || "Estado guardado") || "Estado guardado";
  const message = normalizeText(options.message || "La información del estado fue actualizada correctamente.") || "La información del estado fue actualizada correctamente.";

  if (trackingSuccessTitle) {
    trackingSuccessTitle.textContent = title;
  }

  if (trackingSuccessMessage) {
    trackingSuccessMessage.textContent = message;
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

function openDeleteUpdateModal(stateKey, updateIndex, eventId = "") {
  if (!trackingDeleteUpdateModal) {
    return;
  }

  const requiresApproval = !isAnthonyGlobalOwner();
  pendingTrackingDeleteAction = { stateKey, updateIndex, eventId };

  if (trackingDeleteUpdateTitle) {
    trackingDeleteUpdateTitle.textContent = requiresApproval ? "Solicitar eliminación" : "Borrar evento";
  }

  if (trackingDeleteUpdateCopy) {
    trackingDeleteUpdateCopy.textContent = requiresApproval
      ? "Esta acción enviará una solicitud de eliminación a Anthony. El evento seguirá visible hasta que él la apruebe."
      : "Esta acción elimina el evento reciente de la orden. No se puede deshacer.";
  }

  if (trackingDeleteUpdateConfirm) {
    trackingDeleteUpdateConfirm.textContent = requiresApproval ? "Solicitar permiso" : "Borrar";
  }

  if (trackingDeleteUpdateCancel) {
    trackingDeleteUpdateCancel.textContent = "Cancelar";
  }

  adminSetFeedback(trackingDeleteUpdateFeedback, "");
  trackingDeleteUpdateModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeDeleteUpdateModal() {
  if (!trackingDeleteUpdateModal) {
    return;
  }

  trackingDeleteUpdateModal.hidden = true;
  pendingTrackingDeleteAction = null;
  adminSetFeedback(trackingDeleteUpdateFeedback, "");

  if ((!trackingSuccessModal || trackingSuccessModal.hidden)
    && (!orderSuccessModal || orderSuccessModal.hidden)
    && (!createOrderModal || createOrderModal.hidden)
    && (!orderDeleteRequestModal || orderDeleteRequestModal.hidden)) {
    document.body.classList.remove("modal-open");
  }
}

async function confirmDeleteUpdate() {
  if (!pendingTrackingDeleteAction) {
    return;
  }

  const requiresApproval = !isAnthonyGlobalOwner();

  if (trackingDeleteUpdateConfirm) {
    trackingDeleteUpdateConfirm.disabled = true;
  }

  adminSetFeedback(
    trackingDeleteUpdateFeedback,
    requiresApproval ? "Enviando solicitud..." : "Eliminando evento..."
  );

  try {
    await deleteUpdate(
      pendingTrackingDeleteAction.stateKey,
      pendingTrackingDeleteAction.updateIndex,
      pendingTrackingDeleteAction.eventId
    );
    closeDeleteUpdateModal();
  } catch (error) {
    adminSetFeedback(trackingDeleteUpdateFeedback, error.message || "No se pudo borrar el evento.", "error");
  } finally {
    if (trackingDeleteUpdateConfirm) {
      trackingDeleteUpdateConfirm.disabled = false;
    }
  }
}

function setCreateOrderModalMode(mode, order = null) {
  if (!createOrderForm) {
    return;
  }

  const normalizedMode = mode === "edit" ? "edit" : "create";
  createOrderForm.dataset.mode = normalizedMode;
  createOrderForm.dataset.orderId = normalizedMode === "edit" ? getOrderIdentifier(order) : "";
  createOrderForm.dataset.orderRegion = normalizedMode === "edit"
    ? String(
        order?.orderRegion
        || (["gerenteUSA", "adminUSA", "brokerUSA"].includes(String(currentAdminRole || "").trim()) ? "usa" : "latam")
      ).trim().toLowerCase()
    : (["gerenteUSA", "adminUSA", "brokerUSA"].includes(String(currentAdminRole || "").trim()) ? "usa" : "latam");

  if (createOrderClientSelect) {
    createOrderClientSelect.required = normalizedMode !== "edit";
  }

  if (createOrderModalTitle) {
    createOrderModalTitle.textContent = normalizedMode === "edit" ? "Editar pedido" : "Crear pedido";
  }

  if (createOrderModalCopy) {
    createOrderModalCopy.textContent = normalizedMode === "edit"
      ? "Modifica los datos del pedido seleccionado sin salir del módulo de seguimiento."
      : "Registra un pedido nuevo sin salir del módulo de seguimiento.";
  }

  if (createOrderSubmitButton) {
    createOrderSubmitButton.textContent = normalizedMode === "edit" ? "Guardar cambios" : "Crear pedido";
  }

  renderCreateOrderBrokerOptions();
}

function resolveCreateOrderFieldValue(field, value) {
  const normalizedValue = normalizeText(value);

  if (String(field?.tagName || "").toUpperCase() !== "SELECT") {
    return normalizedValue;
  }

  if (!normalizedValue) {
    return "";
  }

  const expectedValue = normalizeSearchValue(normalizedValue);
  const matchedOption = Array.from(field.options || []).find((option) => {
    const optionValue = normalizeSearchValue(option.value || "");
    const optionLabel = normalizeSearchValue(option.textContent || "");
    return optionValue === expectedValue || optionLabel === expectedValue;
  });

  return matchedOption?.value || "";
}

function fillCreateOrderFormFromOrder(order) {
  if (!createOrderForm || !order) {
    return;
  }

  const setFieldValue = (name, value) => {
    const field = createOrderForm.elements.namedItem(name);

    if (field && "value" in field) {
      field.value = resolveCreateOrderFieldValue(field, value);
    }
  };

  setFieldValue("brand", String(order?.vehicle?.brand || ""));
  setFieldValue("model", String(order?.vehicle?.model || ""));
  setFieldValue("version", String(order?.vehicle?.version || ""));
  setFieldValue("year", String(order?.vehicle?.year || ""));
  setFieldValue("destination", String(order?.vehicle?.destination || ""));
  setFieldValue("exteriorColor", String(order?.vehicle?.exteriorColor || order?.vehicle?.color || ""));
  setFieldValue("interiorColor", String(order?.vehicle?.interiorColor || order?.vehicle?.color || ""));
  setFieldValue("vin", String(order?.vehicle?.vin || ""));
  setFieldValue("notes", String(order?.notes || ""));

  if (createOrderTrackingInput) {
    createOrderTrackingInput.readOnly = true;
    createOrderTrackingInput.value = String(order?.trackingNumber || "");
    createOrderTrackingInput.placeholder = createOrderTrackingInput.value;
  }

  if (createOrderClientSelect) {
    createOrderClientSelect.value = String(order?.client?._id || order?.client?.id || order?.clientId || "");
  }

  if (createOrderBrokerSelect) {
    createOrderBrokerSelect.value = String(order?.assignedBroker?._id || order?.assignedBroker?.id || order?.assignedBrokerId || "");
  }
}

function resetCreateOrderFormState() {
  createOrderForm?.reset();
  setCreateOrderModalMode("create");
  renderCreateOrderClientOptions();
  renderCreateOrderBrokerOptions();
  applyCreateOrderTrackingNumber();
  adminSetFeedback(createOrderFeedback, "");
}

async function openEditOrderModal(orderId) {
  const order = orders.find((item) => getOrderIdentifier(item) === String(orderId || "").trim()) || null;

  if (!order || !createOrderModal) {
    return;
  }

  try {
    await loadCreateOrderModalData();
    setCreateOrderModalMode("edit", order);
    fillCreateOrderFormFromOrder(order);
    adminSetFeedback(createOrderFeedback, "");
  } catch (error) {
    adminSetFeedback(trackingFeedback, error.message, "error");
    return;
  }

  createOrderModal.hidden = false;
  layoutCreateOrderModal();

  if (!createOrderModalResizeHandlerBound) {
    window.addEventListener("resize", layoutCreateOrderModal);
    createOrderModalResizeHandlerBound = true;
  }

  document.body.classList.add("modal-open");
}

function openOrderDeleteRequestModal(orderId) {
  const order = orders.find((item) => getOrderIdentifier(item) === String(orderId || "").trim()) || null;

  if (!order || !orderDeleteRequestModal) {
    return;
  }

  pendingDeletionOrderId = getOrderIdentifier(order);

  if (orderDeleteRequestSummary) {
    orderDeleteRequestSummary.value = `${order.trackingNumber || "Sin tracking"} · ${formatOrderLabel(order)}`;
  }

  if (orderDeleteRequestReason) {
    orderDeleteRequestReason.value = "";
  }

  adminSetFeedback(orderDeleteRequestFeedback, "");
  orderDeleteRequestModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeOrderDeleteRequestModal() {
  if (!orderDeleteRequestModal) {
    return;
  }

  orderDeleteRequestModal.hidden = true;
  pendingDeletionOrderId = "";

  if (orderDeleteRequestReason) {
    orderDeleteRequestReason.value = "";
  }

  adminSetFeedback(orderDeleteRequestFeedback, "");

  if ((!trackingSuccessModal || trackingSuccessModal.hidden) && (!orderSuccessModal || orderSuccessModal.hidden) && (!createOrderModal || createOrderModal.hidden)) {
    document.body.classList.remove("modal-open");
  }
}

async function handleDeleteOrderAction(orderId) {
  const order = orders.find((item) => getOrderIdentifier(item) === String(orderId || "").trim()) || null;

  if (!order) {
    adminSetFeedback(trackingFeedback, "No se pudo identificar el pedido.", "error");
    return;
  }

  if (hasPendingDeletionRequest(order)) {
    adminSetFeedback(trackingFeedback, "Este pedido ya tiene una solicitud de eliminación pendiente.", "error");
    return;
  }

  if (isDeletionManagerRole(currentAdminRole)) {
    if (!window.confirm("¿Seguro que deseas eliminar este pedido?")) {
      return;
    }

    try {
      await fetchTrackingPageJson(`/api/admin/orders/${getOrderIdentifier(order)}/deletion-request`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      await loadTrackingPage();
      adminSetFeedback(trackingFeedback, "Pedido eliminado correctamente.", "success");
    } catch (error) {
      adminSetFeedback(trackingFeedback, error.message, "error");
    }

    return;
  }

  openOrderDeleteRequestModal(getOrderIdentifier(order));
}

async function submitOrderDeleteRequest(event) {
  event?.preventDefault?.();

  if (!pendingDeletionOrderId) {
    adminSetFeedback(orderDeleteRequestFeedback, "No se encontró el pedido a eliminar.", "error");
    return false;
  }

  const reason = normalizeText(orderDeleteRequestReason?.value || "");

  if (!reason) {
    adminSetFeedback(orderDeleteRequestFeedback, "Debes indicar el motivo de la solicitud.", "error");
    return false;
  }

  adminSetFeedback(orderDeleteRequestFeedback, "Enviando solicitud...");

  try {
    await fetchTrackingPageJson(`/api/admin/orders/${pendingDeletionOrderId}/deletion-request`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });

    closeOrderDeleteRequestModal();
    await loadTrackingPage();
    adminSetFeedback(trackingFeedback, "Solicitud de eliminación enviada correctamente.", "success");
    return false;
  } catch (error) {
    adminSetFeedback(orderDeleteRequestFeedback, error.message, "error");
    return false;
  }
}

async function openCreateOrderModal() {
  if (!createOrderModal) {
    return;
  }

  try {
    await loadCreateOrderModalData();
    resetCreateOrderFormState();
  } catch (error) {
    if (createOrderClientSelect) {
      createOrderClientSelect.innerHTML = '<option value="">Error cargando clientes</option>';
    }

    if (createOrderClientSummary) {
      createOrderClientSummary.textContent = error.message;
    }

    adminSetFeedback(trackingFeedback, error.message, "error");
  }

  createOrderModal.hidden = false;
  layoutCreateOrderModal();

  if (!createOrderModalResizeHandlerBound) {
    window.addEventListener("resize", layoutCreateOrderModal);
    createOrderModalResizeHandlerBound = true;
  }

  document.body.classList.add("modal-open");
}

function closeCreateOrderModal() {
  if (!createOrderModal) {
    return;
  }

  createOrderModal.hidden = true;
  createOrderModal.style.setProperty("display", "none", "important");
  resetCreateOrderFormState();

  if (createOrderModalResizeHandlerBound) {
    window.removeEventListener("resize", layoutCreateOrderModal);
    createOrderModalResizeHandlerBound = false;
  }

  if ((!trackingSuccessModal || trackingSuccessModal.hidden) && (!orderSuccessModal || orderSuccessModal.hidden)) {
    document.body.classList.remove("modal-open");
  }
}

window.__closeTrackingSuccessModal = closeSuccessModal;
window.__adminTrackingHandleSearch = () => handleSearchClick();
window.__adminTrackingFallbackSearch = () => handleSearchClick();
window.__openCreateOrderModal = openCreateOrderModal;
window.__closeCreateOrderModal = closeCreateOrderModal;
window.__closeOrderDeleteRequestModal = closeOrderDeleteRequestModal;
window.__regenerateTrackingFromModal = regenerateTrackingFromModal;

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

trackingSearchButton?.addEventListener("click", handleSearchClick);
trackingClearButton?.addEventListener("click", clearSearchFilters);
trackingSuccessClose?.addEventListener("click", closeSuccessModal);

trackingSuccessModal?.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-tracking-modal")) {
    closeSuccessModal();
  }
});

trackingDeleteUpdateModal?.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-delete-update-modal")) {
    closeDeleteUpdateModal();
  }
});

trackingDeleteUpdateConfirm?.addEventListener("click", () => {
  confirmDeleteUpdate().catch((error) => {
    adminSetFeedback(trackingDeleteUpdateFeedback, error.message || "No se pudo borrar el evento.", "error");
  });
});

openCreateOrderModalButton?.addEventListener("click", openCreateOrderModal);

createOrderModal?.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-create-order-modal")) {
    closeCreateOrderModal();
  }
});

orderDeleteRequestModal?.addEventListener("click", (event) => {
  if (event.target.hasAttribute("data-close-order-delete-request-modal")) {
    closeOrderDeleteRequestModal();
  }
});

orderDeleteRequestForm?.addEventListener("submit", submitOrderDeleteRequest);

window.addEventListener("admin-order-created", async (event) => {
  const createdOrder = event?.detail?.order;
  closeCreateOrderModal();

  createOrderForm?.reset();
  applyCreateOrderTrackingNumber();

  try {
    await loadTrackingPage();

    if (createdOrder) {
      searchConfigs[0].input.value = String(createdOrder?.trackingNumber || "").trim();
      searchConfigs[1].input.value = "";
      searchConfigs[2].input.value = "";
      renderSearchResults(getFilteredOrders());

      const createdOrderId = getOrderIdentifier(createdOrder);

      if (createdOrderId) {
        selectOrder(createdOrderId);
      }
    }

    adminSetFeedback(trackingFeedback, "Pedido creado y listo para seguimiento.", "success");
  } catch (error) {
    adminSetFeedback(trackingFeedback, error.message, "error");
  }
});

window.addEventListener("admin-order-updated", async (event) => {
  const updatedOrder = event?.detail?.order;
  const updatedOrderId = getOrderIdentifier(updatedOrder);

  closeCreateOrderModal();

  try {
    await loadTrackingPage();

    if (updatedOrderId) {
      searchConfigs[0].input.value = String(updatedOrder?.trackingNumber || "").trim();
      searchConfigs[1].input.value = "";
      searchConfigs[2].input.value = "";
      renderSearchResults(getFilteredOrders());
    }

    selectedOrderId = "";
    if (trackingOrderInput) {
      trackingOrderInput.value = "";
    }
    if (trackingEditorFields) {
      trackingEditorFields.hidden = true;
    }
    syncSelectionToUrl(null);
    renderTrackingOverview(null);

    adminSetFeedback(trackingFeedback, "Pedido actualizado correctamente.", "success");
  } catch (error) {
    adminSetFeedback(trackingFeedback, error.message, "error");
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

function handleTrackingPageClick(event) {
  if (event.target.closest("[data-close-tracking-modal]")) {
    closeSuccessModal();
    return;
  }

  if (event.target.closest("[data-close-broker-document-modal]")) {
    closeBrokerDocumentModal();
    return;
  }

  const detailButton = event.target.closest("[data-order-detail-link]");

  if (detailButton) {
    const href = normalizeText(detailButton.dataset.orderDetailLink || "");

    if (href) {
      window.location.href = href;
    }

    return;
  }

  const brokerUploadButton = event.target.closest("[data-broker-upload]");

  if (brokerUploadButton) {
    openBrokerDocumentModal(String(brokerUploadButton.dataset.brokerUpload || ""));
    return;
  }

  const brokerDocumentsButton = event.target.closest("[data-broker-documents]");

  if (brokerDocumentsButton) {
    const orderId = String(brokerDocumentsButton.dataset.brokerDocuments || "").trim();

    if (orderId) {
      window.location.href = `/admin-broker-documents.html?orderId=${encodeURIComponent(orderId)}`;
    }

    return;
  }

  const editButton = event.target.closest("[data-order-edit]");

  if (editButton) {
    openEditOrderModal(String(editButton.dataset.orderEdit || ""));
    return;
  }

  const deleteButton = event.target.closest("[data-order-delete]");

  if (deleteButton) {
    handleDeleteOrderAction(String(deleteButton.dataset.orderDelete || ""));
    return;
  }

  const orderRow = event.target.closest("[data-order-row-select]");

  if (orderRow) {
    selectOrder(String(orderRow.dataset.orderId || ""));
    adminSetFeedback(trackingFeedback, canCreateOrEditOrders() ? "Pedido seleccionado. Ya puedes gestionar sus estados." : "Pedido seleccionado. Ya puedes subir archivos y documentos.", "success");
    return;
  }

  const orderButton = event.target.closest("[data-order-id]");

  if (orderButton) {
    selectOrder(String(orderButton.dataset.orderId || ""));
    adminSetFeedback(trackingFeedback, canCreateOrEditOrders() ? "Pedido seleccionado. Ya puedes gestionar sus estados." : "Pedido seleccionado. Ya puedes subir archivos y documentos.", "success");
    return;
  }

  const overviewStageToggle = event.target.closest("[data-overview-stage-toggle]");

  if (overviewStageToggle) {
    const stateKey = String(overviewStageToggle.dataset.overviewStageToggle || "");
    expandedOverviewStateKey = expandedOverviewStateKey === stateKey ? "" : stateKey;
    renderTrackingOverview(getSelectedOrder());
    return;
  }

  const transitionButton = event.target.closest("[data-transition-direction]");

  if (transitionButton) {
    transitionSelectedOrder(String(transitionButton.dataset.transitionDirection || "")).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message, "error");
    });
    return;
  }

  const finalizeButton = event.target.closest("[data-finalize-order]");

  if (finalizeButton) {
    finalizeSelectedOrder().catch((error) => {
      adminSetFeedback(trackingFeedback, error.message, "error");
    });
    return;
  }

  const overviewEventToggle = event.target.closest("[data-overview-event-toggle]");

  if (overviewEventToggle) {
    const eventId = String(overviewEventToggle.dataset.overviewEventToggle || "");

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
    expandedStateKey = expandedStateKey === stateKey ? "" : stateKey;
    renderStates();
    return;
  }

  const saveButton = event.target.closest("[data-save-state-key]");

  if (saveButton) {
    saveState(String(saveButton.dataset.saveStateKey || "")).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message, "error");
    });
    return;
  }

  const visibilityButton = event.target.closest("[data-toggle-update-visibility]");

  if (visibilityButton) {
    const stateKey = String(visibilityButton.dataset.stateKey || "");
    const updateIndex = Number.parseInt(String(visibilityButton.dataset.updateIndex || ""), 10);
    const eventId = String(visibilityButton.dataset.eventId || "").trim();
    const nextVisible = String(visibilityButton.dataset.nextVisible || "") === "true";

    if (!stateKey || Number.isNaN(updateIndex)) {
      return;
    }

    toggleUpdateVisibility(stateKey, updateIndex, nextVisible, eventId).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message || "No se pudo actualizar la visibilidad.", "error");
    });
    return;
  }

  const orderDocumentVisibilityButton = event.target.closest("[data-toggle-order-document-visibility]");

  if (orderDocumentVisibilityButton) {
    const documentId = String(orderDocumentVisibilityButton.dataset.documentId || "").trim();
    const nextVisible = String(orderDocumentVisibilityButton.dataset.nextVisible || "") === "true";

    toggleOrderDocumentVisibility(documentId, nextVisible).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message || "No se pudo actualizar la visibilidad del documento.", "error");
    });
    return;
  }

  const deleteOrderDocumentButton = event.target.closest("[data-delete-order-document]");

  if (deleteOrderDocumentButton) {
    const documentId = String(deleteOrderDocumentButton.dataset.documentId || "").trim();

    deleteOrderDocument(documentId).catch((error) => {
      adminSetFeedback(trackingFeedback, error.message || "No se pudo eliminar el documento.", "error");
    });
    return;
  }

  const deleteUpdateButton = event.target.closest("[data-delete-update]");

  if (!deleteUpdateButton) {
    return;
  }

  const stateKey = String(deleteUpdateButton.dataset.stateKey || "");
  const updateIndex = Number.parseInt(String(deleteUpdateButton.dataset.updateIndex || ""), 10);
  const eventId = String(deleteUpdateButton.dataset.eventId || "").trim();

  if (!stateKey || Number.isNaN(updateIndex)) {
    return;
  }

  openDeleteUpdateModal(stateKey, updateIndex, eventId);
}

trackingRoot.addEventListener("click", handleTrackingPageClick);
trackingPreview.addEventListener("click", handleTrackingPageClick);
trackingStageTransitionCard?.addEventListener("click", handleTrackingPageClick);
brokerDocumentModal?.addEventListener("click", handleTrackingPageClick);

brokerDocumentForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitBrokerDocumentForm().catch((error) => {
    adminSetFeedback(brokerDocumentFeedback, error.message, "error");
  });
});

trackingPreview.addEventListener("submit", (event) => {
  const newEventForm = event.target.closest("[data-new-event-form]");

  if (newEventForm) {
    event.preventDefault();
    submitNewTrackingEventForm(newEventForm).catch((error) => {
      const feedbackElement = newEventForm.querySelector("[data-new-event-feedback]");
      adminSetFeedback(feedbackElement, error.message, "error");
    });
    return;
  }

  const orderDocumentForm = event.target.closest("[data-order-document-form]");

  if (!orderDocumentForm) {
    return;
  }

  event.preventDefault();
  submitOrderDocumentForm(orderDocumentForm).catch((error) => {
    const feedbackElement = orderDocumentForm.querySelector("[data-order-document-feedback]");
    adminSetFeedback(feedbackElement, error.message, "error");
  });
});

trackingRoot.addEventListener("change", (event) => {
  const attachmentsField = event.target.closest('[data-field="attachments"]');

  if (attachmentsField) {
    const stateCard = attachmentsField.closest("[data-state-card]");
    const uploadPreview = stateCard?.querySelector("[data-upload-preview]");
    renderPendingUploadPreview(uploadPreview, attachmentsField.files);
  }

  const stateField = event.target.closest('[data-field="confirmed"], [data-field="inProgress"]');

  if (stateField) {
    const stateCard = stateField.closest("[data-state-card]");
    const stateKey = String(stateCard?.dataset.stateCard || "");
    const selectedOrder = getSelectedOrder();

    if (!stateKey || !selectedOrder) {
      return;
    }

    const confirmedField = stateCard.querySelector('[data-field="confirmed"]');
    const inProgressField = stateCard.querySelector('[data-field="inProgress"]');
    const states = getOrderTrackingSteps(selectedOrder);
    const stateIndex = states.findIndex((item) => item.key === stateKey);
    const canAdvanceState = canAdvanceTrackingState(states, stateIndex);

    if ((stateField === confirmedField && confirmedField?.checked) || (stateField === inProgressField && inProgressField?.checked)) {
      if (!canAdvanceState) {
        stateField.checked = false;
        adminSetFeedback(trackingFeedback, "Completa el estado anterior antes de avanzar este.", "error");
      }
    }

    if (stateField === confirmedField && confirmedField?.checked && inProgressField) {
      inProgressField.checked = false;
    }

    if (stateField === inProgressField && inProgressField?.checked && confirmedField) {
      confirmedField.checked = false;
    }

    setStateDraft(stateKey, {
      confirmed: Boolean(confirmedField?.checked),
      inProgress: Boolean(inProgressField?.checked),
    });
  }
});

trackingRoot.addEventListener("input", (event) => {
  const notesField = event.target.closest('[data-field="notes"]');

  if (notesField) {
    const stateCard = notesField.closest("[data-state-card]");
    const stateKey = String(stateCard?.dataset.stateCard || "");

    if (stateKey) {
      setStateDraft(stateKey, { notes: String(notesField.value || "") });
    }

    return;
  }

  const videoLinksField = event.target.closest('[data-field="videoLinks"]');

  if (!videoLinksField) {
    return;
  }

  const stateCard = videoLinksField.closest("[data-state-card]");
  const stateKey = String(stateCard?.dataset.stateCard || "");

  if (stateKey) {
    setStateDraft(stateKey, { videoLinks: String(videoLinksField.value || "") });
  }
});

async function loadTrackingPage() {
  await loadTrackingPageSession();
  const ordersData = await fetchTrackingPageJson("/api/admin/orders");
  orders = Array.isArray(ordersData?.orders) ? ordersData.orders : [];
  populateSearchSelects();

  const urlFilters = getUrlFilters();
  const initialOrderId = resolveInitialOrderId(urlFilters);

  if (urlFilters.tracking) {
    searchConfigs[0].input.value = urlFilters.tracking;
  }

  if (urlFilters.vin) {
    searchConfigs[1].input.value = urlFilters.vin;
  }

  if (urlFilters.internal) {
    searchConfigs[2].input.value = urlFilters.client || urlFilters.internal;
  }

  renderSearchResults(getFilteredOrders());

  if (isUsaBrokerRole()) {
    syncTrackingPageMode(null);
    renderOrderSummary(null);
    renderStates();
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    return;
  }

  if (initialOrderId) {
    selectOrder(initialOrderId);
  } else {
    if (trackingEditorFields) {
      trackingEditorFields.hidden = true;
    }
    renderOrderSummary(null);
    renderStates();
  }

  stopInitOverlayWatchdog();
  forceClearLoadingState();
}

forceClearLoadingState();
initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
window.addEventListener("pageshow", forceClearLoadingState);
window.addEventListener("load", forceClearLoadingState);

loadTrackingPage().catch((error) => {
  stopInitOverlayWatchdog();
  forceClearLoadingState();
  if (trackingEditorFields) {
    trackingEditorFields.hidden = true;
  }
  searchConfigs.forEach((config) => {
    config.input.value = "";
    config.input.placeholder = error.message;
    config.list.innerHTML = "";
  });
  adminRenderEmptyState(trackingPreview, error.message);
  adminSetFeedback(trackingFeedback, error.message, "error");
});
