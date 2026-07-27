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

  if (!requireAdminAccess()) {
    return;
  }

  attachLogout();

  const maintenanceFeedback = document.getElementById("maintenance-feedback");
  const maintenanceList = document.getElementById("maintenance-list");
  const maintenanceCount = document.getElementById("maintenance-count");
  const maintenanceMonthFilter = document.getElementById("maintenance-month-filter");
  const maintenanceMonthSummary = document.getElementById("maintenance-month-summary");
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
  const appointmentsModal = document.getElementById("maint-appointments-modal");
  const appointmentsModalOverlay = document.getElementById("maint-modal-overlay");
  const appointmentsModalClose = document.getElementById("maint-modal-close");
  const openAddMaintenanceButton = document.getElementById("open-add-maintenance-modal");
  const backfillMaintenanceButton = document.getElementById("backfill-maintenance-button");
  const addMaintenanceModal = document.getElementById("add-maintenance-modal");
  const addMaintenanceOverlay = document.getElementById("add-maintenance-overlay");
  const addMaintenanceClose = document.getElementById("add-maintenance-close");
  const addMaintenanceCancel = document.getElementById("add-maintenance-cancel");
  const addMaintenanceForm = document.getElementById("add-maintenance-form");
  const addMaintenanceFeedback = document.getElementById("add-maintenance-feedback");
  const addMaintActivationDate = document.getElementById("add-maint-activation-date");
  const addMaintDueDate = document.getElementById("add-maint-due-date");
  const detailCards = Array.from(document.querySelectorAll(".maint-panel-clickable[data-detail-bucket]"));

  let maintenanceItems = [];
  let clientVehicleItems = [];
  let dueByDateItems = [];
  let dueByDateNextMonthItems = [];
  let dueByKmItems = [];
  let appointmentsThisMonthItems = [];
  let scheduledCallsByMonth = [];
  let selectedMonthKey = "";
  const appointmentDayMap = new Map();
  let selectedAppointmentDayKey = "";

  const STATUS_LABELS = {
    scheduled: "Programado",
    due: "Vencido",
    contacted: "Contactado",
    completed: "Completado",
    sin_programar: "Sin programar",
  };

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

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
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

  function addMonthsToDateInput(dateValue, months) {
    const source = parseDate(dateValue);

    if (!source) {
      return "";
    }

    const next = new Date(Date.UTC(
      source.getUTCFullYear(),
      source.getUTCMonth() + months,
      source.getUTCDate(),
      12,
      0,
      0,
      0
    ));

    return next.toISOString().slice(0, 10);
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

  function renderDueByDate(items) {
    if (maintenanceByDateCount) {
      maintenanceByDateCount.textContent = String(items.length);
    }
    if (maintenanceByDateList) {
      maintenanceByDateList.style.display = "none";
    }
  }

  function renderDueByNextMonth(items) {
    if (maintenanceByNextMonthCount) {
      maintenanceByNextMonthCount.textContent = String(items.length);
    }
    if (maintenanceByNextMonthList) {
      maintenanceByNextMonthList.style.display = "none";
    }
  }

  function renderDueByKm(items) {
    if (maintenanceByKmCount) {
      maintenanceByKmCount.textContent = String(items.length);
    }
    if (maintenanceByKmList) {
      maintenanceByKmList.style.display = "none";
    }
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
      const id = String(vehicle._id || vehicle.id || "");
      return `
        <article class="maint-vehicle-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-title">${escapeHtml(ownerName)}</span>
            <span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "Sin placa")}</span>
            <span class="maint-vehicle-card-row">${escapeHtml(title || "Vehículo sin nombre")}</span>
            <span class="maint-vehicle-card-row">Cita: ${appointmentDate ? formatDate(appointmentDate) : "Sin fecha"} · ${formatAppointmentTime(vehicle)}</span>
          </div>
          <span class="maint-vehicle-card-badge is-scheduled">Agendada</span>
        </article>
      `;
    }).join("");
  }

  async function cancelAppointment(vehicleId, isFromModal = false) {
    if (!confirm("¿Estás seguro de que deseas cancelar esta cita?")) {
      return;
    }

    try {
      await fetchJson(`/api/admin/maintenance-vehicles/${encodeURIComponent(vehicleId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          adminContactStatus: "pending",
          adminAppointmentDate: null,
          adminAppointmentTime: "",
        }),
        loadingMessage: false,
      });

      setFeedback(maintenanceFeedback, "Cita cancelada correctamente.", "success");
      if (isFromModal) {
        closeAppointmentsModal();
      }
      setTimeout(() => loadMaintenancePage(), 800);
    } catch (error) {
      setFeedback(maintenanceFeedback, `Error al cancelar cita: ${error.message}`, "error");
    }
  }

  function renderAppointmentsDayList(dayKey, shouldOpenModal = false) {
    if (!appointmentsDayList || !appointmentsDayTitle || !appointmentsModal) {
      return;
    }

    const dayItems = appointmentDayMap.get(dayKey) || [];
    const [year, month, day] = dayKey.split("-").map(Number);
    const dayDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

    appointmentsDayTitle.textContent = `Citas del ${toDayLabel(dayDate)}`;

    if (!dayItems.length) {
      renderEmptyState(appointmentsDayList, "No hay citas para este día.");
    } else {
      appointmentsDayList.innerHTML = dayItems.map((vehicle) => {
        const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
        const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
        const id = String(vehicle._id || vehicle.id || "");
        return `
          <article class="maint-vehicle-card" data-vehicle-id="${id}">
            <div class="maint-vehicle-card-info">
              <span class="maint-vehicle-card-title">${escapeHtml(ownerName)}</span>
              <span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "Sin placa")}</span>
              <span class="maint-vehicle-card-row">${escapeHtml(title || "Vehículo sin nombre")}</span>
              <span class="maint-vehicle-card-row">Hora: ${formatAppointmentTime(vehicle)}</span>
            </div>
            <button class="maint-modal-delete-btn" type="button" data-vehicle-id="${id}" title="Eliminar cita">🗑</button>
          </article>
        `;
      }).join("");

      appointmentsDayList.querySelectorAll(".maint-modal-delete-btn").forEach((button) => {
        button.addEventListener("click", () => cancelAppointment(button.dataset.vehicleId, true));
      });
    }

    if (shouldOpenModal) {
      appointmentsModal.classList.add("is-open");
    }
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
        renderAppointmentsDayList(selectedAppointmentDayKey, true);
      });
    });
  }

  function populateMonthFilter(months) {
    if (!maintenanceMonthFilter) {
      return;
    }

    const previousValue = selectedMonthKey || maintenanceMonthFilter.value || "";
    const options = ['<option value="">Todos los meses</option>'];

    months.forEach((month) => {
      options.push(
        `<option value="${escapeHtml(month.key)}">${escapeHtml(month.label)} (${month.count})</option>`
      );
    });

    maintenanceMonthFilter.innerHTML = options.join("");

    if (previousValue && months.some((month) => month.key === previousValue)) {
      maintenanceMonthFilter.value = previousValue;
      selectedMonthKey = previousValue;
    } else {
      maintenanceMonthFilter.value = "";
      selectedMonthKey = "";
    }
  }

  function updateMonthSummary() {
    if (!maintenanceMonthSummary) {
      return;
    }

    if (!selectedMonthKey) {
      maintenanceMonthSummary.textContent = `Total programados: ${maintenanceItems.length}. Elige un mes para ver cuántos llamar.`;
      return;
    }

    const selected = scheduledCallsByMonth.find((month) => month.key === selectedMonthKey);
    const count = selected?.count ?? maintenanceItems.length;
    const label = selected?.label || selectedMonthKey;
    maintenanceMonthSummary.textContent = `En ${label} hay ${count} carro${count === 1 ? "" : "s"} programado${count === 1 ? "" : "s"} para llamar.`;
  }

  function renderMaintenance(items, clientVehicles) {
    const totalCount = Number.isFinite(Number(window.__maintenanceTotalCount))
      ? Number(window.__maintenanceTotalCount)
      : items.length + clientVehicles.length;

    if (maintenanceCount) {
      maintenanceCount.textContent = String(selectedMonthKey ? items.length : totalCount);
    }

    updateMonthSummary();

    if (!maintenanceList) {
      return;
    }

    if (!items.length && !clientVehicles.length) {
      maintenanceList.innerHTML = `
        <tr>
          <td colspan="7"><div class="empty-state">No hay mantenimientos para este filtro.</div></td>
        </tr>
      `;
      return;
    }

    const orderRows = items.map((item) => {
      const vehicleTitle = [
        item.vehicleSnapshot?.brand || item.order?.vehicle?.brand,
        item.vehicleSnapshot?.model || item.order?.vehicle?.model,
        item.vehicleSnapshot?.version || item.order?.vehicle?.version,
      ].filter(Boolean).join(" ");
      const clientName = item.client?.name || item.contactName || "Cliente";
      const tracking = item.source === "manual"
        ? "Manual"
        : (item.order?.trackingNumber || "Sin guía");
      const vin = item.vehicleSnapshot?.vin || item.order?.vehicle?.vin || "—";
      const statusLabel = STATUS_LABELS[item.status] || item.status || "Programado";

      return `
        <tr>
          <td>${escapeHtml(tracking)}</td>
          <td>${escapeHtml(clientName)}</td>
          <td>${escapeHtml(vehicleTitle || "Vehículo")}</td>
          <td>${escapeHtml(vin)}</td>
          <td>${item.activationDate ? formatDate(item.activationDate) : "—"}</td>
          <td>${item.dueDate ? formatDate(item.dueDate) : "—"}</td>
          <td>${escapeHtml(statusLabel)}</td>
        </tr>
      `;
    }).join("");

    const clientRows = selectedMonthKey
      ? ""
      : clientVehicles.map((vehicle) => {
        const title = [vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ");
        const ownerName = vehicle.user?.name || vehicle.client?.name || "Cliente";
        return `
          <tr>
            <td>Registro cliente</td>
            <td>${escapeHtml(ownerName)}</td>
            <td>${escapeHtml(title || "Vehículo")}</td>
            <td>—</td>
            <td>${vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "—"}</td>
            <td>${vehicle.dueDateBySchedule ? formatDate(vehicle.dueDateBySchedule) : "—"}</td>
            <td>Registro cliente</td>
          </tr>
        `;
      }).join("");

    maintenanceList.innerHTML = orderRows + clientRows || `
      <tr>
        <td colspan="7"><div class="empty-state">No hay mantenimientos para este filtro.</div></td>
      </tr>
    `;
  }

  function openAddMaintenanceModal() {
    if (!addMaintenanceModal) {
      return;
    }

    addMaintenanceForm?.reset();
    setFeedback(addMaintenanceFeedback, "");
    addMaintenanceModal.hidden = false;
  }

  function closeAddMaintenanceModal() {
    if (!addMaintenanceModal) {
      return;
    }

    addMaintenanceModal.hidden = true;
  }

  async function submitAddMaintenance(event) {
    event.preventDefault();

    const payload = {
      contactName: document.getElementById("add-maint-contact-name")?.value || "",
      contactPhone: document.getElementById("add-maint-contact-phone")?.value || "",
      contactEmail: document.getElementById("add-maint-contact-email")?.value || "",
      brand: document.getElementById("add-maint-brand")?.value || "",
      model: document.getElementById("add-maint-model")?.value || "",
      version: document.getElementById("add-maint-version")?.value || "",
      year: document.getElementById("add-maint-year")?.value || "",
      vin: document.getElementById("add-maint-vin")?.value || "",
      plate: document.getElementById("add-maint-plate")?.value || "",
      activationDate: addMaintActivationDate?.value || "",
      dueDate: addMaintDueDate?.value || "",
      contactNotes: document.getElementById("add-maint-notes")?.value || "",
    };

    setFeedback(addMaintenanceFeedback, "Guardando mantenimiento...");

    try {
      await fetchJson("/api/admin/maintenance", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setFeedback(addMaintenanceFeedback, "Mantenimiento creado.", "success");
      closeAddMaintenanceModal();
      setFeedback(maintenanceFeedback, "Mantenimiento añadido correctamente.", "success");
      await loadMaintenancePage();
    } catch (error) {
      setFeedback(addMaintenanceFeedback, error.message, "error");
    }
  }

  async function runBackfill() {
    if (!confirm("¿Sincronizar todos los pedidos Latam completados (E10) en mantenimientos?")) {
      return;
    }

    setFeedback(maintenanceFeedback, "Sincronizando pedidos completados...");

    try {
      const result = await fetchJson("/api/admin/maintenance/backfill-completed", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const summary = result.summary || {};
      setFeedback(
        maintenanceFeedback,
        `Listo: ${summary.created || 0} nuevos, ${summary.updated || 0} actualizados, ${summary.skipped || 0} omitidos de ${summary.totalCompletedOrders || 0} completados.`,
        "success"
      );
      await loadMaintenancePage();
    } catch (error) {
      setFeedback(maintenanceFeedback, error.message, "error");
    }
  }

  async function loadMaintenancePage() {
    await loadAdminSession();
    const query = selectedMonthKey ? `?month=${encodeURIComponent(selectedMonthKey)}` : "";
    const maintenanceData = await fetchJson(`/api/admin/maintenance${query}`);
    maintenanceItems = maintenanceData.maintenance || [];
    clientVehicleItems = maintenanceData.clientMaintenanceVehicles || [];
    dueByDateItems = maintenanceData.dueByDateThisMonth || [];
    dueByDateNextMonthItems = maintenanceData.dueByDateNextMonth || [];
    dueByKmItems = maintenanceData.dueByMileageReached || [];
    appointmentsThisMonthItems = maintenanceData.appointmentScheduledThisMonth
      || clientVehicleItems.filter((vehicle) => vehicle.adminContactStatus === "appointment_scheduled");
    scheduledCallsByMonth = maintenanceData.scheduledCallsByMonth || [];
    window.__maintenanceTotalCount = Number(maintenanceData.maintenanceTotal || maintenanceItems.length);

    populateMonthFilter(scheduledCallsByMonth);
    renderMaintenance(maintenanceItems, clientVehicleItems);
    renderDueByDate(dueByDateItems);
    renderDueByNextMonth(dueByDateNextMonthItems);
    renderDueByKm(dueByKmItems);
    renderAppointmentsCard(appointmentsThisMonthItems);
    renderAppointmentsCalendar(appointmentsThisMonthItems);
  }

  function closeAppointmentsModal() {
    if (appointmentsModal) {
      appointmentsModal.classList.remove("is-open");
    }
  }

  openAddMaintenanceButton?.addEventListener("click", openAddMaintenanceModal);
  addMaintenanceClose?.addEventListener("click", closeAddMaintenanceModal);
  addMaintenanceCancel?.addEventListener("click", closeAddMaintenanceModal);
  addMaintenanceOverlay?.addEventListener("click", closeAddMaintenanceModal);
  addMaintenanceForm?.addEventListener("submit", submitAddMaintenance);
  backfillMaintenanceButton?.addEventListener("click", () => {
    runBackfill().catch((error) => setFeedback(maintenanceFeedback, error.message, "error"));
  });

  addMaintActivationDate?.addEventListener("change", () => {
    if (!addMaintActivationDate.value) {
      return;
    }

    if (!addMaintDueDate?.value) {
      addMaintDueDate.value = addMonthsToDateInput(addMaintActivationDate.value, 6);
    }
  });

  maintenanceMonthFilter?.addEventListener("change", () => {
    selectedMonthKey = maintenanceMonthFilter.value || "";
    loadMaintenancePage().catch((error) => {
      setFeedback(maintenanceFeedback, error.message, "error");
    });
  });

  appointmentsModalClose?.addEventListener("click", closeAppointmentsModal);
  appointmentsModalOverlay?.addEventListener("click", closeAppointmentsModal);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (appointmentsModal?.classList.contains("is-open")) {
      closeAppointmentsModal();
    }

    if (addMaintenanceModal && !addMaintenanceModal.hidden) {
      closeAddMaintenanceModal();
    }
  });

  loadMaintenancePage().catch((error) => {
    setFeedback(maintenanceFeedback, error.message || "No se pudo cargar mantenimiento.", "error");
    if (maintenanceList) {
      maintenanceList.innerHTML = `
        <tr>
          <td colspan="7"><div class="empty-state">${escapeHtml(error.message || "Error")}</div></td>
        </tr>
      `;
    }
    renderEmptyState(maintenanceByDateList, error.message);
    renderEmptyState(maintenanceByNextMonthList, error.message);
    renderEmptyState(maintenanceByKmList, error.message);
    renderEmptyState(appointmentsList, error.message);
    renderEmptyState(appointmentsDayList, error.message);
  });

  bindCardNavigation();
})();
