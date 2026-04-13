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
      response.status === 403 ||
      data.message === "Forbidden" ||
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

function resolveStageDisplayFromOrder(order) {
  const stageKey = resolveCurrentStageKey(order);

  if (!stageKey) {
    return "-";
  }

  const stageIndex = stageTemplates.findIndex((stage) => stage.key === stageKey);
  const stageLabel = stageLabelByKey[stageKey] || stageTemplates[stageIndex]?.label || "Estado";

  if (stageIndex === -1) {
    return stageLabel;
  }

  return `E${stageIndex + 1}: ${stageLabel}`;
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
    tableBody.innerHTML = '<tr><td colspan="7"><div class="empty-state">Sin eventos recientes por mostrar.</div></td></tr>';
    return;
  }

  tableBody.innerHTML = events
    .map((event) => `
      <tr>
        <td data-label="Fecha">${escapeHtml(formatDateTimeLabel(event.date))}</td>
        <td data-label="Modulo">${escapeHtml(event.module)}</td>
        <td data-label="Estado">${escapeHtml(event.status || "-")}</td>
        <td data-label="Vehiculo">${escapeHtml(event.vehicle || "-")}</td>
        <td data-label="Cliente">${escapeHtml(event.clientName || "-")}</td>
        <td data-label="Evento">${escapeHtml(event.title)}</td>
        <td data-label="Detalle">${escapeHtml(event.detail)}</td>
      </tr>
    `)
    .join("");
}

function collectGlobalEvents({ orders = [], posts = [], requests = [], maintenance = [] }) {
  const orderEvents = orders.flatMap((order) => {
    const trackingCode = order?.trackingNumber ? `Tracking ${order.trackingNumber}` : "Pedido";
    const vehicleLabel = `${order?.vehicle?.brand || "Vehiculo"} ${order?.vehicle?.model || ""}`.trim();
    const clientName = order?.client?.name || "-";
    const currentStageDisplay = resolveStageDisplayFromOrder(order);
    const baseEvents = [
      {
        date: order?.createdAt,
        module: "Pedidos",
        status: currentStageDisplay,
        vehicle: vehicleLabel,
        clientName,
        title: "Pedido creado",
        detail: `${trackingCode} · ${vehicleLabel}`,
      },
      {
        date: order?.updatedAt,
        module: "Pedidos",
        status: currentStageDisplay,
        vehicle: vehicleLabel,
        clientName,
        title: "Pedido actualizado",
        detail: `${trackingCode} · Estado ${order?.status || "-"}`,
      },
    ];

    const trackingEvents = (order?.trackingSteps || [])
      .filter((step) => step?.updatedAt || step?.confirmedAt)
      .map((step) => ({
        date: step.updatedAt || step.confirmedAt,
        module: "Tracking",
        status: resolveStageDisplayFromStep(step),
        vehicle: vehicleLabel,
        clientName,
        title: `Cambio en ${step.label || "estado"}`,
        detail: `${trackingCode}${step.confirmed ? " · Confirmado" : ""}`,
      }));

    return baseEvents.concat(trackingEvents);
  });

  const postEvents = posts.map((post) => ({
    date: post?.publishedAt || post?.createdAt || post?.updatedAt,
    module: "Publicaciones",
    status: post?.status || "-",
    vehicle: "-",
    clientName: "-",
    title: post?.status === "scheduled" ? "Publicacion programada" : "Publicacion registrada",
    detail: post?.title || "Sin titulo",
  }));

  const requestEvents = requests.map((request) => ({
    date: request?.updatedAt || request?.createdAt,
    module: "Solicitudes de compra",
    status: request?.status || "-",
    vehicle: `${request?.vehicle?.brand || "Vehiculo"} ${request?.vehicle?.model || ""}`.trim(),
    clientName: request?.customerName || "-",
    title: `Solicitud ${request?.status || "nueva"}`,
    detail: `${request?.customerName || "Cliente"} · ${request?.vehicle?.brand || "Vehiculo"} ${request?.vehicle?.model || ""}`.trim(),
  }));

  const maintenanceEvents = maintenance.map((item) => ({
    date: item?.updatedAt || item?.createdAt || item?.dueDate,
    module: "Mantenimientos",
    status: item?.order ? resolveStageDisplayFromOrder(item.order) : "-",
    vehicle: `${item?.order?.vehicle?.brand || "Vehiculo"} ${item?.order?.vehicle?.model || ""}`.trim(),
    clientName: item?.client?.name || item?.order?.client?.name || "-",
    title: `Mantenimiento ${item?.status || "programado"}`,
    detail: `${item?.order?.trackingNumber ? `Tracking ${item.order.trackingNumber}` : "Sin tracking"}${item?.client?.name ? ` · ${item.client.name}` : ""}`,
  }));

  return orderEvents
    .concat(postEvents, requestEvents, maintenanceEvents)
    .filter((event) => event && event.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 20);
}

function renderStageDistribution(orders) {
  const stageGrid = document.getElementById("stage-distribution-grid");

  if (!stageGrid) {
    return;
  }

  const countsByStage = new Map(stageTemplates.map((stage) => [stage.key, 0]));

  orders.forEach((order) => {
    const currentStageKey = resolveCurrentStageKey(order);

    if (!currentStageKey || !countsByStage.has(currentStageKey)) {
      return;
    }

    countsByStage.set(currentStageKey, countsByStage.get(currentStageKey) + 1);
  });

  stageGrid.innerHTML = stageTemplates
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

      if (adminFirstName) {
        adminFirstName.textContent = getFirstName(user?.name);
      }

      if (adminNameTop) {
        adminNameTop.textContent = user?.name || "Administrador";
      }

      const results = await Promise.allSettled([
        fetchDashboardJson("/api/admin/clients"),
        fetchDashboardJson("/api/admin/client-requests"),
        fetchDashboardJson("/api/admin/orders"),
        fetchDashboardJson("/api/admin/maintenance"),
        fetchDashboardJson("/api/admin/posts"),
      ]);

      const clientsData = results[0].status === "fulfilled" ? results[0].value : {};
      const requestsData = results[1].status === "fulfilled" ? results[1].value : {};
      const ordersData = results[2].status === "fulfilled" ? results[2].value : {};
      const maintenanceData = results[3].status === "fulfilled" ? results[3].value : {};
      const postsData = results[4].status === "fulfilled" ? results[4].value : {};

      const clients = normalizeCollectionPayload(clientsData, ["clients"]);
      const requests = normalizeCollectionPayload(requestsData, ["requests", "clientRequests"]);
      const orders = normalizeCollectionPayload(ordersData, ["orders"]);
      const maintenance = normalizeCollectionPayload(maintenanceData, ["maintenance"]);
      const posts = normalizeCollectionPayload(postsData, ["posts"]);
      const activeOrders = orders.filter((order) => order.status === "active");
      const completedOrders = orders.filter((order) => order.status === "completed");

      setElementText(clientsCount, clients.length);
      setElementText(requestsCount, requests.length);
      setElementText(ordersCount, orders.length);
      setElementText(activeOrdersCount, activeOrders.length);
      setElementText(completedOrdersCount, completedOrders.length);
      setElementText(maintenanceCount, maintenance.length);
      setElementText(postsCount, posts.length);

      if (distributionCaption) {
        distributionCaption.textContent = `${orders.length} vehículos distribuidos entre los 9 estados del tracking.`;
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

      const rejected = results.find((entry) => entry.status === "rejected");

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