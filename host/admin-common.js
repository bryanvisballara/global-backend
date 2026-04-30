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

const trackingTemplates = [
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

let loadingOverlay = null;
let loadingLabel = null;
let activeLoadingRequests = 0;

function enableAdminUppercaseView() {
  if (!document.body) {
    return;
  }

  document.body.classList.add("admin-app-view", "admin-uppercase-view");
}

enableAdminUppercaseView();

function ensureLoadingOverlay() {
  if (loadingOverlay) {
    return;
  }

  loadingOverlay = document.createElement("div");
  loadingOverlay.className = "global-loading-overlay";
  loadingOverlay.hidden = true;
  loadingOverlay.innerHTML = `
    <div class="global-loading-card" role="status" aria-live="polite">
      <div class="global-loading-spinner"></div>
      <p id="global-loading-label">Cargando...</p>
    </div>
  `;

  document.body.appendChild(loadingOverlay);
  loadingLabel = document.getElementById("global-loading-label");
}

function showLoadingOverlay(message = "Cargando...") {
  ensureLoadingOverlay();
  activeLoadingRequests += 1;
  loadingLabel.textContent = message;
  loadingOverlay.hidden = false;
  document.body.classList.add("loading-active");
}

function hideLoadingOverlay() {
  activeLoadingRequests = Math.max(0, activeLoadingRequests - 1);

  if (activeLoadingRequests > 0) {
    return;
  }

  if (!loadingOverlay) {
    return;
  }

  loadingOverlay.hidden = true;
  document.body.classList.remove("loading-active");
}

function resetLoadingOverlay() {
  activeLoadingRequests = 0;

  if (!loadingOverlay) {
    document.body.classList.remove("loading-active");
    return;
  }

  loadingOverlay.hidden = true;
  document.body.classList.remove("loading-active");
}

function forceHideAnyLoadingOverlay() {
  resetLoadingOverlay();

  document.querySelectorAll(".global-loading-overlay").forEach((overlay) => {
    overlay.hidden = true;
    overlay.style.display = "none";
  });

  document.body.classList.remove("loading-active");
}

function redirectToLogin() {
  const loginUrl = new URL("/index.html", window.location.origin);
  loginUrl.searchParams.set("logout", "1");
  loginUrl.searchParams.set("t", String(Date.now()));
  window.location.replace(loginUrl.toString());
}

function getAuthToken() {
  return localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
}

function getCurrentRole() {
  return localStorage.getItem("globalAppRole") || sessionStorage.getItem("globalAppRole") || "";
}

function isAdminPanelRole(role) {
  return ["admin", "manager", "adminUSA", "gerenteUSA"].includes(String(role || ""));
}

function isManagerRole(role) {
  return String(role || "") === "manager";
}

function isUsaAdministrativeRole(role) {
  return ["adminUSA", "gerenteUSA"].includes(String(role || ""));
}

function canCreateAdministrativeUsers(role) {
  return ["manager", "gerenteUSA"].includes(String(role || ""));
}

function clearAuth() {
  localStorage.removeItem("globalAppToken");
  localStorage.removeItem("globalAppRole");
  sessionStorage.removeItem("globalAppToken");
  sessionStorage.removeItem("globalAppRole");
}

async function requestLogout() {
  try {
    await fetch(`${resolveApiBaseUrl()}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
      keepalive: true,
    });
  } catch {
    // Ignore logout transport failures and still clear client-side auth state.
  }
}

async function performLogout(button) {
  if (button) {
    button.disabled = true;
  }

  await requestLogout();
  clearAuth();
  redirectToLogin();
}

function requireAdminAccess() {
  const currentPath = window.location.pathname || "";
  const currentRole = getCurrentRole();
  const hasAuthToken = Boolean(getAuthToken());
  const latamOnlyPages = new Set([
    "/admin-client-requests.html",
    "/admin-order-accounting.html",
    "/admin-maintenance.html",
    "/admin-vehicles.html",
    "/admin-posts.html",
    "/admin-virtual-dealership.html",
  ]);

  if (currentRole && !isAdminPanelRole(currentRole)) {
    redirectToLogin();
    return false;
  }

  if (!hasAuthToken) {
    redirectToLogin();
    return false;
  }

  if (isUsaAdministrativeRole(currentRole) && latamOnlyPages.has(currentPath)) {
    window.location.replace("/admin.html");
    return false;
  }

  return true;
}

function applyManagerNavigationVisibility(role = getCurrentRole()) {
  const normalizedRole = String(role || "");
  const showAdminCreatorItems = canCreateAdministrativeUsers(normalizedRole);
  const hideLatamOnlyItems = isUsaAdministrativeRole(normalizedRole);

  document.querySelectorAll(".admin-manager-only, .admin-admin-creator-only").forEach((element) => {
    const shouldShow = showAdminCreatorItems;

    if (element.tagName.toLowerCase() === "a") {
      element.style.display = shouldShow ? "" : "none";
    } else {
      element.hidden = !shouldShow;
    }
  });

  document.querySelectorAll(".admin-latam-only").forEach((element) => {
    if (element.tagName.toLowerCase() === "a") {
      element.style.display = hideLatamOnlyItems ? "none" : "";
    } else {
      element.hidden = hideLatamOnlyItems;
    }
  });

  document.querySelectorAll(".admin-sidebar-section").forEach((section) => {
    const hasVisibleLinks = Array.from(section.querySelectorAll(".admin-nav-link"))
      .some((link) => link.style.display !== "none");

    section.hidden = !hasVisibleLinks;
  });
}

function attachLogout(buttonId = "logout-button") {
  const button = document.getElementById(buttonId);

  if (!button || button.dataset.logoutBound === "true") {
    return;
  }

  button.dataset.logoutBound = "true";

  button.addEventListener("click", async (event) => {
    event.preventDefault();
    await performLogout(button);
  });
}

window.__performAdminLogout = () => performLogout(document.getElementById("logout-button"));

async function fetchJson(path, options = {}) {
  const { loadingMessage = "Cargando...", requestTimeoutMs = 45000, ...fetchOptions } = options;
  const isFormDataBody = fetchOptions.body instanceof FormData;
  const shouldShowLoading = loadingMessage !== false && loadingMessage !== null;
  const authToken = getAuthToken();
  const abortController = new AbortController();
  const timeoutMs = Number(requestTimeoutMs) > 0 ? Number(requestTimeoutMs) : 45000;
  const timeoutHandle = window.setTimeout(() => {
    abortController.abort();
  }, timeoutMs);

  if (shouldShowLoading) {
    showLoadingOverlay(loadingMessage);
  }

  try {
    const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
      ...fetchOptions,
      signal: fetchOptions.signal || abortController.signal,
      credentials: "include",
      headers: {
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
        ...(fetchOptions.headers || {}),
      },
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.message === "Invalid or expired token" || data.message === "Authentication required") {
        clearAuth();
        redirectToLogin();
      }

      throw new Error(data.message || "Request failed");
    }

    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado. Intenta nuevamente.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutHandle);

    if (shouldShowLoading) {
      hideLoadingOverlay();
    }
  }
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

function formatCurrency(amount, currency = "VES") {
  const numericAmount = Number(amount || 0);

  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(numericAmount);
}

function formatDateTimeInBogota(dateValue) {
  if (!dateValue) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(dateValue));
}

function renderEmptyState(container, message) {
  if (!container) {
    return;
  }

  container.innerHTML = `<div class="empty-state">${message}</div>`;
}

function setFeedback(element, message, type = "") {
  if (!element) {
    return;
  }

  element.textContent = message;
  element.className = `feedback${type ? ` ${type}` : ""}`;
}

function buildAdminSidebar(pathname, currentRole = getCurrentRole()) {
  const currentPath = String(pathname || window.location.pathname || "").toLowerCase();
  const isUsaRole = isUsaAdministrativeRole(currentRole);
  const brandLabel = isUsaRole ? "Global Imports USA" : "Global Imports";
  const navSections = [
    {
      title: "Gestion",
      items: [
        { href: "/admin.html", label: "DASHBOARD", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin.html"] },
        { href: "/admin-tracking.html", label: "PEDIDOS", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin-tracking.html", "/admin-orders.html", "/admin-order-accounting.html"] },
        { href: "/admin-vehicles.html", label: "VEHICULOS", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-vehicles.html"] },
        { href: "/admin-clients.html", label: "CLIENTES", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin-clients.html"] },
      ],
    },
    {
      title: "Contenido",
      items: [
        { href: "/admin-posts.html", label: "PUBLICACIONES", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-posts.html", "/admin-post-edit.html"] },
        { href: "/admin-virtual-dealership.html", label: "CONCESIONARIO VIRTUAL", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-virtual-dealership.html"] },
        { href: "/admin-admins.html", label: "CREACION DE ADMINISTRADORES", adminCreatorOnly: true, latamOnly: false, activePaths: ["/admin-admins.html"] },
      ],
    },
    {
      title: "Control",
      items: [
        { href: "/admin-deleted-accounts.html", label: "CUENTAS ELIMINADAS", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin-deleted-accounts.html"] },
        { href: "/admin-order-deletion-requests.html", label: "SOLICITUDES DE ELIMINACION", adminCreatorOnly: true, latamOnly: false, activePaths: ["/admin-order-deletion-requests.html"] },
        { href: "/admin-client-requests.html", label: "SOLICITUDES DE COMPRA", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-client-requests.html"] },
        { href: "/admin-maintenance.html", label: "MANTENIMIENTOS", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-maintenance.html"] },
      ],
    },
  ];

  const navMarkup = navSections
    .map((section) => {
      const linksMarkup = section.items
        .map((item) => {
      const activePaths = Array.isArray(item.activePaths) && item.activePaths.length ? item.activePaths : [item.href];
      const isActive = activePaths.includes(currentPath);
      const classes = ["admin-nav-link"];
      const inlineStyles = [];

      if (isActive) {
        classes.push("active");
      }

      if (item.adminCreatorOnly) {
        classes.push("admin-admin-creator-only");
      }

      if (item.latamOnly) {
        classes.push("admin-latam-only");

        if (isUsaRole) {
          inlineStyles.push("display:none");
        }
      }

      if (item.adminCreatorOnly && !canCreateAdministrativeUsers(currentRole)) {
        inlineStyles.push("display:none");
      }

      return `<a class="${classes.join(" ")}" href="${item.href}"${inlineStyles.length ? ` style="${inlineStyles.join("; ")}"` : ""}>${item.label}</a>`;
        })
        .join("");

      return `
        <div class="admin-sidebar-section">
          <p class="admin-sidebar-section-label">${section.title}</p>
          ${linksMarkup}
        </div>
      `;
    })
    .join("");

  const sidebar = document.createElement("aside");
  sidebar.className = "admin-sidebar admin-sidebar-injected";
  sidebar.setAttribute("aria-label", "Navegacion administrativa");
  sidebar.innerHTML = `
    <div class="admin-sidebar-brand">
      <img class="admin-sidebar-logo" src="/logoblancoleon.png" alt="Global Imports" />
      <div>
        <p class="section-tag">${brandLabel}</p>
        <strong>Panel administrativo</strong>
      </div>
    </div>

    <nav class="admin-sidebar-nav">
      ${navMarkup}
    </nav>

    <div class="admin-sidebar-footer">
      <div class="admin-badge admin-badge-sidebar">
        <span id="admin-name-sidebar">Administrador</span>
        <strong id="admin-email-sidebar">admin@globalimports.com</strong>
      </div>
      <button id="logout-button-sidebar" class="secondary-button admin-logout-button" type="button" onclick="window.__performAdminLogout?.(); return false;">Cerrar sesión</button>
    </div>
  `;

  return sidebar;
}

function injectAdminSidebarLayout() {
  const currentPath = String(window.location.pathname || "");
  const isAdminHtmlRoute = /^\/(?:app\/)?admin(?:-[a-z0-9-]+)?\.html$/i.test(currentPath);

  if (!isAdminHtmlRoute) {
    return;
  }

  const stage = document.querySelector(".dashboard-stage");

  if (!stage) {
    return;
  }

  if (stage.querySelector(".admin-sidebar")) {
    return;
  }

  const sheen = stage.querySelector(":scope > .dashboard-sheen");
  const topLevelNodes = Array.from(stage.children).filter((node) => node !== sheen);

  if (!topLevelNodes.length) {
    return;
  }

  const layout = document.createElement("div");
  layout.className = "admin-dashboard-layout admin-layout-injected";

  const main = document.createElement("section");
  main.className = "admin-dashboard-main admin-main-injected";

  topLevelNodes.forEach((node) => {
    main.appendChild(node);
  });

  layout.appendChild(buildAdminSidebar(currentPath, getCurrentRole()));
  layout.appendChild(main);
  stage.appendChild(layout);

  attachLogout("logout-button-sidebar");
}

function createSidebarToggleButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-button admin-sidebar-toggle";
  button.setAttribute("aria-label", "Abrir menu lateral");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<span class="admin-sidebar-toggle-icon">☰</span><span>Menu</span>';
  return button;
}

function ensureSidebarToggleButton() {
  const existingButton = document.querySelector(".admin-sidebar-toggle");

  if (existingButton) {
    return;
  }

  const topbar = document.querySelector(".admin-dashboard-main .page-topbar");

  if (topbar) {
    topbar.prepend(createSidebarToggleButton());
    return;
  }

  const dashboardHeader = document.querySelector(".admin-dashboard-main .admin-dashboard-header");

  if (dashboardHeader) {
    const leftColumn = dashboardHeader.querySelector(":scope > div") || dashboardHeader;
    leftColumn.prepend(createSidebarToggleButton());
    return;
  }

  const pageHero = document.querySelector(".admin-dashboard-main .page-hero");

  if (pageHero) {
    pageHero.prepend(createSidebarToggleButton());
  }
}

function initializeAdminSidebarDrawer() {
  const currentPath = String(window.location.pathname || "");
  const isAdminHtmlRoute = /^\/(?:app\/)?admin(?:-[a-z0-9-]+)?\.html$/i.test(currentPath);

  if (!isAdminHtmlRoute) {
    return;
  }

  const sidebar = document.querySelector(".admin-sidebar");
  const main = document.querySelector(".admin-dashboard-main");
  const stage = document.querySelector(".dashboard-stage");

  if (!sidebar || !main || !stage) {
    return;
  }

  document.body.classList.add("admin-app-view");

  document.querySelectorAll(".page-topbar .back-link").forEach((link) => {
    link.remove();
  });

  document.body.classList.add("admin-drawer-ready");
  ensureSidebarToggleButton();

  const desktopMediaQuery = window.matchMedia("(min-width: 1101px)");
  const desktopSidebarStateKey = "globalAdminSidebarDesktopCollapsed";

  let backdrop = document.querySelector(".admin-sidebar-backdrop");

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "admin-sidebar-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    stage.appendChild(backdrop);
  }

  const updateToggleButtons = () => {
    const isOpen = document.body.classList.contains("admin-sidebar-open");
    const isDesktop = desktopMediaQuery.matches;
    const isExpanded = isDesktop ? !document.body.classList.contains("admin-sidebar-collapsed") : isOpen;
    document.querySelectorAll(".admin-sidebar-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      button.setAttribute("aria-label", isExpanded ? "Cerrar menu lateral" : "Abrir menu lateral");

      const label = button.querySelector("span:last-child");

      if (label) {
        label.textContent = isDesktop ? (isExpanded ? "Ocultar menu" : "Mostrar menu") : (isExpanded ? "Cerrar menu" : "Menu");
      }
    });
  };

  const syncDesktopSidebarLayout = () => {
    const nav = sidebar.querySelector(".admin-sidebar-nav");

    if (desktopMediaQuery.matches) {
      sidebar.style.height = "auto";
      sidebar.style.maxHeight = "none";
      sidebar.style.overflow = "visible";
      sidebar.style.display = "flex";
      sidebar.style.flexDirection = "column";

      if (nav) {
        nav.style.maxHeight = "none";
        nav.style.overflow = "visible";
      }

      return;
    }

    sidebar.style.removeProperty("height");
    sidebar.style.removeProperty("max-height");
    sidebar.style.removeProperty("overflow");
    sidebar.style.removeProperty("display");
    sidebar.style.removeProperty("flex-direction");

    if (nav) {
      nav.style.removeProperty("max-height");
      nav.style.removeProperty("overflow");
    }
  };

  const syncSidebarMode = () => {
    syncDesktopSidebarLayout();

    if (desktopMediaQuery.matches) {
      const shouldCollapseDesktop = window.localStorage.getItem(desktopSidebarStateKey) === "true";
      document.body.classList.toggle("admin-sidebar-collapsed", shouldCollapseDesktop);
      document.body.classList.remove("admin-sidebar-open");
    } else {
      document.body.classList.remove("admin-sidebar-collapsed");
    }

    updateToggleButtons();
  };

  const closeSidebar = () => {
    if (desktopMediaQuery.matches) {
      document.body.classList.add("admin-sidebar-collapsed");
      window.localStorage.setItem(desktopSidebarStateKey, "true");
      updateToggleButtons();
      return;
    }

    document.body.classList.remove("admin-sidebar-open");
    updateToggleButtons();
  };

  const toggleSidebar = () => {
    if (desktopMediaQuery.matches) {
      const shouldCollapseDesktop = !document.body.classList.contains("admin-sidebar-collapsed");
      document.body.classList.toggle("admin-sidebar-collapsed", shouldCollapseDesktop);
      window.localStorage.setItem(desktopSidebarStateKey, shouldCollapseDesktop ? "true" : "false");
      updateToggleButtons();
      return;
    }

    document.body.classList.toggle("admin-sidebar-open");
    updateToggleButtons();
  };

  if (document.body.dataset.adminDrawerBound === "true") {
    sidebar.querySelectorAll(".admin-nav-link").forEach((navLink) => {
      if (navLink.dataset.mobileNavBound === "true") {
        return;
      }

      navLink.dataset.mobileNavBound = "true";
    });
    updateToggleButtons();
    return;
  }

  document.body.dataset.adminDrawerBound = "true";
  let mobileNavigationInFlight = false;

  const navigateMobileSidebarLink = (navLink, event) => {
    if (!navLink || desktopMediaQuery.matches) {
      return false;
    }

    if (mobileNavigationInFlight) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const destination = navLink.getAttribute("href");

    if (!destination) {
      return true;
    }

    mobileNavigationInFlight = true;
    event.preventDefault();
    event.stopPropagation();
    document.body.classList.remove("admin-sidebar-open");
    updateToggleButtons();
    window.setTimeout(() => {
      window.location.assign(destination);
    }, 0);
    return true;
  };

  const bindMobileSidebarLinks = () => {
    sidebar.querySelectorAll(".admin-nav-link").forEach((navLink) => {
      if (navLink.dataset.mobileNavBound === "true") {
        return;
      }

      navLink.dataset.mobileNavBound = "true";

      const handleNavigation = (event) => {
        if (desktopMediaQuery.matches) {
          return;
        }

        navigateMobileSidebarLink(navLink, event);
      };

      navLink.addEventListener("click", handleNavigation, true);
      navLink.addEventListener("touchend", handleNavigation, { capture: true, passive: false });
    });
  };

  bindMobileSidebarLinks();

  document.addEventListener("click", (event) => {
    const toggleButton = event.target.closest(".admin-sidebar-toggle");

    if (toggleButton) {
      toggleSidebar();
      return;
    }

    if (event.target.closest(".admin-sidebar-backdrop")) {
      closeSidebar();
      return;
    }

    const navLink = event.target.closest(".admin-sidebar .admin-nav-link");

    if (navLink) {
      if (navigateMobileSidebarLink(navLink, event)) {
        return;
      }

      return;
    }

    if (
      !desktopMediaQuery.matches &&
      document.body.classList.contains("admin-sidebar-open") &&
      !event.target.closest(".admin-sidebar")
    ) {
      closeSidebar();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !desktopMediaQuery.matches) {
      closeSidebar();
    }
  });

  document.addEventListener(
    "touchmove",
    (event) => {
      if (desktopMediaQuery.matches || !document.body.classList.contains("admin-sidebar-open")) {
        return;
      }

      if (event.target.closest(".admin-sidebar")) {
        return;
      }

      event.preventDefault();
    },
    { capture: true, passive: false }
  );

  if (typeof desktopMediaQuery.addEventListener === "function") {
    desktopMediaQuery.addEventListener("change", syncSidebarMode);
  } else if (typeof desktopMediaQuery.addListener === "function") {
    desktopMediaQuery.addListener(syncSidebarMode);
  }

  syncSidebarMode();
}

function inferMediaType(url, preferredFormat = "") {
  const normalizedUrl = String(url).toLowerCase();

  if (preferredFormat === "video") {
    return "video";
  }

  if (normalizedUrl.match(/\.(mp4|mov|m4v|webm)(\?|$)/)) {
    return "video";
  }

  return "image";
}

function parseMediaUrls(rawValue, preferredFormat = "") {
  if (!rawValue) {
    return [];
  }

  return String(rawValue)
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((url) => ({
      type: inferMediaType(url, preferredFormat),
      url,
    }));
}

function populateSelect(selectElement, items, placeholder, valueKey, labelBuilder) {
  if (!selectElement) {
    return;
  }

  const currentValue = selectElement.value;
  const options = [`<option value="">${placeholder}</option>`]
    .concat(items.map((item) => `<option value="${item[valueKey]}">${labelBuilder(item)}</option>`));

  selectElement.innerHTML = options.join("");

  if (items.some((item) => item[valueKey] === currentValue)) {
    selectElement.value = currentValue;
  } else if (items.length) {
    selectElement.value = items[0][valueKey];
  }
}

async function loadAdminSession(nameId = "admin-name", emailId = "admin-email") {
  const data = await fetchJson("/api/auth/me");
  const user = data.user || {};
  const nameElement = document.getElementById(nameId);
  const emailElement = document.getElementById(emailId);

  if (user.role) {
    localStorage.setItem("globalAppRole", user.role);
    sessionStorage.setItem("globalAppRole", user.role);
  }

  if (nameElement) {
    nameElement.textContent = user.name || "Administrador";
  }

  if (emailElement) {
    emailElement.textContent = user.email || "admin@globalimports.com";
  }

  const sidebarNameElement = document.getElementById("admin-name-sidebar");
  const sidebarEmailElement = document.getElementById("admin-email-sidebar");

  if (sidebarNameElement) {
    sidebarNameElement.textContent = user.name || "Administrador";
  }

  if (sidebarEmailElement) {
    sidebarEmailElement.textContent = user.email || "admin@globalimports.com";
  }

  applyManagerNavigationVisibility(user.role);

  return user;
}

injectAdminSidebarLayout();
initializeAdminSidebarDrawer();

window.addEventListener("load", forceHideAnyLoadingOverlay);
window.addEventListener("pageshow", forceHideAnyLoadingOverlay);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    forceHideAnyLoadingOverlay();
  }
});
window.setTimeout(forceHideAnyLoadingOverlay, 0);

window.AdminApp = {
  attachLogout,
  canCreateAdministrativeUsers,
  clearAuth,
  fetchJson,
  formatCurrency,
  formatDate,
  formatDateTimeInBogota,
  hideLoadingOverlay,
  isUsaAdministrativeRole,
  loadAdminSession,
  parseMediaUrls,
  populateSelect,
  performLogout,
  redirectToLogin,
  resetLoadingOverlay,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
  showLoadingOverlay,
  trackingTemplates,
};