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

function buildTrackingPageUrl(trackingNumber = "") {
  const trackingUrl = new URL("/client-tracking.html", window.location.origin);
  trackingUrl.searchParams.set("v", TRACKING_PAGE_VERSION);

  if (trackingNumber) {
    trackingUrl.searchParams.set("tracking", String(trackingNumber).toUpperCase().trim());
  }

  return trackingUrl;
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

const SEQUOIA_VERSION_CONFIG = {
  sr5: {
    name: "SR5",
    price: 415000000,
    specs: [
      { label: "Potencia", value: "437 hp" },
      { label: "Motor", value: "i-FORCE MAX 3.4L" },
      { label: "Traccion", value: "4x4 Part-Time" },
    ],
    colors: [
      {
        key: "lunar-rock",
        name: "Lunar Rock",
        hex: "#7f8b80",
        tint: "rgba(108, 123, 113, 0.2)",
        images: [
          "/sr5%20lunar%20rock/srlr1.png",
          "/sr5%20lunar%20rock/srlr2.png",
          "/sr5%20lunar%20rock/srlr3.png",
          "/sr5%20lunar%20rock/srlr4.png",
          "/sr5%20lunar%20rock/srlr5.png",
          "/sr5%20lunar%20rock/srlr6.png",
          "/sr5%20lunar%20rock/srlr7.png",
          "/sr5%20lunar%20rock/srlr8.png",
          "/sr5%20lunar%20rock/srlr9.png",
          "/sr5%20lunar%20rock/srlr10.png",
          "/sr5%20lunar%20rock/srlr11.png",
          "/sr5%20lunar%20rock/srlr12.png",
          "/sr5%20lunar%20rock/srlr13.png",
          "/sr5%20lunar%20rock/slr14.png",
          "/sr5%20lunar%20rock/srlr15.png",
          "/sr5%20lunar%20rock/srlr16.png",
          "/sr5%20lunar%20rock/srlr17.png",
          "/sr5%20lunar%20rock/srlr18.png"
        ]
      },
      {
        key: "blueprint",
        name: "Blueprint",
        hex: "#2d4e84",
        tint: "rgba(44, 77, 132, 0.2)",
        images: [
          "/sr5%20blueprint/sr5bp01.png",
          "/sr5%20blueprint/sr5bp02.png",
          "/sr5%20blueprint/sr5bp03.png",
          "/sr5%20blueprint/sr5bp04.png",
          "/sr5%20blueprint/sr5bp05.png",
          "/sr5%20blueprint/sr5bp06.png",
          "/sr5%20blueprint/sr5bp07.png",
          "/sr5%20blueprint/sr5bp08.png",
          "/sr5%20blueprint/sr5bp09.png",
          "/sr5%20blueprint/sr5bp10.png",
          "/sr5%20blueprint/sr5bp11.png",
          "/sr5%20blueprint/sr5bp12.png",
          "/sr5%20blueprint/sr5bp13.png",
          "/sr5%20blueprint/sr5bp14.png",
          "/sr5%20blueprint/sr5bp15.png",
          "/sr5%20blueprint/sr5bp16.png",
          "/sr5%20blueprint/sr5bp17.png",
          "/sr5%20blueprint/sr5bp18.png"
        ]
      },
      {
        key: "celestial-silver-metallic",
        name: "Celestial Silver Metallic",
        hex: "#aeb3b8",
        tint: "rgba(170, 178, 187, 0.2)",
        images: [
          "/sr5%20celestial%20silver%20metalic/sr5csm01.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm02.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm03.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm04.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm05.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm06.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm07.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm08.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm09.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm10.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm11.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm12.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm13.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm14.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm15.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm16.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm17.png",
          "/sr5%20celestial%20silver%20metalic/sr5csm18.png"
        ]
      },
      {
        key: "magnetic-gray-metallic",
        name: "Magnetic Gray Metallic",
        hex: "#5f666e",
        tint: "rgba(90, 98, 107, 0.2)",
        images: [
          "/sr5%20magnetic%20gray%20metallic/sr5mgm01.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm02.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm03.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm04.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm05.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm06.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm07.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm08.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm09.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm10.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm11.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm12.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm13.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm14.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm15.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm16.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm17.png",
          "/sr5%20magnetic%20gray%20metallic/sr5mgm18.png"
        ]
      },
      {
        key: "midnight-black-metallic",
        name: "Midnight Black Metallic",
        hex: "#141516",
        tint: "rgba(8, 8, 9, 0.2)",
        images: [
          "/sr5%20midnight%20black%20metallic/sr5mbm01.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm02.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm03.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm04.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm05.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm06.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm07.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm08.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm09.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm10.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm11.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm12.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm13.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm14.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm15.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm16.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm17.png",
          "/sr5%20midnight%20black%20metallic/sr5mbm18.png"
        ]
      },
      {
        key: "ice-cap",
        name: "Ice Cap",
        hex: "#dde0df",
        tint: "rgba(215, 220, 220, 0.16)",
        images: [
          "/sr5%20ice%20cap/sr5ic01.png",
          "/sr5%20ice%20cap/sr5ic02.png",
          "/sr5%20ice%20cap/sr5ic03.png",
          "/sr5%20ice%20cap/sr5ic04.png",
          "/sr5%20ice%20cap/sr5ic05.png",
          "/sr5%20ice%20cap/sr5ic06.png",
          "/sr5%20ice%20cap/sr5ic07.png",
          "/sr5%20ice%20cap/sr5ic08.png",
          "/sr5%20ice%20cap/sr5ic09.png",
          "/sr5%20ice%20cap/sr5ic10.png",
          "/sr5%20ice%20cap/sr5ic11.png",
          "/sr5%20ice%20cap/sr5ic12.png",
          "/sr5%20ice%20cap/sr5ic13.png",
          "/sr5%20ice%20cap/sr5ic14.png",
          "/sr5%20ice%20cap/sr5ic15.png",
          "/sr5%20ice%20cap/sr5ic16.png",
          "/sr5%20ice%20cap/sr5ic17.png",
          "/sr5%20ice%20cap/sr5ic18.png"
        ]
      },
      {
        key: "mudbath",
        name: "Mudbath",
        hex: "#8a7b6b",
        tint: "rgba(138, 123, 107, 0.2)",
        images: [
          "/sr5%20mudbath/sr5mdb01.png",
          "/sr5%20mudbath/sr5mdb02.png",
          "/sr5%20mudbath/sr5mdb03.png",
          "/sr5%20mudbath/sr5mdb04.png",
          "/sr5%20mudbath/sr5mdb05.png",
          "/sr5%20mudbath/sr5mdb06.png",
          "/sr5%20mudbath/sr5mdb07.png",
          "/sr5%20mudbath/sr5mdb08.png",
          "/sr5%20mudbath/sr5mdb09.png",
          "/sr5%20mudbath/sr5mdb10.png",
          "/sr5%20mudbath/sr5mdb11.png",
          "/sr5%20mudbath/sr5mdb12.png",
          "/sr5%20mudbath/sr5mdb13.png",
          "/sr5%20mudbath/sr5mdb14.png",
          "/sr5%20mudbath/sr5mdb15.png",
          "/sr5%20mudbath/sr5mdb16.png",
          "/sr5%20mudbath/sr5mdb17.png",
          "/sr5%20mudbath/sr5mdb18.png"
        ]
      },
    ],
  },
  limited: {
    name: "LIMITED",
    price: 450000000,
    specs: [
      { label: "Potencia", value: "437 hp" },
      { label: "Asientos", value: "Cuero + calefaccion" },
      { label: "Audio", value: "JBL Premium" },
    ],
    colors: [
      {
        key: "lunar-rock",
        name: "Lunar Rock",
        hex: "#7f8b80",
        tint: "rgba(108, 123, 113, 0.2)",
        images: [
          "/limited%20lunar%20rock/ltlr01.png",
          "/limited%20lunar%20rock/ltlr02.png",
          "/limited%20lunar%20rock/ltlr03.png",
          "/limited%20lunar%20rock/ltlr04.png",
          "/limited%20lunar%20rock/ltlr05.png",
          "/limited%20lunar%20rock/ltlr06.png",
          "/limited%20lunar%20rock/ltlr07.png",
          "/limited%20lunar%20rock/ltlr08.png",
          "/limited%20lunar%20rock/ltlr09.png",
          "/limited%20lunar%20rock/ltlr10.png",
          "/limited%20lunar%20rock/ltlr11.png",
          "/limited%20lunar%20rock/ltlr12.png",
          "/limited%20lunar%20rock/ltlr13.png",
          "/limited%20lunar%20rock/ltlr14.png",
          "/limited%20lunar%20rock/ltlr15.png",
          "/limited%20lunar%20rock/ltlr16.png",
          "/limited%20lunar%20rock/ltlr17.png",
          "/limited%20lunar%20rock/ltlr18.png"
        ]
      },
      {
        key: "blueprint",
        name: "Blueprint",
        hex: "#2d4e84",
        tint: "rgba(44, 77, 132, 0.2)",
        images: [
          "/limited%20blueprint/ltbp01.png",
          "/limited%20blueprint/ltbp02.png",
          "/limited%20blueprint/ltbp03.png",
          "/limited%20blueprint/ltbp04.png",
          "/limited%20blueprint/ltbp05.png",
          "/limited%20blueprint/ltbp06.png",
          "/limited%20blueprint/ltbp07.png",
          "/limited%20blueprint/ltbp08.png",
          "/limited%20blueprint/ltbp09.png",
          "/limited%20blueprint/ltbp10.png",
          "/limited%20blueprint/ltbp11.png",
          "/limited%20blueprint/ltbp12.png",
          "/limited%20blueprint/ltbp13.png",
          "/limited%20blueprint/ltbp14.png",
          "/limited%20blueprint/ltbp15.png",
          "/limited%20blueprint/ltbp16.png",
          "/limited%20blueprint/ltbp17.png",
          "/limited%20blueprint/ltbp18.png"
        ]
      },
      {
        key: "celestial-silver-metallic",
        name: "Celestial Silver Metallic",
        hex: "#aeb3b8",
        tint: "rgba(170, 178, 187, 0.2)",
        images: [
          "/limited%20celestial%20silver%20metallic/ltcsm01.png",
          "/limited%20celestial%20silver%20metallic/ltcsm02.png",
          "/limited%20celestial%20silver%20metallic/ltcsm03.png",
          "/limited%20celestial%20silver%20metallic/ltcsm04.png",
          "/limited%20celestial%20silver%20metallic/ltcsm05.png",
          "/limited%20celestial%20silver%20metallic/ltcsm06.png",
          "/limited%20celestial%20silver%20metallic/ltcsm07.png",
          "/limited%20celestial%20silver%20metallic/ltcsm08.png",
          "/limited%20celestial%20silver%20metallic/ltcsm09.png",
          "/limited%20celestial%20silver%20metallic/ltcsm10.png",
          "/limited%20celestial%20silver%20metallic/ltcsm11.png",
          "/limited%20celestial%20silver%20metallic/ltcsm12.png",
          "/limited%20celestial%20silver%20metallic/ltcsm13.png",
          "/limited%20celestial%20silver%20metallic/ltcsm14.png",
          "/limited%20celestial%20silver%20metallic/ltcsm15.png",
          "/limited%20celestial%20silver%20metallic/ltcsm16.png",
          "/limited%20celestial%20silver%20metallic/ltcsm17.png",
          "/limited%20celestial%20silver%20metallic/ltcsm18.png"
        ]
      },
      {
        key: "magnetic-gray-metallic",
        name: "Magnetic Gray Metallic",
        hex: "#5f666e",
        tint: "rgba(90, 98, 107, 0.2)",
        images: [
          "/limited%20magnetic%20gray%20metallic/ltmgm01.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm02.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm03.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm04.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm05.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm06.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm07.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm08.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm09.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm10.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm11.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm12.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm13.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm14.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm15.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm16.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm17.png",
          "/limited%20magnetic%20gray%20metallic/ltmgm18.png"
        ]
      },
      {
        key: "midnight-black-metallic",
        name: "Midnight Black Metallic",
        hex: "#141516",
        tint: "rgba(8, 8, 9, 0.2)",
        images: [
          "/limited%20midnight%20black%20metallic/ltmbm01.png",
          "/limited%20midnight%20black%20metallic/ltmbm02.png",
          "/limited%20midnight%20black%20metallic/ltmbm03.png",
          "/limited%20midnight%20black%20metallic/ltmbm04.png",
          "/limited%20midnight%20black%20metallic/ltmbm05.png",
          "/limited%20midnight%20black%20metallic/ltmbm06.png",
          "/limited%20midnight%20black%20metallic/ltmbm07.png",
          "/limited%20midnight%20black%20metallic/ltmbm08.png",
          "/limited%20midnight%20black%20metallic/ltmbm09.png",
          "/limited%20midnight%20black%20metallic/ltmbm10.png",
          "/limited%20midnight%20black%20metallic/ltmbm11.png",
          "/limited%20midnight%20black%20metallic/ltmbm12.png",
          "/limited%20midnight%20black%20metallic/ltmbm13.png",
          "/limited%20midnight%20black%20metallic/ltmbm14.png",
          "/limited%20midnight%20black%20metallic/ltmbm15.png",
          "/limited%20midnight%20black%20metallic/ltmbm16.png",
          "/limited%20midnight%20black%20metallic/ltmbm17.png",
          "/limited%20midnight%20black%20metallic/ltmbm18.png"
        ]
      },
      {
        key: "ice-cap",
        name: "Ice Cap",
        hex: "#dde0df",
        tint: "rgba(215, 220, 220, 0.16)",
        images: [
          "/limited%20ice%20cap/ltic01.png",
          "/limited%20ice%20cap/ltic02.png",
          "/limited%20ice%20cap/ltic03.png",
          "/limited%20ice%20cap/ltic04.png",
          "/limited%20ice%20cap/ltic05.png",
          "/limited%20ice%20cap/ltic06.png",
          "/limited%20ice%20cap/ltic07.png",
          "/limited%20ice%20cap/ltic08.png",
          "/limited%20ice%20cap/ltic09.png",
          "/limited%20ice%20cap/ltic10.png",
          "/limited%20ice%20cap/ltic11.png",
          "/limited%20ice%20cap/ltic12.png",
          "/limited%20ice%20cap/ltic13.png",
          "/limited%20ice%20cap/ltic14.png",
          "/limited%20ice%20cap/ltic15.png",
          "/limited%20ice%20cap/ltic16.png",
          "/limited%20ice%20cap/ltic17.png",
          "/limited%20ice%20cap/ltic18.png"
        ]
      },
      {
        key: "wind-chill-pearl",
        name: "Wind Chill Pearl",
        hex: "#dfe3e8",
        tint: "rgba(204, 211, 218, 0.16)",
        images: [
          "/limited%20wind%20chill%20pearl/ltwcp01.png",
          "/limited%20wind%20chill%20pearl/ltwcp02.png",
          "/limited%20wind%20chill%20pearl/ltwcp03.png",
          "/limited%20wind%20chill%20pearl/ltwcp04.png",
          "/limited%20wind%20chill%20pearl/ltwcp05.png",
          "/limited%20wind%20chill%20pearl/ltwcp06.png",
          "/limited%20wind%20chill%20pearl/ltwcp07.png",
          "/limited%20wind%20chill%20pearl/ltwcp08.png",
          "/limited%20wind%20chill%20pearl/ltwcp09.png",
          "/limited%20wind%20chill%20pearl/ltwcp10.png",
          "/limited%20wind%20chill%20pearl/ltwcp11.png",
          "/limited%20wind%20chill%20pearl/ltwcp12.png",
          "/limited%20wind%20chill%20pearl/ltwcp13.png",
          "/limited%20wind%20chill%20pearl/ltwcp14.png",
          "/limited%20wind%20chill%20pearl/ltwcp15.png",
          "/limited%20wind%20chill%20pearl/ltwcp16.png",
          "/limited%20wind%20chill%20pearl/ltwcp17.png",
          "/limited%20wind%20chill%20pearl/ltwcp18.png"
        ]
      },
      {
        key: "mudbath",
        name: "Mudbath",
        hex: "#8a7b6b",
        tint: "rgba(138, 123, 107, 0.2)",
        images: [
          "/limited%20mudbath/ltmdb01.png",
          "/limited%20mudbath/ltmdb02.png",
          "/limited%20mudbath/ltmdb03.png",
          "/limited%20mudbath/ltmdb04.png",
          "/limited%20mudbath/ltmdb05.png",
          "/limited%20mudbath/ltmdb06.png",
          "/limited%20mudbath/ltmdb07.png",
          "/limited%20mudbath/ltmdb08.png",
          "/limited%20mudbath/ltmdb09.png",
          "/limited%20mudbath/ltmdb10.png",
          "/limited%20mudbath/ltmdb11.png",
          "/limited%20mudbath/ltmdb12.png",
          "/limited%20mudbath/ltmdb13.png",
          "/limited%20mudbath/ltmdb14.png",
          "/limited%20mudbath/ltmdb15.png",
          "/limited%20mudbath/ltmdb16.png",
          "/limited%20mudbath/ltmdb17.png",
          "/limited%20mudbath/ltmdb18.png"
        ]
      },
    ],
  },
  platinum: {
    name: "PLATINUM",
    price: 520000000,
    specs: [
      { label: "Sunroof", value: "Panoramico" },
      { label: "Pantalla", value: "14\" Multimedia" },
      { label: "Suspension", value: "AVS Adaptativa" },
    ],
    colors: [
      {
        key: "lunar-rock",
        name: "Lunar Rock",
        hex: "#7f8b80",
        tint: "rgba(108, 123, 113, 0.2)",
        images: [
          "/platinum%20lunar%20rock/ptlr01.png",
          "/platinum%20lunar%20rock/ptlr02.png",
          "/platinum%20lunar%20rock/ptlr03.png",
          "/platinum%20lunar%20rock/ptlr04.png",
          "/platinum%20lunar%20rock/ptlr05.png",
          "/platinum%20lunar%20rock/ptlr06.png",
          "/platinum%20lunar%20rock/ptlr07.png",
          "/platinum%20lunar%20rock/ptlr08.png",
          "/platinum%20lunar%20rock/ptlr09.png",
          "/platinum%20lunar%20rock/ptlr10.png",
          "/platinum%20lunar%20rock/ptlr11.png",
          "/platinum%20lunar%20rock/ptlr12.png",
          "/platinum%20lunar%20rock/ptlr13.png",
          "/platinum%20lunar%20rock/ptlr14.png",
          "/platinum%20lunar%20rock/ptlr15.png",
          "/platinum%20lunar%20rock/ptlr16.png",
          "/platinum%20lunar%20rock/ptlr17.png",
          "/platinum%20lunar%20rock/ptlr18.png"
        ]
      },
      {
        key: "blueprint",
        name: "Blueprint",
        hex: "#2d4e84",
        tint: "rgba(44, 77, 132, 0.2)",
        images: [
          "/platinum%20blueprint/ptbp01.png",
          "/platinum%20blueprint/ptbp02.png",
          "/platinum%20blueprint/ptbp03.png",
          "/platinum%20blueprint/ptbp04.png",
          "/platinum%20blueprint/ptbp05.png",
          "/platinum%20blueprint/ptbp06.png",
          "/platinum%20blueprint/ptbp07.png",
          "/platinum%20blueprint/ptbp08.png",
          "/platinum%20blueprint/ptbp09.png",
          "/platinum%20blueprint/ptbp10.png",
          "/platinum%20blueprint/ptbp11.png",
          "/platinum%20blueprint/ptbp12.png",
          "/platinum%20blueprint/ptbp13.png",
          "/platinum%20blueprint/ptbp14.png",
          "/platinum%20blueprint/ptbp15.png",
          "/platinum%20blueprint/ptbp16.png",
          "/platinum%20blueprint/ptbp17.png",
          "/platinum%20blueprint/ptbp18.png"
        ]
      },
      {
        key: "celestial-silver-metallic",
        name: "Celestial Silver Metallic",
        hex: "#aeb3b8",
        tint: "rgba(170, 178, 187, 0.2)",
        images: [
          "/platinum%20celestial%20silver%20metallic/ptcsm01.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm02.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm03.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm04.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm05.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm06.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm07.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm08.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm09.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm10.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm11.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm12.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm13.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm14.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm15.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm16.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm17.png",
          "/platinum%20celestial%20silver%20metallic/ptcsm18.png"
        ]
      },
      {
        key: "magnetic-gray-metallic",
        name: "Magnetic Gray Metallic",
        hex: "#5f666e",
        tint: "rgba(90, 98, 107, 0.2)",
        images: [
          "/platinum%20magnetic%20gray%20metallic/ptmgm01.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm02.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm03.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm04.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm05.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm06.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm07.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm08.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm09.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm10.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm11.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm12.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm13.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm14.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm15.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm16.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm17.png",
          "/platinum%20magnetic%20gray%20metallic/ptmgm18.png"
        ]
      },
      {
        key: "midnight-black-metallic",
        name: "Midnight Black Metallic",
        hex: "#141516",
        tint: "rgba(8, 8, 9, 0.2)",
        images: [
          "/platinum%20midnight%20black%20metallic/ptmbm01.png",
          "/platinum%20midnight%20black%20metallic/ptmbm02.png",
          "/platinum%20midnight%20black%20metallic/ptmbm03.png",
          "/platinum%20midnight%20black%20metallic/ptmbm04.png",
          "/platinum%20midnight%20black%20metallic/ptmbm05.png",
          "/platinum%20midnight%20black%20metallic/ptmbm06.png",
          "/platinum%20midnight%20black%20metallic/ptmbm07.png",
          "/platinum%20midnight%20black%20metallic/ptmbm08.png",
          "/platinum%20midnight%20black%20metallic/ptmbm09.png",
          "/platinum%20midnight%20black%20metallic/ptmbm10.png",
          "/platinum%20midnight%20black%20metallic/ptmbm11.png",
          "/platinum%20midnight%20black%20metallic/ptmbm12.png",
          "/platinum%20midnight%20black%20metallic/ptmbm13.png",
          "/platinum%20midnight%20black%20metallic/ptmbm14.png",
          "/platinum%20midnight%20black%20metallic/ptmbm15.png",
          "/platinum%20midnight%20black%20metallic/ptmbm16.png",
          "/platinum%20midnight%20black%20metallic/ptmbm17.png",
          "/platinum%20midnight%20black%20metallic/ptmbm18.png"
        ]
      },
      {
        key: "wind-chill-pearl",
        name: "Wind Chill Pearl",
        hex: "#dfe3e8",
        tint: "rgba(204, 211, 218, 0.16)",
        images: [
          "/platinum%20wind%20chill%20pearl/ptwcp01.png",
          "/platinum%20wind%20chill%20pearl/ptwcp02.png",
          "/platinum%20wind%20chill%20pearl/ptwcp03.png",
          "/platinum%20wind%20chill%20pearl/ptwcp04.png",
          "/platinum%20wind%20chill%20pearl/ptwcp05.png",
          "/platinum%20wind%20chill%20pearl/ptwcp06.png",
          "/platinum%20wind%20chill%20pearl/ptwcp07.png",
          "/platinum%20wind%20chill%20pearl/ptwcp08.png",
          "/platinum%20wind%20chill%20pearl/ptwcp09.png",
          "/platinum%20wind%20chill%20pearl/ptwcp10.png",
          "/platinum%20wind%20chill%20pearl/ptwcp11.png",
          "/platinum%20wind%20chill%20pearl/ptwcp12.png",
          "/platinum%20wind%20chill%20pearl/ptwcp13.png",
          "/platinum%20wind%20chill%20pearl/ptwcp14.png",
          "/platinum%20wind%20chill%20pearl/ptwcp15.png",
          "/platinum%20wind%20chill%20pearl/ptwcp16.png",
          "/platinum%20wind%20chill%20pearl/ptwcp17.png",
          "/platinum%20wind%20chill%20pearl/ptwcp18.png"
        ]
      },
      {
        key: "mudbath",
        name: "Mudbath",
        hex: "#8a7b6b",
        tint: "rgba(138, 123, 107, 0.2)",
        images: [
          "/platinum%20mudbath/ptmdb01.png",
          "/platinum%20mudbath/ptmdb02.png",
          "/platinum%20mudbath/ptmdb03.png",
          "/platinum%20mudbath/ptmdb04.png",
          "/platinum%20mudbath/ptmdb05.png",
          "/platinum%20mudbath/ptmdb06.png",
          "/platinum%20mudbath/ptmdb07.png",
          "/platinum%20mudbath/ptmdb08.png",
          "/platinum%20mudbath/ptmdb09.png",
          "/platinum%20mudbath/ptmdb10.png",
          "/platinum%20mudbath/ptmdb11.png",
          "/platinum%20mudbath/ptmdb12.png",
          "/platinum%20mudbath/ptmdb13.png",
          "/platinum%20mudbath/ptmdb14.png",
          "/platinum%20mudbath/ptmdb15.png",
          "/platinum%20mudbath/ptmdb16.png",
          "/platinum%20mudbath/ptmdb17.png",
          "/platinum%20mudbath/ptmdb18.png"
        ]
      },
    ],
  },
  "trd-pro": {
    name: "TRD PRO",
    price: 520000000,
    specs: [
      { label: "Suspension", value: "FOX Off-Road" },
      { label: "Llantas", value: "TRD 18\"" },
      { label: "Terreno", value: "Multi-Terrain Select" },
    ],
    colors: [
      {
        key: "wave-maker",
        name: "Wave Maker",
        hex: "#4f8aa2",
        tint: "rgba(76, 134, 160, 0.2)",
        images: [
          "/trd%20wave%20maker/trdwm01.png",
          "/trd%20wave%20maker/trdwm02.png",
          "/trd%20wave%20maker/trdwm03.png",
          "/trd%20wave%20maker/trdwm04.png",
          "/trd%20wave%20maker/trdwm05.png",
          "/trd%20wave%20maker/trdwm06.png",
          "/trd%20wave%20maker/trdwm07.png",
          "/trd%20wave%20maker/trdwm08.png",
          "/trd%20wave%20maker/trdwm09.png",
          "/trd%20wave%20maker/trdwm10.png",
          "/trd%20wave%20maker/trdwm11.png",
          "/trd%20wave%20maker/trdwm12.png",
          "/trd%20wave%20maker/trdwm13.png",
          "/trd%20wave%20maker/trdwm14.png",
          "/trd%20wave%20maker/trdwm15.png",
          "/trd%20wave%20maker/trdwm16.png",
          "/trd%20wave%20maker/trdwm17.png",
          "/trd%20wave%20maker/trdwm18.png"
        ]
      },
      {
        key: "magnetic-gray-metallic",
        name: "Magnetic Gray Metallic",
        hex: "#5f666e",
        tint: "rgba(90, 98, 107, 0.2)",
        images: [
          "/trd%20magnetic%20gray%20metallic/trdmgm01.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm02.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm03.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm04.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm05.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm06.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm07.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm08.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm09.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm10.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm11.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm12.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm13.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm14.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm15.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm16.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm17.png",
          "/trd%20magnetic%20gray%20metallic/trdmgm18.png"
        ]
      },
      {
        key: "midnight-black-metallic",
        name: "Midnight Black Metallic",
        hex: "#141516",
        tint: "rgba(8, 8, 9, 0.2)",
        images: [
          "/trd%20midnight%20black%20metallic/trdmbm01.png",
          "/trd%20midnight%20black%20metallic/trdmbm02.png",
          "/trd%20midnight%20black%20metallic/trdmbm03.png",
          "/trd%20midnight%20black%20metallic/trdmbm04.png",
          "/trd%20midnight%20black%20metallic/trdmbm05.png",
          "/trd%20midnight%20black%20metallic/trdmbm06.png",
          "/trd%20midnight%20black%20metallic/trdmbm07.png",
          "/trd%20midnight%20black%20metallic/trdmbm08.png",
          "/trd%20midnight%20black%20metallic/trdmbm09.png",
          "/trd%20midnight%20black%20metallic/trdmbm10.png",
          "/trd%20midnight%20black%20metallic/trdmbm11.png",
          "/trd%20midnight%20black%20metallic/trdmbm12.png",
          "/trd%20midnight%20black%20metallic/trdmbm13.png",
          "/trd%20midnight%20black%20metallic/trdmbm14.png",
          "/trd%20midnight%20black%20metallic/trdmbm15.png",
          "/trd%20midnight%20black%20metallic/trdmbm16.png",
          "/trd%20midnight%20black%20metallic/trdmbm17.png",
          "/trd%20midnight%20black%20metallic/trdmbm18.png"
        ]
      },
    ],
  },
  capstone: {
    name: "CAPSTONE",
    price: 520000000,
    specs: [
      { label: "Interior", value: "Semi-anilina premium" },
      { label: "Rines", value: "22\" cromados" },
      { label: "Asistencias", value: "Toyota Safety Sense" },
    ],
    colors: [
      {
        key: "blueprint",
        name: "Blueprint",
        hex: "#2d4e84",
        tint: "rgba(44, 77, 132, 0.2)",
        images: [
          "/capstone%20blueprint/cpbp01.png",
          "/capstone%20blueprint/cpbp02.png",
          "/capstone%20blueprint/cpbp03.png",
          "/capstone%20blueprint/cpbp04.png",
          "/capstone%20blueprint/cpbp05.png",
          "/capstone%20blueprint/cpbp06.png",
          "/capstone%20blueprint/cpbp07.png",
          "/capstone%20blueprint/cpbp08.png",
          "/capstone%20blueprint/cpbp09.png",
          "/capstone%20blueprint/cpbp10.png",
          "/capstone%20blueprint/cpbp11.png",
          "/capstone%20blueprint/cpbp12.png",
          "/capstone%20blueprint/cpbp13.png",
          "/capstone%20blueprint/cpbp14.png",
          "/capstone%20blueprint/cpbp15.png",
          "/capstone%20blueprint/cpbp16.png",
          "/capstone%20blueprint/cpbp17.png",
          "/capstone%20blueprint/cpbp18.png"
        ]
      },
      {
        key: "celestial-silver-metallic",
        name: "Celestial Silver Metallic",
        hex: "#aeb3b8",
        tint: "rgba(170, 178, 187, 0.2)",
        images: [
          "/capstone%20celestial%20silver%20metallic/cpcsm01.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm02.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm03.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm04.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm05.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm06.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm07.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm08.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm09.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm10.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm11.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm12.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm13.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm14.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm15.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm16.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm17.png",
          "/capstone%20celestial%20silver%20metallic/cpcsm18.png"
        ]
      },
      {
        key: "magnetic-gray-metallic",
        name: "Magnetic Gray Metallic",
        hex: "#5f666e",
        tint: "rgba(90, 98, 107, 0.2)",
        images: [
          "/capstone%20magnetic%20gray%20metallic/cpmgm01.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm02.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm03.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm04.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm05.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm06.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm07.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm08.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm09.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm10.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm11.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm12.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm13.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm14.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm15.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm16.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm17.png",
          "/capstone%20magnetic%20gray%20metallic/cpmgm18.png"
        ]
      },
      {
        key: "midnight-black-metallic",
        name: "Midnight Black Metallic",
        hex: "#141516",
        tint: "rgba(8, 8, 9, 0.2)",
        images: [
          "/capstone%20midnight%20black%20metallic/cpmbm01.png",
          "/capstone%20midnight%20black%20metallic/cpmbm02.png",
          "/capstone%20midnight%20black%20metallic/cpmbm03.png",
          "/capstone%20midnight%20black%20metallic/cpmbm04.png",
          "/capstone%20midnight%20black%20metallic/cpmbm05.png",
          "/capstone%20midnight%20black%20metallic/cpmbm06.png",
          "/capstone%20midnight%20black%20metallic/cpmbm07.png",
          "/capstone%20midnight%20black%20metallic/cpmbm08.png",
          "/capstone%20midnight%20black%20metallic/cpmbm09.png",
          "/capstone%20midnight%20black%20metallic/cpmbm10.png",
          "/capstone%20midnight%20black%20metallic/cpmbm11.png",
          "/capstone%20midnight%20black%20metallic/cpmbm12.png",
          "/capstone%20midnight%20black%20metallic/cpmbm13.png",
          "/capstone%20midnight%20black%20metallic/cpmbm14.png",
          "/capstone%20midnight%20black%20metallic/cpmbm15.png",
          "/capstone%20midnight%20black%20metallic/cpmbm16.png",
          "/capstone%20midnight%20black%20metallic/cpmbm17.png",
          "/capstone%20midnight%20black%20metallic/cpmbm18.png"
        ]
      },
      {
        key: "wind-chill-pearl",
        name: "Wind Chill Pearl",
        hex: "#dfe3e8",
        tint: "rgba(204, 211, 218, 0.16)",
        images: [
          "/capstone%20wind%20chill%20pearl/cpwcp01.png",
          "/capstone%20wind%20chill%20pearl/cpwcp02.png",
          "/capstone%20wind%20chill%20pearl/cpwcp03.png",
          "/capstone%20wind%20chill%20pearl/cpwcp04.png",
          "/capstone%20wind%20chill%20pearl/cpwcp05.png",
          "/capstone%20wind%20chill%20pearl/cpwcp06.png",
          "/capstone%20wind%20chill%20pearl/cpwcp07.png",
          "/capstone%20wind%20chill%20pearl/cpwcp08.png",
          "/capstone%20wind%20chill%20pearl/cpwcp09.png",
          "/capstone%20wind%20chill%20pearl/cpwcp10.png",
          "/capstone%20wind%20chill%20pearl/cpwcp11.png",
          "/capstone%20wind%20chill%20pearl/cpwcp12.png",
          "/capstone%20wind%20chill%20pearl/cpwcp13.png",
          "/capstone%20wind%20chill%20pearl/cpwcp14.png",
          "/capstone%20wind%20chill%20pearl/cpwcp15.png",
          "/capstone%20wind%20chill%20pearl/cpwcp16.png",
          "/capstone%20wind%20chill%20pearl/cpwcp17.png",
          "/capstone%20wind%20chill%20pearl/cpwcp18.png"
        ]
      },
    ],
  },
  "1794": {
    name: "1794",
    price: 520000000,
    specs: [
      { label: "Interior", value: "Saddle tan heritage" },
      { label: "Acabados", value: "Madera natural" },
      { label: "Confort", value: "Asientos ventilados" },
    ],
    colors: [
      {
        key: "blueprint",
        name: "Blueprint",
        hex: "#1f335f",
        tint: "rgba(46, 66, 110, 0.22)",
        images: [
          "/1794%20blueprint/n1794bp01.png",
          "/1794%20blueprint/n1794bp02.png",
          "/1794%20blueprint/n1794bp03.png",
          "/1794%20blueprint/n1794bp04.png",
          "/1794%20blueprint/n1794bp05.png",
          "/1794%20blueprint/n1794bp06.png",
          "/1794%20blueprint/n1794bp07.png",
          "/1794%20blueprint/n1794bp08.png",
          "/1794%20blueprint/n1794bp09.png",
          "/1794%20blueprint/n1794bp10.png",
          "/1794%20blueprint/n1794bp11.png",
          "/1794%20blueprint/n1794bp12.png",
          "/1794%20blueprint/n1794bp13.png",
          "/1794%20blueprint/n1794bp14.png",
          "/1794%20blueprint/n1794bp15.png",
          "/1794%20blueprint/n1794bp16.png",
          "/1794%20blueprint/n1794bp17.png",
          "/1794%20blueprint/n1794bp18.png"
        ]
      },
      {
        key: "celestial-silver-metallic",
        name: "Celestial Silver Metallic",
        hex: "#c6c8cc",
        tint: "rgba(180, 184, 189, 0.2)",
        images: [
          "/1794%20celestial%20silver%20metallic/n1794csm01.png",
          "/1794%20celestial%20silver%20metallic/n1794csm02.png",
          "/1794%20celestial%20silver%20metallic/n1794csm03.png",
          "/1794%20celestial%20silver%20metallic/n1794csm04.png",
          "/1794%20celestial%20silver%20metallic/n1794csm05.png",
          "/1794%20celestial%20silver%20metallic/n1794csm06.png",
          "/1794%20celestial%20silver%20metallic/n1794csm07.png",
          "/1794%20celestial%20silver%20metallic/n1794csm08.png",
          "/1794%20celestial%20silver%20metallic/n1794csm09.png",
          "/1794%20celestial%20silver%20metallic/n1794csm10.png",
          "/1794%20celestial%20silver%20metallic/n1794csm11.png",
          "/1794%20celestial%20silver%20metallic/n1794csm12.png",
          "/1794%20celestial%20silver%20metallic/n1794csm13.png",
          "/1794%20celestial%20silver%20metallic/n1794csm14.png",
          "/1794%20celestial%20silver%20metallic/n1794csm15.png",
          "/1794%20celestial%20silver%20metallic/n1794csm16.png",
          "/1794%20celestial%20silver%20metallic/n1794csm17.png",
          "/1794%20celestial%20silver%20metallic/n1794csm18.png"
        ]
      },
      {
        key: "lunar-rock",
        name: "Lunar Rock",
        hex: "#7e7b6f",
        tint: "rgba(112, 108, 98, 0.2)",
        images: [
          "/1794%20lunar%20rock/n1794lr01.png",
          "/1794%20lunar%20rock/n1794lr02.png",
          "/1794%20lunar%20rock/n1794lr03.png",
          "/1794%20lunar%20rock/n1794lr04.png",
          "/1794%20lunar%20rock/n1794lr05.png",
          "/1794%20lunar%20rock/n1794lr06.png",
          "/1794%20lunar%20rock/n1794lr07.png",
          "/1794%20lunar%20rock/n1794lr08.png",
          "/1794%20lunar%20rock/n1794lr09.png",
          "/1794%20lunar%20rock/n1794lr10.png",
          "/1794%20lunar%20rock/n1794lr11.png",
          "/1794%20lunar%20rock/n1794lr12.png",
          "/1794%20lunar%20rock/n1794lr13.png",
          "/1794%20lunar%20rock/n1794lr14.png",
          "/1794%20lunar%20rock/n1794lr15.png",
          "/1794%20lunar%20rock/n1794lr16.png",
          "/1794%20lunar%20rock/n1794lr17.png",
          "/1794%20lunar%20rock/n1794lr18.png"
        ]
      },
      {
        key: "magnetic-gray-metallic",
        name: "Magnetic Gray Metallic",
        hex: "#5f666e",
        tint: "rgba(90, 98, 107, 0.2)",
        images: [
          "/1794%20magnetic%20gray%20metallic/n1794mgm01.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm02.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm03.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm04.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm05.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm06.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm07.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm08.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm09.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm10.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm11.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm12.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm13.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm14.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm15.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm16.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm17.png",
          "/1794%20magnetic%20gray%20metallic/n1794mgm18.png"
        ]
      },
      {
        key: "midnight-black-metallic",
        name: "Midnight Black Metallic",
        hex: "#141516",
        tint: "rgba(8, 8, 9, 0.2)",
        images: [
          "/1794%20midnight%20black%20metallic/n1794mbm01.png",
          "/1794%20midnight%20black%20metallic/n1794mbm02.png",
          "/1794%20midnight%20black%20metallic/n1794mbm03.png",
          "/1794%20midnight%20black%20metallic/n1794mbm04.png",
          "/1794%20midnight%20black%20metallic/n1794mbm05.png",
          "/1794%20midnight%20black%20metallic/n1794mbm06.png",
          "/1794%20midnight%20black%20metallic/n1794mbm07.png",
          "/1794%20midnight%20black%20metallic/n1794mbm08.png",
          "/1794%20midnight%20black%20metallic/n1794mbm09.png",
          "/1794%20midnight%20black%20metallic/n1794mbm10.png",
          "/1794%20midnight%20black%20metallic/n1794mbm11.png",
          "/1794%20midnight%20black%20metallic/n1794mbm12.png",
          "/1794%20midnight%20black%20metallic/n1794mbm13.png",
          "/1794%20midnight%20black%20metallic/n1794mbm14.png",
          "/1794%20midnight%20black%20metallic/n1794mbm15.png",
          "/1794%20midnight%20black%20metallic/n1794mbm16.png",
          "/1794%20midnight%20black%20metallic/n1794mbm17.png",
          "/1794%20midnight%20black%20metallic/n1794mbm18.png"
        ]
      },
      {
        key: "mudbath",
        name: "Mudbath",
        hex: "#6f5f49",
        tint: "rgba(111, 95, 73, 0.22)",
        images: [
          "/1794%20mudbath/n1794mdb01.png",
          "/1794%20mudbath/n1794mdb02.png",
          "/1794%20mudbath/n1794mdb03.png",
          "/1794%20mudbath/n1794mdb04.png",
          "/1794%20mudbath/n1794mdb05.png",
          "/1794%20mudbath/n1794mdb06.png",
          "/1794%20mudbath/n1794mdb07.png",
          "/1794%20mudbath/n1794mdb08.png",
          "/1794%20mudbath/n1794mdb09.png",
          "/1794%20mudbath/n1794mdb10.png",
          "/1794%20mudbath/n1794mdb11.png",
          "/1794%20mudbath/n1794mdb12.png",
          "/1794%20mudbath/n1794mdb13.png",
          "/1794%20mudbath/n1794mdb14.png",
          "/1794%20mudbath/n1794mdb15.png",
          "/1794%20mudbath/n1794mdb16.png",
          "/1794%20mudbath/n1794mdb17.png",
          "/1794%20mudbath/n1794mdb18.png"
        ]
      },
      {
        key: "wind-chill-pearl",
        name: "Wind Chill Pearl",
        hex: "#dfe3e8",
        tint: "rgba(204, 211, 218, 0.16)",
        images: [
          "/1794%20wind%20chill%20pearl/n1794wcp01.png",
          "/1794%20wind%20chill%20pearl/n1794wcp02.png",
          "/1794%20wind%20chill%20pearl/n1794wcp03.png",
          "/1794%20wind%20chill%20pearl/n1794wcp04.png",
          "/1794%20wind%20chill%20pearl/n1794wcp05.png",
          "/1794%20wind%20chill%20pearl/n1794wcp06.png",
          "/1794%20wind%20chill%20pearl/n1794wcp07.png",
          "/1794%20wind%20chill%20pearl/n1794wcp08.png",
          "/1794%20wind%20chill%20pearl/n1794wcp09.png",
          "/1794%20wind%20chill%20pearl/n1794wcp10.png",
          "/1794%20wind%20chill%20pearl/n1794wcp11.png",
          "/1794%20wind%20chill%20pearl/n1794wcp12.png",
          "/1794%20wind%20chill%20pearl/n1794wcp13.png",
          "/1794%20wind%20chill%20pearl/n1794wcp14.png",
          "/1794%20wind%20chill%20pearl/n1794wcp15.png",
          "/1794%20wind%20chill%20pearl/n1794wcp16.png",
          "/1794%20wind%20chill%20pearl/n1794wcp17.png",
          "/1794%20wind%20chill%20pearl/n1794wcp18.png"
        ]
      },
    ],
  },
};

const SEQUOIA_VERSION_ORDER = ["sr5", "limited", "platinum", "trd-pro", "capstone", "1794"];

const SEQUOIA_INTERIOR_CONFIG = {
  sr5: {
    colors: [
      {
        key: "tela-color-black",
        name: "Tela Black",
        hex: "#2a2a2c",
        images: [
          "/sr5%20tela/sr5tela01.webp",
          "/sr5%20tela/sr5tela02.webp",
          "/sr5%20tela/sr5tela03.webp",
          "/sr5%20tela/sr5tela04.webp"
        ]
      },
      {
        key: "piel-black",
        name: "Piel Black",
        hex: "#101114",
        images: [
          "/sr5%20piel%20black/sr5piel01.webp",
          "/sr5%20piel%20black/sr5piel02.webp",
          "/sr5%20piel%20black/sr5piel03.webp",
          "/sr5%20piel%20black/sr5piel04.webp"
        ]
      },
      {
        key: "piel-boulder",
        name: "Piel Boulder",
        hex: "#8e8273",
        images: [
          "/sr5%20piel%20boulder/sr5pb01.webp",
          "/sr5%20piel%20boulder/sr5pb02.webp",
          "/sr5%20piel%20boulder/sr5pb03.webp",
          "/sr5%20piel%20boulder/sr5pb04.webp"
        ]
      },
    ],
  },
  limited: {
    colors: [
      {
        key: "piel-black",
        name: "Piel Black",
        hex: "#101114",
        images: [
          "/limited%20piel%20black/ltpielb01.webp",
          "/limited%20piel%20black/ltpielb02.webp",
          "/limited%20piel%20black/ltpielb03.webp",
          "/limited%20piel%20black/ltpielb04.webp"
        ]
      },
      {
        key: "piel-boulder",
        name: "Piel Boulder",
        hex: "#8e8273",
        images: [
          "/limited%20piel%20boulder/ltpielbo01.webp",
          "/limited%20piel%20boulder/ltpielbo02.webp",
          "/limited%20piel%20boulder/ltpielbo03.webp",
          "/limited%20piel%20boulder/ltpielbo04.webp"
        ]
      },
    ],
  },
  platinum: {
    colors: [
      {
        key: "piel-black",
        name: "Piel Black",
        hex: "#101114",
        images: [
          "/platinum%20piel%20black/ptpielb01.webp",
          "/platinum%20piel%20black/ptpielb02.webp",
          "/platinum%20piel%20black/ptpielb03.webp",
          "/platinum%20piel%20black/ptpielb04.webp"
        ]
      },
    ],
  },
  "trd-pro": {
    colors: [
      {
        key: "black-softex",
        name: "Black Softex",
        hex: "#141416",
        images: [
          "/trd%20black%20softex/trdbs01.webp",
          "/trd%20black%20softex/trdbs02.webp",
          "/trd%20black%20softex/trdbs03.webp",
          "/trd%20black%20softex/trdbs04.webp"
        ]
      },
      {
        key: "cockpit-red-softex",
        name: "Cockpit Red Softex",
        hex: "#8d1f2d",
        images: [
          "/trd%20cockpit%20red%20softex/trdcrs01.webp",
          "/trd%20cockpit%20red%20softex/trdcrs02.webp",
          "/trd%20cockpit%20red%20softex/trdcrs03.webp",
          "/trd%20cockpit%20red%20softex/trdcrs04.webp"
        ]
      },
    ],
  },
  capstone: {
    colors: [
      {
        key: "piel-premium-texturizada-shale",
        name: "Piel Premium Texturizada Shale",
        hex: "#8f8579",
        images: [
          "/capstone%20piel%20premium%20texturizada%20shale/cppts01.webp",
          "/capstone%20piel%20premium%20texturizada%20shale/cppts02.webp",
          "/capstone%20piel%20premium%20texturizada%20shale/cppts03.webp",
          "/capstone%20piel%20premium%20texturizada%20shale/cppts04.webp"
        ]
      },
    ],
  },
  "1794": {
    colors: [
      {
        key: "piel-saddle-tan",
        name: "Piel Saddle Tan",
        hex: "#8a6a4a",
        images: [
          "/1794%20piel%20saddle%20tan/n1794pst01.webp",
          "/1794%20piel%20saddle%20tan/n1794pst02.webp",
          "/1794%20piel%20saddle%20tan/n1794pst03.webp",
          "/1794%20piel%20saddle%20tan/n1794pst04.webp"
        ]
      },
    ],
  },
};

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
    }),
  });

  state.registeredPushToken = pushInfo.token;
}

function syncNativePushToken() {
  const nativePushInfo = window.__globalImportsNativePush;

  if (!nativePushInfo?.token) {
    return;
  }

  registerNativePushToken(nativePushInfo).catch(() => null);
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
    await fetchJson("/api/auth/delete-account", {
      method: "POST",
      body: JSON.stringify({ password }),
    });

    await requestLogout();
    clearAuth();
    redirectToLogin();
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
  const whatsappUrl = new URL(`https://wa.me/${GLOBAL_WHATSAPP_NUMBER}`);

  if (message) {
    whatsappUrl.searchParams.set("text", message);
  }

  return whatsappUrl.toString();
}

function buildSequoiaWhatsappAppUrl(message) {
  const whatsappUrl = new URL("whatsapp://send");
  whatsappUrl.searchParams.set("phone", GLOBAL_WHATSAPP_NUMBER);

  if (message) {
    whatsappUrl.searchParams.set("text", message);
  }

  return whatsappUrl.toString();
}

function openSequoiaWhatsappChat(message) {
  const normalizedMessage = String(message || "").trim();
  const appUrl = buildSequoiaWhatsappAppUrl(normalizedMessage);
  const webUrl = buildSequoiaWhatsappUrl(normalizedMessage);
  let appOpened = false;

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      appOpened = true;
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange, { once: true });
  window.location.href = appUrl;

  window.setTimeout(() => {
    if (!appOpened && document.visibilityState === "visible") {
      window.location.href = webUrl;
    }
  }, GLOBAL_WHATSAPP_FALLBACK_DELAY_MS);

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
  return SEQUOIA_VERSION_CONFIG[selectedSequoiaVersion] || SEQUOIA_VERSION_CONFIG.sr5;
}

function getActiveSequoiaColor() {
  const versionConfig = getActiveSequoiaConfig();
  return versionConfig.colors.find((item) => item.key === selectedSequoiaColor) || versionConfig.colors[0];
}

function getActiveSequoiaInteriorConfig() {
  return SEQUOIA_INTERIOR_CONFIG[selectedSequoiaVersion] || SEQUOIA_INTERIOR_CONFIG.sr5 || { colors: [] };
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
  const versionConfig = getActiveSequoiaConfig();
  const activeColor = getActiveSequoiaColor();

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
    sequoiaConfigVersions.innerHTML = SEQUOIA_VERSION_ORDER.map((versionKey) => {
      const current = SEQUOIA_VERSION_CONFIG[versionKey];

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
    const imageUrl = vehicleImages?.[item.key] || item.image;

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
        renderSequoiaConfigurator();
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
    const nextConfig = SEQUOIA_VERSION_CONFIG[nextVersion];

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

      window.location.href = response.signingUrl;
    } catch (error) {
      if (error?.message && /consentimiento jwt|consent_required|docusign requiere consentimiento/i.test(error.message)) {
        const consentUrlMatch = String(error.message).match(/https?:\/\/\S+/i);

        if (consentUrlMatch?.[0]) {
          window.open(consentUrlMatch[0], "_blank", "noopener,noreferrer");
        }
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
    showSequoiaVisionHint();
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
  registerNativePushToken(event.detail || {}).catch(() => null);
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

loadDashboard().catch((error) => {
  renderEmptyState(feedContainer, error.message);
  setFeedback(trackingSearchFeedback, error.message, "error");
  renderEmptyState(maintenanceList, error.message);
  renderEmptyState(notificationsList, error.message);
  renderEmptyState(virtualDealershipClientList, error.message);
});

loadVirtualDealership().catch(() => {
  // Keep dashboard usable if virtual dealership fetch fails during initial boot.
});

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
renderSequoiaConfigurator();