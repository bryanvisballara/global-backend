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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeSearchValue(value) {
  return normalizeText(value).toUpperCase();
}

function getOrderIdentifier(order) {
  return String(order?._id || order?.id || "").trim();
}

function getInternalIdentifier(order) {
  return String(order?.vehicle?.internalIdentifier || order?.vehicle?.description || "").trim();
}

function getClientDisplayName(order) {
  return normalizeText(order?.client?.name || "Cliente sin asignar") || "Cliente sin asignar";
}

function formatOrderLabel(order) {
  return `${order?.vehicle?.brand || "Vehiculo"} ${order?.vehicle?.model || ""}${order?.vehicle?.version ? ` ${order.vehicle.version}` : ""} ${order?.vehicle?.year || ""}`.trim();
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
const trackingSuccessModal = document.getElementById("tracking-success-modal");
const trackingSuccessTitle = document.getElementById("tracking-success-title");
const trackingSuccessMessage = document.getElementById("tracking-success-message");
const trackingSuccessClose = document.getElementById("tracking-success-close");

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
    key: "internal",
    input: document.getElementById("tracking-search-internal"),
    list: document.getElementById("tracking-search-internal-list"),
    placeholder: "Escribe o selecciona identificador interno",
    getValue(order) {
      return getInternalIdentifier(order);
    },
  },
];

let orders = [];
let selectedOrderId = "";
let currentAdminRole = "";
let expandedStateKey = "";
let expandedOverviewStateKey = "";
let initOverlayWatchdog = null;
const expandedOverviewEventIds = new Set();
const savingStates = new Set();
const stateDrafts = new Map();

function syncTrackingPageMode(order) {
  document.body.classList.toggle("tracking-detail-mode", Boolean(order));
}

function getActiveOrders() {
  return orders.filter((order) => order?.status === "active");
}

function canEditStateForRole(role, stateKey) {
  return Boolean(String(role || "").trim()) && Boolean(String(stateKey || "").trim());
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
      const parsedUpdateIndex = Number.isInteger(event?.updateIndex)
        ? event.updateIndex
        : Number.parseInt(String(event?.updateIndex || ""), 10);

      return {
        eventId: String(event?.eventId || event?._id || ""),
        stateKey: stateMeta.key,
        stateLabel: String(event?.stateLabel || stateMeta.label || "Estado"),
        stateIndex: Number.isInteger(event?.stateIndex) ? event.stateIndex : stateMeta.index,
        stateCode: String(event?.stateCode || stateMeta.code || "-"),
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
    const latestUpdate = getLatestUpdate({ updates });
    const lastCompletedUpdate = [...updates].reverse().find((item) => item.completed) || null;

    return {
      key: template.key,
      label: String(sourceStep?.label || template.label),
      updates,
      confirmed: Boolean(typeof sourceStep?.confirmed === "boolean" ? sourceStep.confirmed : latestUpdate?.completed),
      inProgress: Boolean(
        typeof sourceStep?.inProgress === "boolean"
          ? sourceStep.inProgress && !sourceStep.confirmed
          : latestUpdate?.completed
            ? false
            : latestUpdate?.inProgress
      ),
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
    return { code: "-", label: "Sin etapa" };
  }

  return {
    code: getStateCode(stageIndex),
    label: String(adminTrackingTemplates[stageIndex]?.label || "Estado"),
  };
}

function populateSearchSelects() {
  const activeOrders = getActiveOrders();

  searchConfigs.forEach((config) => {
    const values = [];

    activeOrders.forEach((order) => {
      const rawValue = normalizeText(config.getValue(order));

      if (!rawValue) {
        return;
      }

      values.push(`<option value="${escapeHtml(rawValue)}"></option>`);
    });

    config.input.placeholder = config.placeholder;
    config.list.innerHTML = values.join("");
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

      return normalizeSearchValue(config.getValue(order)).includes(query);
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

function findExactMatch(matches) {
  return matches.find((order) => searchConfigs.every((config) => {
    const query = normalizeSearchValue(config.input.value);

    if (!query) {
      return true;
    }

    return normalizeSearchValue(config.getValue(order)) === query;
  })) || null;
}

function updateUrlForOrder(order) {
  const url = new URL(window.location.href);

  if (!order) {
    url.searchParams.delete("orderId");
    url.searchParams.delete("tracking");
    url.searchParams.delete("vin");
    url.searchParams.delete("internal");
    window.history.replaceState({}, document.title, url.toString());
    return;
  }

  url.searchParams.set("orderId", getOrderIdentifier(order));
  url.searchParams.set("tracking", String(order?.trackingNumber || ""));
  url.searchParams.set("vin", String(order?.vehicle?.vin || ""));
  url.searchParams.set("internal", getInternalIdentifier(order));
  window.history.replaceState({}, document.title, url.toString());
}

function applySelectedOrderToInputs(order) {
  if (!order) {
    return;
  }

  searchConfigs[0].input.value = String(order?.trackingNumber || "");
  searchConfigs[1].input.value = String(order?.vehicle?.vin || "");
  searchConfigs[2].input.value = getInternalIdentifier(order);
}

function getUrlFilters() {
  const url = new URL(window.location.href);
  return {
    orderId: normalizeText(url.searchParams.get("orderId") || ""),
    tracking: normalizeSearchValue(url.searchParams.get("tracking") || ""),
    vin: normalizeSearchValue(url.searchParams.get("vin") || ""),
    internal: normalizeSearchValue(url.searchParams.get("internal") || ""),
  };
}

function resolveInitialOrderId(filters) {
  if (!filters.orderId && !filters.tracking && !filters.vin && !filters.internal) {
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
            <th>Vehiculo</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          ${matches.map((order) => {
            const orderId = getOrderIdentifier(order);
            const trackingValue = String(order?.trackingNumber || "").trim();
            const vinValue = String(order?.vehicle?.vin || "").trim();
            const internalValue = String(getInternalIdentifier(order) || "").trim();
            const detailUrl = `/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(trackingValue)}&vin=${encodeURIComponent(vinValue)}&internal=${encodeURIComponent(internalValue)}`;
            const stageMeta = getCurrentStageMeta(order);
            const vehicleLabel = formatOrderLabel(order);
            const rowDate = formatDateLabel(order?.purchaseDate || order?.createdAt);

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
                <td data-label="Destino">${escapeHtml(order?.vehicle?.destination || "-")}</td>
                <td data-label="Estado">${escapeHtml(`${stageMeta.code} · ${stageMeta.label}`)}</td>
                <td data-label="Vehiculo"><strong>${escapeHtml(vehicleLabel)}</strong></td>
                <td data-label="Fecha">${escapeHtml(rowDate)}</td>
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

  return index === firstPendingIndex ? "is-current" : "is-pending";
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

function renderStateUpdates(step) {
  const indexedUpdates = getIndexedUpdates(step);

  if (!indexedUpdates.length) {
    return '<div class="tracking-state-history-empty">Todavia no hay actualizaciones en el historial de esta etapa.</div>';
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
          <p>${escapeHtml(update.notes || "Sin descripcion registrada.")}</p>
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
        description: event.notes || "Sin descripcion registrada.",
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
          description: update.notes || "Sin descripcion registrada.",
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
        <p>${escapeHtml(item.description || "Sin descripcion registrada.")}</p>
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

function renderOrderSummary(order) {
  if (!order) {
    trackingOrderSummary.innerHTML = "";
    return;
  }

  const stageMeta = getCurrentStageMeta(order);

  trackingOrderSummary.innerHTML = `
    <div class="tracking-card-header">
      <strong>${escapeHtml(formatOrderLabel(order))}</strong>
      <p>${escapeHtml(getClientDisplayName(order))} · Tracking ${escapeHtml(order?.trackingNumber || "-")}</p>
      <p>VIN ${escapeHtml(order?.vehicle?.vin || "Sin VIN")} · Llegada estimada ${escapeHtml(formatDateLabel(order?.expectedArrivalDate))}</p>
      <p>Destino ${escapeHtml(order?.vehicle?.destination || "-")} · ${escapeHtml(`${stageMeta.code} ${stageMeta.label}`)}</p>
    </div>
  `;
}

function renderTrackingOverview(order) {
  if (!order) {
    adminRenderEmptyState(trackingPreview, "Selecciona un pedido para ver sus eventos recientes.");
    return;
  }

  const states = getOrderTrackingSteps(order);
  const hasVisibleStage = states.some((state) => state.key === expandedOverviewStateKey);
  const resolvedExpandedOverviewStateKey = hasVisibleStage ? expandedOverviewStateKey : "";

  trackingPreview.innerHTML = `
    <div class="tracking-overview-stack">
      <article class="state-order-item tracking-overview-card">
        <header class="state-order-header">
          <h3>${escapeHtml(formatOrderLabel(order))}</h3>
          <span class="section-tag">Tracking ${escapeHtml(order?.trackingNumber || "-")}</span>
        </header>
        <div class="state-order-grid">
          <p><strong>Version:</strong> ${escapeHtml(order?.vehicle?.version || "Sin version")}</p>
          <p><strong>Ano:</strong> ${escapeHtml(order?.vehicle?.year || "-")}</p>
          <p><strong>VIN:</strong> ${escapeHtml(order?.vehicle?.vin || "-")}</p>
          <p><strong>Color:</strong> ${escapeHtml(order?.vehicle?.color || "-")}</p>
          <p><strong>Cliente:</strong> ${escapeHtml(getClientDisplayName(order))}</p>
          <p><strong>Email cliente:</strong> ${escapeHtml(order?.client?.email || "-")}</p>
          <p><strong>Telefono:</strong> ${escapeHtml(order?.client?.phone || "-")}</p>
          <p><strong>Estado pedido:</strong> ${escapeHtml(order?.status || "-")}</p>
          <p><strong>Compra:</strong> ${escapeHtml(formatDateLabel(order?.purchaseDate || order?.createdAt))}</p>
          <p><strong>Llegada estimada:</strong> ${escapeHtml(formatDateLabel(order?.expectedArrivalDate))}</p>
          <p><strong>Media del pedido:</strong> ${escapeHtml((order?.media || []).length)} archivo(s)</p>
          <p><strong>ID interno:</strong> ${escapeHtml(getInternalIdentifier(order) || "-")}</p>
        </div>
        <p class="state-order-notes"><strong>Notas:</strong> ${escapeHtml(order?.notes || "Sin notas internas")}</p>
      </article>

      <article class="dashboard-card tracking-table-card tracking-timeline-card">
        <div class="card-heading">
          <h2>Timeline de etapas</h2>
        </div>
        <div class="tracking-timeline-grid">
          ${states.map((state, index) => {
            const variant = resolveTimelineStateVariant(state, index, states);
            const statusLabel = resolveTimelineStateStatusLabel(variant);
            const statusIcon = variant === "is-completed" ? "✅" : variant === "is-current" ? "⭐" : "◻";
            const canEditState = canEditStateForRole(currentAdminRole, state.key);

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
        <div class="card-heading">
          <h2>Eventos recientes</h2>
        </div>
        <div class="tracking-stage-events-stack">
          ${buildRecentEvents(order).length
            ? buildRecentEvents(order)
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
    syncTrackingPageMode(null);
    trackingStatesList.innerHTML = "";
    adminRenderEmptyState(trackingPreview, "Busca un pedido y selecciona uno para gestionar sus eventos.");
    return;
  }

  syncTrackingPageMode(selectedOrder);

  trackingStatesList.innerHTML = getOrderTrackingSteps(selectedOrder).map((state, index) => {
    const isExpanded = expandedStateKey === state.key;
    const canEditState = canEditStateForRole(currentAdminRole, state.key);
    const draft = getStateDraft(state);
    const historyCount = Array.isArray(state?.updates) ? state.updates.length : 0;
    const updatedText = state.updatedAt ? `Actualizado ${formatDateLabel(state.updatedAt)}` : "Sin actualizaciones todavia";
    const editButtonText = state.confirmed ? "Completado" : state.inProgress ? "En curso" : "Editar";
    const stateMedia = getFlattenedStateMedia(state);

    return `
      <article class="tracking-state-card ${state.confirmed ? "is-confirmed" : ""} ${state.inProgress ? "is-in-progress" : ""} ${isExpanded ? "is-open" : ""}" data-state-card="${escapeHtml(state.key)}">
        <div class="tracking-state-header">
          <div class="tracking-state-copy">
            <small>Estado ${index + 1}</small>
            <strong>${escapeHtml(state.label)}</strong>
            <p>${escapeHtml(updatedText)} · ${escapeHtml(`${historyCount} actualizacion(es)`)}</p>
          </div>
          <button
            class="tracking-state-edit-button ${state.confirmed ? "is-confirmed" : ""}"
            type="button"
            ${canEditState ? `data-edit-state-key="${escapeHtml(state.key)}"` : "disabled"}
          >${canEditState ? editButtonText : "Bloqueado"}</button>
        </div>
        <div class="tracking-state-body" ${isExpanded ? "" : "hidden"}>
          <div class="tracking-state-switches">
            <label class="dashboard-checkbox"><input type="checkbox" data-field="inProgress" ${draft.inProgress ? "checked" : ""} ${canEditState ? "" : "disabled"} /> Activar estado en curso</label>
            <label class="dashboard-checkbox"><input type="checkbox" data-field="confirmed" ${draft.confirmed ? "checked" : ""} ${canEditState ? "" : "disabled"} /> Completar estado</label>
          </div>
          <p class="tracking-state-helper-copy">Cada guardado agrega una nueva entrada al historial. El cliente solo ve los eventos que publiques con el ojo.</p>
          <label>
            <span>Nueva actualizacion</span>
            <textarea rows="4" data-field="notes" placeholder="Describe lo ocurrido en esta actualizacion" ${canEditState ? "" : "disabled"}>${escapeHtml(draft.notes)}</textarea>
          </label>
          <div class="tracking-state-upload-grid two-up">
            <label>
              <span>Adjuntos</span>
              <input type="file" data-field="attachments" multiple accept="image/*,video/*,.pdf,application/pdf" ${canEditState ? "" : "disabled"} />
            </label>
            <label>
              <span>Video por link</span>
              <textarea rows="4" data-field="videoLinks" placeholder="Pega uno o varios links, separados por salto de linea" ${canEditState ? "" : "disabled"}>${escapeHtml(draft.videoLinks)}</textarea>
            </label>
          </div>
          <div class="tracking-state-actions">
            <button class="primary-button" type="button" data-save-state-key="${escapeHtml(state.key)}" ${canEditState ? "" : "disabled"}>Agregar evento</button>
            <p class="feedback" data-state-feedback="${escapeHtml(state.key)}"></p>
          </div>
          <section class="tracking-state-history-block">
            <div class="card-heading compact">
              <h3>Historial de esta etapa</h3>
            </div>
            ${renderStateUpdates(state)}
          </section>
          ${renderCategorizedMediaSections(stateMedia)}
        </div>
      </article>
    `;
  }).join("");

  renderTrackingOverview(selectedOrder);
}

function selectOrder(orderId) {
  selectedOrderId = String(orderId || "").trim();
  expandedStateKey = "";
  expandedOverviewStateKey = "";
  expandedOverviewEventIds.clear();
  clearStateDrafts();
  trackingOrderInput.value = selectedOrderId;
  trackingEditorFields.hidden = !selectedOrderId;

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
  trackingEditorFields.hidden = true;
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
  adminSetFeedback(
    trackingFeedback,
    nextVisible ? "Evento visible para el cliente." : "Evento oculto para el cliente.",
    "success"
  );

  if (nextVisible && publishConfirmed) {
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
  adminSetFeedback(trackingFeedback, "Evento eliminado correctamente.", "success");
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
  const stateCard = trackingStatesList.querySelector(`[data-state-card="${stateKey}"]`);
  const stateFeedback = trackingStatesList.querySelector(`[data-state-feedback="${stateKey}"]`);
  const saveButton = trackingStatesList.querySelector(`[data-save-state-key="${stateKey}"]`);

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

  if (!notes && !files.length && !videoLinks && !inProgress && !confirmed) {
    adminSetFeedback(stateFeedback, "Agrega una nota, un adjunto o marca el estado para crear el evento.", "error");
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

function handleSearchClick() {
  const matches = getFilteredOrders();
  renderSearchResults(matches);

  if (!matches.length) {
    selectedOrderId = "";
    trackingOrderInput.value = "";
    trackingEditorFields.hidden = true;
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

window.__closeTrackingSuccessModal = closeSuccessModal;
window.__adminTrackingHandleSearch = () => handleSearchClick();
window.__adminTrackingFallbackSearch = () => handleSearchClick();

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

  const orderRow = event.target.closest("[data-order-link]");

  if (orderRow) {
    const href = normalizeText(orderRow.dataset.href || "");

    if (href) {
      window.location.href = href;
      return;
    }

    selectOrder(String(orderRow.dataset.orderId || ""));
    adminSetFeedback(trackingFeedback, "Pedido seleccionado. Ya puedes gestionar sus estados.", "success");
    return;
  }

  const orderButton = event.target.closest("[data-order-id]");

  if (orderButton) {
    selectOrder(String(orderButton.dataset.orderId || ""));
    adminSetFeedback(trackingFeedback, "Pedido seleccionado. Ya puedes gestionar sus estados.", "success");
    return;
  }

  const overviewStageToggle = event.target.closest("[data-overview-stage-toggle]");

  if (overviewStageToggle) {
    const stateKey = String(overviewStageToggle.dataset.overviewStageToggle || "");
    expandedOverviewStateKey = expandedOverviewStateKey === stateKey ? "" : stateKey;
    renderTrackingOverview(getSelectedOrder());
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

  const deleteButton = event.target.closest("[data-delete-update]");

  if (!deleteButton) {
    return;
  }

  const stateKey = String(deleteButton.dataset.stateKey || "");
  const updateIndex = Number.parseInt(String(deleteButton.dataset.updateIndex || ""), 10);
  const eventId = String(deleteButton.dataset.eventId || "").trim();

  if (!stateKey || Number.isNaN(updateIndex)) {
    return;
  }

  deleteUpdate(stateKey, updateIndex, eventId).catch((error) => {
    adminSetFeedback(trackingFeedback, error.message || "No se pudo borrar el evento.", "error");
  });
}

trackingRoot.addEventListener("click", handleTrackingPageClick);
trackingPreview.addEventListener("click", handleTrackingPageClick);

trackingRoot.addEventListener("change", (event) => {
  const stateField = event.target.closest('[data-field="confirmed"], [data-field="inProgress"]');

  if (stateField) {
    const stateCard = stateField.closest("[data-state-card]");
    const stateKey = String(stateCard?.dataset.stateCard || "");

    if (!stateKey) {
      return;
    }

    const confirmedField = stateCard.querySelector('[data-field="confirmed"]');
    const inProgressField = stateCard.querySelector('[data-field="inProgress"]');

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
    searchConfigs[2].input.value = urlFilters.internal;
  }

  renderSearchResults(getFilteredOrders());

  if (initialOrderId) {
    selectOrder(initialOrderId);
  } else {
    trackingEditorFields.hidden = true;
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
  trackingEditorFields.hidden = true;
  searchConfigs.forEach((config) => {
    config.input.value = "";
    config.input.placeholder = error.message;
    config.list.innerHTML = "";
  });
  adminRenderEmptyState(trackingPreview, error.message);
  adminSetFeedback(trackingFeedback, error.message, "error");
});
