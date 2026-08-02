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
  const maintenanceDateFrom = document.getElementById("maintenance-date-from");
  const maintenanceDateTo = document.getElementById("maintenance-date-to");
  const maintenanceDateApply = document.getElementById("maintenance-date-apply");
  const maintenanceDateClear = document.getElementById("maintenance-date-clear");
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
  let selectedDateFrom = "";
  let selectedDateTo = "";
  const appointmentDayMap = new Map();
  let selectedAppointmentDayKey = "";
  let calendarAppointments = [];
  const nowForCalendar = new Date();
  let calendarCursor = {
    year: nowForCalendar.getUTCFullYear(),
    month: nowForCalendar.getUTCMonth(),
  };
  const calendarPrevButton = document.getElementById("maintenance-calendar-prev");
  const calendarNextButton = document.getElementById("maintenance-calendar-next");

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

  function toDateInputValue(value) {
    const parsed = parseDate(value);
    return parsed ? parsed.toISOString().slice(0, 10) : "";
  }

  function normalizeTimeValue(value) {
    const raw = String(value || "").trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(raw) ? raw : "";
  }

  function buildAppointmentTimeOptions(selectedValue) {
    const normalized = normalizeTimeValue(selectedValue);
    const hours = ['<option value="">Hora</option>'];

    for (let h = 7; h <= 18; h += 1) {
      for (const minutes of ["00", "30"]) {
        if (h === 18 && minutes === "30") {
          continue;
        }

        const timeStr = `${String(h).padStart(2, "0")}:${minutes}`;
        const hour12 = h % 12 === 0 ? 12 : h % 12;
        const suffix = h < 12 ? "AM" : "PM";
        hours.push(`<option value="${timeStr}"${normalized === timeStr ? " selected" : ""}>${hour12}:${minutes} ${suffix}</option>`);
      }
    }

    return hours.join("");
  }

  function buildAppointmentEditControls(vehicle, idPrefix = "appt") {
    const id = String(vehicle._id || vehicle.id || "");
    const dateValue = toDateInputValue(vehicle.adminAppointmentDate || vehicle.appointmentDate);
    const timeValue = normalizeTimeValue(vehicle.adminAppointmentTime);

    return `
      <div class="maint-appt-edit" data-vehicle-id="${escapeHtml(id)}">
        <input class="maint-appointment-date-input" type="date" id="${idPrefix}-date-${escapeHtml(id)}" value="${dateValue}" />
        <select class="maint-appointment-time-input" id="${idPrefix}-time-${escapeHtml(id)}">${buildAppointmentTimeOptions(timeValue)}</select>
        <button class="primary-button maint-appt-save-btn" type="button" data-vehicle-id="${escapeHtml(id)}" data-id-prefix="${escapeHtml(idPrefix)}">Guardar</button>
        <p class="maint-row-feedback" id="${idPrefix}-feedback-${escapeHtml(id)}" aria-live="polite"></p>
      </div>
    `;
  }

  async function saveAppointment(vehicleId, idPrefix = "appt") {
    const dateEl = document.getElementById(`${idPrefix}-date-${vehicleId}`);
    const timeEl = document.getElementById(`${idPrefix}-time-${vehicleId}`);
    const feedbackEl = document.getElementById(`${idPrefix}-feedback-${vehicleId}`);
    const button = document.querySelector(`.maint-appt-save-btn[data-vehicle-id="${vehicleId}"][data-id-prefix="${idPrefix}"]`);
    const adminAppointmentDate = dateEl?.value || "";
    const adminAppointmentTime = normalizeTimeValue(timeEl?.value || "");

    if (!adminAppointmentDate) {
      if (feedbackEl) {
        feedbackEl.textContent = "Selecciona la fecha.";
        feedbackEl.className = "maint-row-feedback maint-row-error";
      }
      return;
    }

    if (!adminAppointmentTime) {
      if (feedbackEl) {
        feedbackEl.textContent = "Selecciona la hora.";
        feedbackEl.className = "maint-row-feedback maint-row-error";
      }
      return;
    }

    if (button) {
      button.disabled = true;
    }

    if (feedbackEl) {
      feedbackEl.textContent = "Guardando...";
      feedbackEl.className = "maint-row-feedback";
    }

    try {
      await fetchJson(`/api/admin/maintenance-vehicles/${encodeURIComponent(vehicleId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          adminContactStatus: "appointment_scheduled",
          adminAppointmentDate,
          adminAppointmentTime,
        }),
        loadingMessage: false,
      });

      setFeedback(maintenanceFeedback, "Cita actualizada correctamente.", "success");
      await loadMaintenancePage();
    } catch (error) {
      if (feedbackEl) {
        feedbackEl.textContent = error.message || "Error al guardar";
        feedbackEl.className = "maint-row-feedback maint-row-error";
      } else {
        setFeedback(maintenanceFeedback, `Error al actualizar cita: ${error.message}`, "error");
      }
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  function bindAppointmentEditControls(container) {
    if (!container) {
      return;
    }

    container.querySelectorAll(".maint-appt-edit, .maint-appt-edit input, .maint-appt-edit select, .maint-appt-edit button").forEach((el) => {
      el.addEventListener("click", (event) => event.stopPropagation());
      el.addEventListener("keydown", (event) => event.stopPropagation());
    });

    container.querySelectorAll(".maint-appt-save-btn").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        saveAppointment(button.dataset.vehicleId, button.dataset.idPrefix || "appt");
      });
    });
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

      const navigate = (event) => {
        if (event?.target?.closest?.(".maint-appt-edit, .maint-modal-delete-btn, button, input, select, a, label")) {
          return;
        }

        window.location.href = `/app/admin-maintenance-detail.html?bucket=${encodeURIComponent(bucket)}`;
      };

      card.addEventListener("click", navigate);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          if (event.target?.closest?.(".maint-appt-edit, button, input, select, a, label")) {
            return;
          }
          event.preventDefault();
          navigate(event);
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
        <article class="maint-vehicle-card maint-appointment-card">
          <div class="maint-vehicle-card-info">
            <span class="maint-vehicle-card-badge is-scheduled">Agendada</span>
            <span class="maint-vehicle-card-title">${escapeHtml(ownerName)}</span>
            <span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "Sin placa")}</span>
            <span class="maint-vehicle-card-row">${escapeHtml(title || "Vehículo sin nombre")}</span>
            <span class="maint-vehicle-card-row">Cita: ${appointmentDate ? formatDate(appointmentDate) : "Sin fecha"} · ${formatAppointmentTime(vehicle)}</span>
            ${buildAppointmentEditControls(vehicle, "card")}
          </div>
        </article>
      `;
    }).join("");

    bindAppointmentEditControls(appointmentsList);
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
          <article class="maint-vehicle-card maint-appointment-card" data-vehicle-id="${id}">
            <div class="maint-vehicle-card-info">
              <span class="maint-vehicle-card-title">${escapeHtml(ownerName)}</span>
              <span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "Sin placa")}</span>
              <span class="maint-vehicle-card-row">${escapeHtml(title || "Vehículo sin nombre")}</span>
              <span class="maint-vehicle-card-row">Hora actual: ${formatAppointmentTime(vehicle)}</span>
              ${buildAppointmentEditControls(vehicle, "day")}
            </div>
            <button class="maint-modal-delete-btn" type="button" data-vehicle-id="${id}" title="Eliminar cita">🗑</button>
          </article>
        `;
      }).join("");

      bindAppointmentEditControls(appointmentsDayList);

      appointmentsDayList.querySelectorAll(".maint-modal-delete-btn").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          cancelAppointment(button.dataset.vehicleId, true);
        });
      });
    }

    if (shouldOpenModal) {
      appointmentsModal.classList.add("is-open");
    }
  }

  function shiftCalendarMonth(delta) {
    const next = new Date(Date.UTC(calendarCursor.year, calendarCursor.month + delta, 1, 12, 0, 0, 0));
    calendarCursor = {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth(),
    };
    renderAppointmentsCalendar(calendarAppointments);
  }

  function renderAppointmentsCalendar(items) {
    if (!appointmentsCalendarGrid) {
      return;
    }

    calendarAppointments = Array.isArray(items) ? items : calendarAppointments;
    appointmentDayMap.clear();

    calendarAppointments.forEach((vehicle) => {
      const appointmentDate = toAppointmentDate(vehicle);

      if (!appointmentDate) {
        return;
      }

      const dayKey = toDateKey(appointmentDate);
      const list = appointmentDayMap.get(dayKey) || [];
      list.push(vehicle);
      appointmentDayMap.set(dayKey, list);
    });

    const year = calendarCursor.year;
    const month = calendarCursor.month;
    const monthStart = new Date(Date.UTC(year, month, 1, 12, 0, 0, 0));
    const monthLabel = toMonthLabel(monthStart);
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12, 0, 0, 0)).getUTCDate();
    const firstWeekdaySundayFirst = monthStart.getUTCDay();
    const firstWeekdayMondayFirst = firstWeekdaySundayFirst === 0 ? 6 : firstWeekdaySundayFirst - 1;

    if (appointmentsMonthLabel) {
      appointmentsMonthLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
    }

    const now = new Date();
    const todayKey = toDateKey(new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      12,
      0,
      0,
      0
    )));
    const monthDayKeys = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      monthDayKeys.push(toDateKey(new Date(Date.UTC(year, month, day, 12, 0, 0, 0))));
    }
    const firstAvailableInMonth = monthDayKeys.find((key) => appointmentDayMap.has(key));
    if (!selectedAppointmentDayKey || !monthDayKeys.includes(selectedAppointmentDayKey)) {
      selectedAppointmentDayKey = monthDayKeys.includes(todayKey)
        ? todayKey
        : (firstAvailableInMonth || monthDayKeys[0]);
    }

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
        appointmentsCalendarGrid.querySelectorAll("button[data-day-key]").forEach((item) => {
          item.classList.toggle("is-active", item.dataset.dayKey === selectedAppointmentDayKey);
        });
        renderAppointmentsDayList(selectedAppointmentDayKey, true);
      });
    });
  }

  function hasActiveDateRange() {
    return Boolean(selectedDateFrom || selectedDateTo);
  }

  function parseLocalDateValue(value) {
    const raw = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return null;
    }
    const [year, month, day] = raw.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function isDueDateInSelectedRange(dateValue) {
    if (!hasActiveDateRange()) {
      return true;
    }
    const date = dateValue ? new Date(dateValue) : null;
    if (!date || Number.isNaN(date.getTime())) {
      return false;
    }
    const from = parseLocalDateValue(selectedDateFrom);
    const to = parseLocalDateValue(selectedDateTo);
    if (from) {
      const fromStart = new Date(from);
      fromStart.setHours(0, 0, 0, 0);
      if (date < fromStart) {
        return false;
      }
    }
    if (to) {
      const toEnd = new Date(to);
      toEnd.setHours(23, 59, 59, 999);
      if (date > toEnd) {
        return false;
      }
    }
    return true;
  }

  function updateMonthSummary() {
    if (!maintenanceMonthSummary) {
      return;
    }

    if (!hasActiveDateRange()) {
      maintenanceMonthSummary.textContent = `Total programados: ${maintenanceItems.length}. Elige un rango de fechas para filtrar.`;
      return;
    }

    const fromLabel = selectedDateFrom ? formatDate(`${selectedDateFrom}T12:00:00`) : "inicio";
    const toLabel = selectedDateTo ? formatDate(`${selectedDateTo}T12:00:00`) : "hoy en adelante";
    maintenanceMonthSummary.textContent = `Entre ${fromLabel} y ${toLabel}: ${maintenanceItems.length} contacto${maintenanceItems.length === 1 ? "" : "s"} para llamar.`;
  }

  function renderMaintenance(items, clientVehicles) {
    const filteredClientVehicles = hasActiveDateRange()
      ? clientVehicles.filter((vehicle) => isDueDateInSelectedRange(vehicle.dueDateBySchedule))
      : clientVehicles;

    const totalCount = Number.isFinite(Number(window.__maintenanceTotalCount))
      ? Number(window.__maintenanceTotalCount)
      : items.length + filteredClientVehicles.length;

    if (maintenanceCount) {
      maintenanceCount.textContent = String(hasActiveDateRange() ? items.length + filteredClientVehicles.length : totalCount);
    }

    updateMonthSummary();

    if (!maintenanceList) {
      return;
    }

    if (!items.length && !filteredClientVehicles.length) {
      maintenanceList.innerHTML = `
        <tr>
          <td colspan="7"><div class="empty-state">No hay mantenimientos para este filtro.</div></td>
        </tr>
      `;
      return;
    }

    const orderRows = items.map((item) => {
      const isMarketingLead = item.source === "cotizador_marketing" || item.source === "taller_marketing";
      const vehicleTitle = isMarketingLead
        ? (item.vehicleSnapshot?.version || [
          item.vehicleSnapshot?.brand,
          item.vehicleSnapshot?.model,
        ].filter(Boolean).join(" "))
        : [
          item.vehicleSnapshot?.brand || item.order?.vehicle?.brand,
          item.vehicleSnapshot?.model || item.order?.vehicle?.model,
          item.vehicleSnapshot?.version || item.order?.vehicle?.version,
        ].filter(Boolean).join(" ");
      const clientName = item.client?.name || item.contactName || "Cliente";
      const tracking = item.source === "taller_marketing"
        ? "Marketing taller"
        : (item.source === "cotizador_marketing"
          ? "Marketing cotizador"
          : (item.source === "manual"
            ? "Manual"
            : (item.order?.trackingNumber || "Sin guía")));
      const vin = item.vehicleSnapshot?.vin || item.order?.vehicle?.vin || "—";
      const statusLabel = isMarketingLead
        ? "Marketing 6M"
        : (STATUS_LABELS[item.status] || item.status || "Programado");

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

    const clientRows = filteredClientVehicles.map((vehicle) => {
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
    const params = new URLSearchParams();
    if (selectedDateFrom) params.set("from", selectedDateFrom);
    if (selectedDateTo) params.set("to", selectedDateTo);
    const query = params.toString() ? `?${params.toString()}` : "";
    const maintenanceData = await fetchJson(`/api/admin/maintenance${query}`);
    maintenanceItems = maintenanceData.maintenance || [];
    clientVehicleItems = maintenanceData.clientMaintenanceVehicles || [];
    dueByDateItems = maintenanceData.dueByDateThisMonth || [];
    dueByDateNextMonthItems = maintenanceData.dueByDateNextMonth || [];
    dueByKmItems = maintenanceData.dueByMileageReached || [];
    appointmentsThisMonthItems = maintenanceData.appointmentScheduledThisMonth
      || clientVehicleItems.filter((vehicle) => vehicle.adminContactStatus === "appointment_scheduled");
    calendarAppointments = (Array.isArray(maintenanceData.appointmentScheduled) && maintenanceData.appointmentScheduled.length
      ? maintenanceData.appointmentScheduled
      : clientVehicleItems.filter((vehicle) => vehicle.adminContactStatus === "appointment_scheduled")
    ).filter((vehicle) => toAppointmentDate(vehicle));
    scheduledCallsByMonth = maintenanceData.scheduledCallsByMonth || [];
    window.__maintenanceTotalCount = Number(maintenanceData.maintenanceTotal || maintenanceItems.length);

    if (maintenanceDateFrom) maintenanceDateFrom.value = selectedDateFrom;
    if (maintenanceDateTo) maintenanceDateTo.value = selectedDateTo;

    renderMaintenance(maintenanceItems, clientVehicleItems);
    renderDueByDate(dueByDateItems);
    renderDueByNextMonth(dueByDateNextMonthItems);
    renderDueByKm(dueByKmItems);
    renderAppointmentsCard(appointmentsThisMonthItems);
    renderAppointmentsCalendar(calendarAppointments);
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

  function applyDateRangeFilter() {
    selectedDateFrom = String(maintenanceDateFrom?.value || "").trim();
    selectedDateTo = String(maintenanceDateTo?.value || "").trim();

    if (selectedDateFrom && selectedDateTo && selectedDateFrom > selectedDateTo) {
      setFeedback(maintenanceFeedback, "La fecha Desde no puede ser mayor que Hasta.", "error");
      return;
    }

    loadMaintenancePage().catch((error) => {
      setFeedback(maintenanceFeedback, error.message, "error");
    });
  }

  maintenanceDateApply?.addEventListener("click", applyDateRangeFilter);
  maintenanceDateClear?.addEventListener("click", () => {
    selectedDateFrom = "";
    selectedDateTo = "";
    if (maintenanceDateFrom) maintenanceDateFrom.value = "";
    if (maintenanceDateTo) maintenanceDateTo.value = "";
    loadMaintenancePage().catch((error) => {
      setFeedback(maintenanceFeedback, error.message, "error");
    });
  });
  [maintenanceDateFrom, maintenanceDateTo].forEach((input) => {
    input?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyDateRangeFilter();
      }
    });
  });

  calendarPrevButton?.addEventListener("click", () => shiftCalendarMonth(-1));
  calendarNextButton?.addEventListener("click", () => shiftCalendarMonth(1));
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

  const diagnosesBody = document.getElementById("mechanic-diagnoses-body");
  const diagnosesRefresh = document.getElementById("mechanic-diagnoses-refresh");
  let diagnosesLoaded = false;

  async function loadMechanicDiagnoses() {
    if (!diagnosesBody) return;
    diagnosesBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">Cargando diagnósticos...</div></td></tr>`;
    const data = await fetchJson("/api/admin/mechanic-diagnoses");
    const orders = data.orders || [];
    if (!orders.length) {
      diagnosesBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">Aún no hay diagnósticos del taller.</div></td></tr>`;
      return;
    }
    diagnosesBody.innerHTML = orders.map((order) => {
      const vehicle = [order.vehicle?.brand, order.vehicle?.model, order.vehicle?.year].filter(Boolean).join(" ");
      return `
        <tr>
          <td>${escapeHtml(order.orderNumber || "—")}</td>
          <td>${escapeHtml(order.client?.name || "—")}</td>
          <td>${escapeHtml(vehicle || "—")}</td>
          <td>${escapeHtml(order.vehicle?.plate || "—")}</td>
          <td>${order.currentKm != null ? Number(order.currentKm).toLocaleString("es-CO") : "—"}</td>
          <td>${order.nextServiceKm != null ? `${Number(order.nextServiceKm).toLocaleString("es-CO")} km` : "—"}</td>
          <td>${order.completedAt || order.createdAt ? formatDate(order.completedAt || order.createdAt) : "—"}</td>
          <td><button class="secondary-button" type="button" data-diagnosis-pdf="${escapeHtml(order.id)}">PDF</button></td>
        </tr>
      `;
    }).join("");

    diagnosesBody.querySelectorAll("[data-diagnosis-pdf]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          const orderId = button.dataset.diagnosisPdf;
          const authToken = localStorage.getItem("globalAppToken") || sessionStorage.getItem("globalAppToken") || "";
          const response = await fetch(`/api/mechanic/orders/${encodeURIComponent(orderId)}/pdf`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
            credentials: "include",
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || "No se pudo descargar el PDF");
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = `Diagnostico-${orderId}.pdf`;
          anchor.click();
          URL.revokeObjectURL(url);
        } catch (error) {
          setFeedback(maintenanceFeedback, error.message, "error");
        }
      });
    });
  }

  document.querySelectorAll("[data-maint-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.maintTab === "diagnosticos" && !diagnosesLoaded) {
        diagnosesLoaded = true;
        loadMechanicDiagnoses().catch((error) => {
          diagnosesLoaded = false;
          if (diagnosesBody) {
            diagnosesBody.innerHTML = `<tr><td colspan="8"><div class="empty-state">${escapeHtml(error.message || "Error")}</div></td></tr>`;
          }
        });
      }
    });
  });
  diagnosesRefresh?.addEventListener("click", () => {
    loadMechanicDiagnoses().catch((error) => setFeedback(maintenanceFeedback, error.message, "error"));
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
