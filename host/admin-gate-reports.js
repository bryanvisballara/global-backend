(() => {
  if (window.__adminGateReportsScriptInitialized) return;
  window.__adminGateReportsScriptInitialized = true;

  const {
    attachLogout,
    fetchJson,
    formatDate,
    requireAdminAccess,
    setFeedback,
  } = window.AdminApp || {};

  if (!requireAdminAccess?.()) return;
  attachLogout?.();

  const feedback = document.getElementById("gate-reports-feedback");
  const bodyEl = document.getElementById("gate-reports-body");
  const searchInput = document.getElementById("gate-search-input");
  const statusFilter = document.getElementById("gate-status-filter");
  const directionFilter = document.getElementById("gate-direction-filter");
  const clearButton = document.getElementById("gate-clear-filters");
  const refreshButton = document.getElementById("gate-refresh");
  const totalCount = document.getElementById("gate-total-count");
  const closedCount = document.getElementById("gate-closed-count");
  const resultsCount = document.getElementById("gate-results-count");
  const detailCard = document.getElementById("gate-report-detail");
  const detailTitle = document.getElementById("gate-detail-title");
  const detailBody = document.getElementById("gate-detail-body");
  const detailPhotos = document.getElementById("gate-detail-photos");
  const detailClose = document.getElementById("gate-detail-close");

  let reports = [];

  const DIRECTION_LABELS = {
    entry: "Ingreso",
    exit: "Salida",
    both: "Ingreso + salida",
  };

  const METHOD_LABELS = {
    own: "Propio",
    tow: "Grúa",
    transporter: "Transportadora",
    other: "Otro",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function emptyStateHtml(title, subtitle = "") {
    return `
      <tr>
        <td colspan="7">
          <div class="gate-empty">
            <div class="gate-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/></svg>
            </div>
            <strong>${escapeHtml(title)}</strong>
            ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
          </div>
        </td>
      </tr>`;
  }

  function vehicleLabel(vehicle = {}) {
    return [vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "Vehículo";
  }

  function dateTimeLabel(dateValue, timeValue) {
    if (!dateValue && !timeValue) return "—";
    const datePart = dateValue ? (formatDate?.(dateValue) || "—") : "—";
    const timePart = timeValue ? String(timeValue) : "";
    return timePart ? `${datePart} · ${timePart}` : datePart;
  }

  function filteredReports() {
    const query = String(searchInput?.value || "").trim().toLowerCase();
    const status = statusFilter?.value || "all";
    const direction = directionFilter?.value || "all";

    return reports.filter((report) => {
      if (status !== "all" && report.status !== status) return false;
      if (direction !== "all" && report.direction !== direction) return false;
      if (!query) return true;
      const v = report.vehicle || {};
      const haystack = [
        report.entryNumber,
        v.plate,
        v.vin,
        v.brand,
        v.model,
        v.year,
        v.color,
        report.status,
        report.direction,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderStats(list) {
    if (totalCount) totalCount.textContent = String(list.length);
    if (closedCount) closedCount.textContent = String(list.filter((item) => item.status === "closed").length);
  }

  function hideDetail() {
    if (detailCard) detailCard.hidden = true;
    if (detailBody) detailBody.innerHTML = "";
    if (detailPhotos) detailPhotos.innerHTML = "";
  }

  function renderPhotoRow(title, photos = []) {
    if (!photos.length) return "";
    const links = photos.map((photo) => {
      const url = escapeHtml(photo.url || "");
      if (!url) return "";
      return `<a href="${url}" target="_blank" rel="noopener noreferrer"><img src="${url}" alt="${escapeHtml(photo.name || title)}" /></a>`;
    }).join("");
    if (!links) return "";
    return `
      <div style="margin-top:1rem;">
        <strong style="display:block;margin-bottom:0.45rem;">${escapeHtml(title)}</strong>
        <div class="gate-photo-row">${links}</div>
      </div>`;
  }

  function showDetail(reportId) {
    const report = reports.find((item) => item.id === reportId);
    if (!report || !detailCard) return;

    const v = report.vehicle || {};
    const title = `${report.entryNumber || "Acta"} · ${vehicleLabel(v)} · ${v.plate || "—"}`;
    if (detailTitle) detailTitle.textContent = title;

    const docs = (report.documentsReceived || []).join(", ") || "—";
    const accessories = (report.accessories || [])
      .filter((item) => item.present)
      .map((item) => item.label + (item.note ? ` (${item.note})` : ""))
      .join(", ") || "—";

    detailBody.innerHTML = `
      <p><strong>Estado</strong>${escapeHtml(report.status === "open" ? "Abierto" : "Cerrado")}</p>
      <p><strong>Tipo</strong>${escapeHtml(DIRECTION_LABELS[report.direction] || report.direction || "—")}</p>
      <p><strong>Ingreso</strong>${escapeHtml(dateTimeLabel(report.entryDate, report.entryTime))}</p>
      <p><strong>Salida</strong>${escapeHtml(dateTimeLabel(report.exitDate, report.exitTime))}</p>
      <p><strong>Placa / VIN</strong>${escapeHtml(v.plate || "—")} · ${escapeHtml(v.vin || "—")}</p>
      <p><strong>Vehículo</strong>${escapeHtml(vehicleLabel(v))} · ${escapeHtml(v.color || "—")}</p>
      <p><strong>Medio llegada</strong>${escapeHtml(METHOD_LABELS[v.arrivalMethod] || v.arrivalMethod || "—")}</p>
      <p><strong>Medio salida</strong>${escapeHtml(METHOD_LABELS[v.departureMethod] || v.departureMethod || "—")}</p>
      <p><strong>Documentos</strong>${escapeHtml(docs)}</p>
      <p><strong>Accesorios</strong>${escapeHtml(accessories)}</p>
      <p><strong>Obs. ingreso</strong>${escapeHtml(report.entryObservations || "—")}</p>
      <p><strong>Obs. salida</strong>${escapeHtml(report.exitObservations || "—")}</p>
      <p><strong>Obs. generales</strong>${escapeHtml(report.generalObservations || "—")}</p>
      <p><strong>Quien entrega (ingreso)</strong>${escapeHtml(report.deliverer?.fullName || "—")}</p>
      <p><strong>Seguridad (ingreso)</strong>${escapeHtml(report.securityReceiver?.fullName || "—")}</p>
      <p><strong>Quien recibe (salida)</strong>${escapeHtml(report.exitDeliverer?.fullName || "—")}</p>
      <p><strong>Seguridad (salida)</strong>${escapeHtml(report.exitReceiver?.fullName || "—")}</p>
    `;

    detailPhotos.innerHTML = [
      renderPhotoRow("Fotos de ingreso", report.entryPhotos),
      renderPhotoRow("Fotos de salida", report.exitPhotos),
    ].join("");

    detailCard.hidden = false;
    detailCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderTable() {
    const list = filteredReports();
    renderStats(reports);
    if (resultsCount) resultsCount.textContent = `${list.length} reporte(s)`;
    if (!bodyEl) return;

    if (!list.length) {
      bodyEl.innerHTML = emptyStateHtml(
        "No hay reportes con estos filtros.",
        "Intenta ajustar los filtros de búsqueda."
      );
      return;
    }

    bodyEl.innerHTML = list.map((report) => {
      const v = report.vehicle || {};
      const statusClass = report.status === "open" ? "gate-status-open" : "gate-status-closed";
      const statusLabel = report.status === "open" ? "Abierto" : "Cerrado";
      return `
        <tr>
          <td>${escapeHtml(report.entryNumber || "—")}</td>
          <td>
            <strong>${escapeHtml(vehicleLabel(v))}</strong><br />
            <span>${escapeHtml(v.plate || "—")}</span>
          </td>
          <td>${escapeHtml(dateTimeLabel(report.entryDate, report.entryTime))}</td>
          <td>${escapeHtml(dateTimeLabel(report.exitDate, report.exitTime))}</td>
          <td>${escapeHtml(DIRECTION_LABELS[report.direction] || report.direction || "—")}</td>
          <td><span class="gate-status-pill ${statusClass}">${escapeHtml(statusLabel)}</span></td>
          <td>
            <button type="button" class="secondary-button" data-report-id="${escapeHtml(report.id)}">Ver</button>
          </td>
        </tr>
      `;
    }).join("");

    bodyEl.querySelectorAll("[data-report-id]").forEach((button) => {
      button.addEventListener("click", () => showDetail(button.dataset.reportId));
    });
  }

  async function loadReports() {
    const data = await fetchJson("/api/vigilance/gate-reports", {
      loadingMessage: "Cargando reportes…",
    });
    reports = Array.isArray(data.reports) ? data.reports : [];
    hideDetail();
    renderTable();
  }

  searchInput?.addEventListener("input", () => renderTable());
  statusFilter?.addEventListener("change", () => renderTable());
  directionFilter?.addEventListener("change", () => renderTable());
  clearButton?.addEventListener("click", () => {
    if (searchInput) searchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (directionFilter) directionFilter.value = "all";
    renderTable();
  });
  refreshButton?.addEventListener("click", () => {
    loadReports().catch((error) => setFeedback?.(feedback, error.message, "error"));
  });
  detailClose?.addEventListener("click", hideDetail);

  loadReports().catch((error) => {
    setFeedback?.(feedback, error.message || "No se pudieron cargar los reportes.", "error");
    if (bodyEl) {
      bodyEl.innerHTML = emptyStateHtml(error.message || "Error al cargar reportes.");
    }
  });
})();
