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

  function redirectToLogin() {
    window.location.replace("/app/index.html");
  }

  function requireMechanicAccess() {
    const role = String(getCurrentRole?.() || "");
    const token = getAuthToken?.();
    if (!token || !["mechanic", "admin", "manager"].includes(role)) {
      redirectToLogin();
      return false;
    }
    return true;
  }

  if (!requireMechanicAccess()) {
    return;
  }

  attachLogout?.();

  const feedback = document.getElementById("mech-feedback");
  const calendarGrid = document.getElementById("mech-calendar-grid");
  const calendarLabel = document.getElementById("mech-cal-label");
  const dayTitle = document.getElementById("mech-day-title");
  const dayCount = document.getElementById("mech-day-count");
  const dayList = document.getElementById("mech-day-list");
  const openOrderButton = document.getElementById("mech-open-order");
  const orderModal = document.getElementById("mech-order-modal");
  const orderOverlay = document.getElementById("mech-order-overlay");
  const orderClose = document.getElementById("mech-order-close");
  const todayPickList = document.getElementById("mech-today-pick-list");
  const showWalkinButton = document.getElementById("mech-show-walkin");
  const walkinForm = document.getElementById("mech-walkin-form");
  const diagnosisCard = document.getElementById("mech-diagnosis-card");
  const diagnosisForm = document.getElementById("mech-diagnosis-form");
  const orderSummary = document.getElementById("mech-order-summary");
  const saveDiagnosisButton = document.getElementById("mech-save-diagnosis");
  const userNameEl = document.getElementById("mech-user-name");
  const userEmailEl = document.getElementById("mech-user-email");
  const confirmModal = document.getElementById("mech-confirm-modal");
  const confirmOverlay = document.getElementById("mech-confirm-overlay");
  const confirmClose = document.getElementById("mech-confirm-close");
  const confirmCancel = document.getElementById("mech-confirm-cancel");
  const confirmSubmit = document.getElementById("mech-confirm-submit");
  const confirmText = document.getElementById("mech-confirm-text");
  const confirmFeedback = document.getElementById("mech-confirm-feedback");
  const confirmEmailHint = document.getElementById("mech-confirm-email-hint");
  const emailCheckbox = document.getElementById("mech-email-checkbox");
  const marketingCheckbox = document.getElementById("mech-marketing-checkbox");
  const successModal = document.getElementById("mech-success-modal");
  const successOverlay = document.getElementById("mech-success-overlay");
  const successClose = document.getElementById("mech-success-close");
  const successOk = document.getElementById("mech-success-ok");
  const successPrint = document.getElementById("mech-success-print");
  const successText = document.getElementById("mech-success-text");

  let appointments = [];
  let todayAppointments = [];
  let openOrders = [];
  let todayKey = "";
  let selectedDayKey = "";
  let currentOrder = null;
  let latestPdfUrl = "";
  let mechanicDefaults = { fullName: "", signatureUrl: "" };
  let selectedPhotoFiles = [];
  let keptExistingPhotos = [];
  let photoPickerBusy = false;
  let signatureState = {
    drawing: false,
    dirty: false,
    usingSavedUrl: false,
  };
  const now = new Date();
  let calendarCursor = { year: now.getUTCFullYear(), month: now.getUTCMonth() };

  const QUESTIONS = [
    { section: "Estado general", key: "leaks", label: "¿El vehículo presenta fugas de aceite, refrigerante o líquidos?", options: [
      ["no", "✅ No"], ["leve", "🟡 Leve"], ["si", "🔴 Sí"],
    ] },
    { section: "Estado general", key: "faultCodes", label: "¿Se detectaron testigos o códigos de falla en el tablero?", options: [
      ["no", "✅ No"], ["menores", "🟡 Sí (menores)"], ["importantes", "🔴 Sí (importantes)"],
    ] },
    { section: "Estado general", key: "engine", label: "¿El motor funciona correctamente? (ralentí, vibraciones, ruidos, humo)", options: [
      ["excelente", "🟢 Excelente"], ["revision", "🟡 Requiere revisión"], ["deficiente", "🔴 Deficiente"],
    ] },
    { section: "Estado general", key: "brakes", label: "¿El sistema de frenos se encuentra en buen estado?", options: [
      ["excelente", "🟢 Excelente"], ["proximo", "🟡 Próximo mantenimiento"], ["inmediato", "🔴 Cambio inmediato"],
    ] },
    { section: "Estado general", key: "suspension", label: "¿La suspensión y dirección presentan holguras o ruidos?", options: [
      ["no", "✅ No"], ["leves", "🟡 Leves"], ["si", "🔴 Sí"],
    ] },
    { section: "Inspección preventiva", key: "battery", label: "Estado de la batería y sistema de carga", options: [
      ["correcto", "🟢 Correcto"], ["bajo", "🟡 Bajo rendimiento"], ["reemplazar", "🔴 Reemplazar"],
    ] },
    { section: "Inspección preventiva", key: "tires", label: "Estado de las llantas", options: [
      ["bueno", "🟢 Buen desgaste"], ["medio", "🟡 Desgaste medio"], ["cambio", "🔴 Cambio recomendado"],
    ] },
    { section: "Inspección preventiva", key: "cooling", label: "Estado del sistema de refrigeración", options: [
      ["correcto", "🟢 Correcto"], ["mantenimiento", "🟡 Requiere mantenimiento"], ["falla", "🔴 Fuga o falla"],
    ] },
    { section: "Inspección preventiva", key: "wearComponents", label: "¿Se encontraron componentes con desgaste próximo a reemplazo?", options: [
      ["no", "✅ No"], ["preventivo", "🟡 Sí (preventivo)"], ["urgente", "🔴 Sí (urgente)"],
    ] },
    { section: "Inspección preventiva", key: "oxidation", label: "¿Grado de oxidación del vehículo en parte inferior y chasis?", options: [
      ["bajo", "✅ Bajo"], ["leves", "🟡 Leves"], ["importantes", "🔴 Importantes"],
    ] },
    { section: "Recomendaciones del técnico", key: "nextService", label: "Próximo mantenimiento recomendado", options: [
      ["5000", "En 5.000 km"], ["10000", "En 10.000 km"], ["before5000", "Revisar antes de 5.000 km"],
    ] },
    { section: "Recomendaciones del técnico", key: "overallState", label: "Estado general del vehículo", options: [
      ["excelente", "🟢 Excelente"], ["bueno", "🟡 Bueno"], ["regular", "🟠 Regular"], ["reparacion", "🔴 Requiere reparación"],
    ] },
    { section: "Recomendaciones del técnico", key: "bodyDamage", label: "¿Se encontraron rayones o golpes en la carrocería?", options: [
      ["no", "🟢 No"], ["leves", "🟡 Leves"], ["si", "🔴 Sí"],
    ] },
  ];

  const COMPLEMENTARY = [
    "Alineación", "Balanceo", "Cambio líquido de frenos", "Cambio refrigerante",
    "Limpieza de inyectores", "Limpieza cuerpo de aceleración", "Rotación de llantas",
    "Pastillas de frenos", "Ninguno",
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const BUSINESS_TIMEZONE = "America/Bogota";

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
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    return year && month && day ? `${year}-${month}-${day}` : "";
  }

  function orderDayKey(order) {
    if (order?.agendaDayKey) return order.agendaDayKey;
    if (order?.sourceType === "walk_in") return dayKey(order.createdAt || order.appointmentDate);
    return dayKey(order?.appointmentDate || order?.createdAt);
  }

  function appointmentDayKey(item) {
    return item?.agendaDayKey || dayKey(item?.appointmentDate);
  }

  function vehicleTitle(item) {
    const vehicle = item.vehicle || item;
    return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Vehículo";
  }

  function appointmentsForDay(key) {
    return appointments.filter((item) => appointmentDayKey(item) === key);
  }

  function ordersForDay(key) {
    return openOrders.filter((item) => orderDayKey(item) === key);
  }

  function statusLabel(status) {
    if (status === "diagnosis_saved") return "Diagnóstico guardado";
    if (status === "closed") return "Cerrada";
    return "Orden abierta";
  }

  function upsertOpenOrder(order) {
    if (!order?.id) return;
    const next = openOrders.filter((item) => item.id !== order.id);
    next.unshift(order);
    openOrders = next;
  }

  function renderDayList(key) {
    selectedDayKey = key || selectedDayKey || todayKey;
    const dayAppointments = appointmentsForDay(selectedDayKey);
    const dayOrders = ordersForDay(selectedDayKey);
    const total = dayAppointments.length + dayOrders.length;

    if (dayTitle) {
      dayTitle.textContent = selectedDayKey === todayKey
        ? "Agenda de hoy"
        : `Agenda del ${formatDate?.(`${selectedDayKey}T12:00:00`) || selectedDayKey}`;
    }
    if (dayCount) dayCount.textContent = String(total);
    if (!dayList) return;

    if (!total) {
      dayList.innerHTML = `<div class="mech-empty">No hay citas ni órdenes para este día.<br/>Toca otro día o abre una orden nueva.</div>`;
      return;
    }

    const parts = [];

    if (dayOrders.length) {
      parts.push(`<p class="mech-list-label">Órdenes del taller</p>`);
      parts.push(dayOrders.map((order) => {
        const v = order.vehicle || {};
        const c = order.client || {};
        const active = currentOrder?.id === order.id ? " is-active-order" : "";
        return `
          <button class="mech-vehicle-card is-order${active}" type="button" data-order-id="${escapeHtml(order.id)}">
            <strong>${escapeHtml(vehicleTitle(order))}</strong>
            <span>Placa ${escapeHtml(v.plate || "—")} · ${escapeHtml(order.orderNumber || "")}</span>
            <span>${escapeHtml(c.name || "Sin cliente")}${c.phone ? ` · ${escapeHtml(c.phone)}` : ""}</span>
            <span class="mech-status-pill">${escapeHtml(statusLabel(order.status))}</span>
          </button>
        `;
      }).join(""));
    }

    if (dayAppointments.length) {
      parts.push(`<p class="mech-list-label">Citas programadas</p>`);
      parts.push(dayAppointments.map((item) => `
        <button class="mech-vehicle-card" type="button" data-source-id="${escapeHtml(item.id)}" data-record-type="${escapeHtml(item.recordType)}">
          <strong>${escapeHtml(vehicleTitle(item))}</strong>
          <span>${escapeHtml(item.version || "Sin versión")} · Placa ${escapeHtml(item.plate || "—")}</span>
          <span>${item.appointmentTime ? `Hora ${escapeHtml(item.appointmentTime)}` : "Sin hora asignada"}</span>
          <span class="mech-status-pill">Abrir orden</span>
        </button>
      `).join(""));
    }

    dayList.innerHTML = parts.join("");
    dayList.querySelectorAll("button[data-order-id]").forEach((button) => {
      button.addEventListener("click", () => {
        openExistingOrder(button.dataset.orderId)
          .catch((error) => setFeedback?.(feedback, error.message, "error"));
      });
    });
    dayList.querySelectorAll("button[data-source-id]").forEach((button) => {
      button.addEventListener("click", () => {
        createOrderFromAppointment(button.dataset.sourceId, button.dataset.recordType)
          .catch((error) => setFeedback?.(feedback, error.message, "error"));
      });
    });
  }

  function renderCalendar() {
    if (!calendarGrid || !calendarLabel) return;
    const year = calendarCursor.year;
    const month = calendarCursor.month;
    const first = new Date(Date.UTC(year, month, 1));
    const startWeekday = first.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const monthLabel = first.toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
    calendarLabel.textContent = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

    const counts = new Map();
    appointments.forEach((item) => {
      const key = appointmentDayKey(item);
      if (!key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    openOrders.forEach((item) => {
      const key = orderDayKey(item);
      if (!key || !key.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const cells = [];
    for (let i = 0; i < startWeekday; i += 1) {
      cells.push(`<div class="mech-day is-muted"></div>`);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const count = counts.get(key) || 0;
      const classes = ["mech-day"];
      if (key === selectedDayKey) classes.push("is-active");
      if (key === todayKey) classes.push("is-today");
      cells.push(`
        <button class="${classes.join(" ")}" type="button" data-day="${key}">
          <span class="mech-day-number">${day}</span>
          <span class="mech-day-count" ${count ? "" : 'hidden aria-hidden="true"'}>${count || ""}</span>
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

  function openOrderModal() {
    if (orderModal) orderModal.hidden = false;
    if (walkinForm) walkinForm.hidden = true;
    if (!todayPickList) return;

    const todayOrders = ordersForDay(todayKey);
    const parts = [];

    if (todayOrders.length) {
      parts.push(`<p class="mech-list-label">Órdenes abiertas de hoy</p>`);
      parts.push(todayOrders.map((order) => {
        const v = order.vehicle || {};
        return `
          <button class="mech-vehicle-card is-order" type="button" data-order-id="${escapeHtml(order.id)}">
            <strong>${escapeHtml(vehicleTitle(order))}</strong>
            <span>Placa ${escapeHtml(v.plate || "—")} · ${escapeHtml(order.orderNumber || "")}</span>
            <span class="mech-status-pill">${escapeHtml(statusLabel(order.status))}</span>
          </button>
        `;
      }).join(""));
    }

    if (todayAppointments.length) {
      parts.push(`<p class="mech-list-label">Citas de hoy</p>`);
      parts.push(todayAppointments.map((item) => `
        <button class="mech-vehicle-card" type="button" data-source-id="${escapeHtml(item.id)}" data-record-type="${escapeHtml(item.recordType)}">
          <strong>${escapeHtml(vehicleTitle(item))}</strong>
          <span>${escapeHtml(item.version || "Sin versión")} · Placa ${escapeHtml(item.plate || "—")}</span>
          <span>${item.appointmentTime ? `Hora ${escapeHtml(item.appointmentTime)}` : "Sin hora"}</span>
        </button>
      `).join(""));
    }

    if (!parts.length) {
      todayPickList.innerHTML = `<div class="mech-empty">No hay citas agendadas para hoy.<br/>Usa “Agregar vehículo nuevo”.</div>`;
      return;
    }

    todayPickList.innerHTML = parts.join("");
    todayPickList.querySelectorAll("button[data-order-id]").forEach((button) => {
      button.addEventListener("click", () => {
        openExistingOrder(button.dataset.orderId)
          .then(() => closeOrderModal())
          .catch((error) => setFeedback?.(feedback, error.message, "error"));
      });
    });
    todayPickList.querySelectorAll("button[data-source-id]").forEach((button) => {
      button.addEventListener("click", () => {
        createOrderFromAppointment(button.dataset.sourceId, button.dataset.recordType)
          .catch((error) => setFeedback?.(feedback, error.message, "error"));
      });
    });
  }

  function closeOrderModal() {
    if (orderModal) orderModal.hidden = true;
  }

  async function openExistingOrder(orderId) {
    const cached = openOrders.find((item) => item.id === orderId);
    if (cached) {
      currentOrder = cached;
      renderDiagnosisForm();
      renderDayList(selectedDayKey);
      setFeedback?.(feedback, "Orden lista para editar o continuar el diagnóstico.", "success");
      return;
    }
    const result = await fetchJson(`/api/mechanic/orders/${encodeURIComponent(orderId)}`);
    currentOrder = result.order;
    upsertOpenOrder(currentOrder);
    renderDiagnosisForm();
    renderCalendar();
    renderDayList(selectedDayKey);
    setFeedback?.(feedback, "Orden lista para editar o continuar el diagnóstico.", "success");
  }

  async function createOrderFromAppointment(sourceId, recordType) {
    const result = await fetchJson("/api/mechanic/orders", {
      method: "POST",
      body: JSON.stringify({ mode: "appointment", sourceId, recordType }),
    });
    currentOrder = result.order;
    upsertOpenOrder(currentOrder);
    closeOrderModal();
    selectedDayKey = todayKey;
    renderCalendar();
    renderDayList(selectedDayKey);
    setFeedback?.(feedback, "Orden abierta. Revisa los datos y completa el diagnóstico.", "success");
    renderDiagnosisForm();
  }

  function renderDiagnosisForm() {
    if (!currentOrder || !diagnosisForm || !diagnosisCard) return;
    diagnosisCard.hidden = false;
    const v = currentOrder.vehicle || {};
    const c = currentOrder.client || {};
    if (orderSummary) {
      orderSummary.textContent = `${currentOrder.orderNumber} · ${[v.brand, v.model, v.plate].filter(Boolean).join(" ")}`;
    }

    const diagnosis = currentOrder.diagnosis || {};
    let html = `
      <div class="mech-details-box">
        <div class="mech-section-title">Datos del vehículo / cliente</div>
        <p style="margin:0 0 0.85rem;color:var(--mech-muted);font-size:0.95rem;">
          Si algo quedó mal al crear la orden, corrígelo aquí y guarda.
        </p>
        <div class="mech-form-grid" id="mech-order-details-fields">
          <label><span>Nombre del cliente</span><input name="clientName" required autocomplete="name" value="${escapeHtml(c.name || "")}" /></label>
          <label><span>Teléfono</span><input name="clientPhone" inputmode="tel" autocomplete="tel" value="${escapeHtml(c.phone || "")}" /></label>
          <label><span>Correo</span><input name="clientEmail" type="email" inputmode="email" autocomplete="email" value="${escapeHtml(c.email || "")}" /></label>
          <label><span>Marca</span><input name="brand" required value="${escapeHtml(v.brand || "")}" /></label>
          <label><span>Modelo</span><input name="model" required value="${escapeHtml(v.model || "")}" /></label>
          <label><span>Año</span><input name="year" inputmode="numeric" value="${escapeHtml(v.year || "")}" /></label>
          <label><span>Versión</span><input name="version" value="${escapeHtml(v.version || "")}" /></label>
          <label><span>Placa</span><input name="plate" required autocomplete="off" value="${escapeHtml(v.plate || "")}" /></label>
          <div style="grid-column:1/-1;">
            <button id="mech-save-details" class="mech-btn mech-btn-ghost mech-btn-block" type="button">Guardar cambios de datos</button>
          </div>
        </div>
      </div>
    `;

    const questionNotes = diagnosis.questionNotes && typeof diagnosis.questionNotes === "object"
      ? diagnosis.questionNotes
      : {};

    let lastSection = "";
    QUESTIONS.forEach((question) => {
      if (question.section !== lastSection) {
        html += `<div class="mech-section-title">${question.section}</div>`;
        lastSection = question.section;
      }
      html += `
        <fieldset class="mech-q">
          <legend>${question.label}</legend>
          <div class="mech-options">
            ${question.options.map(([value, label]) => `
              <label>
                <input type="radio" name="${question.key}" value="${value}" ${diagnosis[question.key] === value ? "checked" : ""} required />
                <span>${label}</span>
              </label>
            `).join("")}
          </div>
          <label class="mech-q-note">
            <span>Observaciones (opcional)</span>
            <textarea name="note_${question.key}" rows="2" maxlength="800" placeholder="Nota sobre esta pregunta…">${escapeHtml(questionNotes[question.key] || "")}</textarea>
          </label>
        </fieldset>
      `;
    });

    const selectedComplementary = new Set(
      Array.isArray(diagnosis.complementaryServices) ? diagnosis.complementaryServices : []
    );

    html += `
      <div class="mech-section-title">Recomendaciones del técnico</div>
      <fieldset class="mech-q">
        <legend>¿Se recomienda realizar algún servicio complementario?</legend>
        <div class="mech-chips">
          ${COMPLEMENTARY.map((item) => `
            <label>
              <input type="checkbox" name="complementaryServices" value="${escapeHtml(item)}" ${selectedComplementary.has(item) ? "checked" : ""} />
              <span>${item}</span>
            </label>
          `).join("")}
        </div>
      </fieldset>
      <label class="mech-field">
        <span>Observaciones del técnico</span>
        <textarea name="observations" placeholder="Detalle hallazgos, recomendaciones o condiciones del vehículo">${escapeHtml(diagnosis.observations || "")}</textarea>
      </label>
      <div class="mech-form-grid" style="margin-top:1rem;">
        <label>
          <span>Km actual</span>
          <input name="currentKm" type="number" min="0" step="1" required inputmode="numeric" value="${currentOrder.currentKm ?? ""}" />
        </label>
        <label>
          <span>Km próximo mantenimiento</span>
          <input id="mech-next-km" type="number" readonly placeholder="Se calcula solo" value="${currentOrder.nextServiceKm ?? ""}" />
        </label>
      </div>
      <label class="mech-field" style="margin-top:1rem;">
        <span>Fotos del vehículo / trabajo (máx. 10)</span>
        <input id="mech-photos-input" name="photos" type="file" accept="image/*" capture="environment" multiple />
      </label>
      <div class="mech-photo-previews" id="mech-photo-previews" aria-live="polite"></div>
      <div class="mech-sign-box">
        <div class="mech-section-title">Técnico responsable</div>
        <p style="margin:0;color:var(--mech-muted);font-size:0.95rem;">
          Firma y nombre que aparecerán en el PDF del servicio.
        </p>
        <label class="mech-field">
          <span>Nombre y apellido</span>
          <input
            id="mech-technician-name"
            name="technicianName"
            required
            autocomplete="name"
            placeholder="Ej. Carlos Pérez"
            value="${escapeHtml(currentOrder.technicianName || mechanicDefaults.fullName || "")}"
          />
        </label>
        <div class="mech-sign-canvas-wrap">
          <canvas id="mech-signature-canvas" width="720" height="220" aria-label="Firma del técnico"></canvas>
        </div>
        <div class="mech-sign-actions">
          <button id="mech-clear-signature" class="mech-btn mech-btn-ghost" type="button">Limpiar firma</button>
          <button id="mech-load-signature" class="mech-btn mech-btn-ghost" type="button" ${mechanicDefaults.signatureUrl || currentOrder.technicianSignatureUrl ? "" : "hidden"}>Usar firma guardada</button>
        </div>
        <label class="mech-default-check">
          <input id="mech-save-tech-default" type="checkbox" checked />
          <span>Guardar nombre y firma como predeterminados para próximos servicios</span>
        </label>
      </div>
    `;

    diagnosisForm.innerHTML = html;
    diagnosisForm.addEventListener("change", updateNextKmPreview);
    document.getElementById("mech-save-details")?.addEventListener("click", () => {
      saveOrderDetails().catch((error) => setFeedback?.(feedback, error.message, "error"));
    });
    updateNextKmPreview();
    setupPhotoPicker();
    setupSignaturePad(currentOrder.technicianSignatureUrl || mechanicDefaults.signatureUrl || "");
    diagnosisCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function photoFileKey(file) {
    return `${String(file?.name || "").trim().toLowerCase()}|${Number(file?.size || 0)}`;
  }

  function revokePhotoPreviewUrls() {
    document.querySelectorAll("#mech-photo-previews img[data-object-url]").forEach((img) => {
      const url = img.getAttribute("data-object-url");
      if (url) URL.revokeObjectURL(url);
    });
  }

  function syncPhotoInputFiles() {
    const input = document.getElementById("mech-photos-input");
    if (!input) return;
    const transfer = new DataTransfer();
    selectedPhotoFiles.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
  }

  function totalPhotoCount() {
    return keptExistingPhotos.length + selectedPhotoFiles.length;
  }

  function renderPhotoPreviews() {
    const wrap = document.getElementById("mech-photo-previews");
    if (!wrap) return;
    revokePhotoPreviewUrls();
    const existingHtml = keptExistingPhotos.map((photo, index) => `
      <div class="mech-photo-thumb">
        <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.name || `Foto ${index + 1}`)}" />
        <button class="mech-photo-remove" type="button" data-existing-index="${index}" aria-label="Quitar foto">×</button>
      </div>
    `).join("");
    const newHtml = selectedPhotoFiles.map((file, index) => {
      const url = URL.createObjectURL(file);
      return `
        <div class="mech-photo-thumb">
          <img src="${url}" alt="${escapeHtml(file.name || `Foto ${index + 1}`)}" data-object-url="${url}" />
          <button class="mech-photo-remove" type="button" data-photo-index="${index}" aria-label="Quitar foto">×</button>
        </div>
      `;
    }).join("");
    wrap.innerHTML = `${existingHtml}${newHtml}`;
    wrap.querySelectorAll("button[data-existing-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.existingIndex);
        if (!Number.isFinite(index)) return;
        keptExistingPhotos = keptExistingPhotos.filter((_, i) => i !== index);
        renderPhotoPreviews();
      });
    });
    wrap.querySelectorAll("button[data-photo-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.photoIndex);
        if (!Number.isFinite(index)) return;
        selectedPhotoFiles = selectedPhotoFiles.filter((_, i) => i !== index);
        syncPhotoInputFiles();
        renderPhotoPreviews();
      });
    });
  }

  function setupPhotoPicker() {
    const existing = Array.isArray(currentOrder?.photos) ? currentOrder.photos : [];
    const seenExisting = new Set();
    keptExistingPhotos = existing.filter((photo) => {
      const key = `${String(photo.url || "").trim()}|${String(photo.name || "").trim().toLowerCase()}`;
      if (!key || key === "|" || seenExisting.has(key)) return false;
      seenExisting.add(key);
      return Boolean(photo.url);
    });
    selectedPhotoFiles = [];
    photoPickerBusy = false;
    const input = document.getElementById("mech-photos-input");
    const wrap = document.getElementById("mech-photo-previews");
    if (wrap) wrap.innerHTML = "";
    renderPhotoPreviews();
    if (!input || input.dataset.bound === "true") {
      syncPhotoInputFiles();
      return;
    }
    input.dataset.bound = "true";

    input.addEventListener("change", () => {
      if (photoPickerBusy) return;
      photoPickerBusy = true;
      try {
        const incoming = Array.from(input.files || []);
        if (!incoming.length) return;
        const known = new Set(selectedPhotoFiles.map(photoFileKey));
        keptExistingPhotos.forEach((photo) => {
          const name = String(photo.name || "").trim().toLowerCase();
          if (name) known.add(`${name}|0`);
          known.add(`${name}|${Number(photo.size || 0)}`);
        });
        let skippedDuplicate = false;
        let skippedLimit = false;
        incoming.forEach((file) => {
          if (totalPhotoCount() >= 10) {
            skippedLimit = true;
            return;
          }
          const key = photoFileKey(file);
          const nameOnly = String(file.name || "").trim().toLowerCase();
          const duplicate = known.has(key)
            || selectedPhotoFiles.some((item) => item.name === file.name && item.size === file.size)
            || keptExistingPhotos.some((item) => String(item.name || "").trim().toLowerCase() === nameOnly);
          if (duplicate) {
            skippedDuplicate = true;
            return;
          }
          known.add(key);
          selectedPhotoFiles.push(file);
        });
        selectedPhotoFiles = selectedPhotoFiles.slice(0, Math.max(0, 10 - keptExistingPhotos.length));
        syncPhotoInputFiles();
        renderPhotoPreviews();
        if (skippedLimit) {
          setFeedback?.(feedback, "Máximo 10 fotos por diagnóstico.", "error");
        } else if (skippedDuplicate) {
          setFeedback?.(feedback, "Se omitió una foto duplicada.", "error");
        }
      } finally {
        photoPickerBusy = false;
      }
    });
  }

  function getSignatureCanvas() {
    return document.getElementById("mech-signature-canvas");
  }

  function resolveSignatureAssetUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^(data:|blob:|https?:)/i.test(value)) return value;
    const apiBase = String(window.AdminApp?.resolveApiBaseUrl?.() || window.location.origin).replace(/\/$/, "");
    return `${apiBase}${value.startsWith("/") ? value : `/${value}`}`;
  }

  function clearSignatureCanvas() {
    const canvas = getSignatureCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    signatureState.dirty = false;
    signatureState.usingSavedUrl = false;
  }

  function isSignatureBlank() {
    if (signatureState.usingSavedUrl && !signatureState.dirty) {
      return false;
    }

    const canvas = getSignatureCanvas();
    if (!canvas) return true;

    try {
      const ctx = canvas.getContext("2d");
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) {
          return false;
        }
      }
      return true;
    } catch (_error) {
      return !(signatureState.usingSavedUrl || signatureState.dirty);
    }
  }

  async function fetchSignatureObjectUrl(url) {
    const absoluteUrl = resolveSignatureAssetUrl(url);
    if (!absoluteUrl) return "";

    if (absoluteUrl.startsWith("data:") || absoluteUrl.startsWith("blob:")) {
      return absoluteUrl;
    }

    const authToken = getAuthToken?.();
    const response = await fetch(absoluteUrl, {
      credentials: "include",
      mode: "cors",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });

    if (!response.ok) {
      throw new Error("No se pudo cargar la firma guardada");
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  function drawSignatureFromUrl(url) {
    const canvas = getSignatureCanvas();
    if (!canvas || !url) return Promise.resolve(false);
    const ctx = canvas.getContext("2d");

    return (async () => {
      let objectUrl = "";
      try {
        objectUrl = await fetchSignatureObjectUrl(url);
        const image = await new Promise((resolve, reject) => {
          const nextImage = new Image();
          nextImage.onload = () => resolve(nextImage);
          nextImage.onerror = () => reject(new Error("Firma inválida"));
          nextImage.src = objectUrl;
        });

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        const x = (canvas.width - width) / 2;
        const y = (canvas.height - height) / 2;
        ctx.drawImage(image, x, y, width, height);
        signatureState.dirty = false;
        signatureState.usingSavedUrl = true;
        return true;
      } catch (_error) {
        return false;
      } finally {
        if (objectUrl && objectUrl.startsWith("blob:")) {
          URL.revokeObjectURL(objectUrl);
        }
      }
    })();
  }

  function readSignatureDataUrl() {
    const canvas = getSignatureCanvas();
    if (!canvas) return "";
    try {
      return canvas.toDataURL("image/png");
    } catch (_error) {
      return "";
    }
  }

  function setupSignaturePad(defaultUrl = "") {
    const canvas = getSignatureCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    clearSignatureCanvas();
    signatureState = { drawing: false, dirty: false, usingSavedUrl: false };

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
      signatureState.drawing = true;
      signatureState.dirty = true;
      signatureState.usingSavedUrl = false;
      const point = pointFromEvent(event);
      ctx.beginPath();
      ctx.moveTo(point.x, point.y);
    };
    const moveDraw = (event) => {
      if (!signatureState.drawing) return;
      event.preventDefault();
      const point = pointFromEvent(event);
      ctx.lineWidth = 2.8;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#111111";
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    };
    const endDraw = () => {
      signatureState.drawing = false;
    };

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", moveDraw);
    canvas.addEventListener("mouseup", endDraw);
    canvas.addEventListener("mouseleave", endDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", moveDraw, { passive: false });
    canvas.addEventListener("touchend", endDraw);

    document.getElementById("mech-clear-signature")?.addEventListener("click", () => {
      clearSignatureCanvas();
    });
    document.getElementById("mech-load-signature")?.addEventListener("click", () => {
      const url = currentOrder?.technicianSignatureUrl || mechanicDefaults.signatureUrl || "";
      if (!url) return;
      drawSignatureFromUrl(url).then((ok) => {
        if (!ok) setFeedback?.(feedback, "No se pudo cargar la firma guardada.", "error");
      });
    });

    if (defaultUrl) {
      drawSignatureFromUrl(defaultUrl).then((ok) => {
        if (!ok) {
          // Keep blank canvas; user can still draw or retry load.
        }
      });
    }
  }

  async function saveOrderDetails() {
    if (!currentOrder || !diagnosisForm) return;
    const fields = diagnosisForm.querySelector("#mech-order-details-fields");
    if (!fields) return;

    const get = (name) => fields.querySelector(`[name="${name}"]`)?.value?.trim() || "";
    const payload = {
      clientName: get("clientName"),
      clientPhone: get("clientPhone"),
      clientEmail: get("clientEmail"),
      brand: get("brand"),
      model: get("model"),
      year: get("year"),
      version: get("version"),
      plate: get("plate"),
    };

    if (!payload.clientName || !payload.brand || !payload.model || !payload.plate) {
      setFeedback?.(feedback, "Completa cliente, marca, modelo y placa.", "error");
      return;
    }

    const result = await fetchJson(`/api/mechanic/orders/${encodeURIComponent(currentOrder.id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
      loadingMessage: "Guardando datos...",
    });
    currentOrder = result.order;
    upsertOpenOrder(currentOrder);
    if (orderSummary) {
      const v = currentOrder.vehicle || {};
      orderSummary.textContent = `${currentOrder.orderNumber} · ${[v.brand, v.model, v.plate].filter(Boolean).join(" ")}`;
    }
    renderCalendar();
    renderDayList(selectedDayKey);
    setFeedback?.(feedback, "Datos del vehículo/cliente actualizados.", "success");
  }

  function updateNextKmPreview() {
    const currentKm = Number(diagnosisForm?.elements?.currentKm?.value);
    const nextService = diagnosisForm?.querySelector('input[name="nextService"]:checked')?.value;
    const offsets = { "5000": 5000, "10000": 10000, before5000: 4000 };
    const nextInput = document.getElementById("mech-next-km");
    if (!nextInput) return;
    if (!Number.isFinite(currentKm) || !offsets[nextService]) {
      if (currentOrder?.nextServiceKm != null && !offsets[nextService]) {
        nextInput.value = String(currentOrder.nextServiceKm);
      } else {
        nextInput.value = "";
      }
      return;
    }
    nextInput.value = String(currentKm + offsets[nextService]);
  }

  function resolveClientEmail() {
    const fromForm = diagnosisForm?.querySelector('[name="clientEmail"]')?.value?.trim().toLowerCase() || "";
    const fromOrder = String(currentOrder?.client?.email || "").trim().toLowerCase();
    return fromForm || fromOrder;
  }

  function closeConfirmModal() {
    if (confirmModal) confirmModal.hidden = true;
    if (confirmFeedback) {
      confirmFeedback.textContent = "";
      confirmFeedback.className = "mech-feedback feedback";
    }
  }

  function closeSuccessModal() {
    if (successModal) successModal.hidden = true;
  }

  function openConfirmModal() {
    if (!currentOrder) {
      setFeedback?.(feedback, "Primero abre una orden de servicio.", "error");
      return;
    }
    if (!diagnosisForm?.reportValidity()) {
      setFeedback?.(feedback, "Completa el cuestionario y los datos del técnico.", "error");
      return;
    }
    const technicianName = diagnosisForm.querySelector('[name="technicianName"]')?.value?.trim() || "";
    if (!technicianName) {
      setFeedback?.(feedback, "Indica el nombre y apellido del técnico.", "error");
      diagnosisForm.querySelector('[name="technicianName"]')?.focus();
      return;
    }
    const savedSignatureUrl = currentOrder?.technicianSignatureUrl || mechanicDefaults.signatureUrl || "";
    if (isSignatureBlank() && !savedSignatureUrl) {
      setFeedback?.(feedback, "Firma el diagnóstico antes de guardar.", "error");
      getSignatureCanvas()?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const email = resolveClientEmail();
    const vehicle = currentOrder.vehicle || {};
    if (confirmText) {
      confirmText.textContent = `¿Confirmas guardar el diagnóstico de ${[vehicle.brand, vehicle.model, vehicle.plate].filter(Boolean).join(" ")}?`;
    }
    if (emailCheckbox) emailCheckbox.checked = true;
    if (marketingCheckbox) marketingCheckbox.checked = true;
    if (confirmEmailHint) {
      confirmEmailHint.textContent = email
        ? `Se enviará a ${email}`
        : "Esta orden no tiene correo. Agrégalo en “Datos del vehículo / cliente” o desmarca el envío.";
    }
    if (confirmFeedback) {
      confirmFeedback.textContent = "";
      confirmFeedback.className = "mech-feedback feedback";
    }
    if (confirmModal) confirmModal.hidden = false;
  }

  function openSuccessModal(message) {
    if (successText) {
      successText.textContent = message || "El PDF del servicio está listo para imprimir.";
    }
    if (successModal) successModal.hidden = false;
  }

  async function fetchPdfBlob() {
    if (!currentOrder) throw new Error("No hay orden activa");
    const authToken = getAuthToken?.();
    const response = await fetch(`${window.AdminApp.resolveApiBaseUrl()}/api/mechanic/orders/${encodeURIComponent(currentOrder.id)}/pdf`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      credentials: "include",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "No se pudo generar el PDF");
    }
    return response.blob();
  }

  async function preparePdfForPrint() {
    const blob = await fetchPdfBlob();
    if (latestPdfUrl) URL.revokeObjectURL(latestPdfUrl);
    latestPdfUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = latestPdfUrl;
    anchor.download = `Diagnostico-${currentOrder.orderNumber || "GI"}.pdf`;
    anchor.click();
    return latestPdfUrl;
  }

  async function printPreparedPdf() {
    if (!latestPdfUrl) {
      await preparePdfForPrint();
    }
    const printWindow = window.open(latestPdfUrl, "_blank");
    if (!printWindow) {
      throw new Error("Permite ventanas emergentes para imprimir el PDF");
    }
    const triggerPrint = () => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (_error) {
        // El PDF queda abierto para imprimir manualmente
      }
    };
    printWindow.addEventListener("load", triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 700);
  }

  async function saveDiagnosis() {
    if (!currentOrder) {
      setFeedback?.(confirmFeedback || feedback, "Primero abre una orden de servicio.", "error");
      return;
    }
    if (!diagnosisForm?.reportValidity()) {
      setFeedback?.(confirmFeedback || feedback, "Completa el cuestionario.", "error");
      return;
    }

    const technicianName = diagnosisForm.querySelector('[name="technicianName"]')?.value?.trim() || "";
    if (!technicianName) {
      setFeedback?.(confirmFeedback || feedback, "Indica el nombre y apellido del técnico.", "error");
      return;
    }
    const canvas = getSignatureCanvas();
    const hasDrawnSignature = canvas && !isSignatureBlank();
    const savedSignatureUrl = currentOrder?.technicianSignatureUrl || mechanicDefaults.signatureUrl || "";
    if (!hasDrawnSignature && !savedSignatureUrl) {
      setFeedback?.(confirmFeedback || feedback, "Firma el diagnóstico antes de confirmar.", "error");
      return;
    }

    const sendEmail = Boolean(emailCheckbox?.checked);
    const addToMarketing = Boolean(marketingCheckbox?.checked);
    const clientEmail = resolveClientEmail();
    if (sendEmail && (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail))) {
      setFeedback?.(
        confirmFeedback || feedback,
        "Marca el envío solo si hay un correo válido, o guárdalo en los datos del cliente.",
        "error"
      );
      return;
    }
    if (addToMarketing && (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail))) {
      setFeedback?.(
        confirmFeedback || feedback,
        "Para marketing a 6 meses el cliente necesita un correo válido.",
        "error"
      );
      return;
    }

    // Si el mecánico corrigió el correo en el formulario, persistirlo antes de guardar
    if (sendEmail && clientEmail && clientEmail !== String(currentOrder.client?.email || "").toLowerCase()) {
      const fields = diagnosisForm.querySelector("#mech-order-details-fields");
      const get = (name) => fields?.querySelector(`[name="${name}"]`)?.value?.trim() || "";
      await fetchJson(`/api/mechanic/orders/${encodeURIComponent(currentOrder.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          clientName: get("clientName") || currentOrder.client?.name || "",
          clientPhone: get("clientPhone") || currentOrder.client?.phone || "",
          clientEmail,
          brand: get("brand") || currentOrder.vehicle?.brand || "",
          model: get("model") || currentOrder.vehicle?.model || "",
          year: get("year") || currentOrder.vehicle?.year || "",
          version: get("version") || currentOrder.vehicle?.version || "",
          plate: get("plate") || currentOrder.vehicle?.plate || "",
        }),
        loadingMessage: false,
      }).then((result) => {
        currentOrder = result.order;
        upsertOpenOrder(currentOrder);
      }).catch(() => {});
    }

    const formData = new FormData();
    const notesPayload = {};
    QUESTIONS.forEach((question) => {
      const value = diagnosisForm.querySelector(`input[name="${question.key}"]:checked`)?.value || "";
      formData.append(question.key, value);
      const note = diagnosisForm.querySelector(`[name="note_${question.key}"]`)?.value?.trim() || "";
      formData.append(`note_${question.key}`, note);
      if (note) notesPayload[question.key] = note;
    });
    const complementary = Array.from(diagnosisForm.querySelectorAll('input[name="complementaryServices"]:checked'))
      .map((input) => input.value);
    formData.append("complementaryServices", JSON.stringify(complementary));
    formData.append("questionNotes", JSON.stringify(notesPayload));
    formData.append("observations", diagnosisForm.elements.observations?.value || "");
    formData.append("currentKm", diagnosisForm.elements.currentKm?.value || "");
    formData.append("sendEmail", sendEmail ? "true" : "false");
    formData.append("addToMarketing", addToMarketing ? "true" : "false");
    formData.append("technicianName", technicianName);
    formData.append(
      "saveTechnicianDefault",
      document.getElementById("mech-save-tech-default")?.checked ? "true" : "false"
    );
    if (signatureState.dirty || (hasDrawnSignature && !signatureState.usingSavedUrl)) {
      const signatureDataUrl = readSignatureDataUrl();
      if (signatureDataUrl) {
        formData.append("technicianSignatureDataUrl", signatureDataUrl);
      } else if (savedSignatureUrl) {
        formData.append("technicianSignatureUrl", savedSignatureUrl);
      }
    } else if (savedSignatureUrl) {
      formData.append("technicianSignatureUrl", savedSignatureUrl);
    }

    formData.append(
      "keepPhotoUrls",
      JSON.stringify(keptExistingPhotos.map((photo) => photo.url).filter(Boolean))
    );
    selectedPhotoFiles.slice(0, Math.max(0, 10 - keptExistingPhotos.length)).forEach((file) => {
      formData.append("photos", file);
    });

    const result = await fetchJson(`/api/mechanic/orders/${encodeURIComponent(currentOrder.id)}/diagnosis`, {
      method: "POST",
      body: formData,
      loadingMessage: sendEmail ? "Guardando y enviando diagnóstico..." : "Guardando diagnóstico...",
      requestTimeoutMs: 120000,
    });
    currentOrder = result.order;
    upsertOpenOrder(currentOrder);
    if (document.getElementById("mech-save-tech-default")?.checked) {
      mechanicDefaults = {
        fullName: currentOrder.technicianName || technicianName,
        signatureUrl: currentOrder.technicianSignatureUrl || savedSignatureUrl,
      };
    }
    renderDayList(selectedDayKey);
    closeConfirmModal();

    let message = "Diagnóstico guardado. El PDF está listo para imprimir.";
    if (result.emailSent) {
      message = `Diagnóstico guardado y enviado a ${result.clientEmail || clientEmail}.`;
    } else if (sendEmail && result.emailError) {
      message = `Diagnóstico guardado, pero el correo no se envió: ${result.emailError}`;
    } else if (!sendEmail) {
      message = "Diagnóstico guardado sin envío de correo. El PDF está listo para imprimir.";
    }
    if (result.marketingSaved) {
      message = `${message} Cliente agendado para marketing a 6 meses.`;
    } else if (addToMarketing && result.marketingError) {
      message = `${message} Marketing: ${result.marketingError}`;
    }

    try {
      await preparePdfForPrint();
    } catch (pdfError) {
      message = `${message} (PDF: ${pdfError.message})`;
    }

    openSuccessModal(message);
    setFeedback?.(feedback, message, result.emailSent || !sendEmail ? "success" : "error");
  }

  async function loadPortal() {
    await loadAdminSession?.("mech-user-name", "mech-user-email");
    if (userNameEl && !userNameEl.textContent) userNameEl.textContent = "Mecánico";
    if (userEmailEl && !userEmailEl.textContent) userEmailEl.textContent = "—";

    const data = await fetchJson("/api/mechanic/overview");
    appointments = data.appointments || [];
    todayAppointments = data.todayAppointments || [];
    openOrders = data.openOrders || [];
    mechanicDefaults = data.mechanicDefaults || mechanicDefaults;
    todayKey = data.todayKey || new Date().toISOString().slice(0, 10);
    selectedDayKey = selectedDayKey || todayKey;
    const [yearPart, monthPart] = todayKey.split("-").map(Number);
    if (Number.isFinite(yearPart) && Number.isFinite(monthPart)) {
      calendarCursor = { year: yearPart, month: monthPart - 1 };
    }
    if (currentOrder?.id) {
      const fresh = openOrders.find((item) => item.id === currentOrder.id);
      if (fresh) currentOrder = fresh;
    }
    renderCalendar();
    renderDayList(selectedDayKey);
  }

  openOrderButton?.addEventListener("click", openOrderModal);
  orderClose?.addEventListener("click", closeOrderModal);
  orderOverlay?.addEventListener("click", closeOrderModal);
  showWalkinButton?.addEventListener("click", () => {
    if (walkinForm) walkinForm.hidden = !walkinForm.hidden;
  });
  walkinForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(walkinForm);
    const payload = Object.fromEntries(formData.entries());
    fetchJson("/api/mechanic/orders", {
      method: "POST",
      body: JSON.stringify({ mode: "walk_in", ...payload }),
    }).then((result) => {
      currentOrder = result.order;
      upsertOpenOrder(currentOrder);
      closeOrderModal();
      walkinForm.reset();
      selectedDayKey = todayKey;
      renderCalendar();
      renderDayList(selectedDayKey);
      setFeedback?.(feedback, "Orden creada. Revisa los datos y completa el diagnóstico.", "success");
      renderDiagnosisForm();
    }).catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  saveDiagnosisButton?.addEventListener("click", () => {
    openConfirmModal();
  });
  confirmOverlay?.addEventListener("click", closeConfirmModal);
  confirmClose?.addEventListener("click", closeConfirmModal);
  confirmCancel?.addEventListener("click", closeConfirmModal);
  confirmSubmit?.addEventListener("click", () => {
    saveDiagnosis().catch((error) => setFeedback?.(confirmFeedback || feedback, error.message, "error"));
  });
  successOverlay?.addEventListener("click", closeSuccessModal);
  successClose?.addEventListener("click", closeSuccessModal);
  successOk?.addEventListener("click", closeSuccessModal);
  successPrint?.addEventListener("click", () => {
    printPreparedPdf().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (successModal && !successModal.hidden) {
      closeSuccessModal();
      return;
    }
    if (confirmModal && !confirmModal.hidden) {
      closeConfirmModal();
    }
  });
  document.getElementById("mech-cal-prev")?.addEventListener("click", () => {
    calendarCursor.month -= 1;
    if (calendarCursor.month < 0) {
      calendarCursor.month = 11;
      calendarCursor.year -= 1;
    }
    renderCalendar();
  });
  document.getElementById("mech-cal-next")?.addEventListener("click", () => {
    calendarCursor.month += 1;
    if (calendarCursor.month > 11) {
      calendarCursor.month = 0;
      calendarCursor.year += 1;
    }
    renderCalendar();
  });

  loadPortal().catch((error) => setFeedback?.(feedback, error.message || "No se pudo cargar el portal", "error"));
})();
