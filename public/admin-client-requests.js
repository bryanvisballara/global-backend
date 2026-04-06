const {
  attachLogout,
  fetchJson,
  formatCurrency,
  formatDate,
  loadAdminSession,
  renderEmptyState,
  requireAdminAccess,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const requestsList = document.getElementById("client-requests-list");
  const requestsCount = document.getElementById("requests-count");

  function renderRequests(clientRequests) {
    requestsCount.textContent = String(clientRequests.length);

    if (!clientRequests.length) {
      renderEmptyState(requestsList, "Todavía no hay solicitudes hechas por clientes.");
      return;
    }

    requestsList.innerHTML = clientRequests.map((request) => `
      <article class="request-card">
        <div class="request-card-top">
          <div>
            <p class="section-tag">${request.status}</p>
            <h2>${request.vehicle.brand} ${request.vehicle.model}</h2>
          </div>
          <strong>${formatCurrency(request.reservationAmount, request.currency || "VES")}</strong>
        </div>

        <div class="request-specs">
          <div><span>Color</span><strong>${request.vehicle.color || "No indicado"}</strong></div>
          <div><span>Tapicería</span><strong>${request.vehicle.upholstery || "No indicada"}</strong></div>
          <div><span>Versión</span><strong>${request.vehicle.version || "No indicada"}</strong></div>
          <div><span>Año</span><strong>${request.vehicle.year || "No indicado"}</strong></div>
        </div>

        <div class="request-contact-grid">
          <div><span>Cliente</span><strong>${request.customerName}</strong></div>
          <div><span>Teléfono</span><strong>${request.customerPhone}</strong></div>
          <div><span>Correo</span><strong>${request.customerEmail}</strong></div>
          <div><span>Fecha</span><strong>${formatDate(request.createdAt)}</strong></div>
        </div>

        <div class="request-note-box">
          <span>Notas</span>
          <p>${request.notes || "Sin notas adicionales."}</p>
        </div>
      </article>
    `).join("");
  }

  async function loadRequestsPage() {
    await loadAdminSession();
    const data = await fetchJson("/api/admin/client-requests");
    renderRequests(data.clientRequests || []);
  }

  loadRequestsPage().catch((error) => {
    renderEmptyState(requestsList, error.message);
  });
}