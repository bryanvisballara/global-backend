(() => {
  if (window.__adminMaintenanceInitialized) {
    return;
  }

  window.__adminMaintenanceInitialized = true;

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
  const maintenanceByDateCount = document.getElementById("maintenance-by-date-count");
  const maintenanceByDateList = document.getElementById("maintenance-by-date-list");
  const maintenanceByNextMonthCount = document.getElementById("maintenance-by-next-month-count");
  const maintenanceByNextMonthList = document.getElementById("maintenance-by-next-month-list");
  const maintenanceByKmCount = document.getElementById("maintenance-by-km-count");
  const maintenanceByKmList = document.getElementById("maintenance-by-km-list");
  let maintenanceItems = [];
  let clientVehicleItems = [];
  let dueByDateItems = [];
  let dueByDateNextMonthItems = [];
  let dueByKmItems = [];

  function renderDueByDate(items) {
    if (maintenanceByDateCount) {
      maintenanceByDateCount.textContent = String(items.length);
    }

    if (!maintenanceByDateList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(maintenanceByDateList, "No hay vehículos en ventana de +/-15 días para la fecha objetivo (+6 meses).");
      return;
    }

    maintenanceByDateList.innerHTML = items.map((vehicle) => `
      <article class="list-item">
        <div>
          <strong>${vehicle.user?.name || vehicle.client?.name || "Cliente"}</strong>
          <p>${vehicle.brand || "Vehiculo"} ${vehicle.model || ""} ${vehicle.version || ""} · Placa ${vehicle.plate || "N/A"}</p>
          <p>Ultimo mantenimiento: ${vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "Sin fecha"}</p>
          <p>Fecha objetivo (6 meses): ${vehicle.dueDateBySchedule ? formatDate(vehicle.dueDateBySchedule) : "Sin fecha"}</p>
        </div>
        <span>${vehicle.usualDailyKm || "N/A"} km/dia</span>
      </article>
    `).join("");
  }

  function renderDueByKm(items) {
    if (maintenanceByKmCount) {
      maintenanceByKmCount.textContent = String(items.length);
    }

    if (!maintenanceByKmList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(maintenanceByKmList, "No hay vehículos que hayan alcanzado 5.000 km estimados desde su último mantenimiento.");
      return;
    }

    maintenanceByKmList.innerHTML = items.map((vehicle) => `
      <article class="list-item">
        <div>
          <strong>${vehicle.user?.name || vehicle.client?.name || "Cliente"}</strong>
          <p>${vehicle.brand || "Vehiculo"} ${vehicle.model || ""} ${vehicle.version || ""} · Placa ${vehicle.plate || "N/A"}</p>
          <p>Km estimados desde último mantenimiento: ${Math.floor(vehicle.estimatedKmSinceLastMaintenance || 0)}</p>
          <p>Fecha estimada de 5.000 km: ${vehicle.estimatedDateByMileage ? formatDate(vehicle.estimatedDateByMileage) : "Sin fecha"}</p>
        </div>
        <span>${vehicle.usualDailyKm || "N/A"} km/dia</span>
      </article>
    `).join("");
  }

  function renderDueByNextMonth(items) {
    if (maintenanceByNextMonthCount) {
      maintenanceByNextMonthCount.textContent = String(items.length);
    }

    if (!maintenanceByNextMonthList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(maintenanceByNextMonthList, "No hay vehículos del próximo mes en ventana de +/-15 días para la fecha objetivo (+6 meses).");
      return;
    }

    maintenanceByNextMonthList.innerHTML = items.map((vehicle) => `
      <article class="list-item">
        <div>
          <strong>${vehicle.user?.name || vehicle.client?.name || "Cliente"}</strong>
          <p>${vehicle.brand || "Vehiculo"} ${vehicle.model || ""} ${vehicle.version || ""} · Placa ${vehicle.plate || "N/A"}</p>
          <p>Ultimo mantenimiento: ${vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "Sin fecha"}</p>
          <p>Fecha objetivo (6 meses): ${vehicle.dueDateBySchedule ? formatDate(vehicle.dueDateBySchedule) : "Sin fecha"}</p>
        </div>
        <span>${vehicle.usualDailyKm || "N/A"} km/dia</span>
      </article>
    `).join("");
  }

  function renderMaintenance(items, clientVehicles) {
    const combinedCount = items.length + clientVehicles.length;
    maintenanceCount.textContent = String(combinedCount);

    if (!combinedCount) {
      renderEmptyState(maintenanceList, "No hay mantenimientos programados todavía.");
      return;
    }

    const regularMaintenanceMarkup = items.map((item) => `
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

    const clientVehiclesMarkup = clientVehicles.map((vehicle) => `
      <article class="list-item">
        <div>
          <strong>${vehicle.user?.name || vehicle.client?.name || "Cliente"}</strong>
          <p>${vehicle.brand || "Vehiculo"} ${vehicle.model || ""} ${vehicle.version || ""} · Placa ${vehicle.plate || "N/A"}</p>
          <p>Km actual: ${vehicle.currentMileage || "0"} · Año: ${vehicle.year || "N/A"}</p>
          <p>Km diarios usuales: ${vehicle.usualDailyKm || "N/A"}</p>
          <p>Ultimo mantenimiento preventivo: ${vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "Sin fecha"}</p>
          <p>Origen: Registro directo del cliente en app</p>
        </div>
        <span>${formatDate(vehicle.createdAt)}</span>
      </article>
    `).join("");

    maintenanceList.innerHTML = regularMaintenanceMarkup + clientVehiclesMarkup;
  }

  async function loadMaintenancePage() {
    await loadAdminSession();
    const maintenanceData = await fetchJson("/api/admin/maintenance");
    maintenanceItems = maintenanceData.maintenance || [];
    clientVehicleItems = maintenanceData.clientMaintenanceVehicles || [];
    dueByDateItems = maintenanceData.dueByDateThisMonth || [];
    dueByDateNextMonthItems = maintenanceData.dueByDateNextMonth || [];
    dueByKmItems = maintenanceData.dueByMileageReached || [];
    populateSelect(maintenanceSelect, maintenanceItems, "Selecciona un mantenimiento", "_id", (item) => `${item.client?.name || "Cliente"} · ${item.order?.trackingNumber || "Sin tracking"}`);
    renderMaintenance(maintenanceItems, clientVehicleItems);
    renderDueByDate(dueByDateItems);
    renderDueByNextMonth(dueByDateNextMonthItems);
    renderDueByKm(dueByKmItems);
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
    setFeedback(maintenanceFeedback, error.message || "No se pudo cargar mantenimiento.", "error");
    renderEmptyState(maintenanceList, error.message);
    renderEmptyState(maintenanceByDateList, error.message);
    renderEmptyState(maintenanceByNextMonthList, error.message);
    renderEmptyState(maintenanceByKmList, error.message);
  });
}
})();