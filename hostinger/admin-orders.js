const {
  attachLogout: adminAttachLogout,
  resetLoadingOverlay: adminResetLoadingOverlay,
  redirectToLogin: adminRedirectToLogin,
  setFeedback: adminSetFeedback,
} = window.AdminApp;

function resolveOrdersApiBaseUrl() {
  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${port || "10000"}`;
  }

  return "https://global-backend-bdbx.onrender.com";
}

function buildLegacyPurchaseDate() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${now.getFullYear()}-${month}-${day}`;
}

async function fetchOrdersPageJson(path, options = {}) {
  const authToken = localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
  const isFormDataBody = options.body instanceof FormData;

  const response = await fetch(`${resolveOrdersApiBaseUrl()}${path}`, {
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

async function loadOrdersPageSession() {
  const data = await fetchOrdersPageJson("/api/auth/me");
  const user = data.user || {};

  if (user.role) {
    localStorage.setItem("globalAppRole", user.role);
    sessionStorage.setItem("globalAppRole", user.role);
  }

  document.getElementById("admin-name").textContent = user.name || "Administrador";
  document.getElementById("admin-email").textContent = user.email || "admin@globalimports.com";

  return user;
}

if (true) {
  document.body.classList.add("orders-creation-page");
  adminAttachLogout();

  const orderForm = document.getElementById("order-form");
  const orderFeedback = document.getElementById("order-feedback");
  const trackingInput = document.getElementById("order-tracking-number");
  const generateTrackingButton = document.getElementById("generate-tracking-button");
  const mediaFilesInput = document.getElementById("order-media-files");
  const mediaSummary = document.getElementById("order-media-summary");
  const clientSelect = document.getElementById("order-client-select");
  const clientSummary = document.getElementById("order-client-summary");
  const successModal = document.getElementById("order-success-modal");
  const successDescription = document.getElementById("order-success-description");
  const successMeta = document.getElementById("order-success-meta");
  let orders = [];
  let clients = [];
  let initOverlayWatchdog = null;

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

  function buildRandomTracking() {
    const randomNumber = Math.floor(100000 + Math.random() * 99999999);
    return `GI-${randomNumber}`;
  }

  function generateLocalTrackingNumber() {
    const existingTrackings = new Set(
      orders.map((order) => String(order.trackingNumber || "").trim().toUpperCase())
    );

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const candidate = buildRandomTracking();

      if (!existingTrackings.has(candidate)) {
        return candidate;
      }
    }

    return buildRandomTracking();
  }

  function applyTrackingToField(trackingNumber) {
    if (!trackingInput) {
      return;
    }

    trackingInput.readOnly = true;
    trackingInput.value = trackingNumber;
    trackingInput.placeholder = trackingNumber;
    trackingInput.dispatchEvent(new Event("input", { bubbles: true }));
    trackingInput.dispatchEvent(new Event("change", { bubbles: true }));
    trackingInput.focus();
  }

  function renderMediaSummary(files = []) {
    if (!mediaSummary) {
      return;
    }

    if (!files.length) {
      mediaSummary.textContent = "";
      return;
    }

    mediaSummary.textContent = `${files.length} archivo${files.length === 1 ? "" : "s"} seleccionado${files.length === 1 ? "" : "s"}.`;
  }

  function renderClientOptions() {
    if (!clientSelect) {
      return;
    }

    if (!clients.length) {
      clientSelect.innerHTML = '<option value="">No hay clientes disponibles</option>';

      if (clientSummary) {
        clientSummary.textContent = "Primero crea al menos un cliente en el módulo Clientes.";
      }

      return;
    }

    clientSelect.innerHTML = [
      '<option value="">Selecciona cliente</option>',
      ...clients.map((client) => `<option value="${client._id || client.id}">${client.name} · ${client.email}</option>`),
    ].join("");

    if (clientSummary) {
      clientSummary.textContent = `${clients.length} cliente(s) disponible(s).`;
    }
  }

  function closeSuccessModal() {
    if (!successModal) {
      return;
    }

    successModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function showSuccessModal(order) {
    if (!successModal || !order) {
      return;
    }

    const vehicleLabel = `${order.vehicle?.brand || "Vehículo"} ${order.vehicle?.model || ""}${order.vehicle?.version ? ` ${order.vehicle.version}` : ""}`.trim();
    successDescription.textContent = `Se guardó correctamente ${vehicleLabel}.`;
    successMeta.innerHTML = `
      <div class="info-box modal-info-box">
        <span>Cliente</span>
        <strong>${order.client?.name || "Sin cliente"}</strong>
      </div>
      <div class="info-box modal-info-box">
        <span>Tracking</span>
        <strong>${order.trackingNumber || "Sin tracking"}</strong>
      </div>
      <div class="info-box modal-info-box">
        <span>Destino</span>
        <strong>${order.vehicle?.destination || "Sin destino"}</strong>
      </div>
      <div class="info-box modal-info-box">
        <span>Fecha estimada</span>
        <strong>${order.expectedArrivalDate ? new Date(order.expectedArrivalDate).toLocaleDateString("es-CO", { year: "numeric", month: "short", day: "numeric" }) : "Sin fecha"}</strong>
      </div>
    `;
    successModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  async function loadOrdersPage() {
    try {
      await loadOrdersPageSession();
      const [ordersData, usersData] = await Promise.all([
        fetchOrdersPageJson("/api/admin/orders"),
        fetchOrdersPageJson("/api/admin/clients"),
      ]);
      orders = ordersData.orders || [];
      clients = usersData.clients || [];
      renderClientOptions();
      window.__fillRandomTracking({ silent: true });
    } finally {
      stopInitOverlayWatchdog();
      if (typeof adminResetLoadingOverlay === "function") {
        adminResetLoadingOverlay();
      }
      forceClearLoadingState();
    }
  }

  mediaFilesInput?.addEventListener("change", () => {
    renderMediaSummary(Array.from(mediaFilesInput.files || []));
  });

  window.__fillRandomTracking = ({ silent = false } = {}) => {
    const candidate = generateLocalTrackingNumber();
    applyTrackingToField(candidate);

    if (!silent) {
      adminSetFeedback(orderFeedback, "Tracking generado correctamente.", "success");
    }

    return false;
  };

  trackingInput?.addEventListener("keydown", (event) => {
    event.preventDefault();
  });

  trackingInput?.addEventListener("paste", (event) => {
    event.preventDefault();
  });

  window.__closeOrderSuccessModal = closeSuccessModal;

  generateTrackingButton?.addEventListener("click", () => {
    window.__fillRandomTracking();
  });

  document.getElementById("order-success-close")?.addEventListener("click", closeSuccessModal);
  document.querySelector('[data-close-modal="order-success-modal"]')?.addEventListener("click", closeSuccessModal);

  async function submitAdminOrder(event) {
    event?.preventDefault?.();
    const formData = new FormData(orderForm);
    const trackingNumber = String(formData.get("trackingNumber") || "").trim().toUpperCase();
    const exteriorColor = String(formData.get("exteriorColor") || "").trim();
    const interiorColor = String(formData.get("interiorColor") || "").trim();
    const requiredFields = [
      ["brand", "La marca es obligatoria."],
      ["model", "El modelo es obligatorio."],
      ["version", "La versión es obligatoria."],
      ["year", "El año es obligatorio."],
      ["trackingNumber", "El tracking es obligatorio."],
      ["destination", "El destino es obligatorio."],
      ["exteriorColor", "El color exterior es obligatorio."],
      ["interiorColor", "El color interior es obligatorio."],
      ["clientId", "Debes seleccionar un cliente."],
    ];

    for (const [fieldName, message] of requiredFields) {
      if (!String(formData.get(fieldName) || "").trim()) {
        adminSetFeedback(orderFeedback, message, "error");
        forceClearLoadingState();
        return false;
      }
    }

    formData.set("trackingNumber", trackingNumber);
    formData.set("purchaseDate", String(formData.get("purchaseDate") || "").trim() || buildLegacyPurchaseDate());
    formData.set("color", exteriorColor || interiorColor);

    adminSetFeedback(orderFeedback, "Creando pedido...");

    try {
      const data = await fetchOrdersPageJson("/api/admin/orders", {
        method: "POST",
        body: formData,
      });

      orderForm.reset();
      window.__fillRandomTracking({ silent: true });
      renderMediaSummary([]);
      adminSetFeedback(orderFeedback, "Pedido creado correctamente.", "success");
      await loadOrdersPage();
      showSuccessModal(data.order);
      return false;
    } catch (error) {
      adminSetFeedback(orderFeedback, error.message, "error");
      forceClearLoadingState();
      return false;
    }
  }

  window.__submitAdminOrder = submitAdminOrder;
  orderForm.addEventListener("submit", submitAdminOrder);

  renderMediaSummary([]);

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);

  loadOrdersPage().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    adminSetFeedback(orderFeedback, error.message, "error");
  });
}