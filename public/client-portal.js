function resolveApiBaseUrl() {
  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${port || "10000"}`;
  }

  return "https://global-backend-bdbx.onrender.com";
}

const apiBaseUrl = resolveApiBaseUrl();
const state = {
  user: null,
  orders: [],
  maintenance: [],
  notifications: [],
  notificationsViewed: false,
  activeView: "home",
  feedPosts: [],
  feedOffset: 0,
  feedHasMore: true,
  isFetchingFeed: false,
  isRefreshingFeed: false,
};

const FEED_PAGE_SIZE = 5;
const PULL_REFRESH_THRESHOLD = 78;

function redirectToLogin() {
  window.location.replace("/app/index.html");
}

function clearAuth() {
  localStorage.removeItem("globalAppToken");
  localStorage.removeItem("globalAppRole");
}

function getToken() {
  return localStorage.getItem("globalAppToken");
}

function getRole() {
  return localStorage.getItem("globalAppRole");
}

if (!getToken()) {
  redirectToLogin();
}

if (getRole() === "admin") {
  window.location.href = "/app/admin.html";
}

const viewNodes = Array.from(document.querySelectorAll(".client-view"));
const navButtons = Array.from(document.querySelectorAll(".client-nav-button"));
const feedContainer = document.getElementById("client-feed");
const trackingInput = document.getElementById("tracking-search-input");
const trackingOptions = document.getElementById("tracking-search-options");
const trackingResults = document.getElementById("tracking-results");
const requestForm = document.getElementById("client-request-form");
const requestFeedback = document.getElementById("client-request-feedback");
const maintenanceForm = document.getElementById("client-maintenance-form");
const maintenanceFeedback = document.getElementById("client-maintenance-feedback");
const maintenanceSelect = document.getElementById("client-maintenance-id");
const maintenanceList = document.getElementById("client-maintenance-list");
const notificationsButton = document.getElementById("notifications-button");
const notificationsModal = document.getElementById("notifications-modal");
const notificationsOverlay = document.getElementById("notifications-overlay");
const notificationsClose = document.getElementById("notifications-close");
const notificationsList = document.getElementById("notifications-list");
const notificationCount = document.getElementById("notification-count");
const menuButton = document.getElementById("client-menu-button");
const sessionMenu = document.getElementById("session-menu");
const logoutButton = document.getElementById("client-logout-button");
const refreshIndicator = document.getElementById("feed-refresh-indicator");
const refreshLabel = document.getElementById("feed-refresh-label");
const feedLoadMoreSentinel = document.getElementById("feed-load-more-sentinel");
const feedLoadingState = document.getElementById("feed-loading-state");

let feedObserver = null;
let touchStartY = 0;
let pullDistance = 0;
let isPulling = false;

function fetchJson(path, options = {}) {
  return fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const data = await response.json();

    if (!response.ok) {
      if (
        data.message === "Invalid or expired token" ||
        data.message === "Authentication required" ||
        response.status === 401
      ) {
        clearAuth();
        redirectToLogin();
      }

      throw new Error(data.message || "Request failed");
    }

    return data;
  });
}

function setFeedback(element, message, type = "") {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `feedback${type ? ` ${type}` : ""}`;
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "Sin fecha";
  }

  return new Date(dateValue).toLocaleDateString("es-VE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatCurrency(amount, currency = "USD") {
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmptyState(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function updateSummary() {
  if (state.user) {
    document.getElementById("client-greeting").textContent = `Hola, ${state.user.name}`;
    document.getElementById("request-name").value = state.user.name || "";
    document.getElementById("request-email").value = state.user.email || "";
  }
}

function renderFeed() {
  if (!state.feedPosts.length && !state.isFetchingFeed) {
    renderEmptyState(feedContainer, "Todavia no hay publicaciones activas para tu feed.");
    feedLoadingState.textContent = "";
    return;
  }

  feedContainer.innerHTML = state.feedPosts
    .map((post) => {
      const mediaMarkup = (post.media || [])
        .map((item) => {
          if (item.type === "video") {
            return `
              <div class="feed-media-card video">
                <video controls playsinline preload="metadata" src="${escapeHtml(item.url)}"></video>
              </div>
            `;
          }

          return `
            <div class="feed-media-card">
              <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || post.title)}" loading="lazy" />
            </div>
          `;
        })
        .join("");

      const avatarLabel = "GI";
      const authorName = "Global Imports";
      const publishedDate = new Date(post.publishedAt || post.createdAt);
      const relativeDate = publishedDate.toLocaleDateString("es-VE", {
        month: "short",
        day: "numeric",
      });
      const relativeTime = publishedDate.toLocaleTimeString("es-VE", {
        hour: "numeric",
        minute: "2-digit",
      });

      return `
        <article class="feed-card">
          <div class="feed-author-row">
            <div class="feed-author-meta">
              <div class="feed-author-avatar">${avatarLabel}</div>
              <div>
                <strong>${authorName}</strong>
                <p>${escapeHtml(relativeDate)} · ${escapeHtml(relativeTime)}</p>
              </div>
            </div>
          </div>
          ${mediaMarkup ? `<div class="feed-media-strip ${post.media?.length > 1 ? "is-carousel" : ""}">${mediaMarkup}</div>` : ""}
          <div class="feed-story-copy">
            <h3>${escapeHtml(post.title)}</h3>
            <p class="feed-card-copy">${escapeHtml(post.body)}</p>
          </div>
        </article>
      `;
    })
    .join("");

  if (state.isFetchingFeed && state.feedPosts.length) {
    feedLoadingState.textContent = "Cargando mas publicaciones...";
  } else if (!state.feedHasMore && state.feedPosts.length) {
    feedLoadingState.textContent = "Ya viste las publicaciones disponibles.";
  } else {
    feedLoadingState.textContent = "";
  }
}

function updateRefreshIndicator() {
  refreshIndicator.style.setProperty("--pull-distance", `${Math.min(pullDistance, 96)}px`);

  if (state.isRefreshingFeed) {
    refreshIndicator.classList.add("is-active");
    refreshIndicator.classList.add("is-refreshing");
    refreshLabel.textContent = "Actualizando publicaciones...";
    return;
  }

  refreshIndicator.classList.remove("is-refreshing");
  refreshIndicator.classList.toggle("is-active", pullDistance > 8);
  refreshLabel.textContent =
    pullDistance >= PULL_REFRESH_THRESHOLD
      ? "Suelta para actualizar"
      : "Desliza hacia abajo para actualizar";
}

async function loadFeedPage({ reset = false } = {}) {
  if (state.isFetchingFeed) {
    return;
  }

  if (!reset && !state.feedHasMore) {
    return;
  }

  state.isFetchingFeed = true;

  if (reset) {
    state.feedOffset = 0;
    state.feedHasMore = true;
    state.feedPosts = [];
    feedLoadingState.textContent = "Actualizando publicaciones...";
    renderFeed();
  }

  try {
    const data = await fetchJson(`/api/client/posts?offset=${state.feedOffset}&limit=${FEED_PAGE_SIZE}`);
    const nextPosts = data.posts || [];

    state.feedPosts = reset ? nextPosts : state.feedPosts.concat(nextPosts);
    state.feedOffset = data.pagination?.nextOffset || state.feedPosts.length;
    state.feedHasMore = Boolean(data.pagination?.hasMore);
    renderFeed();
  } finally {
    state.isFetchingFeed = false;

    if (state.isRefreshingFeed) {
      state.isRefreshingFeed = false;
      pullDistance = 0;
      updateRefreshIndicator();
    }

    if (state.feedPosts.length && state.feedHasMore) {
      feedLoadingState.textContent = "Desliza hacia abajo para ver mas publicaciones.";
    }
  }
}

async function refreshFeed() {
  if (state.isRefreshingFeed) {
    return;
  }

  state.isRefreshingFeed = true;
  updateRefreshIndicator();
  await loadFeedPage({ reset: true });
}

function setupInfiniteScroll() {
  if (feedObserver) {
    feedObserver.disconnect();
  }

  feedObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && state.activeView === "home") {
          loadFeedPage().catch((error) => {
            feedLoadingState.textContent = error.message;
          });
        }
      });
    },
    {
      root: null,
      rootMargin: "0px 0px 240px 0px",
      threshold: 0.01,
    }
  );

  feedObserver.observe(feedLoadMoreSentinel);
}

function handlePullStart(event) {
  if (state.activeView !== "home" || window.scrollY > 0 || state.isRefreshingFeed) {
    isPulling = false;
    return;
  }

  touchStartY = event.touches[0].clientY;
  pullDistance = 0;
  isPulling = true;
  updateRefreshIndicator();
}

function handlePullMove(event) {
  if (!isPulling) {
    return;
  }

  const currentY = event.touches[0].clientY;
  const deltaY = currentY - touchStartY;

  if (deltaY <= 0) {
    pullDistance = 0;
    updateRefreshIndicator();
    return;
  }

  pullDistance = Math.min(deltaY * 0.6, 110);
  updateRefreshIndicator();

  if (pullDistance > 0) {
    event.preventDefault();
  }
}

function handlePullEnd() {
  if (!isPulling) {
    return;
  }

  isPulling = false;

  if (pullDistance >= PULL_REFRESH_THRESHOLD) {
    refreshFeed().catch((error) => {
      state.isRefreshingFeed = false;
      pullDistance = 0;
      updateRefreshIndicator();
      feedLoadingState.textContent = error.message;
    });
    return;
  }

  pullDistance = 0;
  updateRefreshIndicator();
}

function renderTrackingOptions() {
  trackingOptions.innerHTML = state.orders
    .map((order) => `<option value="${escapeHtml(order.trackingNumber)}"></option>`)
    .join("");
}

function renderTrackingResult() {
  const query = trackingInput.value.trim().toLowerCase();

  if (!query) {
    renderEmptyState(trackingResults, "Ingresa tu numero de guia para ver las actualizaciones del pedido.");
    return;
  }

  const order = state.orders.find((item) => String(item.trackingNumber).toLowerCase() === query);

  if (!order) {
    renderEmptyState(trackingResults, "No encontramos una guia asociada a tu cuenta con ese numero.");
    return;
  }

  const stepsMarkup = (order.trackingSteps || [])
    .map(
      (step) => `
        <article class="tracking-step ${escapeHtml(step.status)}">
          <div>
            <strong>${escapeHtml(step.label)}</strong>
            <p>${escapeHtml(step.notes || "Sin observaciones por ahora.")}</p>
            <p>${escapeHtml(step.updatedAt ? `Actualizado ${formatDate(step.updatedAt)}` : "Esperando actualizacion")}</p>
          </div>
          <span>${escapeHtml(step.status)}</span>
        </article>
      `
    )
    .join("");

  const mediaMarkup = (order.media || [])
    .map((item) => {
      if (item.type === "video") {
        return `<div class="feed-media-card video"><video controls playsinline preload="metadata" src="${escapeHtml(item.url)}"></video></div>`;
      }

      return `<div class="feed-media-card"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(order.vehicle?.brand || "Vehiculo")}" loading="lazy" /></div>`;
    })
    .join("");

  trackingResults.innerHTML = `
    <section class="tracking-preview">
      <div class="tracking-card-header">
        <strong>${escapeHtml(order.vehicle?.brand || "Vehiculo")} ${escapeHtml(order.vehicle?.model || "")}</strong>
        <p>Guia ${escapeHtml(order.trackingNumber)} · Estado ${escapeHtml(order.status || "active")}</p>
        <p>Compra ${escapeHtml(formatDate(order.purchaseDate))} · Llegada estimada ${escapeHtml(formatDate(order.expectedArrivalDate))}</p>
      </div>
      ${mediaMarkup ? `<div class="feed-media-strip">${mediaMarkup}</div>` : ""}
      <div class="tracking-steps-list">${stepsMarkup}</div>
    </section>
  `;
}

function renderMaintenanceOptions() {
  if (!state.maintenance.length) {
    maintenanceSelect.innerHTML = '<option value="">No hay mantenimientos activos</option>';
    return;
  }

  maintenanceSelect.innerHTML = ['<option value="">Selecciona una guia</option>']
    .concat(
      state.maintenance.map(
        (item) =>
          `<option value="${escapeHtml(item._id)}">${escapeHtml(item.order?.trackingNumber || "Sin guia")} · ${escapeHtml(item.order?.vehicle?.brand || "Vehiculo")} ${escapeHtml(item.order?.vehicle?.model || "")}</option>`
      )
    )
    .join("");
}

function renderMaintenanceList() {
  if (!state.maintenance.length) {
    renderEmptyState(maintenanceList, "Todavia no tienes mantenimientos programados.");
    return;
  }

  maintenanceList.innerHTML = state.maintenance
    .map(
      (item) => `
        <article class="maintenance-card">
          <div class="maintenance-card-top">
            <div>
              <strong>${escapeHtml(item.order?.vehicle?.brand || "Vehiculo")} ${escapeHtml(item.order?.vehicle?.model || "")}</strong>
              <p>Guia ${escapeHtml(item.order?.trackingNumber || "Sin guia")}</p>
            </div>
            <span>${escapeHtml(item.status || "scheduled")}</span>
          </div>
          <div class="maintenance-meta-grid">
            <div><span>Proximo mantenimiento</span><strong>${escapeHtml(formatDate(item.dueDate))}</strong></div>
            <div><span>Kilometraje reportado</span><strong>${escapeHtml(item.reportedMileage || "Sin reporte")}</strong></div>
            <div><span>Ultimo servicio</span><strong>${escapeHtml(item.lastServiceDate ? formatDate(item.lastServiceDate) : "Sin fecha")}</strong></div>
            <div><span>Ultima actualizacion</span><strong>${escapeHtml(item.lastClientUpdateAt ? formatDate(item.lastClientUpdateAt) : "Pendiente")}</strong></div>
          </div>
          <p class="maintenance-note">${escapeHtml(item.clientNotes || item.contactNotes || "Sin notas registradas.")}</p>
        </article>
      `
    )
    .join("");
}

function renderNotifications() {
  const unreadCount = state.notificationsViewed ? 0 : state.notifications.length;

  notificationCount.textContent = String(unreadCount);
  notificationCount.hidden = unreadCount === 0;

  if (!state.notifications.length) {
    renderEmptyState(notificationsList, "No hay notificaciones recientes.");
    return;
  }

  notificationsList.innerHTML = state.notifications
    .map(
      (item) => `
        <article class="notification-card ${escapeHtml(item.type)}">
          <div>
            <span>${escapeHtml(item.type)}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.message)}</p>
          </div>
          <time>${escapeHtml(formatDate(item.date))}</time>
        </article>
      `
    )
    .join("");
}

function setActiveView(viewName) {
  state.activeView = viewName;

  viewNodes.forEach((node) => {
    node.classList.toggle("is-active", node.dataset.view === viewName);
  });

  navButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.viewTarget === viewName);
  });
}

function openNotifications() {
  state.notificationsViewed = true;
  notificationCount.textContent = "0";
  notificationCount.hidden = true;
  notificationsModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeNotifications() {
  notificationsModal.hidden = true;
  document.body.classList.remove("modal-open");
}

async function loadDashboard() {
  const data = await fetchJson("/api/client/dashboard");
  state.user = data.user || null;
  state.orders = data.orders || [];
  state.maintenance = data.maintenance || [];
  state.notifications = data.notifications || [];
  state.notificationsViewed = false;

  updateSummary();
  renderTrackingOptions();
  renderTrackingResult();
  renderMaintenanceOptions();
  renderMaintenanceList();
  renderNotifications();
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveView(button.dataset.viewTarget);

    if (button.dataset.viewTarget === "home" && !state.feedPosts.length) {
      loadFeedPage({ reset: true }).catch((error) => {
        feedLoadingState.textContent = error.message;
      });
    }
  });
});

trackingInput.addEventListener("input", renderTrackingResult);

requestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(requestForm);

  setFeedback(requestFeedback, "Enviando tu configuracion...");

  try {
    await fetchJson("/api/client/requests", {
      method: "POST",
      body: JSON.stringify({
        customerPhone: formData.get("customerPhone"),
        reservationAmount: formData.get("reservationAmount"),
        currency: formData.get("currency"),
        notes: formData.get("notes"),
        vehicle: {
          brand: formData.get("brand"),
          model: formData.get("model"),
          year: formData.get("year"),
          version: formData.get("version"),
          color: formData.get("color"),
          upholstery: formData.get("upholstery"),
        },
      }),
    });

    requestForm.reset();
    document.getElementById("request-name").value = state.user?.name || "";
    document.getElementById("request-email").value = state.user?.email || "";
    requestForm.querySelector('select[name="currency"]').value = "USD";
    setFeedback(requestFeedback, "Tu nueva orden fue enviada correctamente.", "success");
  } catch (error) {
    setFeedback(requestFeedback, error.message, "error");
  }
});

maintenanceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(maintenanceForm);
  const maintenanceId = formData.get("maintenanceId");

  if (!maintenanceId) {
    setFeedback(maintenanceFeedback, "Selecciona primero una guia.", "error");
    return;
  }

  setFeedback(maintenanceFeedback, "Guardando tu reporte...");

  try {
    await fetchJson(`/api/client/maintenance/${maintenanceId}/report`, {
      method: "PATCH",
      body: JSON.stringify({
        reportedMileage: formData.get("reportedMileage"),
        lastServiceDate: formData.get("lastServiceDate"),
        clientNotes: formData.get("clientNotes"),
      }),
    });

    setFeedback(maintenanceFeedback, "Reporte de mantenimiento guardado correctamente.", "success");
    await loadDashboard();
    maintenanceSelect.value = maintenanceId;
  } catch (error) {
    setFeedback(maintenanceFeedback, error.message, "error");
  }
});

notificationsButton.addEventListener("click", openNotifications);
notificationsClose.addEventListener("click", closeNotifications);
notificationsOverlay.addEventListener("click", closeNotifications);

menuButton.addEventListener("click", () => {
  const isOpen = !sessionMenu.hidden;
  sessionMenu.hidden = isOpen;
});

logoutButton.addEventListener("click", () => {
  clearAuth();
  redirectToLogin();
});

document.addEventListener("click", (event) => {
  if (!sessionMenu.contains(event.target) && !menuButton.contains(event.target)) {
    sessionMenu.hidden = true;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNotifications();
    sessionMenu.hidden = true;
  }
});

window.addEventListener("touchstart", handlePullStart, { passive: true });
window.addEventListener("touchmove", handlePullMove, { passive: false });
window.addEventListener("touchend", handlePullEnd, { passive: true });

window.addEventListener("load", () => {
  document.body.classList.add("motion-ready");
});

loadDashboard().catch((error) => {
  renderEmptyState(feedContainer, error.message);
  renderEmptyState(trackingResults, error.message);
  renderEmptyState(maintenanceList, error.message);
  renderEmptyState(notificationsList, error.message);
});

setupInfiniteScroll();
loadFeedPage({ reset: true }).catch((error) => {
  renderEmptyState(feedContainer, error.message);
  feedLoadingState.textContent = error.message;
});