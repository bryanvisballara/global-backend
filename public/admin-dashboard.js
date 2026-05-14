(() => {
const adminApp = window.AdminApp || {};
const {
  attachLogout: adminAttachLogout,
  clearAuth: adminClearAuth,
  loadAdminSession,
  redirectToLogin: adminRedirectToLogin,
  resetLoadingOverlay: adminResetLoadingOverlay,
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
const ANTHONY_GLOBAL_OWNER_EMAIL = "anthony-vergel@hotmail.com";
let currentAdminRole = "";
let currentAdminEmail = "";

const stageLabelByKey = {
  "order-received": "Orden recibida",
  "vehicle-search": "Búsqueda del carro",
  "booking-and-shipping": "Booking y tracking naviera",
  "in-transit": "En tránsito",
  "nationalization": "Proceso de nacionalización",
  "port-exit": "Salida del puerto",
  "vehicle-preparation": "Alistamiento",
  delivery: "Entrega",
  registration: "Matrícula",
};

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

function setElementText(element, value) {
  if (!element) {
    return;
  }

  element.textContent = String(value);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

function resolveDashboardApiBaseUrl() {
  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${port || "10000"}`;
  }

  return "https://global-backend-bdbx.onrender.com";
}

async function fetchDashboardJson(path, options = {}) {
  const authToken = localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
  const requestJson = async (withBearerToken) => {
    const response = await fetch(`${resolveDashboardApiBaseUrl()}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...(withBearerToken && authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    let data = {};

    try {
      data = await response.json();
    } catch {
      data = {};
    }

    return { response, data };
  };

  let { response, data } = await requestJson(true);

  const isTokenError =
    response.status === 401 ||
    response.status === 403 ||
    data.message === "Forbidden" ||
    data.message === "Authentication required" ||
    data.message === "Invalid or expired token" ||
    data.message === "Invalid token";

  if (!response.ok && isTokenError && authToken) {
    localStorage.removeItem("globalAppToken");
    sessionStorage.removeItem("globalAppToken");
    ({ response, data } = await requestJson(false));
  }

  if (!response.ok) {
    const isAuthFailure =
      response.status === 401 ||
      data.message === "Authentication required" ||
      data.message === "Invalid or expired token" ||
      data.message === "Invalid token";

    if (isAuthFailure) {
      if (typeof adminClearAuth === "function") {
        adminClearAuth();
      }

      if (typeof adminRedirectToLogin === "function") {
        adminRedirectToLogin();
      }
    }

    throw new Error(data.message || "Request failed");
  }

  return data;
}

async function loadDashboardSession() {
  if (typeof loadAdminSession === "function") {
    return loadAdminSession("admin-name", "admin-email");
  }

  const data = await fetchDashboardJson("/api/auth/me");
  const user = data.user || {};
  const nameElement = document.getElementById("admin-name");
  const emailElement = document.getElementById("admin-email");

  if (nameElement) {
    nameElement.textContent = user.name || "Administrador";
  }

  if (emailElement) {
    emailElement.textContent = user.email || "admin@globalimports.com";
  }

  return user;
}

function getFirstName(fullName) {
  return String(fullName || "Administrador").trim().split(/\s+/)[0] || "Administrador";
}

function isAnthonyGlobalOwner() {
  return currentAdminRole === "manager" && currentAdminEmail === ANTHONY_GLOBAL_OWNER_EMAIL;
}

function shouldShowOrderRegionBadge() {
  return ["adminUSA", "gerenteUSA"].includes(String(currentAdminRole || "").trim()) || isAnthonyGlobalOwner();
}

function renderOrderRegionBadge(orderRegion) {
  if (!shouldShowOrderRegionBadge()) {
    return "";
  }

  const normalizedOrderRegion = String(orderRegion || "latam").trim().toLowerCase();

  if (!["latam", "usa"].includes(normalizedOrderRegion)) {
    return "";
  }

  return `<span class="tracking-order-region-badge is-${escapeHtml(normalizedOrderRegion)}">${escapeHtml(normalizedOrderRegion.toUpperCase())}</span>`;
}

function isUsaAdministrativeRole(role) {
  return ["adminUSA", "gerenteUSA", "brokerUSA"].includes(String(role || ""));
}

function getStateCode(index) {
  return Number.isInteger(index) && index >= 0 ? `E${index + 1}` : "-";
}

function buildDashboardEventTitle({ title = "", stateCode = "-", stateLabel = "Estado", inProgress = false, completed = false } = {}) {
  const normalizedTitle = normalizeText(title);

  if (normalizedTitle) {
    return normalizedTitle;
  }

  const baseTitle = `Cambio de etapa a ${normalizeText(stateCode) || "-"} - ${normalizeText(stateLabel) || "Estado"}`;

  if (inProgress) {
    return `${baseTitle}, Estado en curso`;
  }

  if (completed) {
    return `${baseTitle}, Etapa completada`;
  }

  return baseTitle;
}

function isOrderCompleted(order) {
  if (String(order?.status || "").trim().toLowerCase() === "completed") {
    return true;
  }

  return getOrderTrackingEvents(order).some((event) => event.completed && event.stateIndex === stageTemplates.length - 1);
}

function shouldIncludeGlobalTrackingEvent(event) {
  return !(event.stateIndex === 0 && event.inProgress && !event.completed && !normalizeText(event.title));
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
        stateLabel: String(event?.stateLabel || stageLabelByKey[stateKey] || stageTemplates[stageIndex]?.label || "Estado"),
        stateIndex: Number.isNaN(parsedStateIndex) ? stageIndex : parsedStateIndex,
        stateCode: String(event?.stateCode || getStateCode(Number.isNaN(parsedStateIndex) ? stageIndex : parsedStateIndex)),
        title: normalizeText(event?.title || ""),
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
  const stepsByKey = new Map(orderSteps.map((step, index) => [String(step?.key || stageTemplates[index]?.key || ""), step]));
  const trackingEvents = getOrderTrackingEvents(order);
  const trackingEventsByKey = new Map();

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
      confirmed: derivedConfirmed,
      inProgress: derivedInProgress,
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

function resolveDistributionStageKey(order) {
  if (isOrderCompleted(order)) {
    return completedStageCard.key;
  }

  return resolveCurrentStageKey(order);
}

function resolveStageDisplayFromOrder(order) {
  if (isOrderCompleted(order)) {
    return `E${stageTemplates.length + 1}: ${completedStageCard.label}`;
  }

  const stageKey = resolveCurrentStageKey(order);

  if (!stageKey) {
    return "-";
  }

  const stageIndex = stageTemplates.findIndex((stage) => stage.key === stageKey);
  const stageLabel = stageLabelByKey[stageKey] || stageTemplates[stageIndex]?.label || "Estado";

  if (stageIndex === -1) {
    return stageLabel;
  }

  return stageLabel;
}

function resolveStageDisplayFromStep(step) {
  const stageKey = step?.key;

  if (!stageKey) {
    return "-";
  }

  const stageIndex = stageTemplates.findIndex((stage) => stage.key === stageKey);
  const stageLabel = stageLabelByKey[stageKey] || step?.label || stageTemplates[stageIndex]?.label || "Estado";

  if (stageIndex === -1) {
    return stageLabel;
  }

  return `E${stageIndex + 1}: ${stageLabel}`;
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

function renderGlobalEvents(events) {
  const tableBody = document.getElementById("dashboard-global-events-body");

  if (!tableBody) {
    return;
  }

  if (!events.length) {
    tableBody.innerHTML = '<tr><td colspan="6"><div class="empty-state">Sin eventos recientes por mostrar.</div></td></tr>';
    return;
  }

  tableBody.innerHTML = events
    .map((event) => `
      <tr>
        <td data-label="Fecha">${escapeHtml(formatDateTimeLabel(event.date))}</td>
        <td data-label="Tracking">
          <div class="tracking-order-link-stack">
            ${event.detailUrl
              ? `<a class="dashboard-tracking-link" href="${escapeHtml(event.detailUrl)}">${escapeHtml(event.trackingNumber || "-")}</a>`
              : `<span>${escapeHtml(event.trackingNumber || "-")}</span>`}
            ${renderOrderRegionBadge(event.orderRegion)}
          </div>
        </td>
        <td data-label="Estado">${escapeHtml(event.statusCode || "-")}</td>
        <td data-label="Titulo">${escapeHtml(event.statusTitle || "-")}</td>
        <td data-label="Vehículo">${escapeHtml(event.vehicle || "-")}</td>
        <td data-label="Cliente">${escapeHtml(event.clientName || "-")}</td>
      </tr>
    `)
    .join("");
}

function collectGlobalEvents({ orders = [], posts = [], requests = [], maintenance = [] }) {
  return orders.flatMap((order) => {
    const orderId = String(order?._id || order?.id || "").trim();
    const trackingNumber = order?.trackingNumber || "-";
    const vinValue = String(order?.vehicle?.vin || "").trim();
    const vehicleLabel = `${order?.vehicle?.brand || "Vehículo"} ${order?.vehicle?.model || ""}`.trim();
    const clientName = order?.client?.name || "-";
    const orderRegion = String(order?.orderRegion || "latam").trim().toLowerCase();
    const detailUrl = `/app/admin-tracking.html?orderId=${encodeURIComponent(orderId)}&tracking=${encodeURIComponent(String(trackingNumber || ""))}&vin=${encodeURIComponent(vinValue)}&client=${encodeURIComponent(String(clientName || ""))}`;
    const trackingEvents = getOrderTrackingEvents(order).filter((event) => shouldIncludeGlobalTrackingEvent(event));
    const isCompletedOrder = isOrderCompleted(order);
    const completedStatusCode = `E${stageTemplates.length + 1}`;
    const buildCompletedEvent = (dateValue) => ({
      date: dateValue ? new Date(new Date(dateValue).getTime() + 1).toISOString() : null,
      trackingNumber,
      detailUrl,
      statusCode: completedStatusCode,
      statusTitle: `Pedido completado - ${completedStageCard.label}`,
      vehicle: vehicleLabel,
      clientName,
      orderRegion,
      sortStateIndex: stageTemplates.length,
    });

    if (trackingEvents.length) {
      const mappedEvents = trackingEvents.map((event) => ({
        date: event.updatedAt || event.createdAt,
        trackingNumber,
        detailUrl,
        statusCode: event.stateCode || "-",
        statusTitle: buildDashboardEventTitle(event),
        vehicle: vehicleLabel,
        clientName,
        orderRegion,
        sortStateIndex: Number.isInteger(event.stateIndex) ? event.stateIndex : -1,
      }));

      if (!isCompletedOrder) {
        return mappedEvents;
      }

      const latestTrackingDate = trackingEvents.reduce((latestDate, event) => {
        const eventDate = event.updatedAt || event.createdAt || null;

        if (!eventDate) {
          return latestDate;
        }

        if (!latestDate) {
          return eventDate;
        }

        return new Date(eventDate).getTime() >= new Date(latestDate).getTime() ? eventDate : latestDate;
      }, order?.updatedAt || null);

      return mappedEvents.concat(buildCompletedEvent(latestTrackingDate || order?.updatedAt || order?.createdAt || null));
    }

    const fallbackEvents = getOrderTrackingSteps(order)
      .filter((step, index) => !(index === 0 && step?.inProgress && !step?.confirmed))
      .filter((step) => step?.updatedAt || step?.confirmedAt)
      .map((step, index) => ({
        date: step.updatedAt || step.confirmedAt,
        trackingNumber,
        detailUrl,
        statusCode: `E${index + 1}`,
        statusTitle: buildDashboardEventTitle({
          stateCode: getStateCode(index),
          stateLabel: stageLabelByKey[step?.key] || step?.label || "Estado",
          inProgress: Boolean(step?.inProgress),
          completed: Boolean(step?.confirmed),
        }),
        vehicle: vehicleLabel,
        clientName,
        orderRegion,
        sortStateIndex: index,
      }));

    if (!isCompletedOrder) {
      return fallbackEvents;
    }

    const fallbackCompletionDate = fallbackEvents.reduce((latestDate, event) => {
      if (!event?.date) {
        return latestDate;
      }

      if (!latestDate) {
        return event.date;
      }

      return new Date(event.date).getTime() >= new Date(latestDate).getTime() ? event.date : latestDate;
    }, order?.updatedAt || null);

    return fallbackEvents.concat(buildCompletedEvent(fallbackCompletionDate || order?.updatedAt || order?.createdAt || null));
  })
    .filter((event) => event && event.date)
    .sort((a, b) => {
      const timeDiff = new Date(b.date).getTime() - new Date(a.date).getTime();

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return Number(b.sortStateIndex || -1) - Number(a.sortStateIndex || -1);
    })
    .slice(0, 10);
}

function renderStageDistribution(orders) {
  const stageGrid = document.getElementById("stage-distribution-grid");

  if (!stageGrid) {
    return;
  }

  const distributionStages = [...stageTemplates, completedStageCard];
  const countsByStage = new Map(distributionStages.map((stage) => [stage.key, 0]));

  orders.forEach((order) => {
    const currentStageKey = resolveDistributionStageKey(order);

    if (!currentStageKey || !countsByStage.has(currentStageKey)) {
      return;
    }

    countsByStage.set(currentStageKey, countsByStage.get(currentStageKey) + 1);
  });

  stageGrid.innerHTML = distributionStages
    .map((stage, index) => {
      const count = countsByStage.get(stage.key) || 0;
      const label = stageLabelByKey[stage.key] || stage.label;
      const targetUrl = `/app/admin-state-orders.html?state=${encodeURIComponent(stage.key)}`;
      return `
        <a class="stage-distribution-item stage-distribution-link${count > 0 ? " is-active" : ""}" href="${targetUrl}">
          <span>E${index + 1}</span>
          <strong>${label}</strong>
          <b>${count}</b>
        </a>
      `;
    })
    .join("");
}

function forceClearLoadingState() {
  if (typeof adminResetLoadingOverlay === "function") {
    adminResetLoadingOverlay();
  }

  document.querySelectorAll(".global-loading-overlay").forEach((overlay) => {
    overlay.hidden = true;
  });

  document.body.classList.remove("loading-active");
}

if (true) {
  if (typeof adminAttachLogout === "function") {
    adminAttachLogout();
  }
  renderStageDistribution([]);

  const heroFeedback = document.getElementById("dashboard-feedback");
  const adminFirstName = document.getElementById("admin-first-name");
  const adminNameTop = document.getElementById("admin-name-top");
  const clientsCount = document.getElementById("clients-count");
  const usersCount = document.getElementById("users-count");
  const deletionRequestsCount = document.getElementById("deletion-requests-count");
  const requestsCount = document.getElementById("requests-count");
  const ordersCount = document.getElementById("orders-count");
  const activeOrdersCount = document.getElementById("active-orders-count");
  const completedOrdersCount = document.getElementById("completed-orders-count");
  const maintenanceCount = document.getElementById("maintenance-count");
  const postsCount = document.getElementById("posts-count");
  const distributionCaption = document.getElementById("distribution-caption");
  let initOverlayWatchdog = null;

  function stopInitOverlayWatchdog() {
    if (!initOverlayWatchdog) {
      return;
    }

    window.clearInterval(initOverlayWatchdog);
    initOverlayWatchdog = null;
  }

  function setDashboardError(message) {
    if (!heroFeedback) {
      return;
    }

    heroFeedback.textContent = message;
    heroFeedback.className = "feedback error";
  }

  async function loadDashboard() {
    try {
      let user = {};

      try {
        user = await loadDashboardSession();
      } catch (sessionError) {
        user = {};
      }

      currentAdminRole = String(user?.role || "").trim();
      currentAdminEmail = String(user?.email || "").trim().toLowerCase();

      if (adminFirstName) {
        adminFirstName.textContent = getFirstName(user?.name);
      }

      if (adminNameTop) {
        adminNameTop.textContent = user?.name || "Administrador";
      }

      if (String(user?.role || "") === "brokerUSA") {
        window.location.replace("/app/admin-tracking.html");
        return;
      }

      const adminRoleLabel = document.getElementById("admin-role-label");
      if (adminRoleLabel && user?.role) {
        const roleText = user.role === "manager"
          ? "Gerente"
          : user.role === "gerenteUSA"
            ? "Gerente USA"
            : user.role === "adminUSA"
              ? "Administrador USA"
              : user.role === "brokerUSA"
                ? "Broker USA"
              : user.role === "admin"
                ? "Administrador"
                : "Usuario";
        adminRoleLabel.textContent = roleText;
      }

      const isUsaRole = isUsaAdministrativeRole(user?.role);
      const canManageDeletionRequests = ["manager", "gerenteUSA"].includes(String(user?.role || ""));

      document.querySelectorAll(".admin-latam-only").forEach((element) => {
        element.style.display = isUsaRole ? "none" : "";
      });

      document.querySelectorAll(".admin-admin-creator-only").forEach((element) => {
        element.hidden = !canManageDeletionRequests;
        element.style.display = canManageDeletionRequests ? "" : "none";
      });

      if (isUsaRole) {
        setElementText(requestsCount, 0);
        setElementText(maintenanceCount, 0);
        setElementText(postsCount, 0);
      }

      if (!canManageDeletionRequests) {
        setElementText(deletionRequestsCount, 0);
      }

      const dashboardRequests = [
        { key: "clients", critical: true, promise: fetchDashboardJson("/api/admin/clients") },
        { key: "users", critical: false, promise: fetchDashboardJson("/api/admin/users") },
        { key: "requests", critical: false, promise: isUsaRole ? Promise.resolve({ requests: [] }) : fetchDashboardJson("/api/admin/client-requests") },
        { key: "deletionRequests", critical: false, promise: canManageDeletionRequests ? fetchDashboardJson(`/api/admin/orders/deletion-requests?ts=${Date.now()}`) : Promise.resolve({ orders: [], trackingEventRequests: [] }) },
        { key: "orders", critical: true, promise: fetchDashboardJson("/api/admin/orders") },
        { key: "maintenance", critical: false, promise: isUsaRole ? Promise.resolve({ maintenance: [] }) : fetchDashboardJson("/api/admin/maintenance") },
        { key: "posts", critical: false, promise: isUsaRole ? Promise.resolve({ posts: [] }) : fetchDashboardJson("/api/admin/posts") },
      ];

      const results = await Promise.allSettled(dashboardRequests.map((entry) => entry.promise));

      const clientsData = results[0].status === "fulfilled" ? results[0].value : {};
      const usersData = results[1].status === "fulfilled" ? results[1].value : {};
      const requestsData = results[2].status === "fulfilled" ? results[2].value : {};
      const deletionRequestsData = results[3].status === "fulfilled" ? results[3].value : {};
      const ordersData = results[4].status === "fulfilled" ? results[4].value : {};
      const maintenanceData = results[5].status === "fulfilled" ? results[5].value : {};
      const postsData = results[6].status === "fulfilled" ? results[6].value : {};

      const clients = normalizeCollectionPayload(clientsData, ["clients"]);
      const users = normalizeCollectionPayload(usersData, ["users"]);
      const requests = normalizeCollectionPayload(requestsData, ["requests", "clientRequests"]);
      const orders = normalizeCollectionPayload(ordersData, ["orders"]);
      const maintenance = normalizeCollectionPayload(maintenanceData, ["maintenance"]);
      const clientMaintenanceVehicles = normalizeCollectionPayload(maintenanceData, ["clientMaintenanceVehicles"]);
      const scheduledMaintenance = clientMaintenanceVehicles.filter(
        (vehicle) => String(vehicle?.adminContactStatus || "").trim() === "appointment_scheduled"
      );
      const posts = normalizeCollectionPayload(postsData, ["posts"]);
      const deletionRequestsCountValue = canManageDeletionRequests
        ? normalizeCollectionPayload(deletionRequestsData, ["orders"]).length
          + normalizeCollectionPayload(deletionRequestsData, ["trackingEventRequests"]).length
        : 0;
      const activeOrders = orders.filter((order) => order.status === "active");
      const completedOrders = orders.filter((order) => order.status === "completed");

      setElementText(clientsCount, clients.length);
      setElementText(usersCount, users.length);
      setElementText(deletionRequestsCount, deletionRequestsCountValue);
      setElementText(requestsCount, requests.length);
      setElementText(ordersCount, orders.length);
      setElementText(activeOrdersCount, activeOrders.length);
      setElementText(completedOrdersCount, completedOrders.length);
      setElementText(maintenanceCount, scheduledMaintenance.length);
      setElementText(postsCount, posts.length);

      if (distributionCaption) {
        distributionCaption.textContent = `${orders.length} vehículos distribuidos entre los 10 estados del tracking.`;
      }

      renderStageDistribution(orders);
      renderGlobalEvents(
        collectGlobalEvents({
          orders,
          posts,
          requests,
          maintenance,
        })
      );

      const rejected = results.find((entry, index) => entry.status === "rejected" && dashboardRequests[index].critical);

      if (rejected) {
        setDashboardError(rejected.reason?.message || "Algunos indicadores no se pudieron cargar.");
        return;
      }

      if (heroFeedback) {
        heroFeedback.textContent = "";
        heroFeedback.className = "feedback";
      }
    } catch (error) {
      renderStageDistribution([]);
      renderGlobalEvents([]);
      setDashboardError(error.message);
    } finally {
      stopInitOverlayWatchdog();
      forceClearLoadingState();
    }
  }

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);

  loadDashboard().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    setDashboardError(error.message);
  });

  document.querySelectorAll(".admin-meta-pill-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const href = button.getAttribute("data-href");
      if (href) {
        window.location.href = href;
      }
    });
  });
}

})();