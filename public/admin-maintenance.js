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
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const maintenanceForm = document.getElementById("maintenance-form");
  const maintenanceFeedback = document.getElementById("maintenance-feedback");
  const maintenanceList = document.getElementById("maintenance-list");
  const maintenanceCount = document.getElementById("maintenance-count");
  const maintenanceByDateCount = document.getElementById("maintenance-by-date-count");
  const maintenanceByDateList = document.getElementById("maintenance-by-date-list");
  const maintenanceByNextMonthCount = document.getElementById("maintenance-by-next-month-count");
  const maintenanceByNextMonthList = document.getElementById("maintenance-by-next-month-list");
  const maintenanceByKmCount = document.getElementById("maintenance-by-km-count");
  const maintenanceByKmList = document.getElementById("maintenance-by-km-list");
  const appointmentsCount = document.getElementById("maintenance-appointments-count");
  const appointmentsList = document.getElementById("maintenance-appointments-list");
  const appointmentsMonthLabel = document.getElementById("maintenance-calendar-month-label");
  const appointmentsCalendarGrid = document.getElementById("maintenance-calendar-grid");
  const appointmentsDayTitle = document.getElementById("maintenance-day-title");
  const appointmentsDayList = document.getElementById("maintenance-day-list");
  const detailCards = Array.from(document.querySelectorAll(".maint-panel-clickable[data-detail-bucket]"));
  let maintenanceItems = [];
  let clientVehicleItems = [];
  let dueByDateItems = [];
  let dueByDateNextMonthItems = [];
  let dueByKmItems = [];
  let appointmentsThisMonthItems = [];
  const appointmentDayMap = new Map();
  let selectedAppointmentDayKey = "";

  function parseDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function toDateKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function toMonthLabel(date) {
    return new Intl.DateTimeFormat("es-CO", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  function toDayLabel(date) {
    return new Intl.DateTimeFormat("es-CO", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  }

  function toAppointmentDate(vehicle) {
    return parseDate(vehicle.adminAppointmentDate || vehicle.appointmentDate || vehicle.adminLastContactAt);
  }

  function formatAppointmentTime(vehicle) {
    const timeValue = String(vehicle.adminAppointmentTime || "").trim();

    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(timeValue)) {
      return "Sin hora";
    }

    return `${timeValue} h`;
  }

  function bindCardNavigation() {
    detailCards.forEach((card) => {
      const bucket = card.dataset.detailBucket;

      if (!bucket) {
        return;
      }

      const navigate = () => {
        window.location.href = `/app/admin-maintenance-detail.html?bucket=${encodeURIComponent(bucket)}`;
      };

      card.addEventListener("click", navigate);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigate();
        }
      });
    });
  }

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

  function renderAppointmentsCard(items) {
    if (appointmentsCount) {
      appointmentsCount.textContent = String(items.length);
    }

    if (!appointmentsList) {
      return;
    }

    if (!items.length) {
      renderEmptyState(appointmentsList, "No hay citas agendadas para este mes.");
      return;
    }

    appointmentsList.innerHTML = items.map((vehicle) => {
      const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
      const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
      const appointmentDate = toAppointmentDate(vehicle);
      return `
        <article class="maint-vehicle-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-title">${ownerName}</span>
            <span class="maint-vehicle-card-plate">${vehicle.plate || "Sin placa"}</span>
            <span class="maint-vehicle-card-row">${title || "Vehículo sin nombre"}</span>
            <span class="maint-vehicle-card-row">Cita: ${appointmentDate ? formatDate(appointmentDate) : "Sin fecha"} · ${formatAppointmentTime(vehicle)}</span>
          </div>
          <span class="maint-vehicle-card-badge is-scheduled">Agendada</span>
        </article>
      `;
    }).join("");
  }

  function renderAppointmentsDayList(dayKey) {
    if (!appointmentsDayList || !appointmentsDayTitle) {
      return;
    }

    const dayItems = appointmentDayMap.get(dayKey) || [];
    const [year, month, day] = dayKey.split("-").map(Number);
    const dayDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

    appointmentsDayTitle.textContent = `Citas del ${toDayLabel(dayDate)}`;

    if (!dayItems.length) {
      renderEmptyState(appointmentsDayList, "No hay citas para este día.");
      return;
    }

    appointmentsDayList.innerHTML = dayItems.map((vehicle) => {
      const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
      const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
      return `
        <article class="maint-vehicle-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-title">${ownerName}</span>
            <span class="maint-vehicle-card-plate">${vehicle.plate || "Sin placa"}</span>
            <span class="maint-vehicle-card-row">${title || "Vehículo sin nombre"}</span>
            <span class="maint-vehicle-card-row">Hora: ${formatAppointmentTime(vehicle)}</span>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderAppointmentsCalendar(items) {
    if (!appointmentsCalendarGrid) {
      return;
    }

    appointmentDayMap.clear();

    items.forEach((vehicle) => {
      const appointmentDate = toAppointmentDate(vehicle);

      if (!appointmentDate) {
        return;
      }

      const dayKey = toDateKey(appointmentDate);
      const list = appointmentDayMap.get(dayKey) || [];
      list.push(vehicle);
      appointmentDayMap.set(dayKey, list);
    });

    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const monthStart = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0));
    const monthLabel = toMonthLabel(monthStart);
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12, 0, 0, 0)).getUTCDate();
    const firstWeekdaySundayFirst = monthStart.getUTCDay();
    const firstWeekdayMondayFirst = firstWeekdaySundayFirst === 0 ? 6 : firstWeekdaySundayFirst - 1;

    if (appointmentsMonthLabel) {
      appointmentsMonthLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    }

    const todayKey = toDateKey(new Date(Date.UTC(year, month, now.getUTCDate(), 12, 0, 0, 0)));
    const firstAvailableKey = appointmentDayMap.keys().next().value;
    selectedAppointmentDayKey = appointmentDayMap.has(todayKey)
      ? todayKey
      : (firstAvailableKey || todayKey);

    const dayCells = [];

    for (let i = 0; i < firstWeekdayMondayFirst; i += 1) {
      dayCells.push('<div class="maint-calendar-day is-empty" aria-hidden="true"></div>');
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dayDate = new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
      const dayKey = toDateKey(dayDate);
      const count = (appointmentDayMap.get(dayKey) || []).length;
      const classes = ["maint-calendar-day"];

      if (count > 0) {
        classes.push("has-events");
      }

      if (dayKey === selectedAppointmentDayKey) {
        classes.push("is-active");
      }

      dayCells.push(`
        <button class="${classes.join(" ")}" type="button" data-day-key="${dayKey}">
          <span class="maint-calendar-day-number">${day}</span>
          <span class="maint-calendar-day-count">${count > 0 ? `${count} cita${count > 1 ? "s" : ""}` : ""}</span>
        </button>
      `);
    }

    appointmentsCalendarGrid.innerHTML = dayCells.join("");

    appointmentsCalendarGrid.querySelectorAll("button[data-day-key]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedAppointmentDayKey = button.dataset.dayKey || selectedAppointmentDayKey;
        renderAppointmentsCalendar(items);
      });
    });

    renderAppointmentsDayList(selectedAppointmentDayKey);
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
    appointmentsThisMonthItems = maintenanceData.appointmentScheduledThisMonth
      || clientVehicleItems.filter((vehicle) => vehicle.adminContactStatus === "appointment_scheduled");
    renderMaintenance(maintenanceItems, clientVehicleItems);
    renderDueByDate(dueByDateItems);
    renderDueByNextMonth(dueByDateNextMonthItems);
    renderDueByKm(dueByKmItems);
    renderAppointmentsCard(appointmentsThisMonthItems);
    renderAppointmentsCalendar(appointmentsThisMonthItems);
  }

  if (maintenanceForm) {
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
  }

  loadMaintenancePage().catch((error) => {
    setFeedback(maintenanceFeedback, error.message || "No se pudo cargar mantenimiento.", "error");
    renderEmptyState(maintenanceList, error.message);
    renderEmptyState(maintenanceByDateList, error.message);
    renderEmptyState(maintenanceByNextMonthList, error.message);
    renderEmptyState(maintenanceByKmList, error.message);
    renderEmptyState(appointmentsList, error.message);
    renderEmptyState(appointmentsDayList, error.message);
  });

  bindCardNavigation();
}
})();