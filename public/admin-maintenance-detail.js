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
      subtitle: "Vehículos cuyo próximo mantenimiento preventivo (6 meses) vence este mes. Ventana ±15 días.",
      dataKey: "dueByDateThisMonth",
      type: "date",
    },
    "next-month": {
      title: "Mantenimientos · Próximo mes",
      subtitle: "Vehículos cuyo próximo mantenimiento preventivo (6 meses) vence el mes entrante. Ventana ±15 días.",
      dataKey: "dueByDateNextMonth",
      type: "date",
    },
    km: {
      title: "Mantenimientos · Por km recorrido",
      subtitle: "Vehículos con más de 5.000 km estimados desde el último mantenimiento preventivo.",
      dataKey: "dueByMileageReached",
      type: "km",
    },
  };

  const CONTACT_STATUS_OPTIONS = [
    { value: "pending", label: "Sin contactar" },
    { value: "contacted", label: "Contactado (sin respuesta)" },
    { value: "will_service", label: "Hará servicio con nosotros" },
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

  const params = new URLSearchParams(window.location.search);
  const bucket = params.get("bucket") || "this-month";
  const config = BUCKET_CONFIG[bucket] || BUCKET_CONFIG["this-month"];

  const titleEl = document.getElementById("detail-title");
  const subtitleEl = document.getElementById("detail-subtitle");
  const tableHead = document.getElementById("maint-table-head");
  const tableBody = document.getElementById("maint-table-body");
  const totalCountEl = document.getElementById("maint-total-count");
  const searchInput = document.getElementById("maint-search");
  const pageFeedback = document.getElementById("maint-detail-page-feedback");

  if (titleEl) {
    titleEl.textContent = config.title;
  }

  if (subtitleEl) {
    subtitleEl.textContent = config.subtitle;
  }

  document.title = `Global Imports | ${config.title}`;

  let allVehicles = [];

  function buildTableHead() {
    const isKm = config.type === "km";
    const headerRow = tableHead.querySelector("tr");

    const cols = [
      "Cliente",
      "Vehículo",
      "Placa",
      "Año",
      isKm ? "Km estimados desde mant." : "Último mant.",
      isKm ? "Km/día" : "Vence (+6m)",
      "Último contacto admin",
      "Estado de contacto",
      "Notas internas",
      "Guardar",
    ];

    headerRow.innerHTML = cols.map((col) => `<th class="maint-th">${col}</th>`).join("");
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildStatusSelect(currentStatus, vehicleId) {
    const safe = currentStatus || "pending";
    const statusCls = STATUS_CSS[safe] || "";
    const options = CONTACT_STATUS_OPTIONS
      .map((opt) => `<option value="${opt.value}"${safe === opt.value ? " selected" : ""}>${opt.label}</option>`)
      .join("");

    return `<select class="maint-status-select ${statusCls}" id="status-${vehicleId}" data-vid="${vehicleId}">${options}</select>`;
  }

  function buildNotesInput(currentNotes, vehicleId) {
    return `<input class="maint-notes-input" type="text" id="notes-${vehicleId}" value="${escapeHtml(currentNotes)}" placeholder="Notas internas..." />`;
  }

  function renderRows(vehicles) {
    const isKm = config.type === "km";

    if (!vehicles.length) {
      tableBody.innerHTML = `<tr><td colspan="10" class="maint-td maint-td-empty">No hay vehículos en este grupo.</td></tr>`;
      return;
    }

    tableBody.innerHTML = vehicles.map((vehicle) => {
      const id = String(vehicle._id || vehicle.id || "");
      const ownerName = escapeHtml(vehicle.user?.name || vehicle.client?.name || "Cliente");
      const vehicleTitle = escapeHtml([vehicle.brand, vehicle.model, vehicle.version].filter(Boolean).join(" ") || "Sin nombre");
      const lastContact = vehicle.adminLastContactAt ? formatDate(vehicle.adminLastContactAt) : "—";

      const col5 = isKm
        ? `<strong style="color:#ffcba0">${Math.floor(vehicle.estimatedKmSinceLastMaintenance || 0).toLocaleString()}</strong> km`
        : (vehicle.lastPreventiveMaintenanceDate ? formatDate(vehicle.lastPreventiveMaintenanceDate) : "—");

      const col6 = isKm
        ? `${escapeHtml(vehicle.usualDailyKm || "N/A")} km/día`
        : (vehicle.dueDateBySchedule ? formatDate(vehicle.dueDateBySchedule) : "—");

      return `
        <tr class="maint-row" data-vehicle-id="${id}">
          <td class="maint-td maint-td-name">${ownerName}</td>
          <td class="maint-td maint-td-vehicle">${vehicleTitle}</td>
          <td class="maint-td"><span class="maint-vehicle-card-plate">${escapeHtml(vehicle.plate || "—")}</span></td>
          <td class="maint-td">${escapeHtml(vehicle.year || "—")}</td>
          <td class="maint-td">${col5}</td>
          <td class="maint-td">${col6}</td>
          <td class="maint-td maint-td-lastcontact" id="lastcontact-${id}">${lastContact}</td>
          <td class="maint-td maint-td-status">${buildStatusSelect(vehicle.adminContactStatus, id)}</td>
          <td class="maint-td maint-td-notes">${buildNotesInput(vehicle.adminContactNotes, id)}</td>
          <td class="maint-td maint-td-action">
            <button class="primary-button maint-save-btn" data-vehicle-id="${id}" type="button">Guardar</button>
            <p class="maint-row-feedback" id="row-feedback-${id}" aria-live="polite"></p>
          </td>
        </tr>
      `;
    }).join("");

    // Live-update select border color on change
    tableBody.querySelectorAll(".maint-status-select").forEach((sel) => {
      sel.addEventListener("change", () => {
        sel.className = `maint-status-select ${STATUS_CSS[sel.value] || ""}`;
      });
    });

    tableBody.querySelectorAll(".maint-save-btn").forEach((btn) => {
      btn.addEventListener("click", () => handleSave(btn.dataset.vehicleId));
    });
  }

  function filterAndRender() {
    const query = String(searchInput?.value || "").toLowerCase().trim();

    const filtered = query
      ? allVehicles.filter((v) => {
          const name = String(v.user?.name || v.client?.name || "").toLowerCase();
          const plate = String(v.plate || "").toLowerCase();
          const brand = String(v.brand || "").toLowerCase();
          const model = String(v.model || "").toLowerCase();

          return name.includes(query) || plate.includes(query) || brand.includes(query) || model.includes(query);
        })
      : allVehicles;

    if (totalCountEl) {
      totalCountEl.textContent = String(filtered.length);
    }

    renderRows(filtered);
  }

  async function handleSave(vehicleId) {
    const statusEl = document.getElementById(`status-${vehicleId}`);
    const notesEl = document.getElementById(`notes-${vehicleId}`);
    const feedbackEl = document.getElementById(`row-feedback-${vehicleId}`);
    const btn = tableBody.querySelector(`.maint-save-btn[data-vehicle-id="${vehicleId}"]`);

    if (!statusEl || !feedbackEl) {
      return;
    }

    const adminContactStatus = statusEl.value;
    const adminContactNotes = notesEl?.value || "";

    if (btn) {
      btn.disabled = true;
    }

    feedbackEl.textContent = "Guardando...";
    feedbackEl.className = "maint-row-feedback";

    try {
      const result = await fetchJson(`/api/admin/maintenance-vehicles/${encodeURIComponent(vehicleId)}`, {
        method: "PATCH",
        body: JSON.stringify({ adminContactStatus, adminContactNotes }),
        loadingMessage: false,
      });

      // Sync local state
      const idx = allVehicles.findIndex((v) => String(v._id || v.id) === vehicleId);

      if (idx !== -1) {
        allVehicles[idx] = {
          ...allVehicles[idx],
          adminContactStatus: result.vehicle?.adminContactStatus || adminContactStatus,
          adminContactNotes: result.vehicle?.adminContactNotes ?? adminContactNotes,
          adminLastContactAt: result.vehicle?.adminLastContactAt || new Date().toISOString(),
        };
      }

      const lastContactCell = document.getElementById(`lastcontact-${vehicleId}`);

      if (lastContactCell) {
        lastContactCell.textContent = formatDate(new Date().toISOString());
      }

      feedbackEl.textContent = "✓ Guardado";
      feedbackEl.className = "maint-row-feedback maint-row-success";

      window.setTimeout(() => {
        if (feedbackEl) {
          feedbackEl.textContent = "";
          feedbackEl.className = "maint-row-feedback";
        }
      }, 2500);
    } catch (error) {
      feedbackEl.textContent = error.message || "Error al guardar";
      feedbackEl.className = "maint-row-feedback maint-row-error";
    } finally {
      if (btn) {
        btn.disabled = false;
      }
    }
  }

  async function loadPage() {
    await loadAdminSession();
    const data = await fetchJson("/api/admin/maintenance");
    allVehicles = data[config.dataKey] || [];

    if (totalCountEl) {
      totalCountEl.textContent = String(allVehicles.length);
    }

    buildTableHead();
    renderRows(allVehicles);
  }

  if (searchInput) {
    searchInput.addEventListener("input", filterAndRender);
  }

  loadPage().catch((error) => {
    if (pageFeedback) {
      setFeedback(pageFeedback, error.message || "Error al cargar los datos.", "error");
    }
  });
})();
