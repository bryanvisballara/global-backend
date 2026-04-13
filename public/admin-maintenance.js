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

  function renderVehicleCard(vehicle, badgeLabel, badgeClass) {
    const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
    const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
    return `
      <article class="maint-vehicle-card">
        <div class="maint-vehicle-card-info">
          <span class="maint-vehicle-card-title">${ownerName}</span>
          <span class="maint-vehicle-card-plate">${vehicle.plate || "Sin placa"}</span>
          <span class="maint-vehicle-card-row">${title || "Vehículo sin nombre"}</span>
          <span class="maint-vehicle-card-row">Último mant.: ${vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "Sin fecha"}</span>
          <span class="maint-vehicle-card-row">Vence (6m): ${vehicle.dueDateBySchedule ? formatDate(vehicle.dueDateBySchedule) : "Sin fecha"}</span>
          <span class="maint-vehicle-card-row">${vehicle.usualDailyKm || "N/A"} km/día · ${vehicle.year || ""} · ${vehicle.currentMileage ? vehicle.currentMileage + " km" : ""}</span>
        </div>
        <span class="maint-vehicle-card-badge ${badgeClass || ""}">${badgeLabel || ""}</span>
      </article>
    `;
  }

  function renderDueByDate(items) {
    if (maintenanceByDateCount) {
      maintenanceByDateCount.textContent = String(items.length);
    }

    if (!maintenanceByDateList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(maintenanceByDateList, "No hay vehículos en ventana de +/-15 días para este mes.");
      return;
    }

    maintenanceByDateList.innerHTML = items.map((v) => renderVehicleCard(v, "Este mes", "is-soon")).join("");
  }

  function renderDueByKm(items) {
    if (maintenanceByKmCount) {
      maintenanceByKmCount.textContent = String(items.length);
    }

    if (!maintenanceByKmList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(maintenanceByKmList, "No hay vehículos que hayan alcanzado 5.000 km estimados.");
      return;
    }

    maintenanceByKmList.innerHTML = items.map((vehicle) => {
      const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
      const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
      const kmSince = Math.floor(vehicle.estimatedKmSinceLastMaintenance || 0);
      return `
        <article class="maint-vehicle-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-title">${ownerName}</span>
            <span class="maint-vehicle-card-plate">${vehicle.plate || "Sin placa"}</span>
            <span class="maint-vehicle-card-row">${title || "Vehículo sin nombre"}</span>
            <span class="maint-vehicle-card-row">Km desde último mant.: <strong style="color:#ffcba0">${kmSince.toLocaleString()}</strong></span>
            <span class="maint-vehicle-card-row">Fecha est. 5.000 km: ${vehicle.estimatedDateByMileage ? formatDate(vehicle.estimatedDateByMileage) : "Sin fecha"}</span>
          </div>
          <span class="maint-vehicle-card-badge is-km">${vehicle.usualDailyKm || "N/A"} km/día</span>
        </article>
      `;
    }).join("");
  }

  function renderDueByNextMonth(items) {
    if (maintenanceByNextMonthCount) {
      maintenanceByNextMonthCount.textContent = String(items.length);
    }

    if (!maintenanceByNextMonthList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(maintenanceByNextMonthList, "No hay vehículos en ventana de +/-15 días para el próximo mes.");
      return;
    }

    maintenanceByNextMonthList.innerHTML = items.map((v) => renderVehicleCard(v, "Próx. mes", "")).join("");
  }

  function renderMaintenance(items, clientVehicles) {
    const combinedCount = items.length + clientVehicles.length;
    maintenanceCount.textContent = String(combinedCount);

    if (!combinedCount) {
      renderEmptyState(maintenanceList, "No hay mantenimientos registrados todavía.");
      return;
    }

    const orderMarkup = items.map((item) => {
      const vehicleTitle = [item.order?.vehicle?.brand, item.order?.vehicle?.model].filter(Boolean).join(" ");
      const STATUS_LABELS = { scheduled: "Programado", due: "Vencido", contacted: "Contactado", completed: "Completado" };
      return `
        <article class="maint-vehicle-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-title">${item.client?.name || "Cliente"}</span>
            <span class="maint-vehicle-card-plate">Guía ${item.order?.trackingNumber || "Sin guía"}</span>
            <span class="maint-vehicle-card-row">${vehicleTitle || "Vehículo"}</span>
            <span class="maint-vehicle-card-row">Vence: ${formatDate(item.dueDate)}</span>
            <span class="maint-vehicle-card-row">Km cliente: ${item.reportedMileage || "Sin reporte"}</span>
            <span class="maint-vehicle-card-row">${item.clientNotes || "Sin notas"}</span>
          </div>
          <span class="maint-vehicle-card-badge ${item.status === 'due' ? 'is-soon' : item.status === 'completed' ? '' : ''}">${STATUS_LABELS[item.status] || item.status}</span>
        </article>
      `;
    }).join("");

    const clientVehiclesMarkup = clientVehicles.map((vehicle) => {
      const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
      const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
      return `
        <article class="maint-vehicle-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-title">${ownerName}</span>
            <span class="maint-vehicle-card-plate">${vehicle.plate || "Sin placa"}</span>
            <span class="maint-vehicle-card-row">${title || "Vehículo sin nombre"}</span>
            <span class="maint-vehicle-card-row">Año ${vehicle.year || "N/A"} · ${vehicle.currentMileage || 0} km actuales</span>
            <span class="maint-vehicle-card-row">${vehicle.usualDailyKm || "N/A"} km/día</span>
            <span class="maint-vehicle-card-row">Último mant.: ${vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "Sin fecha"}</span>
          </div>
          <span class="maint-vehicle-card-badge">Registro cliente</span>
        </article>
      `;
    }).join("");

    maintenanceList.innerHTML = orderMarkup + clientVehiclesMarkup;
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