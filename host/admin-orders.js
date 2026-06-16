(() => {
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

function normalizeAdminPathname(pathname = window.location.pathname) {
  return String(pathname || "").replace(/\/+$/, "").toLowerCase();
}

function isEmbeddedTrackingOrderFormPage() {
  const pathname = normalizeAdminPathname();

  return pathname.endsWith("/admin-tracking.html")
    && Boolean(document.getElementById("tracking-create-order-modal"));
}

function resolveAdminHtmlPath(fileName) {
  const pathname = normalizeAdminPathname();
  const useAppPrefix = pathname.startsWith("/app/") || pathname === "/app";

  return `${useAppPrefix ? "/app" : ""}/${fileName}`.replace(/\/{2,}/g, "/");
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function uppercaseDisplay(value, fallback = "") {
  return String(value || fallback || "").toUpperCase();
}

function attachNativeSelectPicker(selectElement) {
  if (!selectElement || selectElement.dataset.pickerBound === "true") {
    return;
  }

  const collapseManualPicker = () => {
    if (selectElement.dataset.manualExpanded !== "true") {
      return;
    }

    selectElement.size = 1;
    selectElement.dataset.manualExpanded = "false";
    selectElement.classList.remove("is-picker-expanded");
  };

  const openPicker = (event) => {
    if (selectElement.disabled) {
      return;
    }

    const optionCount = Array.from(selectElement.options || []).length;
    const useManualPicker = window.matchMedia("(max-width: 900px)").matches;

    if (useManualPicker) {
      if (optionCount <= 1) {
        return;
      }

      const nextExpanded = selectElement.dataset.manualExpanded !== "true";
      selectElement.size = nextExpanded ? Math.min(Math.max(optionCount, 2), 6) : 1;
      selectElement.dataset.manualExpanded = nextExpanded ? "true" : "false";
      selectElement.classList.toggle("is-picker-expanded", nextExpanded);
      event?.preventDefault?.();

      if (nextExpanded) {
        selectElement.focus({ preventScroll: true });
      }

      return;
    }

    if (typeof selectElement.showPicker !== "function") {
      return;
    }

    try {
      selectElement.showPicker();
    } catch {
      // Ignore browsers that block imperative picker opening.
    }
  };

  selectElement.addEventListener("click", openPicker);
  selectElement.addEventListener("change", collapseManualPicker);
  selectElement.addEventListener("blur", () => {
    window.setTimeout(collapseManualPicker, 120);
  });
  selectElement.dataset.pickerBound = "true";
}

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
  adminAttachLogout();

  const orderForm = document.getElementById("order-form");
  const orderFeedback = document.getElementById("order-feedback");
  const trackingInput = document.getElementById("order-tracking-number");
  const generateTrackingButton = document.getElementById("generate-tracking-button");
  const mediaFilesInput = document.getElementById("order-media-files");
  const mediaSummary = document.getElementById("order-media-summary");
  const clientSelect = document.getElementById("order-client-select");
  const clientSummary = document.getElementById("order-client-summary");
  const brokerField = document.getElementById("order-broker-field");
  let brokerSelect = document.getElementById("order-broker-select");
  const brokerSummary = document.getElementById("order-broker-summary");
  const successModal = document.getElementById("order-success-modal");
  const successDescription = document.getElementById("order-success-description");
  const successMeta = document.getElementById("order-success-meta");
  const orderSubmitButton = document.getElementById("tracking-create-order-submit")
    || orderForm?.querySelector('button[type="submit"], button[type="button"]#tracking-create-order-submit')
    || orderForm?.querySelector('button[type="submit"]')
    || null;
  const isEmbeddedTrackingOrderForm = isEmbeddedTrackingOrderFormPage();
  let orders = [];
  let clients = [];
  let brokers = [];
  let currentAdminRole = "";
  let currentAdminEmail = "";
  let initOverlayWatchdog = null;

  const ANTHONY_GLOBAL_OWNER_EMAIL = "anthony-vergel@hotmail.com";

  if (orderForm) {
    orderForm.noValidate = true;
  }

  function getOrderFormMode() {
    return orderForm?.dataset.mode === "edit" ? "edit" : "create";
  }

  function getEditingOrderId() {
    return String(orderForm?.dataset.orderId || "").trim();
  }

  function getOrderFormRegion() {
    const explicitRegion = String(orderForm?.dataset.orderRegion || "").trim().toLowerCase();

    if (explicitRegion) {
      return explicitRegion;
    }

    return ["gerenteusa", "adminusa", "brokerusa"].includes(normalizeRole(currentAdminRole)) ? "usa" : "latam";
  }

  function isAnthonyGlobalOwner() {
    return String(currentAdminRole || "").trim() === "manager" && currentAdminEmail === ANTHONY_GLOBAL_OWNER_EMAIL;
  }

  function hasGlobalLatamOrderPrivileges() {
    return ["admin", "manager"].includes(normalizeRole(currentAdminRole));
  }

  function canEditOrderClient() {
    return getOrderFormMode() !== "edit" || hasGlobalLatamOrderPrivileges();
  }

  function focusInvalidOrderField(fieldName, message) {
    adminSetFeedback(orderFeedback, message, "error");

    const field = orderForm?.elements?.namedItem(fieldName);

    if (field && typeof field.scrollIntoView === "function") {
      field.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    if (field && typeof field.focus === "function") {
      try {
        field.focus({ preventScroll: true });
      } catch {
        // Ignore focus errors on readonly controls.
      }
    }

    orderFeedback?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    forceClearLoadingState();
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

    const orderRegion = getOrderFormRegion();
    const editableClient = canEditOrderClient();
    const compatibleClients = editableClient && getOrderFormMode() === "edit" && isAnthonyGlobalOwner()
      ? [...clients]
      : clients.filter((client) => {
          const clientRegion = String(client?.clientRegion || orderRegion).trim().toLowerCase();
          return clientRegion === orderRegion;
        });
    const previousValue = String(clientSelect.value || "").trim();
    clientSelect.disabled = !editableClient;

    if (!compatibleClients.length) {
      clientSelect.innerHTML = '<option value="">No hay clientes disponibles</option>';

      if (clientSummary) {
        clientSummary.textContent = editableClient
          ? "No hay clientes disponibles para este pedido."
          : "Solo Global Latam puede cambiar el cliente de un pedido.";
      }

      return;
    }

    clientSelect.innerHTML = [
      '<option value="">Selecciona cliente</option>',
      ...compatibleClients.map((client) => `<option value="${escapeHtml(client._id || client.id || "")}">${escapeHtml(uppercaseDisplay(client.name, "Cliente"))}</option>`),
    ].join("");

    if (previousValue && compatibleClients.some((client) => String(client._id || client.id || "").trim() === previousValue)) {
      clientSelect.value = previousValue;
    }

    if (clientSummary) {
      clientSummary.textContent = !editableClient
        ? "Solo Global Latam puede cambiar el cliente de un pedido."
        : getOrderFormMode() === "edit" && isAnthonyGlobalOwner()
          ? `${compatibleClients.length} cliente(s) globales disponible(s). Cambiar la región del cliente moverá el pedido.`
          : `${compatibleClients.length} cliente(s) ${orderRegion.toUpperCase()} disponible(s).`;
    }
  }

  function isClientCompatibleWithOrderRegion(clientId) {
    const normalizedClientId = String(clientId || "").trim();

    if (!normalizedClientId) {
      return true;
    }

    if (isEmbeddedTrackingOrderForm && !clients.length) {
      return Array.from(clientSelect?.options || []).some((option) => String(option.value || "").trim() === normalizedClientId);
    }

    const selectedClient = clients.find((client) => String(client?._id || client?.id || "").trim() === normalizedClientId) || null;

    if (!selectedClient) {
      return false;
    }

    if (isAnthonyGlobalOwner() && getOrderFormMode() === "edit") {
      return true;
    }

    return String(selectedClient?.clientRegion || getOrderFormRegion()).trim().toLowerCase() === getOrderFormRegion();
  }

  function canAssignBrokerToOrders() {
    const normalizedRole = normalizeRole(currentAdminRole);

    if (!["gerenteusa", "adminusa"].includes(normalizedRole)) {
      return false;
    }

    return true;
  }

  function ensureBrokerSelect() {
    if (!brokerField) {
      return null;
    }

    const legacyNodes = [
      brokerField.querySelector("#order-broker-input"),
      brokerField.querySelector("#order-broker-options"),
      brokerField.querySelector("#order-broker-picker"),
    ];

    legacyNodes.forEach((node) => {
      if (node) {
        node.remove();
      }
    });

    let selectElement = brokerField.querySelector("#order-broker-select");

    if (!selectElement) {
      selectElement = document.createElement("select");
      selectElement.id = "order-broker-select";
      selectElement.name = "assignedBrokerId";
      selectElement.innerHTML = '<option value="">Sin broker asignado</option>';

      const summaryElement = brokerField.querySelector("#order-broker-summary");

      if (summaryElement) {
        brokerField.insertBefore(selectElement, summaryElement);
      } else {
        brokerField.appendChild(selectElement);
      }
    }

    return selectElement;
  }

  brokerSelect = brokerSelect || ensureBrokerSelect();

  function renderBrokerOptions() {
    brokerSelect = brokerSelect || ensureBrokerSelect();

    if (!brokerField || !brokerSelect) {
      return;
    }

    const canAssignBroker = canAssignBrokerToOrders();
    brokerField.hidden = !canAssignBroker;
    brokerSelect.disabled = !canAssignBroker;

    if (!canAssignBroker) {
      brokerSelect.innerHTML = '<option value="">Sin broker asignado</option>';
      return;
    }

    const previousValue = String(brokerSelect.value || "").trim();

    const sortedBrokers = [...brokers].sort((left, right) => (
      String(left?.name || "Broker").localeCompare(String(right?.name || "Broker"), "es", { sensitivity: "base" })
    ));

    brokerSelect.innerHTML = [
      '<option value="">Sin broker asignado</option>',
      ...sortedBrokers.map((broker) => `<option value="${escapeHtml(broker._id || broker.id || "")}">${escapeHtml(broker.name || broker.email || "Broker USA")}</option>`),
    ].join("");

    if (previousValue && sortedBrokers.some((broker) => String(broker?._id || broker?.id || "").trim() === previousValue)) {
      brokerSelect.value = previousValue;
    }

    if (brokerSummary) {
      brokerSummary.textContent = sortedBrokers.length
        ? `${sortedBrokers.length} broker(s) USA disponible(s).`
        : "No hay brokers USA creados todavía.";
    }
  }

  function closeSuccessModal() {
    if (!successModal) {
      return;
    }

    successModal.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function showSuccessModal(order, options = {}) {
    if (!successModal || !order) {
      return;
    }

    const mode = options.mode === "edit" ? "edit" : "create";
    const vehicleLabel = `${order.vehicle?.brand || "Vehículo"} ${order.vehicle?.model || ""}${order.vehicle?.version ? ` ${order.vehicle.version}` : ""}`.trim();
    successDescription.textContent = mode === "edit"
      ? `Se actualizó correctamente ${vehicleLabel}.`
      : `Se guardó correctamente ${vehicleLabel}.`;
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
      const user = await loadOrdersPageSession();
      currentAdminRole = String(user?.role || "").trim();
      currentAdminEmail = String(user?.email || "").trim().toLowerCase();

      if (normalizeRole(currentAdminRole) === "brokerusa" && normalizeAdminPathname().endsWith("/admin-orders.html")) {
        window.location.replace(resolveAdminHtmlPath("admin-tracking.html"));
        return;
      }

      if (orderForm) {
        orderForm.dataset.orderRegion = ["gerenteusa", "adminusa", "brokerusa"].includes(normalizeRole(currentAdminRole)) ? "usa" : "latam";
      }

      if (isEmbeddedTrackingOrderForm) {
        return;
      }

      const [ordersData, usersData, adminsData] = await Promise.all([
        fetchOrdersPageJson("/api/admin/orders"),
        fetchOrdersPageJson("/api/admin/clients"),
        fetchOrdersPageJson("/api/admin/users/admins"),
      ]);
      orders = normalizeCollectionPayload(ordersData, ["orders"]);
      clients = normalizeCollectionPayload(usersData, ["clients"]);
      brokers = normalizeCollectionPayload(adminsData, ["users"]).filter((candidate) => normalizeRole(candidate?.role) === "brokerusa");
      renderClientOptions();
      renderBrokerOptions();
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

    if (normalizeRole(currentAdminRole) === "brokerusa") {
      adminSetFeedback(orderFeedback, "Tu perfil solo puede subir archivos en pedidos asignados.", "error");
      return false;
    }

    const formData = new FormData(orderForm);
    const isBrokerFieldVisible = Boolean(brokerField && !brokerField.hidden);
    const formMode = getOrderFormMode();
    const editingOrderId = getEditingOrderId();
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
      ...(formMode === "edit" ? [] : [["clientId", "Debes seleccionar un cliente."]]),
    ];

    for (const [fieldName, message] of requiredFields) {
      if (!String(formData.get(fieldName) || "").trim()) {
        focusInvalidOrderField(fieldName, message);
        return false;
      }
    }

    if (orderSubmitButton) {
      orderSubmitButton.disabled = true;
    }

    adminSetFeedback(orderFeedback, formMode === "edit" ? "Guardando cambios..." : "Creando pedido...");

    try {
      if (formMode === "edit") {
        if (!editingOrderId) {
          throw new Error("No se encontró el pedido que se va a editar.");
        }

        if (String(formData.get("clientId") || "").trim() && !canEditOrderClient()) {
          throw new Error("Solo Global Latam puede cambiar el cliente de un pedido.");
        }

        const yearValue = Number.parseInt(String(formData.get("year") || "").trim(), 10);

        if (Number.isNaN(yearValue)) {
          throw new Error("El año es obligatorio.");
        }

        const payload = {
          brand: String(formData.get("brand") || "").trim(),
          model: String(formData.get("model") || "").trim(),
          version: String(formData.get("version") || "").trim(),
          year: yearValue,
          trackingNumber,
          vin: String(formData.get("vin") || "").trim(),
          destination: String(formData.get("destination") || "").trim(),
          exteriorColor,
          interiorColor,
          clientId: String(formData.get("clientId") || "").trim(),
          notes: String(formData.get("notes") || "").trim(),
        };

        if (!isClientCompatibleWithOrderRegion(payload.clientId)) {
          throw new Error(`Selecciona un cliente ${getOrderFormRegion().toUpperCase()} para este pedido.`);
        }

        if (isBrokerFieldVisible) {
          payload.assignedBrokerId = String(formData.get("assignedBrokerId") || "").trim();
        }

        const data = await fetchOrdersPageJson(`/api/admin/orders/${editingOrderId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });

        adminSetFeedback(orderFeedback, "Pedido actualizado correctamente.", "success");
        await loadOrdersPage();
        window.dispatchEvent(new CustomEvent("admin-order-updated", {
          detail: { order: data.order },
        }));
        return false;
      }

      formData.set("trackingNumber", trackingNumber);
      formData.set("purchaseDate", String(formData.get("purchaseDate") || "").trim() || buildLegacyPurchaseDate());
      formData.set("color", exteriorColor || interiorColor);

      if (!isBrokerFieldVisible) {
        formData.delete("assignedBrokerId");
      }

      const data = await fetchOrdersPageJson("/api/admin/orders", {
        method: "POST",
        body: formData,
      });

      orderForm.reset();
      window.__fillRandomTracking({ silent: true });
      renderMediaSummary([]);
      adminSetFeedback(orderFeedback, "Pedido creado correctamente.", "success");
      await loadOrdersPage();
      showSuccessModal(data.order, { mode: "create" });
      window.dispatchEvent(new CustomEvent("admin-order-created", {
        detail: { order: data.order },
      }));
      return false;
    } catch (error) {
      adminSetFeedback(orderFeedback, error.message, "error");
      forceClearLoadingState();
      return false;
    } finally {
      if (orderSubmitButton) {
        orderSubmitButton.disabled = false;
      }
    }
  }

  function triggerAdminOrderSubmit() {
    return submitAdminOrder();
  }

  window.__submitAdminOrder = submitAdminOrder;
  window.__triggerAdminOrderSubmit = triggerAdminOrderSubmit;
  window.__loadOrderFormData = loadOrdersPage;
  window.__syncEmbeddedOrderFormContext = function syncEmbeddedOrderFormContext({ clients: nextClients = null, brokers: nextBrokers = null } = {}) {
    if (Array.isArray(nextClients)) {
      clients = nextClients;
    }

    if (Array.isArray(nextBrokers)) {
      brokers = nextBrokers;
    }

    renderClientOptions();
    renderBrokerOptions();
  };

  orderSubmitButton?.addEventListener("click", (event) => {
    event.preventDefault();
    void submitAdminOrder(event);
  });

  if (orderForm) {
    Array.from(orderForm.querySelectorAll("select")).forEach((selectElement) => {
      attachNativeSelectPicker(selectElement);
    });
  }

  orderForm?.addEventListener("invalid", (event) => {
    const invalidField = event.target;

    if (!(invalidField instanceof HTMLInputElement || invalidField instanceof HTMLSelectElement || invalidField instanceof HTMLTextAreaElement)) {
      return;
    }

    adminSetFeedback(orderFeedback, invalidField.validationMessage || "Revisa los campos obligatorios.", "error");
  }, true);

  if (!isEmbeddedTrackingOrderForm && orderForm) {
    orderForm.addEventListener("submit", submitAdminOrder);
  }

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

})();