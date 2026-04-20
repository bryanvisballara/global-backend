(() => {
if (window.__adminDeletedAccountsScriptInitialized) {
  return;
}

window.__adminDeletedAccountsScriptInitialized = true;

const {
  attachLogout,
  fetchJson,
  formatDate,
  loadAdminSession,
  renderEmptyState,
  resetLoadingOverlay,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (!requireAdminAccess()) {
  return;
}

attachLogout();

const searchInput = document.getElementById("deleted-accounts-search-input");
const filterButton = document.getElementById("deleted-accounts-filter-button");
const clearButton = document.getElementById("deleted-accounts-clear-button");
const totalCount = document.getElementById("deleted-accounts-total-count");
const withFeedbackCount = document.getElementById("deleted-accounts-with-feedback-count");
const withoutFeedbackCount = document.getElementById("deleted-accounts-without-feedback-count");
const resultsCount = document.getElementById("deleted-accounts-results-count");
const resultsBody = document.getElementById("deleted-accounts-results-body");
const feedback = document.getElementById("deleted-accounts-feedback");

let allDeletedAccounts = [];
let initOverlayWatchdog = null;

function forceClearLoadingState() {
  if (typeof resetLoadingOverlay === "function") {
    resetLoadingOverlay();
  }

  document.querySelectorAll(".global-loading-overlay").forEach((overlay) => {
    overlay.hidden = true;
  });

  document.body.classList.remove("loading-active");
}

function stopInitOverlayWatchdog() {
  if (!initOverlayWatchdog) {
    return;
  }

  window.clearInterval(initOverlayWatchdog);
  initOverlayWatchdog = null;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setEmptyResults(message) {
  resultsBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
}

function normalizeSearchText(entry) {
  return [
    entry.name,
    entry.email,
    entry.phone,
    entry.recommendation,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");
}

function renderStats(entries) {
  const total = entries.length;
  const withRecommendation = entries.filter((entry) => String(entry.recommendation || "").trim()).length;

  totalCount.textContent = String(total);
  withFeedbackCount.textContent = String(withRecommendation);
  withoutFeedbackCount.textContent = String(total - withRecommendation);
}

function renderTable(entries) {
  resultsCount.textContent = `${entries.length} cuenta(s)`;

  if (!entries.length) {
    setEmptyResults("No hay cuentas eliminadas que coincidan con la búsqueda.");
    return;
  }

  resultsBody.innerHTML = entries.map((entry) => {
    const contactLine = [entry.email, entry.phone].filter(Boolean).join(" · ") || "Sin datos de contacto";
    const recommendation = String(entry.recommendation || "").trim();
    const feedbackMeta = entry.feedbackSubmittedAt
      ? `Opinión enviada ${formatDate(entry.feedbackSubmittedAt)}`
      : "Sin opinión registrada";

    return `
      <tr>
        <td data-label="Cuenta">
          <strong>${escapeHtml(entry.name || "Sin nombre")}</strong>
          <small>${escapeHtml(entry.role || "client")}</small>
        </td>
        <td data-label="Contacto">${escapeHtml(contactLine)}</td>
        <td data-label="Eliminada">
          <strong>${escapeHtml(formatDate(entry.deletedAt || entry.createdAt))}</strong>
          <small>${escapeHtml(entry.deletionSource || "self-service")}</small>
        </td>
        <td data-label="Opinión">
          <p class="deleted-account-recommendation ${recommendation ? "" : "is-empty"}">${escapeHtml(recommendation || "Sin opinión")}</p>
          <small>${escapeHtml(feedbackMeta)}</small>
        </td>
      </tr>
    `;
  }).join("");
}

function applyFilters() {
  const search = String(searchInput.value || "").trim().toLowerCase();
  const filteredEntries = allDeletedAccounts.filter((entry) => {
    if (!search) {
      return true;
    }

    return normalizeSearchText(entry).includes(search);
  });

  renderTable(filteredEntries);
}

async function loadDeletedAccounts() {
  try {
    await loadAdminSession();
    const data = await fetchJson("/api/admin/deleted-accounts");

    allDeletedAccounts = data.deletedAccounts || [];
    renderStats(allDeletedAccounts);
    applyFilters();
    setFeedback(feedback, "", "");
  } finally {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
  }
}

filterButton?.addEventListener("click", applyFilters);
searchInput?.addEventListener("input", applyFilters);
clearButton?.addEventListener("click", () => {
  searchInput.value = "";
  applyFilters();
});

forceClearLoadingState();
initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
window.addEventListener("pageshow", forceClearLoadingState);
window.addEventListener("load", forceClearLoadingState);

loadDeletedAccounts().catch((error) => {
  stopInitOverlayWatchdog();
  forceClearLoadingState();
  renderEmptyState(resultsBody, error.message);
  setFeedback(feedback, error.message, "error");
});
})();