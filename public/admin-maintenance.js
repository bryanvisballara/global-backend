const {
  attachLogout,
  fetchJson,
  formatDate,
  loadAdminSession,
  populateSelect,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const maintenanceForm = document.getElementById("maintenance-form");
  const maintenanceFeedback = document.getElementById("maintenance-feedback");
  const maintenanceList = document.getElementById("maintenance-list");
  const maintenanceSelect = document.getElementById("maintenance-id");
  const maintenanceCount = document.getElementById("maintenance-count");
  let maintenanceItems = [];

  function renderMaintenance(items) {
    maintenanceCount.textContent = String(items.length);

    if (!items.length) {
      renderEmptyState(maintenanceList, "No hay mantenimientos programados todavía.");
      return;
    }

    maintenanceList.innerHTML = items.map((item) => `
      <article class="list-item">
        <div>
          <strong>${item.client?.name || "Cliente"}</strong>
          <p>${item.order?.vehicle?.brand || "Vehiculo"} ${item.order?.vehicle?.model || ""} · ${item.status}</p>
          <p>Tracking ${item.order?.trackingNumber || "sin guia"} · Km cliente: ${item.reportedMileage || "Sin reporte"}</p>
          <p>Ultimo servicio cliente: ${item.lastServiceDate ? formatDate(item.lastServiceDate) : "Sin fecha"}</p>
          <p>${item.clientNotes || "Sin notas del cliente"}</p>
        </div>
        <span>${formatDate(item.dueDate)}</span>
      </article>
    `).join("");
  }

  async function loadMaintenancePage() {
    await loadAdminSession();
    const maintenanceData = await fetchJson("/api/admin/maintenance");
    maintenanceItems = maintenanceData.maintenance || [];
    populateSelect(maintenanceSelect, maintenanceItems, "Selecciona un mantenimiento", "_id", (item) => `${item.client?.name || "Cliente"} · ${item.order?.trackingNumber || "Sin tracking"}`);
    renderMaintenance(maintenanceItems);
  }

  maintenanceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(maintenanceForm);

    setFeedback(maintenanceFeedback, "Actualizando mantenimiento...");

    try {
      await fetchJson(`/api/admin/maintenance/${formData.get("maintenanceId")}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: formData.get("status"),
          contactNotes: formData.get("contactNotes"),
          lastNotificationAt: formData.get("markNotified") === "on" ? new Date().toISOString() : undefined,
          completedAt: formData.get("status") === "completed" ? new Date().toISOString() : undefined,
        }),
      });

      maintenanceForm.reset();
      setFeedback(maintenanceFeedback, "Mantenimiento actualizado correctamente.", "success");
      await loadMaintenancePage();
    } catch (error) {
      setFeedback(maintenanceFeedback, error.message, "error");
    }
  });

  loadMaintenancePage().catch((error) => {
    renderEmptyState(maintenanceList, error.message);
  });
}