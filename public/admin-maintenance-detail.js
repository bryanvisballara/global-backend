(() => {
  if (window.__adminMaintenanceDetailInitialized) {
    return;
  }

  window.__adminMaintenanceDetailInitialized = true;

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

  const BUCKET_CONFIG = {
    "this-month": {
      title: "Mantenimientos · Este mes",
      subtitle: "Vehículos cuyo próximo mantenimiento preventivo (6 meses) vence este mes. Ventana +/-15 días.",
      dataKey: "dueByDateThisMonth",
      type: "date",
    },
    "next-month": {
      title: "Mantenimientos · Próximo mes",
      subtitle: "Vehículos cuyo próximo mantenimiento preventivo (6 meses) vence el mes entrante. Ventana +/-15 días.",
      dataKey: "dueByDateNextMonth",
      type: "date",
    },
    km: {
      title: "Mantenimientos · Por km recorrido",
      subtitle: "Vehículos con más de 5.000 km estimados desde el último mantenimiento preventivo.",
      dataKey: "dueByMileageReached",
      type: "km",
    },
    "appointments-month": {
      title: "Mantenimientos · Citas agendadas este mes",
      subtitle: "Vehículos con estado de cita agendada dentro del mes actual.",
      dataKey: "appointmentScheduledThisMonth",
      type: "appointment",
    },
  };

  const CONTACT_STATUS_OPTIONS = [
    { value: "pending", label: "Sin contactar" },
    { value: "contacted", label: "Contactado (sin respuesta)" },
    { value: "will_service", label: "Volver a contactarlo" },
    { value: "serviced_elsewhere", label: "Lo hizo en otro lado" },
    { value: "not_interested", label: "No está interesado" },
    { value: "appointment_scheduled", label: "Cita agendada" },
  ];

  const STATUS_CSS = {
    pending: "maint-status-pending",
    contacted: "maint-status-contacted",
    will_service: "maint-status-yes",
    serviced_elsewhere: "maint-status-elsewhere",
    not_interested: "maint-status-no",
    appointment_scheduled: "maint-status-scheduled",
  };

  const STATUS_CARDS = [
    "contacted",
    "will_service",
    "serviced_elsewhere",
    "not_interested",
    "appointment_scheduled",
  ];

  const params = new URLSearchParams(window.location.search);
  const bucket = params.get("bucket") || "this-month";
  const config = BUCKET_CONFIG[bucket] || BUCKET_CONFIG["this-month"];

  const titleEl = document.getElementById("detail-title");
  const subtitleEl = document.getElementById("detail-subtitle");
  const tableHead = document.getElementById("maint-table-head");
  const tableBody = document.getElementById("maint-table-body");
  const totalCountEl = document.getElementById("maint-total-count");
  const searchInput = document.getElementById("maint-search");
  const cityFilterEl = document.getElementById("maint-city-filter");
  const pageFeedback = document.getElementById("maint-detail-page-feedback");

  if (titleEl) {
    titleEl.textContent = config.title;
  }

  if (subtitleEl) {
    subtitleEl.textContent = config.subtitle;
  }

  document.title = `Global Imports | ${config.title}`;

  let allVehicles = [];

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function normalizePhone(phoneValue) {
    return String(phoneValue || "").replace(/\D+/g, "");
  }

  function buildWhatsappLink(phoneValue) {
    const normalizedPhone = normalizePhone(phoneValue);

    if (!normalizedPhone) {
      return "<span class=\"maint-phone-missing\">Sin teléfono</span>";
    }

    return `<a class="maint-whatsapp-link" href="https://wa.me/${encodeURIComponent(normalizedPhone)}" target="_blank" rel="noopener noreferrer">${escapeHtml(phoneValue)}</a>`;
  }

  function toDateInputValue(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function normalizeTimeValue(timeValue) {
    const normalized = String(timeValue || "").trim();
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(normalized) ? normalized : "";
  }

  function formatTimeValue(timeValue) {
    const normalized = normalizeTimeValue(timeValue);
    return normalized ? `${normalized} h` : "Sin hora";
  }

  function buildTableHead() {
    const isKm = config.type === "km";
    const isAppointment = config.type === "appointment";
    const headerRow = tableHead.querySelector("tr");

    const cols = [
      "Cliente",
      "Teléfono",
      "Ubicación",
      "Vehículo",
      "Placa",
      "Año",
      isKm ? "Km estimados desde mant." : (isAppointment ? "Fecha de cita" : "Último mant."),
      isKm ? "Km/día" : (isAppointment ? "Último mant." : "Vence (+6 m)"),
      "Último contacto admin",
      "Estado de contacto",
      "Notas internas",
      "Fecha y hora de cita",
      "Guardar",
    ];

    headerRow.innerHTML = cols.map((col) => `<th class="maint-th">${col}</th>`).join("");
  }

  function buildStatusSelect(currentStatus, vehicleId) {
    const safe = currentStatus || "pending";
    const statusCls = STATUS_CSS[safe] || "";
    const options = CONTACT_STATUS_OPTIONS
      .map((opt) => `<option value="${opt.value}"${safe === opt.value ? " selected" : ""}>${opt.label}</option>`)
      .join("");

    return `<select class="maint-status-select ${statusCls}" id="status-${vehicleId}">${options}</select>`;
  }

  function buildNotesInput(currentNotes, vehicleId) {
    return `<input class="maint-notes-input" type="text" id="notes-${vehicleId}" value="${escapeHtml(currentNotes)}" placeholder="Notas internas..." />`;
  }

  function buildAppointmentDateInput(currentValue, vehicleId) {
    return `<input class="maint-appointment-date-input" type="date" id="appointment-${vehicleId}" value="${toDateInputValue(currentValue)}" />`;
  }

  function buildAppointmentTimeInput(currentValue, vehicleId) {
    const hours = [];
    const normalized = normalizeTimeValue(currentValue);
    for (let h = 7; h <= 18; h += 1) {
      for (const minutes of ["00", "30"]) {
        if (h === 18 && minutes === "30") {
          continue;
        }
        const timeStr = `${String(h).padStart(2, "0")}:${minutes}`;
        const hour12 = h % 12 === 0 ? 12 : h % 12;
        const suffix = h < 12 ? "AM" : "PM";
        const label = `${hour12}:${minutes} ${suffix}`;
        hours.push(`<option value="${timeStr}"${normalized === timeStr ? " selected" : ""}>${label}</option>`);
      }
    }
    return `<select class="maint-appointment-time-input" id="appointment-time-${vehicleId}" required><option value="">Selecciona hora</option>${hours.join("")}</select>`;
  }

  function buildAppointmentDateTimeFields(dateValue, timeValue, vehicleId) {
    return `
      <div class="maint-appt-datetime">
        <label>
          <span>Fecha</span>
          ${buildAppointmentDateInput(dateValue, vehicleId)}
        </label>
        <label>
          <span>Hora</span>
          ${buildAppointmentTimeInput(timeValue, vehicleId)}
        </label>
      </div>
    `;
  }

  function getPendingTableVehicles(filteredQuery) {
    const query = String(filteredQuery || "").toLowerCase().trim();
    const selectedCity = String(cityFilterEl?.value || "").trim();
    const pendingVehicles = config.type === "appointment"
      ? allVehicles.filter((v) => String(v.adminContactStatus || "") === "appointment_scheduled")
      : allVehicles.filter((v) => String(v.adminContactStatus || "pending") === "pending");

    return pendingVehicles.filter((v) => {
      const location = String(v.drivingCity || "").trim();
      const byCity = !selectedCity || location === selectedCity;

      if (!byCity) {
        return false;
      }

      if (!query) {
        return true;
      }

      const name = String(v.user?.name || v.client?.name || "").toLowerCase();
      const plate = String(v.plate || "").toLowerCase();
      const brand = String(v.brand || "").toLowerCase();
      const model = String(v.model || "").toLowerCase();
      const phone = String(v.user?.phone || v.client?.phone || "").toLowerCase();
      const city = String(v.drivingCity || "").toLowerCase();

      return name.includes(query) || plate.includes(query) || brand.includes(query) || model.includes(query) || phone.includes(query) || city.includes(query);
    });
  }

  function renderRows(vehicles) {
    const isKm = config.type === "km";
    const isAppointment = config.type === "appointment";

    if (!vehicles.length) {
      tableBody.innerHTML = `<tr><td colspan="13" class="maint-td maint-td-empty">${
        config.type === "appointment"
          ? "No hay citas agendadas en este grupo."
          : "No hay pendientes en este grupo."
      }</td></tr>`;
      return;
    }

    tableBody.innerHTML = vehicles.map((vehicle) => {
      const id = String(vehicle._id || vehicle.id || "");
      const ownerName = escapeHtml(vehicle.user?.name || vehicle.client?.name || "Cliente");
      const ownerPhoneRaw = vehicle.user?.phone || vehicle.client?.phone || "";
      const drivingCity = escapeHtml(vehicle.drivingCity || "Sin ubicación");
      const vehicleTitle = escapeHtml([vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ") || "Sin nombre");
      const lastContact = vehicle.adminLastContactAt ? formatDate(vehicle.adminLastContactAt) : "-";
      const appointmentDateValue = vehicle.adminAppointmentDate || vehicle.appointmentDate || "";
      const appointmentTimeValue = vehicle.adminAppointmentTime || "";

      const col5 = isKm
        ? `<strong style="color:#ffcba0">${Math.floor(vehicle.estimatedKmSinceLastMaintenance || 0).toLocaleString()}</strong> km`
        : (isAppointment
          ? (appointmentDateValue ? formatDate(appointmentDateValue) : "Sin fecha")
          : (vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "-"));

      const col6 = isKm
        ? `${escapeHtml(vehicle.usualDailyKm || "N/A")} km/día`
        : (isAppointment
          ? (vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "-")
          : (vehicle.dueDateBySchedule ? formatDate(vehicle.dueDateBySchedule) : "-"));

      return `
        <tr class="maint-row" data-vehicle-id="${id}">
          <td class="maint-td maint-td-name">${ownerName}</td>
          <td class="maint-td maint-td-phone">${buildWhatsappLink(ownerPhoneRaw)}</td>
          <td class="maint-td maint-td-city">${drivingCity}</td>
          <td class="maint-td maint-td-vehicle">${vehicleTitle}</td>
          <td class="maint-td"><span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "-")}</span></td>
          <td class="maint-td">${escapeHtml(vehicle.year || "-")}</td>
          <td class="maint-td">${col5}</td>
          <td class="maint-td">${col6}</td>
          <td class="maint-td maint-td-lastcontact" id="lastcontact-${id}">${lastContact}</td>
          <td class="maint-td maint-td-status">${buildStatusSelect(vehicle.adminContactStatus, id)}</td>
          <td class="maint-td maint-td-notes">${buildNotesInput(vehicle.adminContactNotes, id)}</td>
          <td class="maint-td">${buildAppointmentDateTimeFields(appointmentDateValue, appointmentTimeValue, id)}</td>
          <td class="maint-td maint-td-action">
            <button class="primary-button maint-save-btn" data-vehicle-id="${id}" type="button">Guardar</button>
            <p class="maint-row-feedback" id="row-feedback-${id}" aria-live="polite"></p>
          </td>
        </tr>
      `;
    }).join("");

    tableBody.querySelectorAll(".maint-status-select").forEach((select) => {
      select.addEventListener("change", () => {
        select.className = `maint-status-select ${STATUS_CSS[select.value] || ""}`;
      });
    });

    tableBody.querySelectorAll(".maint-save-btn").forEach((button) => {
      button.addEventListener("click", () => handleSave(button.dataset.vehicleId));
    });
  }

  function renderStatusCards() {
    STATUS_CARDS.forEach((statusValue) => {
      const listEl = document.getElementById(`status-list-${statusValue}`);
      const countEl = document.getElementById(`status-count-${statusValue}`);

      if (!listEl || !countEl) {
        return;
      }

      const items = allVehicles.filter((vehicle) => String(vehicle.adminContactStatus || "pending") === statusValue);
      countEl.textContent = String(items.length);

      if (!items.length) {
        renderEmptyState(listEl, "Sin registros todavía.");
        return;
      }

      listEl.innerHTML = items.map((vehicle) => {
        const id = String(vehicle._id || vehicle.id || "");
        const ownerName = escapeHtml(vehicle.user?.name || vehicle.client?.name || "Cliente");
        const vehicleTitle = escapeHtml([vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ") || "Vehículo");
        const phoneRaw = vehicle.user?.phone || vehicle.client?.phone || "";
        const drivingCity = escapeHtml(vehicle.drivingCity || "Sin ubicación");
        const apptDate = vehicle.adminAppointmentDate || vehicle.appointmentDate;
        const apptDateLabel = apptDate ? formatDate(apptDate) : "Sin fecha";
        const canEditAppointment = statusValue === "appointment_scheduled";

        return `
          <article class="maint-vehicle-card${canEditAppointment ? " maint-appointment-card" : ""}">
            <div class="maint-vehicle-card-info">
              <span class="maint-vehicle-card-badge ${STATUS_CSS[statusValue] || ""}">${escapeHtml(CONTACT_STATUS_OPTIONS.find((opt) => opt.value === statusValue)?.label || statusValue)}</span>
              <span class="maint-vehicle-card-title">${ownerName}</span>
              <span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "Sin placa")}</span>
              <span class="maint-vehicle-card-row">${vehicleTitle}</span>
              <span class="maint-vehicle-card-row">Ubicación: ${drivingCity}</span>
              <span class="maint-vehicle-card-row">${buildWhatsappLink(phoneRaw)}</span>
              <span class="maint-vehicle-card-row">Notas: ${escapeHtml(vehicle.adminContactNotes || "Sin notas")}</span>
              ${canEditAppointment
                ? `<span class="maint-vehicle-card-row">Cita: ${apptDateLabel} · ${formatTimeValue(vehicle.adminAppointmentTime)}</span>
                   <div class="maint-appt-edit" data-vehicle-id="${escapeHtml(id)}">
                     ${buildAppointmentDateTimeFields(apptDate, vehicle.adminAppointmentTime, `card-${id}`)}
                     <button class="primary-button maint-card-save-btn" type="button" data-vehicle-id="${escapeHtml(id)}">Guardar cambios</button>
                     <p class="maint-row-feedback" id="card-feedback-${escapeHtml(id)}" aria-live="polite"></p>
                   </div>`
                : ""}
            </div>
          </article>
        `;
      }).join("");

      if (statusValue === "appointment_scheduled") {
        listEl.querySelectorAll(".maint-card-save-btn").forEach((button) => {
          button.addEventListener("click", () => handleCardAppointmentSave(button.dataset.vehicleId));
        });
      }
    });
  }

  async function handleCardAppointmentSave(vehicleId) {
    const dateEl = document.getElementById(`appointment-card-${vehicleId}`);
    const timeEl = document.getElementById(`appointment-time-card-${vehicleId}`);
    const feedbackEl = document.getElementById(`card-feedback-${vehicleId}`);
    const button = document.querySelector(`.maint-card-save-btn[data-vehicle-id="${vehicleId}"]`);
    const adminAppointmentDate = dateEl?.value || "";
    const adminAppointmentTime = normalizeTimeValue(timeEl?.value || "");

    if (!adminAppointmentDate || !adminAppointmentTime) {
      if (feedbackEl) {
        feedbackEl.textContent = "Debes indicar fecha y hora.";
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
      const result = await fetchJson(`/api/admin/maintenance-vehicles/${encodeURIComponent(vehicleId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          adminContactStatus: "appointment_scheduled",
          adminAppointmentDate,
          adminAppointmentTime,
        }),
        loadingMessage: false,
      });

      const idx = allVehicles.findIndex((vehicle) => String(vehicle._id || vehicle.id) === vehicleId);

      if (idx !== -1) {
        allVehicles[idx] = {
          ...allVehicles[idx],
          ...result.vehicle,
          adminContactStatus: "appointment_scheduled",
          adminAppointmentDate: result.vehicle?.adminAppointmentDate ?? adminAppointmentDate,
          adminAppointmentTime: result.vehicle?.adminAppointmentTime ?? adminAppointmentTime,
          adminLastContactAt: result.vehicle?.adminLastContactAt || new Date().toISOString(),
        };
      }

      setFeedback(pageFeedback, "Cita actualizada correctamente.", "success");
      filterAndRender();
    } catch (error) {
      if (feedbackEl) {
        feedbackEl.textContent = error.message || "Error al guardar";
        feedbackEl.className = "maint-row-feedback maint-row-error";
      }
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  function filterAndRender() {
    const query = String(searchInput?.value || "").trim();
    const pendingVehicles = getPendingTableVehicles(query);

    if (totalCountEl) {
      totalCountEl.textContent = String(pendingVehicles.length);
    }

    renderRows(pendingVehicles);
    renderStatusCards();
  }

  async function handleSave(vehicleId) {
    const statusEl = document.getElementById(`status-${vehicleId}`);
    const notesEl = document.getElementById(`notes-${vehicleId}`);
    const appointmentDateEl = document.getElementById(`appointment-${vehicleId}`);
    const appointmentTimeEl = document.getElementById(`appointment-time-${vehicleId}`);
    const feedbackEl = document.getElementById(`row-feedback-${vehicleId}`);
    const button = tableBody.querySelector(`.maint-save-btn[data-vehicle-id="${vehicleId}"]`);

    if (!statusEl || !feedbackEl) {
      return;
    }

    const adminContactStatus = statusEl.value;
    const adminContactNotes = notesEl?.value || "";
    const adminAppointmentDate = appointmentDateEl?.value || null;
    const adminAppointmentTime = normalizeTimeValue(appointmentTimeEl?.value || "");

    if (adminContactStatus === "appointment_scheduled" && !adminAppointmentDate) {
      feedbackEl.textContent = "Debes seleccionar una fecha de cita.";
      feedbackEl.className = "maint-row-feedback maint-row-error";
      return;
    }

    if (adminContactStatus === "appointment_scheduled" && !adminAppointmentTime) {
      feedbackEl.textContent = "Debes seleccionar una hora programada.";
      feedbackEl.className = "maint-row-feedback maint-row-error";
      return;
    }

    if (button) {
      button.disabled = true;
    }

    feedbackEl.textContent = "Guardando...";
    feedbackEl.className = "maint-row-feedback";

    try {
      const result = await fetchJson(`/api/admin/maintenance-vehicles/${encodeURIComponent(vehicleId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          adminContactStatus,
          adminContactNotes,
          adminAppointmentDate,
          adminAppointmentTime,
        }),
        loadingMessage: false,
      });

      const idx = allVehicles.findIndex((vehicle) => String(vehicle._id || vehicle.id) === vehicleId);

      if (idx !== -1) {
        allVehicles[idx] = {
          ...allVehicles[idx],
          ...result.vehicle,
          adminContactStatus: result.vehicle?.adminContactStatus || adminContactStatus,
          adminContactNotes: result.vehicle?.adminContactNotes ?? adminContactNotes,
          adminAppointmentDate: result.vehicle?.adminAppointmentDate ?? adminAppointmentDate,
          adminAppointmentTime: result.vehicle?.adminAppointmentTime ?? adminAppointmentTime,
          adminLastContactAt: result.vehicle?.adminLastContactAt || new Date().toISOString(),
        };
      }

      setFeedback(pageFeedback, "Contacto guardado. El cliente fue movido al card de su estado.", "success");
      filterAndRender();
    } catch (error) {
      feedbackEl.textContent = error.message || "Error al guardar";
      feedbackEl.className = "maint-row-feedback maint-row-error";
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  async function loadPage() {
    await loadAdminSession();
    const data = await fetchJson("/api/admin/maintenance");
    allVehicles = Array.isArray(data[config.dataKey]) ? data[config.dataKey] : [];

    buildTableHead();
    filterAndRender();
  }

  if (searchInput) {
    searchInput.addEventListener("input", filterAndRender);
  }

  if (cityFilterEl) {
    cityFilterEl.addEventListener("change", filterAndRender);
  }

  loadPage().catch((error) => {
    if (pageFeedback) {
      setFeedback(pageFeedback, error.message || "Error al cargar los datos.", "error");
    }
  });
})();
