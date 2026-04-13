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
      subtitle: "Vehiculos cuyo proximo mantenimiento preventivo (6 meses) vence este mes. Ventana +-15 dias.",
      dataKey: "dueByDateThisMonth",
      type: "date",
    },
    "next-month": {
      title: "Mantenimientos · Proximo mes",
      subtitle: "Vehiculos cuyo proximo mantenimiento preventivo (6 meses) vence el mes entrante. Ventana +-15 dias.",
      dataKey: "dueByDateNextMonth",
      type: "date",
    },
    km: {
      title: "Mantenimientos · Por km recorrido",
      subtitle: "Vehiculos con mas de 5.000 km estimados desde el ultimo mantenimiento preventivo.",
      dataKey: "dueByMileageReached",
      type: "km",
    },
    "appointments-month": {
      title: "Mantenimientos · Citas agendadas este mes",
      subtitle: "Vehiculos con estado de cita agendada dentro del mes actual.",
      dataKey: "appointmentScheduledThisMonth",
      type: "appointment",
    },
  };

  const CONTACT_STATUS_OPTIONS = [
    { value: "pending", label: "Sin contactar" },
    { value: "contacted", label: "Contactado (sin respuesta)" },
    { value: "will_service", label: "Volver a contactarlo" },
    { value: "serviced_elsewhere", label: "Lo hizo en otro lado" },
    { value: "not_interested", label: "No esta interesado" },
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
      return "<span class=\"maint-phone-missing\">Sin telefono</span>";
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
      "Telefono",
      "Ubicacion",
      "Vehiculo",
      "Placa",
      "Ano",
      isKm ? "Km estimados desde mant." : (isAppointment ? "Fecha cita" : "Ultimo mant."),
      isKm ? "Km/dia" : (isAppointment ? "Ultimo mant." : "Vence (+6m)"),
      "Ultimo contacto admin",
      "Estado de contacto",
      "Notas internas",
      "Fecha cita",
      "Hora programada",
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
    return `<input class="maint-appointment-time-input" type="time" id="appointment-time-${vehicleId}" value="${normalizeTimeValue(currentValue)}" />`;
  }

  function getPendingTableVehicles(filteredQuery) {
    const query = String(filteredQuery || "").toLowerCase().trim();
    const selectedCity = String(cityFilterEl?.value || "").trim();
    const pendingVehicles = allVehicles.filter((v) => String(v.adminContactStatus || "pending") === "pending");

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
      tableBody.innerHTML = `<tr><td colspan="13" class="maint-td maint-td-empty">No hay pendientes en este grupo.</td></tr>`;
      return;
    }

    tableBody.innerHTML = vehicles.map((vehicle) => {
      const id = String(vehicle._id || vehicle.id || "");
      const ownerName = escapeHtml(vehicle.user?.name || vehicle.client?.name || "Cliente");
      const ownerPhoneRaw = vehicle.user?.phone || vehicle.client?.phone || "";
      const drivingCity = escapeHtml(vehicle.drivingCity || "Sin ubicacion");
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
        ? `${escapeHtml(vehicle.usualDailyKm || "N/A")} km/dia`
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
          <td class="maint-td">${buildAppointmentDateInput(appointmentDateValue, id)}</td>
          <td class="maint-td">${buildAppointmentTimeInput(appointmentTimeValue, id)}</td>
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
        renderEmptyState(listEl, "Sin registros todavia.");
        return;
      }

      listEl.innerHTML = items.map((vehicle) => {
        const ownerName = escapeHtml(vehicle.user?.name || vehicle.client?.name || "Cliente");
        const vehicleTitle = escapeHtml([vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ") || "Vehiculo");
        const phoneRaw = vehicle.user?.phone || vehicle.client?.phone || "";
        const drivingCity = escapeHtml(vehicle.drivingCity || "Sin ubicacion");
        const apptDate = vehicle.adminAppointmentDate || vehicle.appointmentDate;
        const apptDateLabel = apptDate ? formatDate(apptDate) : "Sin fecha";

        return `
          <article class="maint-vehicle-card">
            <div class="maint-vehicle-card-info">
              <span class="maint-vehicle-card-title">${ownerName}</span>
              <span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "Sin placa")}</span>
              <span class="maint-vehicle-card-row">${vehicleTitle}</span>
              <span class="maint-vehicle-card-row">Ubicacion: ${drivingCity}</span>
              <span class="maint-vehicle-card-row">${buildWhatsappLink(phoneRaw)}</span>
              <span class="maint-vehicle-card-row">Notas: ${escapeHtml(vehicle.adminContactNotes || "Sin notas")}</span>
              ${statusValue === "appointment_scheduled"
                ? `<span class="maint-vehicle-card-row">Cita: ${apptDateLabel} · ${formatTimeValue(vehicle.adminAppointmentTime)}</span>`
                : ""}
            </div>
            <span class="maint-vehicle-card-badge ${STATUS_CSS[statusValue] || ""}">${escapeHtml(CONTACT_STATUS_OPTIONS.find((opt) => opt.value === statusValue)?.label || statusValue)}</span>
          </article>
        `;
      }).join("");
    });
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
