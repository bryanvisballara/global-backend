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

function syncAdminViewportMetrics() {
  const viewportWidth = Math.round(Math.max(
    window.visualViewport?.width || 0,
    window.innerWidth || 0,
    document.documentElement.clientWidth || 0
  ));
  const viewportHeight = Math.round(Math.max(
    window.visualViewport?.height || 0,
    window.innerHeight || 0,
    document.documentElement.clientHeight || 0
  ));

  if (viewportWidth > 0) {
    document.documentElement.style.setProperty("--admin-visual-width", `${viewportWidth}px`);
  }

  if (viewportHeight > 0) {
    document.documentElement.style.setProperty("--admin-visual-height", `${viewportHeight}px`);
  }
}

syncAdminViewportMetrics();

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
    "/admin-maintenance.html",
    "/admin-visitors.html",
    "/admin-gate-reports.html",
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

window.__performAdminLogout = () =>
  performLogout(document.getElementById("logout-button") || document.getElementById("logout-button-sidebar"));

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

function adminNavIcon(name) {
  const icons = {
    dashboard:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/></svg>',
    clipboard:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4.5h6"/><path d="M8.5 4.5h-1A2.5 2.5 0 0 0 5 7v12.5A2.5 2.5 0 0 0 7.5 22h9a2.5 2.5 0 0 0 2.5-2.5V7a2.5 2.5 0 0 0-2.5-2.5h-1"/><rect x="9" y="2.5" width="6" height="3.5" rx="1.2"/><path d="M9 11h6M9 15h4"/></svg>',
    car:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 15.5V14a2 2 0 0 1 1.2-1.8l1.7-.8 1.4-3.1A2.5 2.5 0 0 1 11.1 7h1.8a2.5 2.5 0 0 1 2.3 1.3l1.4 3.1 1.7.8A2 2 0 0 1 19.5 14v1.5"/><path d="M4.5 16.5h2.2M17.3 16.5h2.2"/><circle cx="7.5" cy="16.5" r="1.7"/><circle cx="16.5" cy="16.5" r="1.7"/><path d="M9.3 16.5h5.4"/><path d="M8 10.8h8"/></svg>',
    user:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19.2a6.5 6.5 0 0 1 13 0"/></svg>',
    "shield-x":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 5.5 5.8v5.3c0 4.3 2.8 7.8 6.5 9.1 3.7-1.3 6.5-4.8 6.5-9.1V5.8L12 3.2z"/><path d="m9.8 10.2 4.4 4.4M14.2 10.2l-4.4 4.4"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5h14"/><path d="M9.5 7.5V6a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 6v1.5"/><path d="M8.5 7.5 9.2 19a1.5 1.5 0 0 0 1.5 1.4h2.6a1.5 1.5 0 0 0 1.5-1.4l.7-11.5"/><circle cx="12" cy="13.2" r="1.3"/><path d="M10.2 16.2a2.2 2.2 0 0 1 3.6 0"/></svg>',
    cart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h1.6l1.4 10.2A1.5 1.5 0 0 0 8.5 16.5h8.3a1.5 1.5 0 0 0 1.5-1.2L20 8H7"/><circle cx="9.5" cy="19.2" r="1.2"/><circle cx="16.5" cy="19.2" r="1.2"/></svg>',
    wrench:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a3.8 3.8 0 0 0-5.1 5.1L4.2 16.8a1.7 1.7 0 0 0 2.4 2.4l5.4-5.4a3.8 3.8 0 0 0 5.1-5.1l-2.2 2.2-2.2-2.2 2-2z"/></svg>',
    chart:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19.5h15"/><path d="M6.5 15.5 10 12l3 2.5 4.5-6"/><path d="M15 8.5h2.5V11"/></svg>',
    document:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5h5.5L18.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z"/><path d="M13.5 3.5V8H18.5"/><path d="M9.5 12h5M9.5 15.5h3.5"/></svg>',
    store:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10.5 6 5.5h12l1.5 5"/><path d="M5 10.5h14v8A1.5 1.5 0 0 1 17.5 20h-11A1.5 1.5 0 0 1 5 18.5v-8z"/><path d="M10 20v-5.5h4V20"/><path d="M4.5 10.5c.8 1 2 1.5 3.5 1.5s2.7-.5 3.5-1.5c.8 1 2 1.5 3.5 1.5s2.7-.5 3.5-1.5"/></svg>',
    "shield-user":
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 5.5 5.8v5.3c0 4.3 2.8 7.8 6.5 9.1 3.7-1.3 6.5-4.8 6.5-9.1V5.8L12 3.2z"/><circle cx="12" cy="10" r="2"/><path d="M8.8 15.2a3.4 3.4 0 0 1 6.4 0"/></svg>',
  };

  return icons[name] || icons.dashboard;
}

function buildAdminSidebar(pathname, currentRole = getCurrentRole()) {
  const currentPath = String(pathname || window.location.pathname || "").toLowerCase();
  const isUsaRole = isUsaAdministrativeRole(currentRole);
  const brandLabel = isUsaRole ? "Global Imports USA" : "Global Imports";
  const navSections = [
    {
      title: "Gestión",
      items: [
        { href: "/admin.html", label: "Dashboard", icon: "dashboard", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin.html"] },
        { href: "/admin-tracking.html", label: "Pedidos", icon: "clipboard", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin-tracking.html", "/admin-orders.html"] },
        { href: "/admin-vehicles.html", label: "Vehículos", icon: "car", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-vehicles.html"] },
        { href: "/admin-clients.html", label: "Clientes", icon: "user", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin-clients.html"] },
      ],
    },
    {
      title: "Control",
      items: [
        { href: "/admin-deleted-accounts.html", label: "Cuentas eliminadas", icon: "shield-x", adminCreatorOnly: false, latamOnly: false, activePaths: ["/admin-deleted-accounts.html"] },
        { href: "/admin-order-deletion-requests.html", label: "Solicitudes de eliminación", icon: "trash", adminCreatorOnly: true, latamOnly: false, activePaths: ["/admin-order-deletion-requests.html"] },
        { href: "/admin-client-requests.html", label: "Solicitudes de compra", icon: "cart", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-client-requests.html"] },
        { href: "/admin-maintenance.html", label: "Mantenimientos", icon: "wrench", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-maintenance.html"] },
        { href: "/admin-visitors.html", label: "Visitantes", icon: "user", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-visitors.html"] },
        { href: "/admin-gate-reports.html", label: "Reporte de ingresos y salidas", icon: "chart", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-gate-reports.html"] },
      ],
    },
    {
      title: "Contenido",
      items: [
        { href: "/admin-posts.html", label: "Publicaciones", icon: "document", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-posts.html", "/admin-post-edit.html"] },
        { href: "/admin-virtual-dealership.html", label: "Concesionario virtual", icon: "store", adminCreatorOnly: false, latamOnly: true, activePaths: ["/admin-virtual-dealership.html"] },
        { href: "/admin-admins.html", label: "Creación de administradores", icon: "shield-user", adminCreatorOnly: true, latamOnly: false, activePaths: ["/admin-admins.html"] },
      ],
    },
  ];

  const navMarkup = navSections
    .map((section) => {
      const linksMarkup = section.items
        .filter((item) => !item.adminCreatorOnly || canCreateAdministrativeUsers(currentRole))
        .filter((item) => !item.latamOnly || !isUsaRole)
        .map((item) => {
      const activePaths = Array.isArray(item.activePaths) && item.activePaths.length ? item.activePaths : [item.href];
      const isActive = activePaths.includes(currentPath);
      const classes = ["admin-nav-link"];

      if (isActive) {
        classes.push("active");
      }

      if (item.adminCreatorOnly) {
        classes.push("admin-admin-creator-only");
      }

      if (item.latamOnly) {
        classes.push("admin-latam-only");
      }

      return `<a class="${classes.join(" ")}" href="${item.href}"><span class="admin-nav-icon" aria-hidden="true">${adminNavIcon(item.icon)}</span><span class="admin-nav-label">${item.label}</span>${item.href === "/admin-posts.html" ? '<span class="admin-nav-badge" id="admin-posts-draft-badge" hidden>0</span>' : ""}</a>`;
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
      <div class="admin-sidebar-user-card">
        <span class="admin-sidebar-avatar" id="admin-avatar-sidebar" aria-hidden="true">AD</span>
        <div class="admin-sidebar-user-meta">
          <strong class="admin-sidebar-user-name" id="admin-name-sidebar">Administrador</strong>
          <span class="admin-sidebar-user-email" id="admin-email-sidebar">admin@globalimports.com</span>
        </div>
        <span class="admin-sidebar-user-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>
        </span>
      </div>
      <button id="logout-button-sidebar" class="admin-logout-button" type="button" onclick="window.__performAdminLogout?.(); return false;">
        <span class="admin-logout-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 5.5H7.5A2 2 0 0 0 5.5 7.5v9A2 2 0 0 0 7.5 18.5H10"/><path d="M13 12h6.5"/><path d="m16.5 9 3 3-3 3"/></svg>
        </span>
        <span>Cerrar sesión</span>
      </button>
    </div>
  `;

  return sidebar;
}

function getAdminInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "AD";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

function syncAdminSidebarAvatar(name) {
  const initials = getAdminInitials(name);
  document.querySelectorAll(".admin-sidebar-avatar, .admin-header-avatar").forEach((avatar) => {
    avatar.textContent = initials;
  });
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

  const existingSidebar = stage.querySelector(".admin-sidebar");
  const freshSidebar = buildAdminSidebar(currentPath, getCurrentRole());

  if (existingSidebar) {
    const existingNav = existingSidebar.querySelector(".admin-sidebar-nav");
    const freshNav = freshSidebar.querySelector(".admin-sidebar-nav");
    const existingFooter = existingSidebar.querySelector(".admin-sidebar-footer");
    const freshFooter = freshSidebar.querySelector(".admin-sidebar-footer");

    if (existingNav && freshNav) {
      existingNav.replaceWith(freshNav);
    }

    if (existingFooter && freshFooter) {
      const keepPrimaryIds = Boolean(existingFooter.querySelector("#admin-name, #logout-button"));
      const freshName = freshFooter.querySelector("#admin-name-sidebar");
      const freshEmail = freshFooter.querySelector("#admin-email-sidebar");
      const freshLogout = freshFooter.querySelector("#logout-button-sidebar");
      const freshAvatar = freshFooter.querySelector("#admin-avatar-sidebar");

      if (keepPrimaryIds) {
        if (freshName) {
          freshName.id = "admin-name";
        }
        if (freshEmail) {
          freshEmail.id = "admin-email";
        }
        if (freshLogout) {
          freshLogout.id = "logout-button";
        }
        if (freshAvatar) {
          freshAvatar.id = "admin-avatar";
        }
      }

      existingFooter.replaceWith(freshFooter);
      attachLogout(keepPrimaryIds ? "logout-button" : "logout-button-sidebar");
    }

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

  layout.appendChild(freshSidebar);
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
  initializeAdminNotificationsBell();

  const desktopMediaQuery = window.matchMedia("(min-width: 1101px) and (hover: hover) and (pointer: fine)");
  const isAppleTouchDevice = () => {
    const userAgent = String(navigator.userAgent || "");
    const platform = String(navigator.platform || "");
    return /iPad|iPhone|iPod/i.test(userAgent) || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
  };
  const isIpadTouchDevice = () => {
    const userAgent = String(navigator.userAgent || "");
    const platform = String(navigator.platform || "");
    return /iPad/i.test(userAgent) || (platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
  };
  const isDesktopSidebarMode = () => desktopMediaQuery.matches && !isAppleTouchDevice();

  let backdrop = document.querySelector(".admin-sidebar-backdrop");

  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "admin-sidebar-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    stage.appendChild(backdrop);
  }

  const updateToggleButtons = () => {
    const isOpen = document.body.classList.contains("admin-sidebar-open");
    const isDesktop = isDesktopSidebarMode();
    const isExpanded = isDesktop || isOpen;
    document.querySelectorAll(".admin-sidebar-toggle").forEach((button) => {
      button.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      button.setAttribute("aria-label", isExpanded ? "Cerrar menu lateral" : "Abrir menu lateral");

      const label = button.querySelector("span:last-child");

      if (label) {
        label.textContent = isDesktop ? "Menu" : (isExpanded ? "Cerrar menu" : "Menu");
      }
    });
  };

  const syncSidebarMode = () => {
    const isDesktop = isDesktopSidebarMode();
    const isIpad = isIpadTouchDevice();
    document.body.classList.toggle("admin-ipad-drawer", !isDesktop && isIpad);

    if (isDesktop) {
      window.localStorage.removeItem("globalAdminSidebarDesktopCollapsed");
      document.body.classList.remove("admin-sidebar-collapsed");
      document.body.classList.remove("admin-sidebar-open");
    } else {
      document.body.classList.remove("admin-sidebar-collapsed");

      if (isIpad) {
        document.body.classList.remove("admin-sidebar-open");
      }
    }

    updateToggleButtons();
  };

  const closeSidebar = () => {
    if (isDesktopSidebarMode()) {
      updateToggleButtons();
      return;
    }

    document.body.classList.remove("admin-sidebar-open");
    updateToggleButtons();
  };

  const toggleSidebar = () => {
    if (isDesktopSidebarMode()) {
      updateToggleButtons();
      return;
    }

    document.body.classList.toggle("admin-sidebar-open");
    updateToggleButtons();
  };

  if (document.body.dataset.adminDrawerBound === "true") {
    updateToggleButtons();
    return;
  }

  document.body.dataset.adminDrawerBound = "true";

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

    if (event.target.closest(".admin-sidebar .admin-nav-link")) {
      if (!isDesktopSidebarMode()) {
        closeSidebar();
      }
      return;
    }

    if (
      !isDesktopSidebarMode() &&
      document.body.classList.contains("admin-sidebar-open") &&
      !event.target.closest(".admin-sidebar")
    ) {
      closeSidebar();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !isDesktopSidebarMode()) {
      closeSidebar();
    }
  });

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

  const displayName = user.name || "Administrador";
  const displayEmail = user.email || "admin@globalimports.com";

  if (nameElement) {
    nameElement.textContent = displayName;
  }

  if (emailElement) {
    emailElement.textContent = displayEmail;
  }

  const sidebarNameElement = document.getElementById("admin-name-sidebar");
  const sidebarEmailElement = document.getElementById("admin-email-sidebar");
  const headerNameElement = document.getElementById("admin-name-top");
  const headerEmailElement = document.getElementById("admin-email-top");

  if (sidebarNameElement) {
    sidebarNameElement.textContent = displayName;
  }

  if (sidebarEmailElement) {
    sidebarEmailElement.textContent = displayEmail;
  }

  if (headerNameElement) {
    headerNameElement.textContent = displayName;
  }

  if (headerEmailElement) {
    headerEmailElement.textContent = displayEmail;
  }

  syncAdminSidebarAvatar(displayName);
  applyManagerNavigationVisibility(user.role);
  refreshPostsDraftBadge().catch(() => null);
  refreshAdminNotifications().catch(() => null);

  return user;
}

async function refreshPostsDraftBadge() {
  const badge = document.getElementById("admin-posts-draft-badge");

  if (!badge) {
    return 0;
  }

  const hideBadge = () => {
    badge.hidden = true;
    badge.textContent = "";
    badge.style.display = "none";
  };

  if (!getAuthToken()) {
    hideBadge();
    return 0;
  }

  try {
    const data = await fetchJson("/api/admin/posts/draft-count", {
      loadingMessage: false,
    });
    const count = Number(data?.count) || 0;
    const shouldShow = count >= 1;

    badge.hidden = !shouldShow;
    badge.textContent = shouldShow ? String(count) : "";
    badge.style.display = shouldShow ? "" : "none";
    return count;
  } catch {
    hideBadge();
    return 0;
  }
}

function escapeAdminHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createAdminNotificationsBell() {
  const root = document.createElement("div");
  root.className = "admin-notifications";
  root.innerHTML = `
    <button class="admin-notifications-toggle" type="button" aria-label="Notificaciones" aria-expanded="false">
      <span class="admin-notifications-bell-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4.2 1.5 5.8 2 6.5H4.5c.5-.7 2-2.3 2-6.5Z"/>
          <path d="M10 18.5a2 2 0 0 0 4 0"/>
        </svg>
      </span>
      <span class="admin-notifications-count" id="admin-notifications-count" hidden>0</span>
    </button>
    <div class="admin-notifications-panel" id="admin-notifications-panel" hidden>
      <div class="admin-notifications-panel-header">
        <strong>Notificaciones</strong>
        <button class="admin-notifications-mark-all" type="button" title="Marcar todas como leídas" aria-label="Marcar todas como leídas">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 13.5 9.5 18 19 6.5"/>
          </svg>
        </button>
      </div>
      <div class="admin-notifications-list" id="admin-notifications-list"></div>
    </div>
  `;
  return root;
}

function bindAdminHeaderUserMenu(userWrap) {
  if (!userWrap || userWrap.dataset.bound === "true") {
    return;
  }

  userWrap.dataset.bound = "true";
  const userToggle = userWrap.querySelector(".admin-header-user-toggle");
  const userMenu = userWrap.querySelector(".admin-header-user-menu");

  userToggle?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = Boolean(userMenu?.hidden);
    closeAdminNotificationsPanel();
    if (userMenu) {
      userMenu.hidden = !willOpen;
    }
    userToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".admin-header-user")) {
      if (userMenu) {
        userMenu.hidden = true;
      }
      userToggle?.setAttribute("aria-expanded", "false");
    }
  });

  const logoutButton = userWrap.querySelector("#logout-button");
  if (logoutButton) {
    attachLogout(logoutButton.id || "logout-button");
  }
}

function ensureAdminHeaderCluster() {
  const existingCluster = document.querySelector(".admin-header-cluster");
  if (existingCluster) {
    bindAdminHeaderUserMenu(existingCluster.querySelector(".admin-header-user"));
    return existingCluster.querySelector(".admin-notifications") || existingCluster;
  }

  const actions =
    document.querySelector(".page-topbar-actions") ||
    document.querySelector(".admin-dashboard-header-actions");

  if (!actions) {
    return null;
  }

  const existingName =
    actions.querySelector("#admin-name") ||
    actions.querySelector("#admin-name-top") ||
    document.getElementById("admin-name");
  const existingEmail =
    actions.querySelector("#admin-email") ||
    document.getElementById("admin-email");
  const existingLogout = actions.querySelector("#logout-button") || document.getElementById("logout-button");

  const nameId = existingName?.id || "admin-name";
  const emailId = existingEmail?.id || "admin-email";
  const nameText = existingName?.textContent?.trim() || "Administrador";
  const emailText = existingEmail?.textContent?.trim() || "admin@globalimports.com";
  const initials = getAdminInitials(nameText);

  actions.querySelectorAll(".admin-badge, .admin-user-chip").forEach((node) => node.remove());
  if (existingLogout && actions.contains(existingLogout)) {
    existingLogout.remove();
  }

  const cluster = document.createElement("div");
  cluster.className = "admin-header-cluster";

  const bell = createAdminNotificationsBell();
  const divider = document.createElement("span");
  divider.className = "admin-header-divider";
  divider.setAttribute("aria-hidden", "true");

  const userWrap = document.createElement("div");
  userWrap.className = "admin-header-user";
  userWrap.innerHTML = `
    <button class="admin-header-user-toggle" type="button" aria-expanded="false" aria-haspopup="true">
      <span class="admin-header-avatar" id="admin-header-avatar" aria-hidden="true">${escapeAdminHtml(initials)}</span>
      <span class="admin-header-user-meta">
        <strong class="admin-header-user-name" id="${escapeAdminHtml(nameId)}">${escapeAdminHtml(nameText)}</strong>
        <span class="admin-header-user-email" id="${escapeAdminHtml(emailId)}">${escapeAdminHtml(emailText)}</span>
      </span>
      <span class="admin-header-user-chevron" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>
      </span>
    </button>
    <div class="admin-header-user-menu" id="admin-header-user-menu" hidden>
      <button id="logout-button" class="admin-header-logout-button" type="button">Cerrar sesión</button>
    </div>
  `;

  cluster.appendChild(bell);
  cluster.appendChild(divider);
  cluster.appendChild(userWrap);
  actions.prepend(cluster);
  bindAdminHeaderUserMenu(userWrap);
  return bell;
}

function ensureAdminNotificationsBell() {
  const existing = document.querySelector(".admin-notifications");
  if (existing) {
    return existing;
  }

  return ensureAdminHeaderCluster();
}

function setAdminNotificationsCount(count) {
  const badge = document.getElementById("admin-notifications-count");
  if (!badge) {
    return;
  }

  const safeCount = Number(count) || 0;
  const shouldShow = safeCount >= 1;
  badge.hidden = !shouldShow;
  badge.textContent = shouldShow ? String(safeCount > 99 ? "99+" : safeCount) : "";
  badge.style.display = shouldShow ? "" : "none";
}

function renderAdminNotificationsList(notifications = []) {
  const list = document.getElementById("admin-notifications-list");
  if (!list) {
    return;
  }

  if (!notifications.length) {
    list.innerHTML = `<p class="admin-notifications-empty">No hay notificaciones nuevas.</p>`;
    return;
  }

  list.innerHTML = notifications
    .map((item) => {
      const unreadClass = item.isRead ? "" : " is-unread";
      const when = item.createdAt ? formatDateTimeInBogota(item.createdAt) : "";
      return `
        <article class="admin-notification-item${unreadClass}" data-notification-id="${escapeAdminHtml(item.id)}" data-deep-link="${escapeAdminHtml(item.deepLink)}">
          <button class="admin-notification-main" type="button">
            <strong>${escapeAdminHtml(item.title)}</strong>
            <span>${escapeAdminHtml(item.body || "")}</span>
            <small>${escapeAdminHtml(when)}</small>
          </button>
          <button class="admin-notification-dismiss" type="button" title="Eliminar" aria-label="Eliminar notificación" data-dismiss-id="${escapeAdminHtml(item.id)}">×</button>
        </article>
      `;
    })
    .join("");
}

async function refreshAdminNotifications({ renderList = false } = {}) {
  if (!getAuthToken()) {
    setAdminNotificationsCount(0);
    if (renderList) {
      renderAdminNotificationsList([]);
    }
    return { count: 0, notifications: [] };
  }

  try {
    if (renderList) {
      const data = await fetchJson("/api/admin/notifications?limit=40", {
        loadingMessage: false,
      });
      const notifications = data.notifications || [];
      renderAdminNotificationsList(notifications);
      const unread = notifications.filter((item) => !item.isRead).length;
      setAdminNotificationsCount(unread);
      return { count: unread, notifications };
    }

    const data = await fetchJson("/api/admin/notifications/unread-count", {
      loadingMessage: false,
    });
    const count = Number(data?.count) || 0;
    setAdminNotificationsCount(count);
    return { count, notifications: [] };
  } catch {
    setAdminNotificationsCount(0);
    if (renderList) {
      renderAdminNotificationsList([]);
    }
    return { count: 0, notifications: [] };
  }
}

function closeAdminNotificationsPanel() {
  const panel = document.getElementById("admin-notifications-panel");
  const toggle = document.querySelector(".admin-notifications-toggle");
  if (panel) {
    panel.hidden = true;
  }
  if (toggle) {
    toggle.setAttribute("aria-expanded", "false");
  }
}

function initializeAdminNotificationsBell() {
  const currentPath = String(window.location.pathname || "");
  const isAdminHtmlRoute = /^\/(?:app\/)?admin(?:-[a-z0-9-]+)?\.html$/i.test(currentPath);

  if (!isAdminHtmlRoute) {
    return;
  }

  const root = ensureAdminNotificationsBell();
  if (!root || root.dataset.bound === "true") {
    refreshAdminNotifications().catch(() => null);
    return;
  }

  root.dataset.bound = "true";
  const toggle = root.querySelector(".admin-notifications-toggle");
  const panel = root.querySelector(".admin-notifications-panel");
  const markAllButton = root.querySelector(".admin-notifications-mark-all");
  const list = root.querySelector(".admin-notifications-list");

  toggle?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = Boolean(panel?.hidden);
    if (!willOpen) {
      closeAdminNotificationsPanel();
      return;
    }

    const userMenu = document.getElementById("admin-header-user-menu");
    const userToggle = document.querySelector(".admin-header-user-toggle");
    if (userMenu) {
      userMenu.hidden = true;
    }
    userToggle?.setAttribute("aria-expanded", "false");

    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    await refreshAdminNotifications({ renderList: true });
  });

  markAllButton?.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await fetchJson("/api/admin/notifications/read-all", {
        method: "POST",
        loadingMessage: false,
      });
      await refreshAdminNotifications({ renderList: true });
    } catch {
      // ignore
    }
  });

  list?.addEventListener("click", async (event) => {
    const dismissButton = event.target.closest("[data-dismiss-id]");
    if (dismissButton) {
      event.preventDefault();
      event.stopPropagation();
      const notificationId = dismissButton.dataset.dismissId;
      try {
        await fetchJson(`/api/admin/notifications/${notificationId}`, {
          method: "DELETE",
          loadingMessage: false,
        });
        await refreshAdminNotifications({ renderList: true });
      } catch {
        // ignore
      }
      return;
    }

    const itemButton = event.target.closest(".admin-notification-main");
    const item = itemButton?.closest("[data-notification-id]");
    if (!item) {
      return;
    }

    event.preventDefault();
    const notificationId = item.dataset.notificationId;
    const deepLink = item.dataset.deepLink || "/admin.html";

    try {
      await fetchJson(`/api/admin/notifications/${notificationId}/read`, {
        method: "POST",
        loadingMessage: false,
      });
    } catch {
      // continue navigation even if mark-read fails
    }

    closeAdminNotificationsPanel();
    window.location.href = deepLink;
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".admin-notifications")) {
      closeAdminNotificationsPanel();
    }
  });

  refreshAdminNotifications().catch(() => null);
}

injectAdminSidebarLayout();
syncAdminViewportMetrics();
initializeAdminSidebarDrawer();

window.addEventListener("load", forceHideAnyLoadingOverlay);
window.addEventListener("load", syncAdminViewportMetrics);
window.addEventListener("resize", syncAdminViewportMetrics);
window.addEventListener("orientationchange", () => {
  syncAdminViewportMetrics();
  window.setTimeout(syncAdminViewportMetrics, 120);
  window.setTimeout(syncAdminViewportMetrics, 360);
});
window.visualViewport?.addEventListener("resize", syncAdminViewportMetrics);
window.addEventListener("pageshow", forceHideAnyLoadingOverlay);
window.addEventListener("pageshow", syncAdminViewportMetrics);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncAdminViewportMetrics();
    forceHideAnyLoadingOverlay();
    refreshPostsDraftBadge().catch(() => null);
    refreshAdminNotifications().catch(() => null);
  }
});
window.setTimeout(forceHideAnyLoadingOverlay, 0);
window.setTimeout(() => {
  refreshPostsDraftBadge().catch(() => null);
  initializeAdminNotificationsBell();
  refreshAdminNotifications().catch(() => null);
}, 800);
window.setInterval(() => {
  refreshPostsDraftBadge().catch(() => null);
  refreshAdminNotifications().catch(() => null);
}, 60000);

window.AdminApp = {
  attachLogout,
  canCreateAdministrativeUsers,
  clearAuth,
  fetchJson,
  formatCurrency,
  formatDate,
  formatDateTimeInBogota,
  getAuthToken,
  getCurrentRole,
  hideLoadingOverlay,
  isUsaAdministrativeRole,
  loadAdminSession,
  parseMediaUrls,
  populateSelect,
  performLogout,
  redirectToLogin,
  refreshAdminNotifications,
  refreshPostsDraftBadge,
  resetLoadingOverlay,
  renderEmptyState,
  requireAdminAccess,
  resolveApiBaseUrl,
  setFeedback,
  showLoadingOverlay,
  trackingTemplates,
};