function resolveApiBaseUrl() {
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

const apiBaseUrl = resolveApiBaseUrl();
const state = {
  user: null,
  orders: [],
  maintenance: [],
  maintenanceVehicles: [],
  notifications: [],
  activeView: "home",
  registeredPushToken: "",
  feedPosts: [],
  feedOffset: 0,
  feedHasMore: true,
  isFetchingFeed: false,
  isRefreshingFeed: false,
  virtualDealershipVehicles: [],
  virtualDealershipVisibleCount: 0,
  virtualDealershipExpandedDetails: new Set(),
  maintenanceExpandedDetails: new Set(),
};

const FEED_PAGE_SIZE = 5;
const VIRTUAL_DEALERSHIP_BATCH_SIZE = 3;
const PULL_REFRESH_THRESHOLD = 78;
const TRACKING_HISTORY_MAX_ITEMS = 12;
const TRACKING_PAGE_VERSION = "20260416-clientevents04";
const CLIENT_IMAGE_CACHE_SW_URL = "/sw.js";

function buildTrackingPageUrl(trackingNumber = "") {
  const trackingUrl = new URL("/client-tracking.html", window.location.origin);
  trackingUrl.searchParams.set("v", TRACKING_PAGE_VERSION);

  if (trackingNumber) {
    trackingUrl.searchParams.set("tracking", String(trackingNumber).toUpperCase().trim());
  }

  return trackingUrl;
}

function registerClientImageCacheServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register(CLIENT_IMAGE_CACHE_SW_URL).catch((error) => {
      console.warn("No se pudo registrar el cache de imagenes del cliente.", error);
    });
  });
}

function installZoomGuards() {
  document.documentElement.style.touchAction = "manipulation";
  document.body?.style?.setProperty("touch-action", "manipulation");

  const preventGesture = (event) => {
    event.preventDefault();
  };

  ["gesturestart", "gesturechange", "gestureend", "dblclick"].forEach((eventName) => {
    document.addEventListener(eventName, preventGesture, { passive: false });
  });

  let lastTouchEndAt = 0;

  document.addEventListener("touchend", (event) => {
    const now = Date.now();

    if (now - lastTouchEndAt <= 280) {
      event.preventDefault();
    }

    lastTouchEndAt = now;
  }, { passive: false });
}

installZoomGuards();

function getInitialViewFromUrl() {
  const urlView = new URLSearchParams(window.location.search).get("view");
  const allowedViews = new Set(["home", "tracking", "order", "order-options", "order-configurator", "maintenance", "virtual-dealership", "pago-separacion", "pago-exitoso"]);

  if (allowedViews.has(urlView)) {
    return urlView;
  }

  return "home";
}

function persistViewToUrl(viewName) {
  const nextUrl = new URL(window.location.href);

  if (viewName === "home") {
    nextUrl.searchParams.delete("view");
  } else {
    nextUrl.searchParams.set("view", viewName);
  }

  window.history.replaceState({}, document.title, nextUrl.toString());
}

function redirectToLogin() {
  const loginUrl = new URL("/index.html", window.location.origin);
  loginUrl.searchParams.set("logout", "1");
  loginUrl.searchParams.set("t", String(Date.now()));
  window.location.replace(loginUrl.toString());
}

function buildDeletedAccountPageUrl(feedbackToken = "") {
  const pagePath = window.location.pathname.startsWith("/app/")
    ? "/app/account-deleted.html"
    : "/account-deleted.html";
  const deletedAccountUrl = new URL(pagePath, window.location.origin);

  if (feedbackToken) {
    deletedAccountUrl.searchParams.set("token", String(feedbackToken));
  }

  return deletedAccountUrl.toString();
}

function clearAuth() {
  localStorage.removeItem("globalAppToken");
  localStorage.removeItem("globalAppRole");
  sessionStorage.removeItem("globalAppToken");
  sessionStorage.removeItem("globalAppRole");
}

function requestLogout() {
  return fetch(`${apiBaseUrl}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
  }).catch(() => null);
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

if (["admin", "manager", "adminUSA", "gerenteUSA"].includes(getRole())) {
  window.location.href = "/admin.html";
}

const viewNodes = Array.from(document.querySelectorAll(".client-view"));
const navButtons = Array.from(document.querySelectorAll(".client-nav-button"));
const feedContainer = document.getElementById("client-feed");
const trackingForm = document.getElementById("tracking-search-form");
const trackingInput = document.getElementById("tracking-search-input");
const trackingOptions = document.getElementById("tracking-search-options");
const trackingSearchFeedback = document.getElementById("tracking-search-feedback");
const trackingTabSearchButton = document.getElementById("tracking-tab-search");
const trackingTabOrdersButton = document.getElementById("tracking-tab-orders");
const trackingSearchPanel = document.getElementById("tracking-search-panel");
const trackingOrdersPanel = document.getElementById("tracking-orders-panel");
const trackingOrdersList = document.getElementById("tracking-orders-list");
const trackingOrdersClearButton = document.getElementById("tracking-orders-clear");
const requestForm = document.getElementById("client-request-form");
const requestFeedback = document.getElementById("client-request-feedback");
const orderVehicleCarousel = document.getElementById("order-vehicle-carousel");
const orderActionCards = document.getElementById("order-experience-actions");
const orderOptionsBackButton = document.getElementById("order-options-back");
const orderConfigBackButton = document.getElementById("order-config-back");
const sequoiaConfigImageFrame = document.getElementById("sequoia-config-image-frame");
const sequoiaConfigMainImage = document.getElementById("sequoia-config-main-image");
const sequoiaVisionHint = document.getElementById("sequoia-vision-hint");
const sequoiaInteriorImageFrame = document.getElementById("sequoia-interior-image-frame");
const sequoiaInteriorMainImage = document.getElementById("sequoia-interior-main-image");
const sequoiaInteriorColorName = document.getElementById("sequoia-interior-color-name");
const sequoiaInteriorColors = document.getElementById("sequoia-interior-colors");
const sequoiaConfigPrevButton = document.getElementById("sequoia-config-prev");
const sequoiaConfigNextButton = document.getElementById("sequoia-config-next");
const sequoiaConfigDots = document.getElementById("sequoia-config-dots");
const sequoiaConfigColors = document.getElementById("sequoia-config-colors");
const sequoiaConfigColorName = document.getElementById("sequoia-config-color-name");
const sequoiaConfigTitle = document.getElementById("sequoia-config-title");
const sequoiaConfigPrice = document.getElementById("sequoia-config-price");
const sequoiaConfigSpecs = document.getElementById("sequoia-config-specs");
const sequoiaConfigVersions = document.getElementById("sequoia-config-versions");
const sequoiaSummaryTitle = document.getElementById("sequoia-summary-title");
const sequoiaSummaryDeliveryRange = document.getElementById("sequoia-summary-delivery-range");
const sequoiaDeliveryCityButton = document.getElementById("sequoia-delivery-city-button");
const sequoiaCitySelector = document.getElementById("sequoia-city-selector");
const sequoiaCityFeeNote = document.getElementById("sequoia-city-fee-note");
const sequoiaOrderDetailsToggle = document.getElementById("sequoia-order-details-toggle");
const sequoiaOrderDetails = document.getElementById("sequoia-order-details");
const sequoiaSummaryTotalPrice = document.getElementById("sequoia-summary-total-price");
const sequoiaSummaryFinancingLink = document.getElementById("sequoia-summary-financing-link");
const sequoiaOrderCardButton = document.getElementById("sequoia-order-card-button");
const maintenanceFeedback = document.getElementById("client-maintenance-feedback");
const addMaintenanceVehicleButton = document.getElementById("client-add-maintenance-vehicle-button");
const maintenanceVehicleModal = document.getElementById("maintenance-vehicle-modal");
const maintenanceVehicleOverlay = document.getElementById("maintenance-vehicle-overlay");
const maintenanceVehicleClose = document.getElementById("maintenance-vehicle-close");
const maintenanceVehicleForm = document.getElementById("client-maintenance-vehicle-form");
const maintenanceVehicleTitle = document.getElementById("maintenance-vehicle-title");
const maintenanceVehicleSubmitButton = maintenanceVehicleForm?.querySelector('button[type="submit"]');
const maintenanceList = document.getElementById("client-maintenance-list");
const virtualDealershipClientList = document.getElementById("virtual-dealership-client-list");
const virtualDealershipLoadMoreSentinel = document.getElementById("virtual-dealership-load-more-sentinel");
const virtualDealershipImageModal = document.getElementById("virtual-dealership-image-modal");
const virtualDealershipImageOverlay = document.getElementById("virtual-dealership-image-overlay");
const virtualDealershipImageClose = document.getElementById("virtual-dealership-image-close");
const virtualDealershipImagePrev = document.getElementById("virtual-dealership-image-prev");
const virtualDealershipImageNext = document.getElementById("virtual-dealership-image-next");
const virtualDealershipImageDots = document.getElementById("virtual-dealership-image-dots");
const virtualDealershipImageTrack = document.getElementById("virtual-dealership-image-track");
const virtualDealershipVideoModal = document.getElementById("virtual-dealership-video-modal");
const virtualDealershipVideoOverlay = document.getElementById("virtual-dealership-video-overlay");
const virtualDealershipVideoClose = document.getElementById("virtual-dealership-video-close");
const virtualDealershipVideoDescription = document.getElementById("virtual-dealership-video-modal-description");
const virtualDealershipVideoDate = document.getElementById("virtual-dealership-video-date");
const virtualDealershipVideoSlots = document.getElementById("virtual-dealership-video-slots");
const virtualDealershipVideoConfirm = document.getElementById("virtual-dealership-video-confirm");
const virtualDealershipVideoFeedback = document.getElementById("virtual-dealership-video-feedback");
const notificationsButton = document.getElementById("notifications-button");
const notificationsModal = document.getElementById("notifications-modal");
const notificationsOverlay = document.getElementById("notifications-overlay");
const notificationsClose = document.getElementById("notifications-close");
const notificationsList = document.getElementById("notifications-list");
const notificationCount = document.getElementById("notification-count");
const menuButton = document.getElementById("client-menu-button");
const sessionMenu = document.getElementById("session-menu");
const logoutButton = document.getElementById("client-logout-button");
const deleteAccountOpenButton = document.getElementById("client-delete-account-open");
const deleteAccountModal = document.getElementById("delete-account-modal");
const deleteAccountOverlay = document.getElementById("delete-account-overlay");
const deleteAccountCloseButton = document.getElementById("delete-account-close");
const deleteAccountCancelButton = document.getElementById("delete-account-cancel");
const deleteAccountForm = document.getElementById("delete-account-form");
const deleteAccountPasswordInput = document.getElementById("delete-account-password");
const deleteAccountConfirmButton = document.getElementById("delete-account-confirm");
const deleteAccountFeedback = document.getElementById("delete-account-feedback");
const refreshIndicator = document.getElementById("feed-refresh-indicator");
const refreshLabel = document.getElementById("feed-refresh-label");
const feedLoadMoreSentinel = document.getElementById("feed-load-more-sentinel");
const feedLoadingState = document.getElementById("feed-loading-state");

let feedObserver = null;
let virtualDealershipObserver = null;
let touchStartY = 0;
let pullDistance = 0;
let isPulling = false;
let wheelUpRefreshAccumulator = 0;
let lastWheelRefreshAt = 0;
let trackingHistory = [];
let selectedOrderVehicle = null;
let selectedSequoiaVersion = "sr5";
let selectedSequoiaColor = "lunar-rock";
let selectedSequoiaImageIndex = 0;
let selectedSequoiaInteriorColor = "tela-color-black";
let selectedSequoiaInteriorImageIndex = 0;
let selectedSequoiaDeliveryCity = "barranquilla";
let isSequoiaOrderDetailsExpanded = false;
let sequoiaTouchLastX = 0;
let sequoiaTouchAccumulator = 0;
let isSequoiaTouchDragging = false;
let sequoiaWheelAccumulator = 0;
let sequoiaInteriorTouchLastX = 0;
let sequoiaInteriorTouchAccumulator = 0;
let isSequoiaInteriorTouchDragging = false;
let sequoiaInteriorWheelAccumulator = 0;
let sequoiaVisionHintTimeout = null;
let virtualDealershipModalImages = [];
let virtualDealershipModalImageIndex = 0;
let editingMaintenanceVehicleId = "";
let virtualDealershipVideoContext = {
  vehicleTitle: "",
  publicationUrl: "",
  selectedDate: "",
  selectedTime: "",
};

const SEQUOIA_SPIN_STEP_PX = 26;
const SEQUOIA_TOUCH_SPIN_STEP_PX = 14;

const ORDER_ACTION_TEMPLATES = [
  { key: "demo", title: "Agenda un Demo Drive.", image: "/runer.jpeg", button: "Explora" },
  { key: "finance", title: "Opciones de financiamiento", image: "/sequ.jpg", button: "Explora" },
  { key: "design", title: "Diseña tu {vehicle}", image: "/sequ.jpg", button: "Explora" },
];

const ORDER_ACTION_IMAGES_BY_VEHICLE = {
  sequoia: {
    demo: "/sequ.jpg",
    finance: "/sequ2.jpg",
    design: "/sequ3.jpg",
  },
};

const GLOBAL_WHATSAPP_NUMBER = "3016698126";
const GLOBAL_WHATSAPP_FALLBACK_DELAY_MS = 900;
const SEQUOIA_ORDER_RESERVATION_AMOUNT = 1000000;
const SEQUOIA_DELIVERY_OPTIONS = {
  barranquilla: { label: "Barranquilla", fee: 0 },
  bogota: { label: "Bogota", fee: 3500000 },
  medellin: { label: "Medellin", fee: 3500000 },
  bucaramanga: { label: "Bucaramanga", fee: 3500000 },
  cali: { label: "Cali", fee: 5000000 },
};

const DEFAULT_SEQUOIA_VERSION_ORDER = ["sr5", "limited", "platinum", "trd-pro", "capstone", "1794"];
const SEQUOIA_CATALOG_URL = "/sequoia-catalog.json";
const CLIENT_IMAGE_CONFIG_URL = "/client-image-config.json";
const EMPTY_SEQUOIA_CATALOG = Object.freeze({
  versionConfig: {},
  versionOrder: DEFAULT_SEQUOIA_VERSION_ORDER,
  interiorConfig: {},
});
const DEFAULT_CLIENT_IMAGE_DELIVERY_CONFIG = Object.freeze({
  strategy: "origin",
  cloudName: "",
  deliveryBaseUrl: "",
});

let sequoiaCatalog = EMPTY_SEQUOIA_CATALOG;
let sequoiaCatalogPromise = null;
let clientImageDeliveryConfig = DEFAULT_CLIENT_IMAGE_DELIVERY_CONFIG;
let clientImageDeliveryConfigPromise = null;

function normalizeClientAssetPath(assetPath = "") {
  const normalizedValue = String(assetPath || "").trim();

  if (!normalizedValue) {
    return "";
  }

  if (/^(?:https?:)?\/\//i.test(normalizedValue)) {
    return normalizedValue;
  }

  return normalizedValue.startsWith("/") ? normalizedValue : "/" + normalizedValue;
}

function resolveOriginClientAssetUrl(assetPath = "") {
  const normalizedPath = normalizeClientAssetPath(assetPath);

  if (!normalizedPath) {
    return "";
  }

  if (/^(?:https?:)?\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  return new URL(normalizedPath, window.location.origin).toString();
}

function resolveCdnBaseAssetUrl(assetPath = "") {
  const normalizedPath = normalizeClientAssetPath(assetPath);
  const baseUrl = String(clientImageDeliveryConfig.deliveryBaseUrl || "").trim().replace(/\/$/, "");

  if (!normalizedPath) {
    return "";
  }

  if (!baseUrl) {
    return resolveOriginClientAssetUrl(normalizedPath);
  }

  return baseUrl + normalizedPath;
}

function resolveCloudinaryFetchUrl(assetPath = "") {
  const cloudName = String(clientImageDeliveryConfig.cloudName || "").trim();
  const originAssetUrl = resolveOriginClientAssetUrl(assetPath);

  if (!cloudName || !originAssetUrl) {
    return originAssetUrl;
  }

  return "https://res.cloudinary.com/" + cloudName + "/image/fetch/f_auto,q_auto,dpr_auto/" + encodeURIComponent(originAssetUrl);
}

function resolveClientAssetUrl(assetPath = "") {
  const normalizedPath = normalizeClientAssetPath(assetPath);

  if (!normalizedPath) {
    return "";
  }

  if (/^(?:https?:)?\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  switch (String(clientImageDeliveryConfig.strategy || "origin").trim().toLowerCase()) {
    case "cloudinary-fetch":
      return resolveCloudinaryFetchUrl(normalizedPath);
    case "cdn-base":
      return resolveCdnBaseAssetUrl(normalizedPath);
    default:
      return normalizedPath;
  }
}

function mapSequoiaImageCollection(colors = []) {
  if (!Array.isArray(colors)) {
    return [];
  }

  return colors.map((color) => ({
    ...color,
    images: Array.isArray(color?.images) ? color.images.map((imagePath) => resolveClientAssetUrl(imagePath)) : [],
  }));
}

function normalizeSequoiaCatalog(rawCatalog = {}) {
  const rawVersionConfig = rawCatalog?.versionConfig && typeof rawCatalog.versionConfig === "object"
    ? rawCatalog.versionConfig
    : {};
  const rawInteriorConfig = rawCatalog?.interiorConfig && typeof rawCatalog.interiorConfig === "object"
    ? rawCatalog.interiorConfig
    : {};

  const versionConfig = Object.fromEntries(
    Object.entries(rawVersionConfig).map(([versionKey, versionValue]) => [
      versionKey,
      {
        ...versionValue,
        colors: mapSequoiaImageCollection(versionValue?.colors || []),
      },
    ])
  );

  const interiorConfig = Object.fromEntries(
    Object.entries(rawInteriorConfig).map(([versionKey, versionValue]) => [
      versionKey,
      {
        ...versionValue,
        colors: mapSequoiaImageCollection(versionValue?.colors || []),
      },
    ])
  );

  return {
    versionConfig,
    versionOrder: Array.isArray(rawCatalog?.versionOrder) && rawCatalog.versionOrder.length
      ? rawCatalog.versionOrder
      : DEFAULT_SEQUOIA_VERSION_ORDER,
    interiorConfig,
  };
}

function hasSequoiaCatalogLoaded() {
  return Boolean(Object.keys(sequoiaCatalog?.versionConfig || {}).length);
}

async function loadClientImageDeliveryConfig() {
  if (clientImageDeliveryConfigPromise) {
    return clientImageDeliveryConfigPromise;
  }

  clientImageDeliveryConfigPromise = fetch(CLIENT_IMAGE_CONFIG_URL, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error("No se pudo cargar la configuracion de imagenes del cliente.");
      }

      const parsedConfig = await response.json();
      clientImageDeliveryConfig = {
        ...DEFAULT_CLIENT_IMAGE_DELIVERY_CONFIG,
        ...(parsedConfig || {}),
      };
      return clientImageDeliveryConfig;
    })
    .catch(() => {
      clientImageDeliveryConfig = DEFAULT_CLIENT_IMAGE_DELIVERY_CONFIG;
      return clientImageDeliveryConfig;
    });

  return clientImageDeliveryConfigPromise;
}

async function loadSequoiaCatalog() {
  if (hasSequoiaCatalogLoaded()) {
    return sequoiaCatalog;
  }

  if (sequoiaCatalogPromise) {
    return sequoiaCatalogPromise;
  }

  sequoiaCatalogPromise = (async () => {
    await loadClientImageDeliveryConfig();

    const response = await fetch(SEQUOIA_CATALOG_URL, { cache: "force-cache" });

    if (!response.ok) {
      throw new Error("No se pudo cargar el catalogo Sequoia.");
    }

    const rawCatalog = await response.json();
    sequoiaCatalog = normalizeSequoiaCatalog(rawCatalog);
    return sequoiaCatalog;
  })().catch((error) => {
    sequoiaCatalogPromise = null;
    throw error;
  });

  return sequoiaCatalogPromise;
}

function getSequoiaCatalog() {
  return sequoiaCatalog || EMPTY_SEQUOIA_CATALOG;
}

function setSequoiaConfiguratorLoadingState(message = "") {
  if (sequoiaConfigPrice) {
    sequoiaConfigPrice.textContent = message || "";
  }

  if (sequoiaConfigSpecs) {
    sequoiaConfigSpecs.innerHTML = message
      ? '<article class="sequoia-spec-card"><strong>Cargando</strong><span>' + escapeHtml(message) + '</span></article>'
      : "";
  }
}

async function ensureSequoiaConfiguratorReady() {
  if (hasSequoiaCatalogLoaded()) {
    renderSequoiaConfigurator();
    return sequoiaCatalog;
  }

  setSequoiaConfiguratorLoadingState("Cargando configurador...");

  const catalog = await loadSequoiaCatalog();
  const resolvedVersionConfig = catalog.versionConfig || {};
  const fallbackVersionKey = catalog.versionOrder?.[0] || DEFAULT_SEQUOIA_VERSION_ORDER[0];

  if (!resolvedVersionConfig[selectedSequoiaVersion]) {
    selectedSequoiaVersion = fallbackVersionKey;
  }

  const activeVersionConfig = resolvedVersionConfig[selectedSequoiaVersion] || resolvedVersionConfig[fallbackVersionKey] || { colors: [] };
  selectedSequoiaColor = activeVersionConfig.colors?.[0]?.key || selectedSequoiaColor;
  selectedSequoiaInteriorColor = (catalog.interiorConfig?.[selectedSequoiaVersion]?.colors || [])[0]?.key || selectedSequoiaInteriorColor;
  renderSequoiaConfigurator();
  return catalog;
}

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

async function registerNativePushToken(pushInfo) {
  if (!pushInfo?.token || state.registeredPushToken === pushInfo.token) {
    return;
  }

  await fetchJson("/api/client/push-devices", {
    method: "POST",
    body: JSON.stringify({
      token: pushInfo.token,
      platform: pushInfo.platform || "ios",
      provider: pushInfo.provider || "apns",
      appVersion: pushInfo.appVersion || "ios-webview",
      bundleId: pushInfo.bundleId || "",
    }),
  });

  state.registeredPushToken = pushInfo.token;
}

function syncNativePushToken() {
  const nativePushInfo = window.__globalImportsNativePush;

  if (!nativePushInfo?.token) {
    return;
  }

  registerNativePushToken(nativePushInfo).catch((error) => {
    console.warn("[push][client-portal] No se pudo registrar el token nativo.", error);
  });
}

function setFeedback(element, message, type = "") {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `feedback${type ? ` ${type}` : ""}`;
}

function getTrackingHistoryStorageKey() {
  const userIdentifier =
    state.user?.id
    || state.user?._id
    || state.user?.email
    || state.user?.name
    || "guest";

  return `globalAppTrackingHistory:${String(userIdentifier).toLowerCase()}`;
}

function loadTrackingHistory() {
  try {
    const storedValue = localStorage.getItem(getTrackingHistoryStorageKey());

    if (!storedValue) {
      trackingHistory = [];
      return;
    }

    const parsedValue = JSON.parse(storedValue);
    trackingHistory = Array.isArray(parsedValue)
      ? parsedValue
        .map((item) => ({
          trackingNumber: String(item?.trackingNumber || "").toUpperCase().trim(),
          vehicleLabel: String(item?.vehicleLabel || ""),
          searchedAt: String(item?.searchedAt || ""),
        }))
        .filter((item) => item.trackingNumber)
        .slice(0, TRACKING_HISTORY_MAX_ITEMS)
      : [];
  } catch (error) {
    trackingHistory = [];
  }
}

function persistTrackingHistory() {
  try {
    localStorage.setItem(getTrackingHistoryStorageKey(), JSON.stringify(trackingHistory));
  } catch (error) {
    // Ignore storage write failures to keep tracking search available.
  }
}

function renderTrackingHistory() {
  if (!trackingOrdersList) {
    return;
  }

  if (!trackingHistory.length) {
    trackingOrdersList.innerHTML = '<p class="tracking-orders-empty">Aún no has buscado pedidos. Tus búsquedas aparecerán aquí.</p>';

    if (trackingOrdersClearButton) {
      trackingOrdersClearButton.hidden = true;
    }

    return;
  }

  if (trackingOrdersClearButton) {
    trackingOrdersClearButton.hidden = false;
  }

  trackingOrdersList.innerHTML = trackingHistory
    .map(
      (item) => `
        <button type="button" class="tracking-orders-item" data-tracking-history="${escapeHtml(item.trackingNumber)}">
          <strong>Guía ${escapeHtml(item.trackingNumber)}</strong>
          <span>${escapeHtml(item.vehicleLabel || "Pedido guardado")}</span>
          <span>Buscado el ${escapeHtml(formatDate(item.searchedAt))}</span>
        </button>
      `
    )
    .join("");
}

function setTrackingActiveTab(tabName) {
  const isSearchTab = tabName === "search";

  if (trackingSearchPanel) {
    trackingSearchPanel.hidden = !isSearchTab;
  }

  if (trackingOrdersPanel) {
    trackingOrdersPanel.hidden = isSearchTab;
  }

  if (trackingTabSearchButton) {
    trackingTabSearchButton.classList.toggle("is-active", isSearchTab);
    trackingTabSearchButton.setAttribute("aria-selected", String(isSearchTab));
  }

  if (trackingTabOrdersButton) {
    trackingTabOrdersButton.classList.toggle("is-active", !isSearchTab);
    trackingTabOrdersButton.setAttribute("aria-selected", String(!isSearchTab));
  }
}

function rememberTrackingSearch(trackingNumber) {
  const normalizedTrackingNumber = String(trackingNumber || "").toUpperCase().trim();

  if (!normalizedTrackingNumber) {
    return;
  }

  const matchedOrder = state.orders.find(
    (order) => String(order?.trackingNumber || "").toUpperCase().trim() === normalizedTrackingNumber
  );
  const vehicleLabel = [matchedOrder?.vehicle?.brand, matchedOrder?.vehicle?.model, matchedOrder?.vehicle?.version]
    .filter(Boolean)
    .join(" ");

  trackingHistory = [
    {
      trackingNumber: normalizedTrackingNumber,
      vehicleLabel,
      searchedAt: new Date().toISOString(),
    },
    ...trackingHistory.filter((item) => item.trackingNumber !== normalizedTrackingNumber),
  ].slice(0, TRACKING_HISTORY_MAX_ITEMS);

  persistTrackingHistory();
  renderTrackingHistory();
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

function syncNativeAppBadge(count) {
  const normalizedCount = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;

  if (window.webkit?.messageHandlers?.globalImportsBadge) {
    window.webkit.messageHandlers.globalImportsBadge.postMessage({ count: normalizedCount });
  }

  if (typeof navigator.setAppBadge === "function") {
    navigator.setAppBadge(normalizedCount).catch(() => null);
  }

  if (normalizedCount === 0 && typeof navigator.clearAppBadge === "function") {
    navigator.clearAppBadge().catch(() => null);
  }
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

function buildEmbeddedVideoUrl(rawUrl) {
  const url = String(rawUrl || "").trim();

  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();

    if (host.includes("youtu.be") || host.includes("youtube.com")) {
      let videoId = "";

      if (host.includes("youtu.be")) {
        videoId = parsedUrl.pathname.split("/").filter(Boolean)[0] || "";
      } else {
        videoId = parsedUrl.searchParams.get("v") || "";
      }

      if (!videoId) {
        return "";
      }

      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&controls=1&playsinline=1&rel=0&modestbranding=1`;
    }

    if (host.includes("vimeo.com")) {
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      const videoId = segments[segments.length - 1] || "";

      if (!videoId) {
        return "";
      }

      return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?autoplay=1&muted=1&controls=1&title=0&byline=0&portrait=0`;
    }
  } catch {
    return "";
  }

  return "";
}

function renderFeedVideoMedia(url) {
  const embeddedUrl = buildEmbeddedVideoUrl(url);

  if (embeddedUrl) {
    return `
      <div class="feed-media-card video">
        <iframe
          src="${escapeHtml(embeddedUrl)}"
          title="Video"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
    `;
  }

  return `
    <div class="feed-media-card video">
      <video controls autoplay muted playsinline preload="metadata" controlsList="nodownload noplaybackrate" src="${escapeHtml(url)}"></video>
    </div>
  `;
}

function renderEmptyState(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function updateSummary() {
  if (state.user) {
    document.getElementById("client-greeting").textContent = `Hola, ${state.user.name}`;
    const requestName = document.getElementById("request-name");
    const requestEmail = document.getElementById("request-email");

    if (requestName) {
      requestName.value = state.user.name || "";
    }

    if (requestEmail) {
      requestEmail.value = state.user.email || "";
    }
  }
}

function renderFeed() {
  if (!state.feedPosts.length && !state.isFetchingFeed) {
    renderEmptyState(feedContainer, "Todavía no hay publicaciones activas para tu feed.");
    feedLoadingState.textContent = "";
    return;
  }

  feedContainer.innerHTML = state.feedPosts
    .map((post, index) => {
      const mediaMarkup = (post.media || [])
        .map((item) => {
          if (item.type === "video") {
            return renderFeedVideoMedia(item.url);
          }

          return `
            <div class="feed-media-card">
              <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || post.title)}" loading="lazy" />
            </div>
          `;
        })
        .join("");
      const carouselDotsMarkup = post.media?.length > 1
        ? `
            <div class="feed-carousel-indicators" data-feed-carousel-indicators>
              ${post.media
                .map(
                  (_, mediaIndex) => `
                    <button
                      class="feed-carousel-dot ${mediaIndex === 0 ? "is-active" : ""}"
                      type="button"
                      data-feed-carousel-dot
                      data-feed-carousel-index="${mediaIndex}"
                      aria-label="Ir a la imagen ${mediaIndex + 1}"
                    ></button>
                  `
                )
                .join("")}
            </div>
          `
        : "";

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
      const postKey = escapeHtml(post._id || `feed-post-${index}`);

      return `
        <article class="feed-card" data-feed-post-id="${postKey}">
          <div class="feed-author-row">
            <div class="feed-author-meta">
              <div class="feed-author-avatar">
                <img src="/logoblancoleon.png" alt="Logo Global Imports" loading="lazy" />
              </div>
              <div>
                <strong>${authorName}</strong>
                <p>${escapeHtml(relativeDate)} · ${escapeHtml(relativeTime)}</p>
              </div>
            </div>
          </div>
          ${mediaMarkup ? `
            <div class="feed-media-shell">
              <div class="feed-media-strip ${post.media?.length > 1 ? "is-carousel" : ""}" ${post.media?.length > 1 ? 'data-feed-carousel' : ""}>${mediaMarkup}</div>
              ${carouselDotsMarkup}
            </div>
          ` : ""}
          <div class="feed-story-copy">
            <h3>${escapeHtml(post.title)}</h3>
            <div class="feed-card-copy-shell">
              <p class="feed-card-copy is-collapsed" data-feed-copy>${escapeHtml(post.body)}</p>
              <button class="feed-card-toggle" type="button" data-feed-toggle hidden>
                <span class="feed-card-toggle-prefix">...</span>
                <span class="feed-card-toggle-label">ver más</span>
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  syncFeedCopyClamp();
  bindFeedCarousels();

  if (state.isFetchingFeed && state.feedPosts.length) {
    feedLoadingState.textContent = "Cargando más publicaciones...";
  } else if (!state.feedHasMore && state.feedPosts.length) {
    feedLoadingState.textContent = "Ya viste las publicaciones disponibles.";
  } else {
    feedLoadingState.textContent = "";
  }
}

function updateCarouselDots(carouselElement) {
  const shell = carouselElement.closest(".feed-media-shell");
  const dots = Array.from(shell?.querySelectorAll("[data-feed-carousel-dot]") || []);

  if (!dots.length) {
    return;
  }

  const activeIndex = Math.round(carouselElement.scrollLeft / Math.max(carouselElement.clientWidth, 1));

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === activeIndex);
  });
}

function bindFeedCarousels() {
  feedContainer.querySelectorAll("[data-feed-carousel]").forEach((carouselElement) => {
    if (carouselElement.dataset.carouselBound === "true") {
      updateCarouselDots(carouselElement);
      return;
    }

    carouselElement.dataset.carouselBound = "true";
    updateCarouselDots(carouselElement);

    carouselElement.addEventListener("scroll", () => {
      updateCarouselDots(carouselElement);
    }, { passive: true });
  });
}

function syncFeedCopyClamp() {
  feedContainer.querySelectorAll("[data-feed-copy]").forEach((copyElement) => {
    const toggleButton = copyElement.parentElement?.querySelector("[data-feed-toggle]");

    if (!toggleButton) {
      return;
    }

    copyElement.classList.remove("is-expanded");
    copyElement.classList.add("is-collapsed");
    toggleButton.classList.remove("is-expanded");
    toggleButton.querySelector(".feed-card-toggle-label").textContent = "ver más";

    const hasOverflow = copyElement.scrollHeight > copyElement.clientHeight + 2;
    toggleButton.hidden = !hasOverflow;
  });
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

  let requestFailed = false;
  let requestErrorMessage = "";

  try {
    const data = await fetchJson(`/api/client/posts?offset=${state.feedOffset}&limit=${FEED_PAGE_SIZE}`);
    const nextPosts = data.posts || [];

    state.feedPosts = reset ? nextPosts : state.feedPosts.concat(nextPosts);
    state.feedOffset = data.pagination?.nextOffset || state.feedPosts.length;
    state.feedHasMore = Boolean(data.pagination?.hasMore);
  } catch (error) {
    requestFailed = true;
    requestErrorMessage = error?.message || "No se pudieron cargar más publicaciones.";
    throw error;
  } finally {
    state.isFetchingFeed = false;

    if (state.isRefreshingFeed) {
      state.isRefreshingFeed = false;
      pullDistance = 0;
      updateRefreshIndicator();
    }

    renderFeed();

    if (requestFailed && state.feedPosts.length) {
      feedLoadingState.textContent = requestErrorMessage;
    } else if (state.feedPosts.length && state.feedHasMore) {
      feedLoadingState.textContent = "Desliza hacia abajo para ver más publicaciones.";
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

function handleWheelRefresh(event) {
  if (state.activeView !== "home" || state.isRefreshingFeed || state.isFetchingFeed) {
    wheelUpRefreshAccumulator = 0;
    return;
  }

  if (window.scrollY > 2) {
    wheelUpRefreshAccumulator = 0;
    return;
  }

  const deltaY = Number(event.deltaY || 0);

  if (deltaY >= 0) {
    wheelUpRefreshAccumulator = 0;
    return;
  }

  // Track continuous upward wheel motion at the top to trigger a feed refresh.
  wheelUpRefreshAccumulator += Math.abs(deltaY);

  if (wheelUpRefreshAccumulator < 120) {
    return;
  }

  const now = Date.now();

  if (now - lastWheelRefreshAt < 1200) {
    return;
  }

  wheelUpRefreshAccumulator = 0;
  lastWheelRefreshAt = now;

  refreshFeed().catch((error) => {
    state.isRefreshingFeed = false;
    pullDistance = 0;
    updateRefreshIndicator();
    feedLoadingState.textContent = error.message;
  });
}

function setupInfiniteScroll() {
  if (!feedLoadMoreSentinel) {
    return;
  }

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

function setupVirtualDealershipInfiniteScroll() {
  if (!virtualDealershipLoadMoreSentinel) {
    return;
  }

  if (virtualDealershipObserver) {
    virtualDealershipObserver.disconnect();
  }

  virtualDealershipObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || state.activeView !== "virtual-dealership") {
          return;
        }

        if (state.virtualDealershipVisibleCount >= state.virtualDealershipVehicles.length) {
          return;
        }

        state.virtualDealershipVisibleCount = Math.min(
          state.virtualDealershipVisibleCount + VIRTUAL_DEALERSHIP_BATCH_SIZE,
          state.virtualDealershipVehicles.length
        );
        renderVirtualDealership();
      });
    },
    {
      root: null,
      rootMargin: "0px 0px 260px 0px",
      threshold: 0.01,
    }
  );

  virtualDealershipObserver.observe(virtualDealershipLoadMoreSentinel);
}

feedContainer.addEventListener("click", (event) => {
  const carouselDot = event.target.closest("[data-feed-carousel-dot]");

  if (carouselDot) {
    const carouselShell = carouselDot.closest(".feed-media-shell");
    const carouselElement = carouselShell?.querySelector("[data-feed-carousel]");
    const targetIndex = Number(carouselDot.dataset.feedCarouselIndex || 0);

    if (carouselElement) {
      carouselElement.scrollTo({
        left: carouselElement.clientWidth * targetIndex,
        behavior: "smooth",
      });
    }

    return;
  }

  const toggleButton = event.target.closest("[data-feed-toggle]");

  if (!toggleButton) {
    return;
  }

  const copyElement = toggleButton.parentElement?.querySelector("[data-feed-copy]");

  if (!copyElement) {
    return;
  }

  const willExpand = !copyElement.classList.contains("is-expanded");
  copyElement.classList.toggle("is-expanded", willExpand);
  copyElement.classList.toggle("is-collapsed", !willExpand);
  toggleButton.classList.toggle("is-expanded", willExpand);
  toggleButton.querySelector(".feed-card-toggle-label").textContent = willExpand ? "ver menos" : "ver más";
});

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

function formatCopCurrency(amount) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));
}

function addDays(date, days) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function formatDateRange(startDate, endDate) {
  const formatter = new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

function resolveMaintenanceVehicleKey(vehicle, index) {
  return String(vehicle?._id || vehicle?.id || `maintenance-vehicle-${index}`);
}

function setMaintenanceVehicleModalMode(mode) {
  if (maintenanceVehicleTitle) {
    maintenanceVehicleTitle.textContent = mode === "edit" ? "Edita tu vehículo" : "Agrega tu vehículo";
  }

  if (maintenanceVehicleSubmitButton) {
    maintenanceVehicleSubmitButton.textContent = mode === "edit" ? "Guardar cambios" : "Guardar";
  }
}

function setMaintenanceVehicleFormValues(vehicle) {
  if (!maintenanceVehicleForm || !vehicle) {
    return;
  }

  maintenanceVehicleForm.elements.brand.value = vehicle.brand || "";
  maintenanceVehicleForm.elements.model.value = vehicle.model || "";
  maintenanceVehicleForm.elements.version.value = vehicle.version || "";
  maintenanceVehicleForm.elements.year.value = vehicle.year || "";
  maintenanceVehicleForm.elements.currentMileage.value = vehicle.currentMileage || "";
  maintenanceVehicleForm.elements.plate.value = vehicle.plate || "";
  maintenanceVehicleForm.elements.usualDailyKm.value = vehicle.usualDailyKm || "";
  maintenanceVehicleForm.elements.drivingCity.value = vehicle.drivingCity || "";

  if (vehicle.lastPreventiveMaintenanceDate) {
    const dateValue = new Date(vehicle.lastPreventiveMaintenanceDate);
    if (!Number.isNaN(dateValue.getTime())) {
      maintenanceVehicleForm.elements.lastPreventiveMaintenanceDate.value = dateValue.toISOString().slice(0, 10);
    }
  }
}

function openMaintenanceVehicleModal(vehicle = null) {
  if (!maintenanceVehicleModal) {
    return;
  }

  if (maintenanceVehicleForm) {
    maintenanceVehicleForm.reset();
  }

  if (vehicle && (vehicle._id || vehicle.id)) {
    editingMaintenanceVehicleId = String(vehicle._id || vehicle.id);
    setMaintenanceVehicleModalMode("edit");
    setMaintenanceVehicleFormValues(vehicle);
  } else {
    editingMaintenanceVehicleId = "";
    setMaintenanceVehicleModalMode("create");
  }

  maintenanceVehicleModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeMaintenanceVehicleModal() {
  if (!maintenanceVehicleModal) {
    return;
  }

  editingMaintenanceVehicleId = "";
  if (maintenanceVehicleForm) {
    maintenanceVehicleForm.reset();
  }
  setMaintenanceVehicleModalMode("create");

  maintenanceVehicleModal.hidden = true;
  const shouldKeepModalOpen = (notificationsModal && !notificationsModal.hidden)
    || (virtualDealershipImageModal && !virtualDealershipImageModal.hidden)
    || (virtualDealershipVideoModal && !virtualDealershipVideoModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(shouldKeepModalOpen));
}

function resolveVirtualVehicleKey(vehicle, index) {
  return String(vehicle?._id || vehicle?.id || `virtual-vehicle-${index}`);
}

function renderVirtualDealershipImageModal(animated = false) {
  if (!virtualDealershipImageTrack) {
    return;
  }

  const safeIndex = Math.min(
    Math.max(virtualDealershipModalImageIndex, 0),
    Math.max(virtualDealershipModalImages.length - 1, 0)
  );
  const currentImage = virtualDealershipModalImages[safeIndex] || null;

  if (!currentImage) {
    virtualDealershipImageTrack.innerHTML = "";
    if (virtualDealershipImageDots) {
      virtualDealershipImageDots.innerHTML = "";
    }
    return;
  }

  virtualDealershipModalImageIndex = safeIndex;

  const existingSlides = virtualDealershipImageTrack.querySelectorAll(".virtual-dealership-image-slide");
  if (existingSlides.length !== virtualDealershipModalImages.length) {
    virtualDealershipImageTrack.innerHTML = virtualDealershipModalImages
      .map(
        (image) => `
          <div class="virtual-dealership-image-slide">
            <img src="${escapeHtml(image.url || "")}" alt="${escapeHtml(image.alt || "Imagen del vehículo")}" loading="eager" />
          </div>
        `
      )
      .join("");
    animated = false;
  }

  if (!animated) {
    virtualDealershipImageTrack.classList.add("no-transition");
    virtualDealershipImageTrack.style.transform = `translateX(-${safeIndex * 100}%)`;
    void virtualDealershipImageTrack.offsetWidth;
    virtualDealershipImageTrack.classList.remove("no-transition");
  } else {
    virtualDealershipImageTrack.style.transform = `translateX(-${safeIndex * 100}%)`;
  }

  if (virtualDealershipImageDots) {
    const existingDots = virtualDealershipImageDots.querySelectorAll(".virtual-dealership-image-dot");
    if (existingDots.length === virtualDealershipModalImages.length) {
      existingDots.forEach((dot, i) => dot.classList.toggle("is-active", i === safeIndex));
    } else {
      virtualDealershipImageDots.innerHTML = virtualDealershipModalImages
        .map((_, index) => `<button type="button" class="virtual-dealership-image-dot ${index === safeIndex ? "is-active" : ""}" data-virtual-modal-dot-index="${index}" aria-label="Ver imagen ${index + 1}"></button>`)
        .join("");
    }
  }

  const hasMultipleImages = virtualDealershipModalImages.length > 1;

  if (virtualDealershipImagePrev) {
    virtualDealershipImagePrev.hidden = !hasMultipleImages;
  }

  if (virtualDealershipImageNext) {
    virtualDealershipImageNext.hidden = !hasMultipleImages;
  }
}

function stepVirtualDealershipImageModal(direction) {
  if (virtualDealershipModalImages.length <= 1) {
    return;
  }

  const nextIndex = (virtualDealershipModalImageIndex + direction + virtualDealershipModalImages.length)
    % virtualDealershipModalImages.length;
  virtualDealershipModalImageIndex = nextIndex;
  renderVirtualDealershipImageModal(true);
}

function openVirtualDealershipImageModal(vehicleKey, startIndex = 0) {
  if (!virtualDealershipImageModal || !virtualDealershipImageTrack || !vehicleKey) {
    return;
  }

  const matchedVehicle = (state.virtualDealershipVehicles || []).find(
    (vehicle, index) => resolveVirtualVehicleKey(vehicle, index) === String(vehicleKey)
  );

  const images = Array.isArray(matchedVehicle?.images)
    ? matchedVehicle.images.filter((item) => item && item.url)
    : [];

  if (!images.length) {
    return;
  }

  virtualDealershipModalImages = images.map((item, index) => ({
    url: String(item.url || ""),
    alt: String(item.caption || `${matchedVehicle?.brand || "Vehículo"} ${matchedVehicle?.model || ""} foto ${index + 1}`).trim(),
  }));
  virtualDealershipModalImageIndex = Math.min(Math.max(Number(startIndex) || 0, 0), virtualDealershipModalImages.length - 1);
  virtualDealershipImageTrack.innerHTML = "";

  renderVirtualDealershipImageModal(false);
  virtualDealershipImageModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeVirtualDealershipImageModal() {
  if (!virtualDealershipImageModal) {
    return;
  }

  virtualDealershipImageModal.hidden = true;

  if (virtualDealershipImageTrack) {
    virtualDealershipImageTrack.innerHTML = "";
  }

  virtualDealershipModalImages = [];
  virtualDealershipModalImageIndex = 0;

  if (virtualDealershipImageDots) {
    virtualDealershipImageDots.innerHTML = "";
  }

  const shouldKeepModalOpen = (notificationsModal && !notificationsModal.hidden)
    || (maintenanceVehicleModal && !maintenanceVehicleModal.hidden)
    || (virtualDealershipVideoModal && !virtualDealershipVideoModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(shouldKeepModalOpen));
}

function formatVideoSlotLabel(hours, minutes) {
  const suffix = hours >= 12 ? "p. m." : "a. m.";
  const normalizedHour = hours % 12 || 12;
  const normalizedMinutes = String(minutes).padStart(2, "0");
  return `${normalizedHour}:${normalizedMinutes} ${suffix}`;
}

function getTodayInLocalDateInputFormat() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInputValue(dateValue) {
  const value = String(dateValue || "").trim();

  if (!value) {
    return null;
  }

  const parts = value.split("-").map((part) => Number(part));

  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [year, month, day] = parts;
  return new Date(year, month - 1, day);
}

function isWeekday(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return false;
  }

  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function getVideoSlotsForDate(dateValue) {
  const selectedDate = parseDateInputValue(dateValue);

  if (!selectedDate || !isWeekday(selectedDate)) {
    return [];
  }

  const now = new Date();
  const isToday = selectedDate.toDateString() === now.toDateString();
  const slots = [];

  for (let hour = 9; hour <= 15; hour += 1) {
    for (let minute = 0; minute < 60; minute += 15) {
      const slotDate = new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        hour,
        minute,
        0,
        0
      );

      if (isToday && slotDate.getTime() <= now.getTime()) {
        continue;
      }

      const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
      slots.push({
        value,
        label: formatVideoSlotLabel(hour, minute),
      });
    }
  }

  return slots;
}

function setVirtualDealershipVideoFeedback(message, type = "") {
  if (!virtualDealershipVideoFeedback) {
    return;
  }

  virtualDealershipVideoFeedback.textContent = message || "";
  virtualDealershipVideoFeedback.classList.remove("is-error", "is-success");

  if (type === "error") {
    virtualDealershipVideoFeedback.classList.add("is-error");
  }

  if (type === "success") {
    virtualDealershipVideoFeedback.classList.add("is-success");
  }
}

function renderVirtualDealershipVideoSlots() {
  if (!virtualDealershipVideoSlots) {
    return;
  }

  const slots = getVideoSlotsForDate(virtualDealershipVideoContext.selectedDate);

  if (!virtualDealershipVideoContext.selectedDate) {
    virtualDealershipVideoSlots.innerHTML = '<option value="" disabled selected>Primero selecciona una fecha</option>';
    return;
  }

  if (!slots.length) {
    virtualDealershipVideoContext.selectedTime = "";
    virtualDealershipVideoSlots.innerHTML = '<option value="" disabled selected>Sin horarios disponibles para esta fecha</option>';
    return;
  }

  const currentSelected = virtualDealershipVideoContext.selectedTime;
  const hasCurrentSelected = slots.some((slot) => slot.value === currentSelected);

  if (!hasCurrentSelected) {
    virtualDealershipVideoContext.selectedTime = "";
  }

  virtualDealershipVideoSlots.innerHTML =
    '<option value="" disabled' + (virtualDealershipVideoContext.selectedTime ? '' : ' selected') + '>Elige un horario</option>' +
    slots
      .map((slot) => `<option value="${slot.value}"${slot.value === virtualDealershipVideoContext.selectedTime ? ' selected' : ''}>${slot.label}</option>`)
      .join("");
}

function openVirtualDealershipVideoModal(vehicleTitle, publicationUrl) {
  if (!virtualDealershipVideoModal || !vehicleTitle || !publicationUrl) {
    return;
  }

  const today = getTodayInLocalDateInputFormat();
  virtualDealershipVideoContext.vehicleTitle = String(vehicleTitle);
  virtualDealershipVideoContext.publicationUrl = String(publicationUrl);
  virtualDealershipVideoContext.selectedDate = today;
  virtualDealershipVideoContext.selectedTime = "";

  if (virtualDealershipVideoDescription) {
    virtualDealershipVideoDescription.textContent = `Mira ${vehicleTitle} en vivo y en directo con la ayuda de nuestro equipo. Selecciona fecha y hora (lunes a viernes, 9:00 a. m. a 4:00 p. m.).`;
  }

  if (virtualDealershipVideoDate) {
    virtualDealershipVideoDate.min = today;
    virtualDealershipVideoDate.value = today;
  }

  setVirtualDealershipVideoFeedback("");
  renderVirtualDealershipVideoSlots();
  virtualDealershipVideoModal.hidden = false;
  document.body.classList.add("modal-open");
}

function closeVirtualDealershipVideoModal() {
  if (!virtualDealershipVideoModal) {
    return;
  }

  virtualDealershipVideoModal.hidden = true;
  virtualDealershipVideoContext.selectedTime = "";
  setVirtualDealershipVideoFeedback("");

  const shouldKeepModalOpen = (notificationsModal && !notificationsModal.hidden)
    || (maintenanceVehicleModal && !maintenanceVehicleModal.hidden)
    || (virtualDealershipImageModal && !virtualDealershipImageModal.hidden)
    || (deleteAccountModal && !deleteAccountModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(shouldKeepModalOpen));
}

function openDeleteAccountModal() {
  if (!deleteAccountModal) {
    return;
  }

  if (notificationsModal && !notificationsModal.hidden) {
    closeNotifications();
  }

  if (sessionMenu) {
    sessionMenu.hidden = true;
  }

  deleteAccountForm?.reset();
  setFeedback(deleteAccountFeedback, "");
  deleteAccountModal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => deleteAccountPasswordInput?.focus(), 60);
}

function closeDeleteAccountModal() {
  if (!deleteAccountModal) {
    return;
  }

  deleteAccountModal.hidden = true;
  const shouldKeepModalOpen = (notificationsModal && !notificationsModal.hidden)
    || (maintenanceVehicleModal && !maintenanceVehicleModal.hidden)
    || (virtualDealershipImageModal && !virtualDealershipImageModal.hidden)
    || (virtualDealershipVideoModal && !virtualDealershipVideoModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(shouldKeepModalOpen));
}

async function submitDeleteAccount() {
  const password = String(deleteAccountPasswordInput?.value || "");

  if (!password) {
    setFeedback(deleteAccountFeedback, "Escribe tu contraseña para confirmar.", "error");
    return;
  }

  if (deleteAccountConfirmButton) {
    deleteAccountConfirmButton.disabled = true;
  }

  setFeedback(deleteAccountFeedback, "Eliminando cuenta...");

  try {
    const response = await fetchJson("/api/auth/delete-account", {
      method: "POST",
      body: JSON.stringify({ password }),
    });

    await requestLogout();
    clearAuth();
    window.location.replace(buildDeletedAccountPageUrl(response.feedbackToken || ""));
  } catch (error) {
    setFeedback(deleteAccountFeedback, error.message, "error");
  } finally {
    if (deleteAccountConfirmButton) {
      deleteAccountConfirmButton.disabled = false;
    }
  }
}

function refreshMaintenanceButtonLabel() {
  if (!addMaintenanceVehicleButton) {
    return;
  }

  addMaintenanceVehicleButton.textContent = state.maintenanceVehicles.length
    ? "Agrega otro vehículo"
    : "Agrega tu vehículo";
}

function renderMaintenanceList() {
  const allItems = [];

  state.maintenanceVehicles.forEach((vehicle, index) => {
    allItems.push({
      source: "client-vehicle",
      vehicle,
      key: resolveMaintenanceVehicleKey(vehicle, index),
    });
  });

  state.maintenance.forEach((item) => {
    allItems.push({
      source: "order-maintenance",
      item,
    });
  });

  if (!allItems.length) {
    renderEmptyState(maintenanceList, "Todavía no tienes vehículos registrados en mantenimiento.");
    refreshMaintenanceButtonLabel();
    return;
  }

  maintenanceList.innerHTML = allItems
    .map((entry) => {
      if (entry.source === "client-vehicle") {
        const vehicle = entry.vehicle;
        const vehicleKey = entry.key;
        const detailsExpanded = state.maintenanceExpandedDetails.has(vehicleKey);
        const vehicleTitle = [vehicle.brand || "Vehículo", vehicle.model || "", vehicle.version || ""]
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        return `
          <article class="maintenance-card">
            <div class="maintenance-card-top maintenance-card-top-compact">
              <div>
                <strong>${escapeHtml(vehicleTitle || "Vehículo")}</strong>
                <p>Último mantenimiento realizado: ${escapeHtml(vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "Sin fecha")}</p>
                <button type="button" class="maintenance-details-link" data-maintenance-toggle-details="${escapeHtml(vehicleKey)}" aria-expanded="${detailsExpanded ? "true" : "false"}">Ver más detalles</button>
              </div>
              <div class="maintenance-card-actions-inline">
                <button type="button" class="maintenance-action-icon" data-maintenance-edit="${escapeHtml(vehicle._id || vehicle.id || "")}" aria-label="Editar vehículo">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm14.71-9.04a1.003 1.003 0 0 0 0-1.42l-2.5-2.5a1.003 1.003 0 0 0-1.42 0L11.13 6.95l3.75 3.75 2.83-2.49z"></path></svg>
                </button>
                <button type="button" class="maintenance-action-icon is-danger" data-maintenance-delete="${escapeHtml(vehicle._id || vehicle.id || "")}" aria-label="Eliminar vehículo">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"></path></svg>
                </button>
              </div>
            </div>
            <div class="maintenance-meta-grid ${detailsExpanded ? "is-open" : "is-collapsed"}">
              <div><span>Año</span><strong>${escapeHtml(vehicle.year || "N/A")}</strong></div>
              <div><span>Kilometraje actual</span><strong>${escapeHtml(vehicle.currentMileage || "0")}</strong></div>
              <div><span>Km diarios usuales</span><strong>${escapeHtml(vehicle.usualDailyKm || "N/A")}</strong></div>
              <div><span>Ubicación</span><strong>${escapeHtml(vehicle.drivingCity || "Sin ubicación")}</strong></div>
              <div><span>Placa</span><strong>${escapeHtml(vehicle.plate || "N/A")}</strong></div>
              <div><span>Creado</span><strong>${escapeHtml(vehicle.createdAt ? formatDate(vehicle.createdAt) : "Ahora")}</strong></div>
            </div>
            <p class="maintenance-note ${detailsExpanded ? "is-open" : "is-collapsed"}">Recibirás ofertas y cupones especiales para este vehículo.</p>
          </article>
        `;
      }

      const item = entry.item;

      return `
        <article class="maintenance-card">
          <div class="maintenance-card-top">
            <div>
              <strong>${escapeHtml(item.order?.vehicle?.brand || "Vehículo")} ${escapeHtml(item.order?.vehicle?.model || "")}</strong>
              <p>Guía ${escapeHtml(item.order?.trackingNumber || "Sin guía")}</p>
            </div>
            <span>${escapeHtml(item.status || "scheduled")}</span>
          </div>
          <div class="maintenance-meta-grid">
            <div><span>Próximo mantenimiento</span><strong>${escapeHtml(formatDate(item.dueDate))}</strong></div>
            <div><span>Kilometraje reportado</span><strong>${escapeHtml(item.reportedMileage || "Sin reporte")}</strong></div>
            <div><span>Último servicio</span><strong>${escapeHtml(item.lastServiceDate ? formatDate(item.lastServiceDate) : "Sin fecha")}</strong></div>
            <div><span>Última actualización</span><strong>${escapeHtml(item.lastClientUpdateAt ? formatDate(item.lastClientUpdateAt) : "Pendiente")}</strong></div>
          </div>
          <p class="maintenance-note">${escapeHtml(item.clientNotes || item.contactNotes || "Sin notas registradas.")}</p>
        </article>
      `;
    })
    .join("");

  refreshMaintenanceButtonLabel();
}

async function submitMaintenanceVehicleForm() {
  if (!maintenanceVehicleForm) {
    return;
  }

  const formData = new FormData(maintenanceVehicleForm);
  const usualDailyKm = Number(formData.get("usualDailyKm"));

  if (Number.isNaN(usualDailyKm) || usualDailyKm < 10 || usualDailyKm > 200) {
    throw new Error("Los kms diarios deben estar entre 10 y 200");
  }

  const isEditing = Boolean(editingMaintenanceVehicleId);
  setFeedback(maintenanceFeedback, isEditing ? "Actualizando vehículo..." : "Guardando vehículo...");

  await fetchJson(isEditing
    ? `/api/client/maintenance-vehicles/${encodeURIComponent(editingMaintenanceVehicleId)}`
    : "/api/client/maintenance-vehicles", {
    method: isEditing ? "PATCH" : "POST",
    body: JSON.stringify({
      brand: formData.get("brand"),
      model: formData.get("model"),
      version: formData.get("version"),
      year: formData.get("year"),
      currentMileage: formData.get("currentMileage"),
      usualDailyKm,
      drivingCity: formData.get("drivingCity"),
      plate: formData.get("plate"),
      lastPreventiveMaintenanceDate: formData.get("lastPreventiveMaintenanceDate"),
    }),
  });

  closeMaintenanceVehicleModal();
  setFeedback(maintenanceFeedback, isEditing ? "Vehículo actualizado correctamente." : "Vehículo guardado correctamente.", "success");
  await loadDashboard();
}

async function deleteMaintenanceVehicle(vehicleId) {
  const id = String(vehicleId || "").trim();

  if (!id) {
    return;
  }

  await fetchJson(`/api/client/maintenance-vehicles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  state.maintenanceExpandedDetails.delete(id);
  setFeedback(maintenanceFeedback, "Vehículo eliminado correctamente.", "success");
  await loadDashboard();
}

function getSelectedDeliveryOption() {
  return SEQUOIA_DELIVERY_OPTIONS[selectedSequoiaDeliveryCity] || SEQUOIA_DELIVERY_OPTIONS.barranquilla;
}

function getSequoiaOrderSummaryData() {
  const versionConfig = getActiveSequoiaConfig();
  const exteriorColor = getActiveSequoiaColor();
  const interiorColor = getActiveSequoiaInteriorColor();
  const deliveryOption = getSelectedDeliveryOption();
  const vehiclePrice = Number(versionConfig.price || 0);
  const deliveryFee = Number(deliveryOption.fee || 0);

  return {
    brand: "Toyota",
    model: "Sequoia",
    versionName: versionConfig.name,
    exteriorColorName: exteriorColor?.name || "No definido",
    interiorColorName: interiorColor?.name || "No definido",
    deliveryCityLabel: deliveryOption.label,
    vehiclePrice,
    deliveryFee,
    totalPrice: vehiclePrice + deliveryFee,
  };
}

function buildSequoiaWhatsappUrl(message) {
  const whatsappUrl = new URL("https://api.whatsapp.com/send");
  whatsappUrl.searchParams.set("phone", GLOBAL_WHATSAPP_NUMBER);

  if (message) {
    whatsappUrl.searchParams.set("text", message);
  }

  return whatsappUrl.toString();
}

function openExternalBrowserUrl(url, pendingWindow = null) {
  const resolvedUrl = String(url || "").trim();

  if (!resolvedUrl) {
    if (pendingWindow && !pendingWindow.closed) {
      pendingWindow.close();
    }
    return false;
  }

  const nativeExternalLinkHandler = window.webkit?.messageHandlers?.globalImportsExternalLink;

  if (nativeExternalLinkHandler?.postMessage) {
    try {
      if (pendingWindow && !pendingWindow.closed) {
        pendingWindow.close();
      }

      nativeExternalLinkHandler.postMessage({ url: resolvedUrl });
      return true;
    } catch (error) {
      console.warn("No se pudo abrir el enlace en el handler nativo.", error);
    }
  }

  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.opener = null;
    pendingWindow.location.replace(resolvedUrl);
    return true;
  }

  const openedWindow = window.open(resolvedUrl, "_blank", "noopener,noreferrer");

  if (openedWindow) {
    openedWindow.opener = null;
    return true;
  }

  const externalLink = document.createElement("a");
  externalLink.href = resolvedUrl;
  externalLink.target = "_blank";
  externalLink.rel = "noopener noreferrer external";
  (document.body || document.documentElement).appendChild(externalLink);
  externalLink.click();
  externalLink.remove();

  if (document.visibilityState === "visible") {
    window.location.assign(resolvedUrl);
  }

  return true;
}

function openSequoiaWhatsappChat(message) {
  const normalizedMessage = String(message || "").trim();
  const webUrl = buildSequoiaWhatsappUrl(normalizedMessage);
  openExternalBrowserUrl(webUrl);

  return webUrl;
}

function getSelectedOrderVehicleLabel() {
  if (!selectedOrderVehicle) {
    return "el vehículo";
  }

  const parts = [selectedOrderVehicle.brand, selectedOrderVehicle.model];

  if (selectedOrderVehicle.key === "sequoia") {
    const activeVersion = getActiveSequoiaConfig()?.name;

    if (activeVersion) {
      parts.push(activeVersion);
    }
  }

  return parts.filter(Boolean).join(" ").trim() || "el vehículo";
}

function renderSequoiaOrderSummary() {
  if (!sequoiaSummaryTitle) {
    return;
  }

  const summary = getSequoiaOrderSummaryData();
  const orderDate = new Date();
  const estimatedStartDate = addDays(orderDate, 75);
  const estimatedEndDate = addDays(orderDate, 90);

  sequoiaSummaryTitle.textContent = `${summary.brand} ${summary.model} ${summary.versionName}`;

  if (sequoiaSummaryDeliveryRange) {
    sequoiaSummaryDeliveryRange.textContent = formatDateRange(estimatedStartDate, estimatedEndDate);
  }

  if (sequoiaDeliveryCityButton) {
    sequoiaDeliveryCityButton.textContent = `Entrega en: ${summary.deliveryCityLabel}`;
  }

  if (sequoiaCitySelector) {
    sequoiaCitySelector.innerHTML = Object.entries(SEQUOIA_DELIVERY_OPTIONS)
      .map(([key, option]) => {
        const feeLabel = option.fee > 0 ? `+ ${formatCopCurrency(option.fee)}` : "Gratis";
        return `
          <button
            type="button"
            class="sequoia-city-option ${key === selectedSequoiaDeliveryCity ? "is-active" : ""}"
            data-delivery-city="${key}"
          >
            <span>${escapeHtml(option.label)}</span>
            <small>${escapeHtml(feeLabel)}</small>
          </button>
        `;
      })
      .join("");
  }

  if (sequoiaCityFeeNote) {
    sequoiaCityFeeNote.textContent = summary.deliveryFee > 0
      ? `${summary.deliveryCityLabel} ${formatCopCurrency(summary.deliveryFee)} por servicio de Niñera Express privada`
      : `${summary.deliveryCityLabel} gratis por servicio de Niñera Express privada`;
  }

  if (sequoiaOrderDetails) {
    sequoiaOrderDetails.innerHTML = `
      <p><strong>Marca:</strong> ${escapeHtml(summary.brand)}</p>
      <p><strong>Modelo:</strong> ${escapeHtml(summary.model)}</p>
      <p><strong>Versión:</strong> ${escapeHtml(summary.versionName)}</p>
      <p><strong>Color:</strong> ${escapeHtml(summary.exteriorColorName)}</p>
      <p><strong>Cojinería:</strong> ${escapeHtml(summary.interiorColorName)}</p>
      <p><strong>Precio del vehículo:</strong> ${escapeHtml(formatCopCurrency(summary.vehiclePrice))}</p>
      <p><strong>Precio Niñera Express privada:</strong> ${escapeHtml(formatCopCurrency(summary.deliveryFee))}</p>
      <p><strong>Total:</strong> ${escapeHtml(formatCopCurrency(summary.totalPrice))}</p>
    `;
  }

  if (sequoiaSummaryTotalPrice) {
    sequoiaSummaryTotalPrice.textContent = formatCopCurrency(summary.totalPrice);
  }

  if (sequoiaSummaryFinancingLink) {
    const financeMessage = `Hola, quiero explorar financiamiento para una ${summary.brand} ${summary.model} ${summary.versionName}. Precio total estimado: ${formatCopCurrency(summary.totalPrice)}.`;
    sequoiaSummaryFinancingLink.href = buildSequoiaWhatsappUrl(financeMessage);
    sequoiaSummaryFinancingLink.setAttribute("data-whatsapp-message", encodeURIComponent(financeMessage));
  }

  if (sequoiaOrderDetails) {
    sequoiaOrderDetails.hidden = !isSequoiaOrderDetailsExpanded;
  }

  if (sequoiaOrderDetailsToggle) {
    sequoiaOrderDetailsToggle.textContent = isSequoiaOrderDetailsExpanded ? "Ocultar los detalles del pedido" : "Mostrar los detalles del pedido";
    sequoiaOrderDetailsToggle.setAttribute("aria-expanded", String(isSequoiaOrderDetailsExpanded));
  }
}

function getActiveSequoiaConfig() {
  const catalog = getSequoiaCatalog();
  const versionConfig = catalog.versionConfig || {};
  const fallbackVersionKey = catalog.versionOrder?.[0] || DEFAULT_SEQUOIA_VERSION_ORDER[0];

  return versionConfig[selectedSequoiaVersion] || versionConfig[fallbackVersionKey] || { name: "Sequoia", price: 0, specs: [], colors: [] };
}

function getActiveSequoiaColor() {
  const versionConfig = getActiveSequoiaConfig();
  return versionConfig.colors.find((item) => item.key === selectedSequoiaColor) || versionConfig.colors[0];
}

function getActiveSequoiaInteriorConfig() {
  const catalog = getSequoiaCatalog();
  const interiorConfig = catalog.interiorConfig || {};
  const fallbackVersionKey = catalog.versionOrder?.[0] || DEFAULT_SEQUOIA_VERSION_ORDER[0];

  return interiorConfig[selectedSequoiaVersion] || interiorConfig[fallbackVersionKey] || { colors: [] };
}

function getActiveSequoiaInteriorColor() {
  const interiorConfig = getActiveSequoiaInteriorConfig();
  return interiorConfig.colors.find((item) => item.key === selectedSequoiaInteriorColor) || interiorConfig.colors[0];
}

function renderSequoiaCarouselDots(images) {
  if (!sequoiaConfigDots) {
    return;
  }

  sequoiaConfigDots.innerHTML = images
    .map(
      (_, index) => `
        <button
          type="button"
          class="sequoia-config-dot ${index === selectedSequoiaImageIndex ? "is-active" : ""}"
          data-sequoia-dot-index="${index}"
          aria-label="Ir a imagen ${index + 1}"
        ></button>
      `
    )
    .join("");
}

function updateSequoiaMainImage() {
  const activeColor = getActiveSequoiaColor();

  if (!activeColor || !sequoiaConfigMainImage || !activeColor.images?.length) {
    return;
  }

  const safeIndex = ((selectedSequoiaImageIndex % activeColor.images.length) + activeColor.images.length) % activeColor.images.length;
  selectedSequoiaImageIndex = safeIndex;
  sequoiaConfigMainImage.src = activeColor.images[safeIndex];
  sequoiaConfigMainImage.alt = `Toyota Sequoia ${activeColor.name}`;
  sequoiaConfigImageFrame?.style.setProperty("--sequoia-color-tint", activeColor.tint || "rgba(0, 0, 0, 0)");
  renderSequoiaCarouselDots(activeColor.images);
}

function spinSequoiaImage(step) {
  const activeColor = getActiveSequoiaColor();

  if (!activeColor?.images?.length) {
    return;
  }

  selectedSequoiaImageIndex += step;
  updateSequoiaMainImage();
}

function updateSequoiaInteriorImage() {
  const activeInteriorColor = getActiveSequoiaInteriorColor();

  if (!activeInteriorColor || !sequoiaInteriorMainImage || !activeInteriorColor.images?.length) {
    return;
  }

  const safeIndex = ((selectedSequoiaInteriorImageIndex % activeInteriorColor.images.length) + activeInteriorColor.images.length) % activeInteriorColor.images.length;
  selectedSequoiaInteriorImageIndex = safeIndex;
  sequoiaInteriorMainImage.src = activeInteriorColor.images[safeIndex];
  sequoiaInteriorMainImage.alt = `Interior Toyota Sequoia ${activeInteriorColor.name}`;
}

function spinSequoiaInteriorImage(step) {
  const activeInteriorColor = getActiveSequoiaInteriorColor();

  if (!activeInteriorColor?.images?.length) {
    return;
  }

  selectedSequoiaInteriorImageIndex += step;
  updateSequoiaInteriorImage();
}

function renderSequoiaInterior() {
  const interiorConfig = getActiveSequoiaInteriorConfig();
  const activeInteriorColor = getActiveSequoiaInteriorColor();

  if (sequoiaInteriorColorName && activeInteriorColor) {
    sequoiaInteriorColorName.textContent = String(activeInteriorColor.name || "").toUpperCase();
  }

  if (sequoiaInteriorColors) {
    sequoiaInteriorColors.innerHTML = (interiorConfig.colors || [])
      .map(
        (color) => `
          <button
            type="button"
            class="sequoia-color-swatch ${color.key === selectedSequoiaInteriorColor ? "is-active" : ""}"
            data-sequoia-interior-color="${escapeHtml(color.key)}"
            aria-label="Color interior ${escapeHtml(color.name)}"
            title="${escapeHtml(color.name)}"
          >
            <span style="--swatch-color:${escapeHtml(color.hex)}"></span>
          </button>
        `
      )
      .join("");
  }

  if (!activeInteriorColor) {
    return;
  }

  if (!activeInteriorColor.images[selectedSequoiaInteriorImageIndex]) {
    selectedSequoiaInteriorImageIndex = 0;
  }

  updateSequoiaInteriorImage();
  renderSequoiaOrderSummary();
}

function showSequoiaVisionHint() {
  if (!sequoiaVisionHint) {
    return;
  }

  sequoiaVisionHint.classList.remove("is-hidden");

  if (sequoiaVisionHintTimeout) {
    clearTimeout(sequoiaVisionHintTimeout);
  }

  sequoiaVisionHintTimeout = setTimeout(() => {
    sequoiaVisionHint.classList.add("is-hidden");
  }, 3000);
}

function renderSequoiaConfigurator() {
  const catalog = getSequoiaCatalog();
  const versionConfig = getActiveSequoiaConfig();
  const activeColor = getActiveSequoiaColor();

  if (!catalog.versionOrder?.length || !versionConfig.colors?.length) {
    setSequoiaConfiguratorLoadingState("Cargando configurador...");
    return;
  }

  if (sequoiaConfigTitle) {
    sequoiaConfigTitle.textContent = `Toyota Sequoia ${versionConfig.name}`;
  }

  if (sequoiaConfigPrice) {
    sequoiaConfigPrice.textContent = formatCopCurrency(versionConfig.price);
  }

  if (sequoiaConfigColorName && activeColor) {
    sequoiaConfigColorName.textContent = String(activeColor.name || "").toUpperCase();
  }

  if (sequoiaConfigSpecs) {
    sequoiaConfigSpecs.innerHTML = versionConfig.specs
      .map(
        (spec) => `
          <article class="sequoia-spec-card">
            <strong>${escapeHtml(spec.value)}</strong>
            <span>${escapeHtml(spec.label)}</span>
          </article>
        `
      )
      .join("");
  }

  if (sequoiaConfigVersions) {
    sequoiaConfigVersions.innerHTML = catalog.versionOrder.map((versionKey) => {
      const current = catalog.versionConfig?.[versionKey];

      if (!current) {
        return "";
      }

      return `
        <button
          type="button"
          class="sequoia-version-card ${versionKey === selectedSequoiaVersion ? "is-active" : ""}"
          data-sequoia-version="${versionKey}"
        >
          <strong>${escapeHtml(current.name)}</strong>
          <span>${escapeHtml(formatCopCurrency(current.price))}</span>
        </button>
      `;
    }).join("");
  }

  if (sequoiaConfigColors) {
    sequoiaConfigColors.innerHTML = versionConfig.colors
      .map(
        (color) => `
          <button
            type="button"
            class="sequoia-color-swatch ${color.key === selectedSequoiaColor ? "is-active" : ""}"
            data-sequoia-color="${escapeHtml(color.key)}"
            aria-label="Color ${escapeHtml(color.name)}"
            title="${escapeHtml(color.name)}"
          >
            <span style="--swatch-color:${escapeHtml(color.hex)}"></span>
          </button>
        `
      )
      .join("");
  }

  if (!activeColor) {
    return;
  }

  if (!activeColor.images[selectedSequoiaImageIndex]) {
    selectedSequoiaImageIndex = 0;
  }

  updateSequoiaMainImage();
  renderSequoiaInterior();
  renderSequoiaOrderSummary();
}

function renderOrderActionCards(vehicleInfo) {
  if (!orderActionCards || !vehicleInfo) {
    return;
  }

  const vehicleTitle = `${vehicleInfo.brand} ${vehicleInfo.model}`.trim();
  const vehicleImages = ORDER_ACTION_IMAGES_BY_VEHICLE[vehicleInfo.key] || null;

  orderActionCards.innerHTML = ORDER_ACTION_TEMPLATES.map((item) => {
    const cardTitle = item.title.replace("{vehicle}", vehicleTitle);
    const imageUrl = resolveClientAssetUrl(vehicleImages?.[item.key] || item.image);

    return `
      <button
        class="order-action-card"
        type="button"
        data-order-action="${item.key}"
        style="--action-image:url('${imageUrl}')"
      >
        <strong>${escapeHtml(cardTitle)}</strong>
        <span>${escapeHtml(item.button)}</span>
      </button>
    `;
  }).join("");

  orderActionCards.hidden = false;
}

function activateOrderVehicleCard(cardButton) {
  if (!cardButton) {
    return;
  }

  orderVehicleCarousel?.querySelectorAll(".order-vehicle-card").forEach((button) => {
    button.classList.toggle("is-active", button === cardButton);
  });

  selectedOrderVehicle = {
    key: cardButton.dataset.vehicleKey || "",
    brand: cardButton.dataset.vehicleBrand || "",
    model: cardButton.dataset.vehicleModel || "",
  };

  const brandField = requestForm?.elements?.brand;
  if (brandField) {
    brandField.value = selectedOrderVehicle.brand;
  }

  const modelField = requestForm?.elements?.model;
  if (modelField) {
    modelField.value = selectedOrderVehicle.model;
  }

  renderOrderActionCards(selectedOrderVehicle);
  setActiveView("order-options", { direction: "forward" });
}

function bindOrderExperience() {
  if (!orderVehicleCarousel || !orderActionCards) {
    return;
  }

  orderVehicleCarousel.addEventListener("click", (event) => {
    const vehicleButton = event.target.closest(".order-vehicle-card");

    if (!vehicleButton) {
      return;
    }

    activateOrderVehicleCard(vehicleButton);
  });

  orderActionCards.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-order-action]");

    if (!actionButton || !selectedOrderVehicle) {
      return;
    }

    const action = actionButton.dataset.orderAction;
    const vehicleLabel = getSelectedOrderVehicleLabel();
    const notesField = requestForm?.elements?.notes;

    if (action === "demo") {
      const message = `Hola, me encuentro interesado en la compra de una ${vehicleLabel} y quisiera hacer un Demo Drive para conocerla un poco más. ¿Podrías brindarme más información?`;
      openSequoiaWhatsappChat(message);
      return;
    }

    if (action === "finance") {
      const message = `Hola! estoy interesado en comprar ${vehicleLabel}, me gustaria que me ayudaras con el proceso de financiamiento para el vehiculo.`;
      openSequoiaWhatsappChat(message);
      return;
    }

    if (action === "design") {
      if (selectedOrderVehicle.key === "sequoia") {
        selectedSequoiaVersion = "sr5";
        selectedSequoiaColor = "lunar-rock";
        selectedSequoiaImageIndex = 0;
        selectedSequoiaInteriorColor = "tela-color-black";
        selectedSequoiaInteriorImageIndex = 0;
        setActiveView("order-configurator", { direction: "forward" });
        return;
      }

      if (notesField) {
        notesField.value = `Quiero disenar mi ${vehicleLabel} con especificaciones personalizadas.`;
      }
    }

    if (requestForm) {
      requestForm.scrollIntoView({ behavior: "smooth", block: "start" });
      requestForm.elements.customerPhone?.focus();
      setFeedback(requestFeedback, `Perfecto. Vamos con ${vehicleLabel}. Completa los datos y enviamos la solicitud.`, "success");
    }
  });

  orderOptionsBackButton?.addEventListener("click", () => {
    setActiveView("order", { direction: "backward" });
  });
}

function bindSequoiaConfigurator() {
  if (!sequoiaConfigVersions || !sequoiaConfigColors || !sequoiaConfigMainImage) {
    return;
  }

  sequoiaConfigVersions.addEventListener("click", (event) => {
    const versionButton = event.target.closest("[data-sequoia-version]");

    if (!versionButton) {
      return;
    }

    const nextVersion = versionButton.dataset.sequoiaVersion;
    const nextConfig = getSequoiaCatalog().versionConfig?.[nextVersion];

    if (!nextConfig) {
      return;
    }

    selectedSequoiaVersion = nextVersion;
    selectedSequoiaColor = nextConfig.colors[0]?.key || selectedSequoiaColor;
    selectedSequoiaImageIndex = 0;
    selectedSequoiaInteriorColor = getActiveSequoiaInteriorConfig().colors[0]?.key || selectedSequoiaInteriorColor;
    selectedSequoiaInteriorImageIndex = 0;
    renderSequoiaConfigurator();
  });

  sequoiaConfigColors.addEventListener("click", (event) => {
    const colorButton = event.target.closest("[data-sequoia-color]");

    if (!colorButton) {
      return;
    }

    selectedSequoiaColor = colorButton.dataset.sequoiaColor || selectedSequoiaColor;
    selectedSequoiaImageIndex = 0;
    renderSequoiaConfigurator();
  });

  sequoiaInteriorColors?.addEventListener("click", (event) => {
    const colorButton = event.target.closest("[data-sequoia-interior-color]");

    if (!colorButton) {
      return;
    }

    selectedSequoiaInteriorColor = colorButton.dataset.sequoiaInteriorColor || selectedSequoiaInteriorColor;
    selectedSequoiaInteriorImageIndex = 0;
    renderSequoiaInterior();
  });

  sequoiaConfigDots?.addEventListener("click", (event) => {
    const dotButton = event.target.closest("[data-sequoia-dot-index]");

    if (!dotButton) {
      return;
    }

    selectedSequoiaImageIndex = Number(dotButton.dataset.sequoiaDotIndex || 0);
    updateSequoiaMainImage();
  });

  sequoiaConfigPrevButton?.addEventListener("click", () => {
    spinSequoiaImage(-1);
  });

  sequoiaConfigNextButton?.addEventListener("click", () => {
    spinSequoiaImage(1);
  });

  sequoiaConfigImageFrame?.addEventListener("touchstart", (event) => {
    if ((event.touches?.length || 0) !== 1) {
      isSequoiaTouchDragging = false;
      return;
    }

    sequoiaTouchLastX = event.touches?.[0]?.clientX || 0;
    sequoiaTouchAccumulator = 0;
    isSequoiaTouchDragging = true;
  }, { passive: true });

  sequoiaConfigImageFrame?.addEventListener("touchmove", (event) => {
    if (!isSequoiaTouchDragging || (event.touches?.length || 0) !== 1) {
      return;
    }

    const currentX = event.touches?.[0]?.clientX || sequoiaTouchLastX;
    const deltaX = currentX - sequoiaTouchLastX;
    sequoiaTouchLastX = currentX;
    sequoiaTouchAccumulator += deltaX;

    const steps = Math.trunc(sequoiaTouchAccumulator / SEQUOIA_TOUCH_SPIN_STEP_PX);

    if (steps !== 0) {
      spinSequoiaImage(-steps);
      sequoiaTouchAccumulator -= steps * SEQUOIA_TOUCH_SPIN_STEP_PX;
    }

    // Keep the gesture dedicated to 360 rotation while the finger is over the frame.
    event.preventDefault();
  }, { passive: false });

  sequoiaConfigImageFrame?.addEventListener("touchend", () => {
    isSequoiaTouchDragging = false;
    sequoiaTouchAccumulator = 0;
  }, { passive: true });

  sequoiaConfigImageFrame?.addEventListener("touchcancel", () => {
    isSequoiaTouchDragging = false;
    sequoiaTouchAccumulator = 0;
  }, { passive: true });

  sequoiaConfigImageFrame?.addEventListener("wheel", (event) => {
    const horizontalIntent = event.deltaX;

    if (Math.abs(horizontalIntent) < 1) {
      return;
    }

    event.preventDefault();
    sequoiaWheelAccumulator += horizontalIntent;

    const steps = Math.trunc(sequoiaWheelAccumulator / SEQUOIA_SPIN_STEP_PX);

    if (steps !== 0) {
      spinSequoiaImage(steps);
      sequoiaWheelAccumulator -= steps * SEQUOIA_SPIN_STEP_PX;
    }
  }, { passive: false });

  sequoiaInteriorImageFrame?.addEventListener("touchstart", (event) => {
    if ((event.touches?.length || 0) !== 1) {
      isSequoiaInteriorTouchDragging = false;
      return;
    }

    sequoiaInteriorTouchLastX = event.touches?.[0]?.clientX || 0;
    sequoiaInteriorTouchAccumulator = 0;
    isSequoiaInteriorTouchDragging = true;
  }, { passive: true });

  sequoiaInteriorImageFrame?.addEventListener("touchmove", (event) => {
    if (!isSequoiaInteriorTouchDragging || (event.touches?.length || 0) !== 1) {
      return;
    }

    const currentX = event.touches?.[0]?.clientX || sequoiaInteriorTouchLastX;
    const deltaX = currentX - sequoiaInteriorTouchLastX;
    sequoiaInteriorTouchLastX = currentX;
    sequoiaInteriorTouchAccumulator += deltaX;

    const steps = Math.trunc(sequoiaInteriorTouchAccumulator / SEQUOIA_TOUCH_SPIN_STEP_PX);

    if (steps !== 0) {
      spinSequoiaInteriorImage(-steps);
      sequoiaInteriorTouchAccumulator -= steps * SEQUOIA_TOUCH_SPIN_STEP_PX;
    }

    // Keep the gesture dedicated to 360 rotation while the finger is over the frame.
    event.preventDefault();
  }, { passive: false });

  sequoiaInteriorImageFrame?.addEventListener("touchend", () => {
    isSequoiaInteriorTouchDragging = false;
    sequoiaInteriorTouchAccumulator = 0;
  }, { passive: true });

  sequoiaInteriorImageFrame?.addEventListener("touchcancel", () => {
    isSequoiaInteriorTouchDragging = false;
    sequoiaInteriorTouchAccumulator = 0;
  }, { passive: true });

  sequoiaInteriorImageFrame?.addEventListener("wheel", (event) => {
    const horizontalIntent = event.deltaX;

    if (Math.abs(horizontalIntent) < 1) {
      return;
    }

    event.preventDefault();
    sequoiaInteriorWheelAccumulator += horizontalIntent;

    const steps = Math.trunc(sequoiaInteriorWheelAccumulator / SEQUOIA_SPIN_STEP_PX);

    if (steps !== 0) {
      spinSequoiaInteriorImage(steps);
      sequoiaInteriorWheelAccumulator -= steps * SEQUOIA_SPIN_STEP_PX;
    }
  }, { passive: false });

  orderConfigBackButton?.addEventListener("click", () => {
    setActiveView("order-options", { direction: "backward" });
  });

  sequoiaDeliveryCityButton?.addEventListener("click", () => {
    if (!sequoiaCitySelector) {
      return;
    }

    const nextExpandedState = sequoiaCitySelector.hidden;
    sequoiaCitySelector.hidden = !nextExpandedState;
    sequoiaDeliveryCityButton.setAttribute("aria-expanded", String(nextExpandedState));
  });

  sequoiaCitySelector?.addEventListener("click", (event) => {
    const cityButton = event.target.closest("[data-delivery-city]");

    if (!cityButton) {
      return;
    }

    selectedSequoiaDeliveryCity = cityButton.dataset.deliveryCity || selectedSequoiaDeliveryCity;
    sequoiaCitySelector.hidden = true;
    sequoiaDeliveryCityButton?.setAttribute("aria-expanded", "false");
    renderSequoiaOrderSummary();
  });

  sequoiaOrderDetailsToggle?.addEventListener("click", () => {
    isSequoiaOrderDetailsExpanded = !isSequoiaOrderDetailsExpanded;
    renderSequoiaOrderSummary();
  });

  sequoiaOrderCardButton?.addEventListener("click", async () => {
    if (!sequoiaOrderCardButton) {
      return;
    }

    const originalLabel = sequoiaOrderCardButton.textContent;
    const summary = getSequoiaOrderSummaryData();
    const nativeExternalLinkHandler = window.webkit?.messageHandlers?.globalImportsExternalLink;
    const pendingExternalWindow = nativeExternalLinkHandler?.postMessage
      ? null
      : window.open("", "_blank", "noopener,noreferrer");

    sequoiaOrderCardButton.disabled = true;
    sequoiaOrderCardButton.textContent = "Preparando contrato...";

    try {
      const response = await fetchJson("/api/client/docusign/preagreement-signing-url", {
        method: "POST",
        body: JSON.stringify({
          vehicle: {
            brand: summary.brand,
            model: summary.model,
            version: summary.versionName,
            exteriorColor: summary.exteriorColorName,
            interiorColor: summary.interiorColorName,
          },
          deliveryCity: summary.deliveryCityLabel,
          totalPriceLabel: formatCopCurrency(summary.totalPrice),
          reservationAmountLabel: formatCopCurrency(SEQUOIA_ORDER_RESERVATION_AMOUNT),
        }),
      });

      if (!response?.signingUrl) {
        throw new Error("No fue posible iniciar la firma del preacuerdo.");
      }

      if (!openExternalBrowserUrl(response.signingUrl, pendingExternalWindow)) {
        window.location.assign(response.signingUrl);
      }
    } catch (error) {
      if (error?.message && /consentimiento jwt|consent_required|docusign requiere consentimiento/i.test(error.message)) {
        const consentUrlMatch = String(error.message).match(/https?:\/\/\S+/i);

        if (consentUrlMatch?.[0]) {
          if (!openExternalBrowserUrl(consentUrlMatch[0], pendingExternalWindow)) {
            window.location.assign(consentUrlMatch[0]);
          }
        }
      } else if (pendingExternalWindow && !pendingExternalWindow.closed) {
        pendingExternalWindow.close();
      }

      window.alert(error.message || "No se pudo iniciar la firma del preacuerdo.");
      sequoiaOrderCardButton.disabled = false;
      sequoiaOrderCardButton.textContent = originalLabel;
    }
  });
}

function goToTrackingPage() {
  const query = trackingInput.value.trim();

  if (!query) {
    setFeedback(trackingSearchFeedback, "Ingresa tu número de guía para continuar.", "error");
    return;
  }

  setFeedback(trackingSearchFeedback, "", "");
  rememberTrackingSearch(query);

  const trackingUrl = buildTrackingPageUrl(query);
  window.location.href = trackingUrl.toString();
}

function renderNotifications() {
  const unreadCount = state.notifications.length;

  notificationCount.textContent = String(unreadCount);
  notificationCount.hidden = unreadCount === 0;
  syncNativeAppBadge(unreadCount);

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
          <div class="notification-meta">
            <time>${escapeHtml(formatDate(item.date))}</time>
            <button
              type="button"
              class="notification-dismiss"
              data-notification-dismiss="${escapeHtml(item.id)}"
              aria-label="Eliminar notificacion"
            >
              x
            </button>
          </div>
        </article>
      `
    )
    .join("");
}

async function dismissNotification(notificationId) {
  const id = String(notificationId || "").trim();

  if (!id) {
    return;
  }

  await fetchJson(`/api/client/notifications/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  state.notifications = state.notifications.filter((item) => item.id !== id);
  renderNotifications();
}

function renderVirtualDealership() {
  if (!virtualDealershipClientList) {
    return;
  }

  if (!state.virtualDealershipVehicles.length) {
    renderEmptyState(virtualDealershipClientList, "No hay vehículos de compra inmediata publicados por el momento.");
    if (virtualDealershipLoadMoreSentinel) {
      virtualDealershipLoadMoreSentinel.hidden = true;
    }
    return;
  }

  const visibleVehicles = state.virtualDealershipVehicles.slice(0, state.virtualDealershipVisibleCount);

  virtualDealershipClientList.innerHTML = visibleVehicles
    .map((vehicle, index) => {
      const vehicleImages = Array.isArray(vehicle.images)
        ? vehicle.images.filter((item) => item && item.url)
        : [];
      const vehicleKey = resolveVirtualVehicleKey(vehicle, index);
      const vehicleTitle = `${vehicle.brand || "Vehículo"} ${vehicle.model || ""} ${vehicle.version || ""}`.trim();
      const pricing = formatCopCurrency(vehicle.price || 0);
      const publicationUrl = new URL("/client.html", window.location.origin);
      publicationUrl.searchParams.set("view", "virtual-dealership");
      publicationUrl.hash = `virtual-vehicle-${vehicleKey}`;

      const whatsappMessage = `Hola, estoy muy interesado en comprar este vehículo (${publicationUrl.toString()}); ¿podrías darme más información o llamarme?`;
      const whatsappUrl = buildSequoiaWhatsappUrl(whatsappMessage);
      const detailsExpanded = state.virtualDealershipExpandedDetails.has(vehicleKey);

      return `
        <article class="virtual-dealership-card">
          <span id="virtual-vehicle-${escapeHtml(vehicleKey)}" class="virtual-dealership-anchor" aria-hidden="true"></span>
          ${vehicleImages.length
            ? `<div class="virtual-dealership-carousel" role="group" aria-label="Galería de ${escapeHtml(vehicleTitle)}">
                <div class="virtual-dealership-carousel-track">
                  ${vehicleImages
                    .map(
                      (image, index) => `
                        <button
                          type="button"
                          class="virtual-dealership-image-button virtual-dealership-carousel-slide"
                          data-virtual-image-url="${encodeURIComponent(image.url)}"
                          data-virtual-image-alt="${escapeHtml(image.caption || `${vehicleTitle} foto ${index + 1}`)}"
                          data-virtual-vehicle-key="${escapeHtml(vehicleKey)}"
                          data-virtual-image-index="${index}"
                          aria-label="Ver imagen ${index + 1} de ${vehicleImages.length}"
                        >
                          <img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.caption || vehicleTitle)}" loading="lazy" />
                        </button>
                      `
                    )
                    .join("")}
                </div>
                ${vehicleImages.length > 1
                  ? `<div class="virtual-dealership-carousel-dots" aria-hidden="true">${vehicleImages
                      .map(() => '<span class="virtual-dealership-carousel-dot"></span>')
                      .join("")}</div>`
                  : ""}
                <div class="virtual-dealership-media-overlay">
                  <h3>${escapeHtml(vehicleTitle || "Vehículo")}</h3>
                  <strong class="virtual-dealership-media-price">${escapeHtml(pricing)}</strong>
                </div>
              </div>`
            : ""}
          <div class="virtual-dealership-card-body">
            <button type="button" class="virtual-dealership-details-toggle" data-virtual-details-toggle="${escapeHtml(vehicleKey)}" aria-expanded="${detailsExpanded ? "true" : "false"}">${detailsExpanded ? "Ocultar detalles" : "Ver detalles"}</button>
            <div class="virtual-dealership-details ${detailsExpanded ? "is-open" : "is-collapsed"}">
              <div class="virtual-dealership-card-meta">
                <span>${escapeHtml(vehicle.year || "Año N/D")}</span>
                <span>${escapeHtml((vehicle.status || "available") === "reserved" ? "Reservado" : "Disponible")}</span>
              </div>
              <p>${escapeHtml(vehicle.exteriorColor || "Color exterior por confirmar")} · ${escapeHtml(vehicle.interiorColor || "Coginería por confirmar")}</p>
              <p>${escapeHtml(vehicle.mileage != null ? `${vehicle.mileage} km` : "Kilometraje por confirmar")} · ${escapeHtml(vehicle.engine || "Motor por confirmar")} · ${escapeHtml(vehicle.horsepower != null ? `${vehicle.horsepower} HP` : "Potencia por confirmar")}</p>
              <p>${escapeHtml(vehicle.description || "Vehículo en vitrina para compra inmediata.")}</p>
              <div class="virtual-dealership-card-actions">
                <a class="secondary-button virtual-dealership-buy-button" href="${escapeHtml(whatsappUrl)}" data-whatsapp-message="${encodeURIComponent(whatsappMessage)}" rel="noopener noreferrer">Comprar ahora</a>
                <div class="virtual-dealership-video-column">
                  <button type="button" class="primary-button virtual-dealership-video-button" data-virtual-video-call="1" data-virtual-video-title="${encodeURIComponent(vehicleTitle)}" data-virtual-video-publication="${encodeURIComponent(publicationUrl.toString())}">Verla en vivo</button>
                </div>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  if (virtualDealershipLoadMoreSentinel) {
    virtualDealershipLoadMoreSentinel.hidden = state.virtualDealershipVisibleCount >= state.virtualDealershipVehicles.length;
  }
}

async function loadVirtualDealership() {
  const data = await fetchJson("/api/client/virtual-dealership");
  state.virtualDealershipVehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  state.virtualDealershipVisibleCount = Math.min(VIRTUAL_DEALERSHIP_BATCH_SIZE, state.virtualDealershipVehicles.length);
  renderVirtualDealership();
}

function setActiveView(viewName, options = {}) {
  const direction = options.direction || "none";
  const previousView = state.activeView;
  let nextViewName = viewName;
  let enteringNode = viewNodes.find((node) => node.dataset.view === nextViewName);

  if (!enteringNode) {
    nextViewName = "home";
    enteringNode = viewNodes.find((node) => node.dataset.view === nextViewName) || viewNodes[0] || null;
  }

  if (!enteringNode) {
    return;
  }

  state.activeView = nextViewName;
  persistViewToUrl(nextViewName);

  viewNodes.forEach((node) => {
    node.classList.remove("is-entering-right", "is-entering-left");
    node.classList.toggle("is-active", node === enteringNode);
  });

  if (enteringNode && direction !== "none") {
    enteringNode.classList.add(direction === "forward" ? "is-entering-right" : "is-entering-left");
  }

  navButtons.forEach((button) => {
    const targetView = button.dataset.viewTarget;
    const shouldHighlightOrder = targetView === "order" && (nextViewName === "order-options" || nextViewName === "order-configurator");
    button.classList.toggle("is-active", targetView === nextViewName || shouldHighlightOrder);
  });

  if (previousView && previousView !== viewName) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (nextViewName === "order-configurator") {
    ensureSequoiaConfiguratorReady()
      .then(() => {
        showSequoiaVisionHint();
      })
      .catch(() => {
        setSequoiaConfiguratorLoadingState("No se pudo cargar el configurador.");
        setFeedback(requestFeedback, "No se pudo cargar el configurador Sequoia. Intenta de nuevo.", "error");
      });
  }
  if (nextViewName === "pago-separacion") {
    initPagoSeparacionView();
  }
  if (nextViewName === "pago-exitoso") {
    initPagoExitosoView();
  }
}

function openNotifications() {
  notificationsModal.hidden = false;
  document.body.classList.add("modal-open");

  loadDashboard().catch(() => null);
}

function closeNotifications() {
  notificationsModal.hidden = true;
  const shouldKeepModalOpen = (maintenanceVehicleModal && !maintenanceVehicleModal.hidden)
    || (virtualDealershipImageModal && !virtualDealershipImageModal.hidden)
    || (virtualDealershipVideoModal && !virtualDealershipVideoModal.hidden)
    || (deleteAccountModal && !deleteAccountModal.hidden);
  document.body.classList.toggle("modal-open", Boolean(shouldKeepModalOpen));
}

async function loadDashboard() {
  const data = await fetchJson("/api/client/dashboard");
  state.user = data.user || null;
  state.orders = data.orders || [];
  state.maintenance = data.maintenance || [];
  state.maintenanceVehicles = data.maintenanceVehicles || [];
  const validMaintenanceKeys = new Set(
    state.maintenanceVehicles.map((vehicle, index) => resolveMaintenanceVehicleKey(vehicle, index))
  );
  state.maintenanceExpandedDetails = new Set(
    Array.from(state.maintenanceExpandedDetails).filter((key) => validMaintenanceKeys.has(key))
  );
  state.notifications = data.notifications || [];
  loadTrackingHistory();

  updateSummary();
  renderTrackingOptions();
  renderTrackingHistory();
  renderMaintenanceList();
  renderNotifications();
  renderVirtualDealership();
  syncNativePushToken();
}

window.addEventListener("globalimports:push-token", (event) => {
  registerNativePushToken(event.detail || {}).catch((error) => {
    console.warn("[push][client-portal] No se pudo registrar el token nativo recibido por evento.", error);
  });
});

window.addEventListener("focus", () => {
  loadDashboard().catch(() => null);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadDashboard().catch(() => null);
  }
});

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveView(button.dataset.viewTarget);

    if (button.dataset.viewTarget === "home" && !state.feedPosts.length) {
      loadFeedPage({ reset: true }).catch((error) => {
        feedLoadingState.textContent = error.message;
      });
    }

    if (button.dataset.viewTarget === "virtual-dealership" && !state.virtualDealershipVehicles.length) {
      loadVirtualDealership().catch((error) => {
        renderEmptyState(virtualDealershipClientList, error.message);
      });
    }
  });
});

trackingForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  goToTrackingPage();
});

trackingTabSearchButton?.addEventListener("click", () => {
  setTrackingActiveTab("search");
});

trackingTabOrdersButton?.addEventListener("click", () => {
  setTrackingActiveTab("orders");
});

trackingOrdersList?.addEventListener("click", (event) => {
  const trackingButton = event.target.closest("[data-tracking-history]");

  if (!trackingButton) {
    return;
  }

  const trackingNumber = String(trackingButton.getAttribute("data-tracking-history") || "").trim();

  if (!trackingNumber) {
    return;
  }

  const trackingUrl = buildTrackingPageUrl(trackingNumber);
  window.location.href = trackingUrl.toString();
});

trackingOrdersClearButton?.addEventListener("click", () => {
  trackingHistory = [];
  persistTrackingHistory();
  renderTrackingHistory();
});

if (requestForm) {
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(requestForm);

    setFeedback(requestFeedback, "Enviando tu configuración...");

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

      const requestName = document.getElementById("request-name");
      const requestEmail = document.getElementById("request-email");

      if (requestName) {
        requestName.value = state.user?.name || "";
      }

      if (requestEmail) {
        requestEmail.value = state.user?.email || "";
      }

      const currencySelect = requestForm.querySelector('select[name="currency"]');
      if (currencySelect) {
        currencySelect.value = "USD";
      }

      setFeedback(requestFeedback, "Tu nueva orden fue enviada correctamente.", "success");
    } catch (error) {
      setFeedback(requestFeedback, error.message, "error");
    }
  });
}

maintenanceVehicleForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await submitMaintenanceVehicleForm();
  } catch (error) {
    setFeedback(maintenanceFeedback, error.message, "error");
  }
});

addMaintenanceVehicleButton?.addEventListener("click", openMaintenanceVehicleModal);
maintenanceVehicleClose?.addEventListener("click", closeMaintenanceVehicleModal);
maintenanceVehicleOverlay?.addEventListener("click", closeMaintenanceVehicleModal);

notificationsButton?.addEventListener("click", openNotifications);
notificationsClose?.addEventListener("click", closeNotifications);
notificationsOverlay?.addEventListener("click", closeNotifications);
maintenanceList?.addEventListener("click", (event) => {
  const toggleDetailsButton = event.target.closest("[data-maintenance-toggle-details]");

  if (toggleDetailsButton) {
    const vehicleKey = String(toggleDetailsButton.getAttribute("data-maintenance-toggle-details") || "").trim();

    if (!vehicleKey) {
      return;
    }

    if (state.maintenanceExpandedDetails.has(vehicleKey)) {
      state.maintenanceExpandedDetails.delete(vehicleKey);
    } else {
      state.maintenanceExpandedDetails.add(vehicleKey);
    }

    renderMaintenanceList();
    return;
  }

  const editButton = event.target.closest("[data-maintenance-edit]");

  if (editButton) {
    const vehicleId = String(editButton.getAttribute("data-maintenance-edit") || "").trim();
    const vehicle = state.maintenanceVehicles.find((item) => String(item._id || item.id || "") === vehicleId);

    if (vehicle) {
      openMaintenanceVehicleModal(vehicle);
    }

    return;
  }

  const deleteButton = event.target.closest("[data-maintenance-delete]");

  if (deleteButton) {
    const vehicleId = String(deleteButton.getAttribute("data-maintenance-delete") || "").trim();

    if (!vehicleId) {
      return;
    }

    const shouldDelete = window.confirm("¿Quieres eliminar este vehículo de mantenimiento?");

    if (!shouldDelete) {
      return;
    }

    deleteMaintenanceVehicle(vehicleId).catch((error) => {
      setFeedback(maintenanceFeedback, error.message, "error");
    });
  }
});
virtualDealershipImageClose?.addEventListener("click", closeVirtualDealershipImageModal);
virtualDealershipImageOverlay?.addEventListener("click", closeVirtualDealershipImageModal);
virtualDealershipImagePrev?.addEventListener("click", () => stepVirtualDealershipImageModal(-1));
virtualDealershipImageNext?.addEventListener("click", () => stepVirtualDealershipImageModal(1));
virtualDealershipImageDots?.addEventListener("click", (event) => {
  const dot = event.target.closest("[data-virtual-modal-dot-index]");

  if (!dot) {
    return;
  }

  const dotIndex = Number(dot.getAttribute("data-virtual-modal-dot-index") || 0);

  if (Number.isNaN(dotIndex)) {
    return;
  }

  virtualDealershipModalImageIndex = Math.min(Math.max(dotIndex, 0), Math.max(virtualDealershipModalImages.length - 1, 0));
  renderVirtualDealershipImageModal(true);
});
virtualDealershipVideoClose?.addEventListener("click", closeVirtualDealershipVideoModal);
virtualDealershipVideoOverlay?.addEventListener("click", closeVirtualDealershipVideoModal);
virtualDealershipVideoDate?.addEventListener("change", () => {
  virtualDealershipVideoContext.selectedDate = String(virtualDealershipVideoDate.value || "").trim();
  virtualDealershipVideoContext.selectedTime = "";

  if (!isWeekday(parseDateInputValue(virtualDealershipVideoContext.selectedDate))) {
    setVirtualDealershipVideoFeedback("Solo puedes agendar de lunes a viernes.", "error");
  } else {
    setVirtualDealershipVideoFeedback("");
  }

  renderVirtualDealershipVideoSlots();
});
virtualDealershipVideoSlots?.addEventListener("change", () => {
  virtualDealershipVideoContext.selectedTime = String(virtualDealershipVideoSlots.value || "").trim();
  setVirtualDealershipVideoFeedback("");
});
virtualDealershipVideoConfirm?.addEventListener("click", () => {
  const selectedDate = virtualDealershipVideoContext.selectedDate;
  const selectedTime = virtualDealershipVideoContext.selectedTime;

  if (!selectedDate) {
    setVirtualDealershipVideoFeedback("Selecciona una fecha para continuar.", "error");
    return;
  }

  const parsedDate = parseDateInputValue(selectedDate);

  if (!isWeekday(parsedDate)) {
    setVirtualDealershipVideoFeedback("Solo puedes agendar de lunes a viernes.", "error");
    return;
  }

  if (!selectedTime) {
    setVirtualDealershipVideoFeedback("Selecciona un horario de 15 minutos.", "error");
    return;
  }

  const userName = String(state.user?.name || state.user?.fullName || "Cliente").trim() || "Cliente";
  const vehicleTitle = virtualDealershipVideoContext.vehicleTitle || "vehículo publicado";
  const publicationUrl = virtualDealershipVideoContext.publicationUrl || window.location.href;
  const formattedDate = parsedDate
    ? parsedDate.toLocaleDateString("es-CO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
    : selectedDate;
  const [hourPart, minutePart] = selectedTime.split(":").map((value) => Number(value));
  const formattedTime = Number.isNaN(hourPart) || Number.isNaN(minutePart)
    ? selectedTime
    : formatVideoSlotLabel(hourPart, minutePart);

  const message = [
    "Hola, quiero agendar una videollamada para verla en vivo.",
    `Cliente: ${userName}`,
    `Vehículo: ${vehicleTitle}`,
    `Fecha: ${formattedDate}`,
    `Hora: ${formattedTime}`,
    `Publicación: ${publicationUrl}`,
  ].join("\n");

  setVirtualDealershipVideoFeedback("Perfecto, te llevamos a WhatsApp para confirmar la videollamada.", "success");
  openSequoiaWhatsappChat(message);
});
document.addEventListener("click", (event) => {
  const whatsappTrigger = event.target.closest("[data-whatsapp-message]");

  if (!whatsappTrigger) {
    return;
  }

  event.preventDefault();
  const encodedMessage = whatsappTrigger.getAttribute("data-whatsapp-message") || "";
  const message = encodedMessage ? decodeURIComponent(encodedMessage) : "";
  openSequoiaWhatsappChat(message);
});
notificationsList?.addEventListener("click", (event) => {
  const dismissButton = event.target.closest("[data-notification-dismiss]");

  if (!dismissButton) {
    return;
  }

  const notificationId = dismissButton.getAttribute("data-notification-dismiss");

  dismissNotification(notificationId).catch(() => null);
});

virtualDealershipClientList?.addEventListener("click", (event) => {
  const detailsToggle = event.target.closest("[data-virtual-details-toggle]");

  if (detailsToggle) {
    const vehicleKey = String(detailsToggle.getAttribute("data-virtual-details-toggle") || "");

    if (vehicleKey) {
      const isExpanded = state.virtualDealershipExpandedDetails.has(vehicleKey);

      if (isExpanded) {
        state.virtualDealershipExpandedDetails.delete(vehicleKey);
      } else {
        state.virtualDealershipExpandedDetails.add(vehicleKey);
      }

      const card = detailsToggle.closest(".virtual-dealership-card");
      const detailsPanel = card?.querySelector(".virtual-dealership-details");
      const nextExpanded = !isExpanded;

      detailsToggle.setAttribute("aria-expanded", String(nextExpanded));
      detailsToggle.textContent = nextExpanded ? "Ocultar detalles" : "Ver detalles";

      if (detailsPanel) {
        detailsPanel.classList.toggle("is-open", nextExpanded);
        detailsPanel.classList.toggle("is-collapsed", !nextExpanded);
      }
    }

    return;
  }

  const videoCallButton = event.target.closest("[data-virtual-video-call]");

  if (videoCallButton) {
    const vehicleTitle = decodeURIComponent(videoCallButton.getAttribute("data-virtual-video-title") || "");
    const publicationUrl = decodeURIComponent(videoCallButton.getAttribute("data-virtual-video-publication") || "");
    openVirtualDealershipVideoModal(vehicleTitle, publicationUrl);
    return;
  }

  const imageButton = event.target.closest("[data-virtual-image-url]");

  if (!imageButton) {
    return;
  }

  openVirtualDealershipImageModal(
    imageButton.getAttribute("data-virtual-vehicle-key"),
    Number(imageButton.getAttribute("data-virtual-image-index") || 0)
  );
});

menuButton?.addEventListener("click", () => {
  const isOpen = !sessionMenu.hidden;
  sessionMenu.hidden = isOpen;
});

logoutButton?.addEventListener("click", async () => {
  await requestLogout();
  clearAuth();
  redirectToLogin();
});

deleteAccountOpenButton?.addEventListener("click", openDeleteAccountModal);
deleteAccountCloseButton?.addEventListener("click", closeDeleteAccountModal);
deleteAccountCancelButton?.addEventListener("click", closeDeleteAccountModal);
deleteAccountOverlay?.addEventListener("click", closeDeleteAccountModal);
deleteAccountForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  submitDeleteAccount().catch((error) => {
    setFeedback(deleteAccountFeedback, error.message, "error");
  });
});

document.addEventListener("click", (event) => {
  if (sessionMenu && menuButton && !sessionMenu.contains(event.target) && !menuButton.contains(event.target)) {
    sessionMenu.hidden = true;
  }

  if (
    sequoiaCitySelector
    && sequoiaDeliveryCityButton
    && !sequoiaCitySelector.hidden
    && !sequoiaCitySelector.contains(event.target)
    && !sequoiaDeliveryCityButton.contains(event.target)
  ) {
    sequoiaCitySelector.hidden = true;
    sequoiaDeliveryCityButton.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeNotifications();
    closeMaintenanceVehicleModal();
    closeVirtualDealershipImageModal();
    closeVirtualDealershipVideoModal();
    closeDeleteAccountModal();
    sessionMenu.hidden = true;
    return;
  }

  if (virtualDealershipImageModal && !virtualDealershipImageModal.hidden) {
    if (event.key === "ArrowLeft") {
      stepVirtualDealershipImageModal(-1);
    }

    if (event.key === "ArrowRight") {
      stepVirtualDealershipImageModal(1);
    }
  }
});

window.addEventListener("touchstart", handlePullStart, { passive: true });
window.addEventListener("touchmove", handlePullMove, { passive: false });
window.addEventListener("touchend", handlePullEnd, { passive: true });
window.addEventListener("wheel", handleWheelRefresh, { passive: true });

window.addEventListener("load", () => {
  document.body.classList.add("motion-ready");
  setTrackingActiveTab("search");
});

// ─── Pago separación (post-DocuSign → Wompi) ─────────────────────────────
let pagoSepInitialized = false;

function initPagoSeparacionView() {
  if (pagoSepInitialized) return;
  pagoSepInitialized = true;

  const params = new URLSearchParams(window.location.search);
  const brand    = params.get("brand")    || "Vehículo";
  const model    = params.get("model")    || "";
  const version  = params.get("version")  || "";
  const extColor = params.get("extColor") || "";
  const intColor = params.get("intColor") || "";
  const city     = params.get("city")     || "";
  const price    = params.get("price")    || "";

  const container = document.getElementById("pago-sep-summary");
  const feedback  = document.getElementById("pago-sep-feedback");
  if (!container) return;

  const vehicleLabel = [brand, model, version].filter(Boolean).join(" ");

  container.innerHTML = `
    <header class="sequoia-order-summary-head">
      <h3>${escapeHtml(vehicleLabel)}</h3>
      <p>Has firmado el preacuerdo de compra exitosamente.</p>
    </header>
    <div style="margin:14px 0; font-size:14px; line-height:1.7;">
      ${extColor ? `<p><strong>Color exterior:</strong> ${escapeHtml(extColor)}</p>` : ""}
      ${intColor ? `<p><strong>Color interior:</strong> ${escapeHtml(intColor)}</p>` : ""}
      ${city     ? `<p><strong>Ciudad de entrega:</strong> ${escapeHtml(city)}</p>` : ""}
      ${price    ? `<p><strong>Precio total estimado:</strong> ${escapeHtml(price)}</p>` : ""}
    </div>
    <div class="sequoia-summary-paytoday">
      <div class="sequoia-summary-line">
        <strong>Paga hoy (separación)</strong>
        <strong>$ 1.000.000</strong>
      </div>
      <p>Monto no reembolsable salvo incumplimiento de Global Imports</p>
    </div>
    <button id="wompi-pay-button" class="sequoia-summary-order-button" type="button" disabled>
      Cargando pasarela de pago...
    </button>
  `;

  fetchJson("/api/client/payment/wompi-config")
    .then((cfg) => {
      const reference = `GI-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

      const successParams = new URLSearchParams();
      successParams.set("view", "pago-exitoso");
      if (brand)    successParams.set("brand",    brand);
      if (model)    successParams.set("model",    model);
      if (version)  successParams.set("version",  version);
      if (extColor) successParams.set("extColor", extColor);
      if (intColor) successParams.set("intColor", intColor);
      if (city)     successParams.set("city", city);
      successParams.set("reference", reference);
      const redirectAfterPayment = `${window.location.origin}/client.html?${successParams.toString()}`;

      // Siempre usar el dominio oficial de Wompi (sandbox y prod usan el mismo)
      const wompiUrl = new URL("https://checkout.wompi.co/p/");
      wompiUrl.searchParams.set("public-key",     cfg.publicKey);
      wompiUrl.searchParams.set("currency",        cfg.currency || "COP");
      wompiUrl.searchParams.set("amount-in-cents", String(cfg.amountInCents || 100000000));
      wompiUrl.searchParams.set("reference",       reference);
      wompiUrl.searchParams.set("redirect-url",    redirectAfterPayment);

      const btn = document.getElementById("wompi-pay-button");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Proceder al pago →";
        btn.addEventListener("click", () => { window.location.href = wompiUrl.toString(); });
      }
    })
    .catch(() => {
      if (feedback) {
        feedback.textContent = "No se pudo cargar la pasarela de pago. Intenta de nuevo.";
        feedback.className = "feedback error";
      }
      const btn = document.getElementById("wompi-pay-button");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Reintentar";
        btn.addEventListener("click", () => { pagoSepInitialized = false; initPagoSeparacionView(); });
      }
    });
}

// ─── Pago exitoso (post-Wompi → WhatsApp) ────────────────────────────────
let pagoExitoInitialized = false;

function initPagoExitosoView() {
  if (pagoExitoInitialized) {
    return;
  }

  pagoExitoInitialized = true;
  const params = new URLSearchParams(window.location.search);
  const brand    = params.get("brand")    || "Vehículo";
  const model    = params.get("model")    || "";
  const version  = params.get("version")  || "";
  const extColor = params.get("extColor") || "";
  const intColor = params.get("intColor") || "";
  const city = params.get("city") || "";
  const reference = params.get("reference") || "";
  const transactionId = params.get("id") || params.get("transactionId") || params.get("transaction_id") || "";
  const status = params.get("status") || "";

  const container = document.getElementById("pago-exito-body");
  if (!container) return;

  const vehicleLabel = [brand, model, version].filter(Boolean).join(" ");

  container.innerHTML = `
    <p style="font-size:14px; color:#6b7280; text-align:center;">Validando pago con Wompi...</p>
  `;

  if (!transactionId) {
    container.innerHTML = `
      <p style="font-size:14px; color:#dc2626; text-align:center;">
        No encontramos el identificador de la transacción. Si ya pagaste, contáctanos para validar manualmente.
      </p>
    `;
    return;
  }

  const waMessage =
    `¡Hola, Global Imports! Acabo de realizar el pago de separación de $1.000.000 para reservar mi ` +
    vehicleLabel +
    (extColor ? ` en color ${extColor}` : "") +
    (intColor ? ` con interior ${intColor}` : "") +
    `. ¿Cuál es el paso a seguir para formalizar el contrato de compra?`;

  const waUrl = buildSequoiaWhatsappUrl(waMessage);

  fetchJson("/api/client/payment/wompi-confirm", {
    method: "POST",
    body: JSON.stringify({
      transactionId,
      status,
      reference,
      brand,
      model,
      version,
      extColor,
      intColor,
      city,
      vehicle: {
        brand,
        model,
        version,
        exteriorColor: extColor,
        interiorColor: intColor,
      },
    }),
  }).then((result) => {
    if (!result?.paid) {
      container.innerHTML = `
        <p style="font-size:14px; color:#b45309; text-align:center;">
          El pago aún aparece como ${escapeHtml(String(result?.status || "PENDING"))}. Cuando se apruebe, verás tu confirmación aquí.
        </p>
      `;
      return;
    }

    container.innerHTML = `
      <div style="font-size:56px; margin-bottom:10px;">&#x2705;</div>
      <p style="font-size:15px; font-weight:600; margin-bottom:6px;">¡Pago confirmado y registrado!</p>
      <p style="font-size:13px; color:#4b5563; margin-bottom:20px;">
        Has separado tu <strong>${escapeHtml(vehicleLabel)}</strong>
        ${extColor ? `color <strong>${escapeHtml(extColor)}</strong>` : ""}.
        Tu compra ya fue notificada al sistema administrativo.
        Tracking: <strong>${escapeHtml(String(result?.trackingNumber || "por asignar"))}</strong>
      </p>
      <a href="${escapeHtml(waUrl)}"
         target="_blank" rel="noopener noreferrer"
         class="sequoia-summary-order-button"
         style="display:inline-block; text-decoration:none; background:#25d366; margin-bottom:14px;">
        &#x1F4AC; Contactar a Global Imports por WhatsApp
      </a>
      <p style="font-size:12px; color:#6b7280;">
        Al hacer clic entrarás a WhatsApp con un mensaje preescrito sobre tu vehículo reservado.
      </p>
    `;
  }).catch((error) => {
    container.innerHTML = `
      <p style="font-size:14px; color:#dc2626; text-align:center;">
        No pudimos validar el pago automáticamente. ${escapeHtml(error?.message || "Intenta recargar la página.")}
      </p>
    `;
  });
}

setActiveView(getInitialViewFromUrl());
registerClientImageCacheServiceWorker();

loadDashboard().catch((error) => {
  renderEmptyState(feedContainer, error.message);
  setFeedback(trackingSearchFeedback, error.message, "error");
  renderEmptyState(maintenanceList, error.message);
  renderEmptyState(notificationsList, error.message);
  renderEmptyState(virtualDealershipClientList, error.message);
});

if (state.activeView === "virtual-dealership") {
  loadVirtualDealership().catch(() => {
    // Keep dashboard usable if virtual dealership fetch fails during initial boot.
  });
}

setupInfiniteScroll();
setupVirtualDealershipInfiniteScroll();

if (feedContainer) {
  loadFeedPage({ reset: true }).catch((error) => {
    renderEmptyState(feedContainer, error.message);
    if (feedLoadingState) {
      feedLoadingState.textContent = error.message;
    }
  });
}
bindOrderExperience();
bindSequoiaConfigurator();