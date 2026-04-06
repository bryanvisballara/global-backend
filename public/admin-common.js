function resolveApiBaseUrl() {
  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${port || "10000"}`;
  }

  return "https://global-backend-bdbx.onrender.com";
}

const trackingTemplates = [
  { key: "request-received", label: "Solicitud recibida" },
  { key: "purchase-confirmed", label: "Compra confirmada" },
  { key: "origin-logistics", label: "Logística en origen" },
  { key: "in-transit", label: "En tránsito" },
  { key: "customs", label: "Proceso aduanal" },
  { key: "local-delivery", label: "Entrega local" },
  { key: "completed", label: "Entrega completada" },
];

function redirectToLogin() {
  window.location.replace("/app/index.html");
}

function getAuthToken() {
  return localStorage.getItem("globalAppToken");
}

function getCurrentRole() {
  return localStorage.getItem("globalAppRole");
}

function clearAuth() {
  localStorage.removeItem("globalAppToken");
  localStorage.removeItem("globalAppRole");
}

function requireAdminAccess() {
  if (!getAuthToken() || getCurrentRole() !== "admin") {
    redirectToLogin();
    return false;
  }

  return true;
}

function attachLogout(buttonId = "logout-button") {
  const button = document.getElementById(buttonId);

  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    clearAuth();
    redirectToLogin();
  });
}

async function fetchJson(path, options = {}) {
  const isFormDataBody = options.body instanceof FormData;

  const response = await fetch(`${resolveApiBaseUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${getAuthToken()}`,
      ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
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

  if (nameElement) {
    nameElement.textContent = user.name || "Administrador";
  }

  if (emailElement) {
    emailElement.textContent = user.email || "admin@globalimports.com";
  }

  return user;
}

window.AdminApp = {
  attachLogout,
  clearAuth,
  fetchJson,
  formatCurrency,
  formatDate,
  loadAdminSession,
  parseMediaUrls,
  populateSelect,
  redirectToLogin,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
  trackingTemplates,
};