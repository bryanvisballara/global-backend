(() => {
  if (window.__adminVisitorsScriptInitialized) return;
  window.__adminVisitorsScriptInitialized = true;

  const {
    attachLogout,
    fetchJson,
    formatDate,
    requireAdminAccess,
    setFeedback,
  } = window.AdminApp || {};

  if (!requireAdminAccess?.()) return;
  attachLogout?.();

  const visitorsBody = document.getElementById("visitors-body");
  const visitorsRefresh = document.getElementById("visitors-refresh");
  const visitorCreateForm = document.getElementById("visitor-create-form");
  const visitorsFeedback = document.getElementById("visitors-feedback");
  const resultsCount = document.getElementById("visitors-results-count");

  const VISITOR_PURPOSE_LABELS = {
    showroom: "Vitrina",
    delivery: "Entrega",
    pickup: "Recogida",
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

  function emptyStateHtml(message) {
    return `
      <tr>
        <td colspan="8">
          <div class="vis-empty">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2"/></svg>
            <p>${escapeHtml(message)}</p>
          </div>
        </td>
      </tr>`;
  }

  async function loadVisitors() {
    const data = await fetchJson("/api/admin/visitors", {
      loadingMessage: "Cargando visitantes…",
    });
    const visits = data.visits || [];
    if (resultsCount) resultsCount.textContent = `${visits.length} visita(s)`;
    if (!visitorsBody) return;

    if (!visits.length) {
      visitorsBody.innerHTML = emptyStateHtml("No hay visitas registradas. Las visitas que registres aparecerán aquí.");
      return;
    }

    visitorsBody.innerHTML = visits.map((visit) => {
      const interest = [visit.vehicleInterest?.brand, visit.vehicleInterest?.model, visit.vehicleInterest?.year]
        .filter(Boolean)
        .join(" ") || "—";
      const contact = [visit.visitorPhone, visit.visitorEmail].filter(Boolean).join(" · ") || "—";
      return `
        <tr>
          <td>${visit.visitDate ? formatDate?.(visit.visitDate) || "—" : "—"}</td>
          <td>${escapeHtml(visit.visitTime || "—")}</td>
          <td>${escapeHtml(visit.visitorName || "—")}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${escapeHtml(interest)}</td>
          <td>${escapeHtml(VISITOR_PURPOSE_LABELS[visit.purpose] || visit.purpose || "—")}</td>
          <td>${escapeHtml(visit.status || "scheduled")}</td>
          <td>
            ${visit.status === "cancelled"
              ? "—"
              : `<button type="button" class="secondary-button" data-cancel-visit="${escapeHtml(visit.id)}">Cancelar</button>`}
          </td>
        </tr>
      `;
    }).join("");

    visitorsBody.querySelectorAll("[data-cancel-visit]").forEach((button) => {
      button.addEventListener("click", () => {
        const visitId = button.getAttribute("data-cancel-visit");
        fetchJson(`/api/admin/visitors/${encodeURIComponent(visitId)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "cancelled" }),
          loadingMessage: "Cancelando visita…",
        }).then(() => {
          setFeedback?.(visitorsFeedback, "Visita cancelada.", "success");
          return loadVisitors();
        }).catch((error) => setFeedback?.(visitorsFeedback, error.message, "error"));
      });
    });
  }

  visitorsRefresh?.addEventListener("click", () => {
    loadVisitors().catch((error) => setFeedback?.(visitorsFeedback, error.message, "error"));
  });

  visitorCreateForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(visitorCreateForm);
    const payload = Object.fromEntries(formData.entries());
    fetchJson("/api/admin/visitors", {
      method: "POST",
      body: JSON.stringify(payload),
      loadingMessage: "Registrando visita…",
    }).then(() => {
      visitorCreateForm.reset();
      setFeedback?.(visitorsFeedback, "Visita registrada para vigilancia.", "success");
      return loadVisitors();
    }).catch((error) => setFeedback?.(visitorsFeedback, error.message, "error"));
  });

  loadVisitors().catch((error) => {
    setFeedback?.(visitorsFeedback, error.message || "No se pudieron cargar los visitantes.", "error");
    if (visitorsBody) {
      visitorsBody.innerHTML = emptyStateHtml(error.message || "Error al cargar visitantes.");
    }
  });
})();
