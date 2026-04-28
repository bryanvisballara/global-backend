(() => {
const {
  attachLogout,
  canCreateAdministrativeUsers,
  fetchJson,
  formatDate,
  formatDateTimeInBogota,
  loadAdminSession,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const requestsList = document.getElementById("order-deletion-requests-list");
  const requestsCount = document.getElementById("deletion-requests-count");
  const feedback = document.getElementById("deletion-requests-feedback");

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildVehicleLabel(order) {
    return [order?.vehicle?.brand, order?.vehicle?.model, order?.vehicle?.version].filter(Boolean).join(" ") || "Vehículo sin datos";
  }

  function buildClientLabel(order) {
    if (order?.client && typeof order.client === "object") {
      return order.client.name || order.client.email || "Sin cliente";
    }

    return "Sin cliente";
  }

  function renderRequests(orders) {
    requestsCount.textContent = String(orders.length);

    if (!orders.length) {
      renderEmptyState(requestsList, "No hay solicitudes de eliminación pendientes.");
      return;
    }

    requestsList.innerHTML = orders.map((order) => {
      const request = order.deletionRequest || {};
      const requester = request.requestedBy && typeof request.requestedBy === "object"
        ? request.requestedBy.name || request.requestedBy.email || "Administrador"
        : "Administrador";

      return `
        <article class="request-card">
          <div class="request-card-top">
            <div>
              <p class="section-tag">Solicitud pendiente</p>
              <h2>${escapeHtml(buildVehicleLabel(order))}</h2>
            </div>
            <strong>${escapeHtml(order.trackingNumber || "Sin tracking")}</strong>
          </div>

          <div class="request-specs">
            <div><span>Cliente</span><strong>${escapeHtml(buildClientLabel(order))}</strong></div>
            <div><span>VIN</span><strong>${escapeHtml(order?.vehicle?.vin || "Pendiente")}</strong></div>
            <div><span>Destino</span><strong>${escapeHtml(order?.vehicle?.destination || "Sin destino")}</strong></div>
            <div><span>Creado</span><strong>${escapeHtml(formatDate(order.createdAt))}</strong></div>
          </div>

          <div class="request-contact-grid">
            <div><span>Solicitado por</span><strong>${escapeHtml(requester)}</strong></div>
            <div><span>Rol</span><strong>${escapeHtml(request.requestedByRole || "- ")}</strong></div>
            <div><span>Fecha solicitud</span><strong>${escapeHtml(formatDateTimeInBogota(request.requestedAt))}</strong></div>
            <div><span>Estado actual</span><strong>${escapeHtml(order.status || "active")}</strong></div>
          </div>

          <div class="request-note-box">
            <span>Motivo</span>
            <p>${escapeHtml(request.reason || "Sin motivo")}</p>
          </div>

          <div class="request-card-actions">
            <button class="primary-button" type="button" data-review-order-id="${escapeHtml(order._id || order.id || "")}" data-action="approve">Aprobar y eliminar</button>
            <button class="secondary-button is-danger" type="button" data-review-order-id="${escapeHtml(order._id || order.id || "")}" data-action="reject">Rechazar</button>
          </div>
        </article>
      `;
    }).join("");
  }

  async function loadDeletionRequestsPage() {
    const user = await loadAdminSession();

    if (!canCreateAdministrativeUsers(user?.role)) {
      window.location.replace("/admin.html");
      return;
    }

    const data = await fetchJson(`/api/admin/orders/deletion-requests?ts=${Date.now()}`);
    let pendingOrders = Array.isArray(data?.orders) ? data.orders : [];

    if (!pendingOrders.length) {
      const fallbackData = await fetchJson(`/api/admin/orders?ts=${Date.now()}`);
      const fallbackOrders = Array.isArray(fallbackData?.orders) ? fallbackData.orders : [];
      pendingOrders = fallbackOrders.filter((order) => String(order?.deletionRequest?.status || "none").trim().toLowerCase() === "pending");
    }

    renderRequests(pendingOrders);
    setFeedback(feedback, "");
  }

  requestsList?.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-review-order-id]");

    if (!actionButton) {
      return;
    }

    const orderId = String(actionButton.dataset.reviewOrderId || "").trim();
    const action = String(actionButton.dataset.action || "").trim();

    if (!orderId || !action) {
      return;
    }

    let rejectionReason = "";

    if (action === "approve") {
      if (!window.confirm("¿Seguro que deseas aprobar esta solicitud y eliminar el pedido?")) {
        return;
      }
    } else {
      rejectionReason = String(window.prompt("Motivo del rechazo (opcional):", "") || "").trim();
    }

    actionButton.disabled = true;
    setFeedback(feedback, action === "approve" ? "Eliminando pedido..." : "Rechazando solicitud...");

    try {
      await fetchJson(`/api/admin/orders/${orderId}/deletion-request`, {
        method: "PATCH",
        body: JSON.stringify({ action, rejectionReason }),
      });

      setFeedback(
        feedback,
        action === "approve" ? "Pedido eliminado correctamente." : "Solicitud rechazada correctamente.",
        "success"
      );
      await loadDeletionRequestsPage();
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      actionButton.disabled = false;
    }
  });

  loadDeletionRequestsPage().catch((error) => {
    renderEmptyState(requestsList, error.message);
    setFeedback(feedback, error.message, "error");
  });
}
})();
