(() => {
  const {
    attachLogout,
    fetchJson,
    formatDate,
    loadAdminSession,
    setFeedback,
    getCurrentRole,
    getAuthToken,
  } = window.AdminApp || {};

  const BUSINESS_TIMEZONE = "America/Bogota";
  const MAX_PHOTOS = 12;

  function redirectToLogin() {
    window.location.replace("/app/index.html");
  }

  function requireVigilanceAccess() {
    const role = String(getCurrentRole?.() || "");
    const token = getAuthToken?.();
    if (!token || !["vigilance", "admin", "manager"].includes(role)) {
      redirectToLogin();
      return false;
    }
    return true;
  }

  if (!requireVigilanceAccess()) return;

  attachLogout?.();

  const feedback = document.getElementById("vig-feedback");
  const calendarGrid = document.getElementById("vig-calendar-grid");
  const calendarLabel = document.getElementById("vig-cal-label");
  const dayTitle = document.getElementById("vig-day-title");
  const dayCount = document.getElementById("vig-day-count");
  const dayList = document.getElementById("vig-day-list");
  const openReportsEl = document.getElementById("vig-open-reports");
  const entryCard = document.getElementById("vig-entry-card");
  const entryForm = document.getElementById("vig-entry-form");
  const exitCard = document.getElementById("vig-exit-card");
  const exitForm = document.getElementById("vig-exit-form");
  const accessoriesList = document.getElementById("vig-accessories-list");
  const exitAccessoriesList = document.getElementById("vig-exit-accessories-list");
  const exitVehicleInfo = document.getElementById("vig-exit-vehicle-info");
  const exitSummary = document.getElementById("vig-exit-summary");

  let agenda = [];
  let todayKey = "";
  let selectedDayKey = "";
  let openReports = [];
  let accessoryCatalog = [];
  let currentExitReport = null;
  let isDirectExit = false;

  const now = new Date();
  let calendarCursor = { year: now.getUTCFullYear(), month: now.getUTCMonth() };

  const entryPhotos = createPhotoPicker({
    inputId: "vig-entry-photos-input",
    previewsId: "vig-entry-photo-previews",
    maxPhotos: MAX_PHOTOS,
    onLimit: () => setFeedback?.(feedback, `Máximo ${MAX_PHOTOS} fotos.`, "error"),
  });

  const exitPhotos = createPhotoPicker({
    inputId: "vig-exit-photos-input",
    previewsId: "vig-exit-photo-previews",
    maxPhotos: MAX_PHOTOS,
    onLimit: () => setFeedback?.(feedback, `Máximo ${MAX_PHOTOS} fotos.`, "error"),
  });

  const delivererSig = createSignaturePad("vig-deliverer-signature", "vig-clear-deliverer-sig");
  const securitySig = createSignaturePad("vig-security-signature", "vig-clear-security-sig");
  const exitDelivererSig = createSignaturePad("vig-exit-deliverer-signature", "vig-clear-exit-deliverer-sig");
  const exitReceiverSig = createSignaturePad("vig-exit-receiver-signature", "vig-clear-exit-receiver-sig");

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dayKey(value) {
    if (!value) return "";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value || "";
    const y = pick("year");
    const m = pick("month");
    const d = pick("day");
    return y && m && d ? `${y}-${m}-${d}` : "";
  }

  function todayDateInputValue() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const pick = (type) => parts.find((p) => p.type === type)?.value || "";
    return `${pick("year")}-${pick("month")}-${pick("day")}`;
  }

  function currentTimeInputValue() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: BUSINESS_TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour")?.value || "00";
    const min = parts.find((p) => p.type === "minute")?.value || "00";
    return `${h}:${min}`;
  }

  function agendaForDay(key) {
    return agenda.filter((item) => (item.agendaDayKey || "") === key);
  }

  function vehicleLabel(item) {
    if (item.kind === "visitor") {
      const vi = item.vehicleInterest || {};
      const parts = [vi.brand, vi.model, vi.year].filter(Boolean);
      return parts.length ? parts.join(" ") : "Interés vitrina";
    }
    return [item.brand, item.model, item.year].filter(Boolean).join(" ") || "Vehículo";
  }

  function renderAccessoriesInto(container) {
    if (!container) return;
    container.innerHTML = accessoryCatalog.map((item) => `
      <div class="vig-accessory-row" data-accessory-key="${escapeHtml(item.key)}">
        <label>
          <input type="checkbox" class="vig-acc-present" data-key="${escapeHtml(item.key)}" />
          ${escapeHtml(item.label)}
        </label>
        <input type="text" class="vig-acc-note" data-key="${escapeHtml(item.key)}" placeholder="Nota opcional" />
      </div>
    `).join("");
  }

  function renderAccessories() {
    renderAccessoriesInto(accessoriesList);
  }

  function renderExitAccessories() {
    renderAccessoriesInto(exitAccessoriesList);
  }

  function collectAccessoriesFrom(container) {
    return accessoryCatalog.map((item) => {
      const present = container?.querySelector(`.vig-acc-present[data-key="${item.key}"]`)?.checked || false;
      const note = container?.querySelector(`.vig-acc-note[data-key="${item.key}"]`)?.value?.trim() || "";
      return { key: item.key, label: item.label, present, note };
    });
  }

  function collectAccessories() {
    return collectAccessoriesFrom(accessoriesList);
  }

  function collectDocumentsFrom(form) {
    return Array.from(form?.querySelectorAll('input[name="doc"]:checked') || [])
      .map((input) => input.value)
      .filter(Boolean);
  }

  function collectDocuments() {
    return collectDocumentsFrom(entryForm);
  }

  function fillExitVehicleFields(vehicle = {}) {
    if (!exitForm) return;
    const set = (name, value) => {
      const input = exitForm.querySelector(`[name="${name}"]`);
      if (input) input.value = value || "";
    };
    set("plate", vehicle.plate || "");
    set("vin", vehicle.vin || "");
    set("brand", vehicle.brand || "");
    set("model", vehicle.model || "");
    set("year", vehicle.year || "");
    set("color", vehicle.color || "");
    set("version", vehicle.version || "");
    set("mileage", vehicle.mileage == null ? "" : String(vehicle.mileage));
  }

  function applyCheckedDocs(form, docs = []) {
    const selected = new Set((docs || []).map((item) => String(item)));
    form?.querySelectorAll('input[name="doc"]').forEach((input) => {
      input.checked = selected.has(input.value);
    });
  }

  function applyAccessories(container, accessories = []) {
    const byKey = new Map((accessories || []).map((item) => [item.key, item]));
    accessoryCatalog.forEach((item) => {
      const saved = byKey.get(item.key);
      const present = container?.querySelector(`.vig-acc-present[data-key="${item.key}"]`);
      const note = container?.querySelector(`.vig-acc-note[data-key="${item.key}"]`);
      if (present) present.checked = Boolean(saved?.present);
      if (note) note.value = saved?.note || "";
    });
  }

  function renderDayList(key) {
    selectedDayKey = key || selectedDayKey || todayKey;
    const items = agendaForDay(selectedDayKey);

    if (dayTitle) {
      dayTitle.textContent = selectedDayKey === todayKey
        ? "Agenda de hoy"
        : `Agenda del ${formatDate?.(`${selectedDayKey}T12:00:00`) || selectedDayKey}`;
    }
    if (dayCount) dayCount.textContent = String(items.length);
    if (!dayList) return;

    if (!items.length) {
      dayList.innerHTML = `<div class="vig-empty">No hay citas ni visitas para este día.</div>`;
      return;
    }

    dayList.innerHTML = items.map((item) => {
      if (item.kind === "visitor") {
        const vi = item.vehicleInterest || {};
        const interest = [vi.brand, vi.model].filter(Boolean).join(" ");
        return `
          <div class="vig-agenda-item">
            <strong>${escapeHtml(item.visitorName || "Visitante")}</strong>
            <span>${item.visitTime ? `Hora ${escapeHtml(item.visitTime)}` : "Sin hora"}${interest ? ` · ${escapeHtml(interest)}` : ""}</span>
            <span>${escapeHtml(item.purpose === "showroom" ? "Visita vitrina" : item.purpose || "")}</span>
            <span class="vig-badge vig-badge-visitor">Visitante vitrina</span>
          </div>
        `;
      }
      return `
        <div class="vig-agenda-item">
          <strong>${escapeHtml(vehicleLabel(item))}</strong>
          <span>Cliente ${escapeHtml(item.clientName || "—")}</span>
          <span>${escapeHtml(item.version || "Sin versión")} · Placa ${escapeHtml(item.plate || "—")}</span>
          <span>${item.appointmentTime ? `Hora ${escapeHtml(item.appointmentTime)}` : "Sin hora asignada"}</span>
          <span class="vig-badge vig-badge-maintenance">Mantenimiento</span>
        </div>
      `;
    }).join("");
  }

  function renderCalendar() {
    if (!calendarGrid || !calendarLabel) return;
    const { year, month } = calendarCursor;
    const first = new Date(Date.UTC(year, month, 1));
    const startWeekday = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthLabel = first.toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
    calendarLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    const counts = new Map();
    agenda.forEach((item) => {
      const key = item.agendaDayKey || "";
      if (!key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const cells = [];
    for (let i = 0; i < startWeekday; i += 1) {
      cells.push(`<div class="vig-day is-muted"></div>`);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const count = counts.get(key) || 0;
      const classes = ["vig-day"];
      if (key === selectedDayKey) classes.push("is-active");
      if (key === todayKey) classes.push("is-today");
      cells.push(`
        <button class="${classes.join(" ")}" type="button" data-day="${key}">
          <span class="vig-day-number">${day}</span>
          <span class="vig-day-count" ${count ? "" : 'hidden aria-hidden="true"'}>${count || ""}</span>
        </button>
      `);
    }
    calendarGrid.innerHTML = cells.join("");
    calendarGrid.querySelectorAll("button[data-day]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedDayKey = button.dataset.day || selectedDayKey;
        renderCalendar();
        renderDayList(selectedDayKey);
      });
    });
  }

  function renderOpenReports() {
    if (!openReportsEl) return;
    if (!openReports.length) {
      openReportsEl.innerHTML = `<div class="vig-empty">No hay ingresos abiertos en este momento.</div>`;
      return;
    }
    openReportsEl.innerHTML = openReports.map((report) => {
      const v = report.vehicle || {};
      const title = [v.brand, v.model, v.year].filter(Boolean).join(" ") || "Vehículo";
      const entryLabel = report.entryTime
        ? `${formatDate?.(report.entryDate) || "—"} · ${escapeHtml(report.entryTime)}`
        : formatDate?.(report.entryDate) || "—";
      return `
        <button class="vig-open-item" type="button" data-report-id="${escapeHtml(report.id)}">
          <strong>${escapeHtml(title)} · ${escapeHtml(v.plate || "—")}</strong>
          <span>${escapeHtml(report.entryNumber || "")} · Ingreso ${entryLabel}</span>
          <span>Turno ${escapeHtml(shiftLabel(report.shift))}</span>
        </button>
      `;
    }).join("");

    openReportsEl.querySelectorAll("button[data-report-id]").forEach((button) => {
      button.addEventListener("click", () => openExitForm(button.dataset.reportId));
    });
  }

  function shiftLabel(value) {
    if (value === "morning") return "Mañana";
    if (value === "afternoon") return "Tarde";
    if (value === "night") return "Noche";
    return value || "—";
  }

  function hideForms() {
    if (entryCard) entryCard.hidden = true;
    if (exitCard) exitCard.hidden = true;
    currentExitReport = null;
    isDirectExit = false;
  }

  function resetExitFormBase() {
    if (exitForm) exitForm.reset();
    exitPhotos.reset();
    exitDelivererSig.clear();
    exitReceiverSig.clear();
    renderExitAccessories();

    const exitDate = document.getElementById("vig-exit-date");
    const exitTime = document.getElementById("vig-exit-time");
    if (exitDate) exitDate.value = todayDateInputValue();
    if (exitTime) exitTime.value = currentTimeInputValue();
  }

  function showExitCard() {
    if (exitCard) {
      exitCard.hidden = false;
      exitCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function openEntryForm() {
    hideForms();
    if (entryForm) entryForm.reset();
    entryPhotos.reset();
    delivererSig.clear();
    securitySig.clear();
    renderAccessories();

    const dateInput = document.getElementById("vig-entry-date");
    const timeInput = document.getElementById("vig-entry-time");
    if (dateInput) dateInput.value = todayDateInputValue();
    if (timeInput) timeInput.value = currentTimeInputValue();

    if (entryCard) {
      entryCard.hidden = false;
      entryCard.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setFeedback?.(feedback, "Completa el acta de ingreso.", "");
  }

  function openDirectExitForm() {
    hideForms();
    isDirectExit = true;
    currentExitReport = null;
    resetExitFormBase();

    if (exitVehicleInfo) {
      exitVehicleInfo.hidden = true;
      exitVehicleInfo.innerHTML = "";
    }
    if (exitSummary) {
      exitSummary.textContent = "Completa el acta de salida del vehículo";
    }

    const towRadio = exitForm?.querySelector('input[name="departureMethod"][value="tow"]');
    if (towRadio) towRadio.checked = true;

    showExitCard();
    setFeedback?.(feedback, "Completa el acta de salida.", "");
  }

  function openExitForm(reportId) {
    const report = openReports.find((item) => item.id === reportId);
    if (!report) return;

    hideForms();
    currentExitReport = report;
    isDirectExit = false;
    resetExitFormBase();

    const v = report.vehicle || {};
    const title = [v.brand, v.model, v.year].filter(Boolean).join(" ") || "Vehículo";
    fillExitVehicleFields(v);
    applyCheckedDocs(exitForm, report.documentsReceived);
    applyAccessories(exitAccessoriesList, report.accessories);

    if (report.shift) {
      const shiftRadio = exitForm?.querySelector(`input[name="shift"][value="${report.shift}"]`);
      if (shiftRadio) shiftRadio.checked = true;
    }

    if (exitVehicleInfo) {
      exitVehicleInfo.hidden = false;
      exitVehicleInfo.innerHTML = `
        <strong>${escapeHtml(title)} · Placa ${escapeHtml(v.plate || "—")}</strong>
        <span>${escapeHtml(report.entryNumber || "")} · Ingreso ${formatDate?.(report.entryDate) || "—"}${report.entryTime ? ` ${escapeHtml(report.entryTime)}` : ""}</span>
        <span>VIN ${escapeHtml(v.vin || "—")} · ${escapeHtml(v.color || "—")}</span>
      `;
    }
    if (exitSummary) {
      exitSummary.textContent = "Completa el acta de salida del vehículo";
    }

    showExitCard();
    setFeedback?.(feedback, "Registra la salida del vehículo.", "");
  }

  function getFormValue(form, name) {
    return form?.querySelector(`[name="${name}"]`)?.value?.trim() || "";
  }

  function getRadioValue(form, name) {
    return form?.querySelector(`input[name="${name}"]:checked`)?.value || "";
  }

  async function saveEntry() {
    if (!entryForm?.reportValidity()) return;

    const delivererName = getFormValue(entryForm, "delivererName");
    const securityName = getFormValue(entryForm, "securityName");
    if (!delivererName || !securityName) {
      setFeedback?.(feedback, "Indica quien entrega y quien recibe (seguridad).", "error");
      return;
    }

    if (delivererSig.isBlank() || securitySig.isBlank()) {
      setFeedback?.(feedback, "Se requieren ambas firmas de ingreso.", "error");
      return;
    }

    const formData = new FormData();
    formData.append("plate", getFormValue(entryForm, "plate").toUpperCase());
    formData.append("brand", getFormValue(entryForm, "brand"));
    formData.append("model", getFormValue(entryForm, "model"));
    formData.append("year", getFormValue(entryForm, "year"));
    formData.append("color", getFormValue(entryForm, "color"));
    formData.append("version", getFormValue(entryForm, "version"));
    formData.append("vin", getFormValue(entryForm, "vin").toUpperCase());
    formData.append("mileage", getFormValue(entryForm, "mileage"));
    formData.append("arrivalMethod", getRadioValue(entryForm, "arrivalMethod"));
    formData.append("entryDate", getFormValue(entryForm, "entryDate"));
    formData.append("entryTime", getFormValue(entryForm, "entryTime"));
    formData.append("shift", getRadioValue(entryForm, "shift"));
    formData.append("documentsReceived", JSON.stringify(collectDocuments()));
    formData.append("accessories", JSON.stringify(collectAccessories()));
    formData.append("entryObservations", getFormValue(entryForm, "entryObservations"));
    formData.append("generalObservations", getFormValue(entryForm, "generalObservations"));
    formData.append("delivererName", delivererName);
    formData.append("delivererDocument", getFormValue(entryForm, "delivererDocument"));
    formData.append("delivererPhone", getFormValue(entryForm, "delivererPhone"));
    formData.append("delivererRelationship", getRadioValue(entryForm, "delivererRelationship"));
    formData.append("delivererSignatureDataUrl", delivererSig.toDataURL());
    formData.append("securityName", securityName);
    formData.append("securityDocument", getFormValue(entryForm, "securityDocument"));
    formData.append("securitySignatureDataUrl", securitySig.toDataURL());
    entryPhotos.files.forEach((file) => formData.append("photos", file));

    try {
      const result = await fetchJson("/api/vigilance/gate-reports/entry", {
        method: "POST",
        body: formData,
        loadingMessage: "Guardando ingreso…",
      });
      if (result.report) {
        openReports = [result.report, ...openReports.filter((r) => r.id !== result.report.id)];
      }
      hideForms();
      renderOpenReports();
      setFeedback?.(feedback, result.message || "Ingreso registrado.", "success");
      await loadOverview(false);
    } catch (error) {
      setFeedback?.(feedback, error.message, "error");
    }
  }

  function appendExitFormData(formData) {
    formData.append("plate", getFormValue(exitForm, "plate").toUpperCase());
    formData.append("vin", getFormValue(exitForm, "vin").toUpperCase());
    formData.append("brand", getFormValue(exitForm, "brand"));
    formData.append("model", getFormValue(exitForm, "model"));
    formData.append("year", getFormValue(exitForm, "year"));
    formData.append("color", getFormValue(exitForm, "color"));
    formData.append("version", getFormValue(exitForm, "version"));
    formData.append("mileage", getFormValue(exitForm, "mileage"));
    formData.append("exitDate", getFormValue(exitForm, "exitDate"));
    formData.append("exitTime", getFormValue(exitForm, "exitTime"));
    formData.append("shift", getRadioValue(exitForm, "shift"));
    formData.append("departureMethod", getRadioValue(exitForm, "departureMethod"));
    formData.append("documentsReceived", JSON.stringify(collectDocumentsFrom(exitForm)));
    formData.append("accessories", JSON.stringify(collectAccessoriesFrom(exitAccessoriesList)));
    formData.append("exitObservations", getFormValue(exitForm, "exitObservations"));
    formData.append("generalObservations", getFormValue(exitForm, "generalObservations"));
    formData.append("exitDelivererName", getFormValue(exitForm, "exitDelivererName"));
    formData.append("exitDelivererDocument", getFormValue(exitForm, "exitDelivererDocument"));
    formData.append("exitDelivererPhone", getFormValue(exitForm, "exitDelivererPhone"));
    formData.append("exitDelivererRelationship", getRadioValue(exitForm, "exitDelivererRelationship"));
    formData.append("exitDelivererSignatureDataUrl", exitDelivererSig.toDataURL());
    formData.append("exitReceiverName", getFormValue(exitForm, "exitReceiverName"));
    formData.append("exitReceiverDocument", getFormValue(exitForm, "exitReceiverDocument"));
    formData.append("exitReceiverSignatureDataUrl", exitReceiverSig.toDataURL());
    exitPhotos.files.forEach((file) => formData.append("photos", file));
  }

  async function saveExit() {
    if ((!currentExitReport && !isDirectExit) || !exitForm?.reportValidity()) return;

    const exitDelivererName = getFormValue(exitForm, "exitDelivererName");
    const exitReceiverName = getFormValue(exitForm, "exitReceiverName");
    if (!exitDelivererName || !exitReceiverName) {
      setFeedback?.(feedback, "Indica responsables de entrega y recepción en salida.", "error");
      return;
    }

    if (exitDelivererSig.isBlank() || exitReceiverSig.isBlank()) {
      setFeedback?.(feedback, "Se requieren ambas firmas de salida.", "error");
      return;
    }

    const formData = new FormData();
    appendExitFormData(formData);

    try {
      let result;
      if (isDirectExit || !currentExitReport) {
        result = await fetchJson("/api/vigilance/gate-reports/direct-exit", {
          method: "POST",
          body: formData,
          loadingMessage: "Registrando salida…",
        });
      } else {
        result = await fetchJson(
          `/api/vigilance/gate-reports/${encodeURIComponent(currentExitReport.id)}/exit`,
          {
            method: "POST",
            body: formData,
            loadingMessage: "Registrando salida…",
          }
        );
        openReports = openReports.filter((r) => r.id !== currentExitReport.id);
      }
      hideForms();
      renderOpenReports();
      setFeedback?.(feedback, result.message || "Salida registrada.", "success");
      await loadOverview(false);
    } catch (error) {
      setFeedback?.(feedback, error.message, "error");
    }
  }

  async function loadOverview(showLoader = true) {
    const data = await fetchJson("/api/vigilance/overview", {
      loadingMessage: showLoader ? "Cargando portal…" : false,
    });
    todayKey = data.todayKey || todayDateInputValue();
    agenda = Array.isArray(data.agenda) ? data.agenda : [];
    openReports = Array.isArray(data.openReports) ? data.openReports : [];
    accessoryCatalog = Array.isArray(data.accessoryCatalog) ? data.accessoryCatalog : [];
    selectedDayKey = selectedDayKey || todayKey;

    const [yearPart, monthPart] = todayKey.split("-").map(Number);
    if (Number.isFinite(yearPart) && Number.isFinite(monthPart)) {
      calendarCursor = { year: yearPart, month: monthPart - 1 };
    }

    renderAccessories();
    renderCalendar();
    renderDayList(selectedDayKey);
    renderOpenReports();
  }

  function createPhotoPicker({ inputId, previewsId, maxPhotos, onLimit }) {
    let files = [];
    let busy = false;

    function fileKey(file) {
      return `${String(file?.name || "").trim().toLowerCase()}|${Number(file?.size || 0)}`;
    }

    function revokeUrls() {
      document.querySelectorAll(`#${previewsId} img[data-object-url]`).forEach((img) => {
        const url = img.getAttribute("data-object-url");
        if (url) URL.revokeObjectURL(url);
      });
    }

    function syncInput() {
      const input = document.getElementById(inputId);
      if (!input) return;
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
    }

    function render() {
      const wrap = document.getElementById(previewsId);
      if (!wrap) return;
      revokeUrls();
      wrap.innerHTML = files.map((file, index) => {
        const url = URL.createObjectURL(file);
        return `
          <div class="vig-photo-thumb">
            <img src="${url}" alt="${escapeHtml(file.name || `Foto ${index + 1}`)}" data-object-url="${url}" />
            <button class="vig-photo-remove" type="button" data-photo-index="${index}" aria-label="Quitar foto">×</button>
          </div>
        `;
      }).join("");

      wrap.querySelectorAll("button[data-photo-index]").forEach((button) => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.photoIndex);
          if (!Number.isFinite(index)) return;
          files = files.filter((_, i) => i !== index);
          syncInput();
          render();
        });
      });
    }

    function bind() {
      const input = document.getElementById(inputId);
      if (!input || input.dataset.bound === "true") return;
      input.dataset.bound = "true";

      input.addEventListener("change", () => {
        if (busy) return;
        busy = true;
        try {
          const incoming = Array.from(input.files || []);
          if (!incoming.length) return;
          const known = new Set(files.map(fileKey));
          let skippedLimit = false;
          incoming.forEach((file) => {
            if (files.length >= maxPhotos) {
              skippedLimit = true;
              return;
            }
            const key = fileKey(file);
            if (known.has(key)) return;
            known.add(key);
            files.push(file);
          });
          files = files.slice(0, maxPhotos);
          syncInput();
          render();
          if (skippedLimit) onLimit?.();
        } finally {
          busy = false;
        }
      });
    }

    return {
      get files() { return files; },
      reset() {
        files = [];
        busy = false;
        const wrap = document.getElementById(previewsId);
        if (wrap) wrap.innerHTML = "";
        const input = document.getElementById(inputId);
        if (input) input.value = "";
        bind();
      },
    };
  }

  function createSignaturePad(canvasId, clearButtonId) {
    let drawing = false;
    let bound = false;

    function getCanvas() {
      return document.getElementById(canvasId);
    }

    function clear() {
      const canvas = getCanvas();
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawing = false;
    }

    function isBlank() {
      const canvas = getCanvas();
      if (!canvas) return true;
      const ctx = canvas.getContext("2d");
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) return false;
      }
      return true;
    }

    function toDataURL() {
      const canvas = getCanvas();
      return canvas && !isBlank() ? canvas.toDataURL("image/png") : "";
    }

    function bind() {
      if (bound) return;
      const canvas = getCanvas();
      if (!canvas) return;
      bound = true;
      clear();

      const ctx = canvas.getContext("2d");
      const pointFromEvent = (event) => {
        const rect = canvas.getBoundingClientRect();
        const source = event.touches?.[0] || event;
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (source.clientX - rect.left) * scaleX,
          y: (source.clientY - rect.top) * scaleY,
        };
      };

      const startDraw = (event) => {
        event.preventDefault();
        drawing = true;
        const point = pointFromEvent(event);
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
      };
      const moveDraw = (event) => {
        if (!drawing) return;
        event.preventDefault();
        const point = pointFromEvent(event);
        ctx.lineWidth = 2.8;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#111111";
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      };
      const endDraw = () => { drawing = false; };

      canvas.addEventListener("mousedown", startDraw);
      canvas.addEventListener("mousemove", moveDraw);
      canvas.addEventListener("mouseup", endDraw);
      canvas.addEventListener("mouseleave", endDraw);
      canvas.addEventListener("touchstart", startDraw, { passive: false });
      canvas.addEventListener("touchmove", moveDraw, { passive: false });
      canvas.addEventListener("touchend", endDraw);

      document.getElementById(clearButtonId)?.addEventListener("click", clear);
    }

    bind();

    return { clear, isBlank, toDataURL, bind };
  }

  document.getElementById("vig-scroll-agenda")?.addEventListener("click", () => {
    document.getElementById("vig-agenda-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("vig-new-entry")?.addEventListener("click", openEntryForm);
  document.getElementById("vig-new-exit")?.addEventListener("click", openDirectExitForm);
  document.getElementById("vig-close-entry")?.addEventListener("click", hideForms);
  document.getElementById("vig-close-exit")?.addEventListener("click", hideForms);
  document.getElementById("vig-save-entry")?.addEventListener("click", () => {
    saveEntry().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  document.getElementById("vig-save-exit")?.addEventListener("click", () => {
    saveExit().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  document.getElementById("vig-cal-prev")?.addEventListener("click", () => {
    calendarCursor.month -= 1;
    if (calendarCursor.month < 0) {
      calendarCursor.month = 11;
      calendarCursor.year -= 1;
    }
    renderCalendar();
  });
  document.getElementById("vig-cal-next")?.addEventListener("click", () => {
    calendarCursor.month += 1;
    if (calendarCursor.month > 11) {
      calendarCursor.month = 0;
      calendarCursor.year += 1;
    }
    renderCalendar();
  });

  loadAdminSession("vig-user-name", "vig-user-email").catch(() => {});
  loadOverview().catch((error) => setFeedback?.(feedback, error.message, "error"));
})();
