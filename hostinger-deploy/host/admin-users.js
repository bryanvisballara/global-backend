(() => {
if (window.__adminUsersScriptInitialized) {
  return;
}

window.__adminUsersScriptInitialized = true;

const {
  attachLogout,
  fetchJson,
  loadAdminSession,
  resetLoadingOverlay,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const usersTotalCount = document.getElementById("users-total-count");
  const usersResultsCount = document.getElementById("users-results-count");
  const usersResultsBody = document.getElementById("users-results-body");
  const usersSearchInput = document.getElementById("users-search-input");
  const usersFilterButton = document.getElementById("users-filter-button");
  const usersClearButton = document.getElementById("users-clear-button");
  const usersFeedback = document.getElementById("users-feedback");

  let allUsers = [];
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

  function normalizeCollectionPayload(payload, keys = []) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    for (const key of keys) {
      if (Array.isArray(payload[key])) {
        return payload[key];
      }
    }

    if (Array.isArray(payload.data)) {
      return payload.data;
    }

    if (payload.data && typeof payload.data === "object") {
      for (const key of keys) {
        if (Array.isArray(payload.data[key])) {
          return payload.data[key];
        }
      }
    }

    return [];
  }

  function formatDateTimeLabel(value) {
    if (!value) {
      return "-";
    }

    return new Date(value).toLocaleString("es-CO", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function setEmptyResults(message) {
    usersResultsBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  }

  function normalizeUserSearchText(user) {
    return [user?.name, user?.email, user?.phone]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
  }

  function renderStats(users) {
    if (usersTotalCount) {
      usersTotalCount.textContent = String(users.length);
    }
  }

  function renderUsersTable(users) {
    if (usersResultsCount) {
      usersResultsCount.textContent = `${users.length} usuario(s)`;
    }

    if (!users.length) {
      setEmptyResults("No hay usuarios que coincidan con la búsqueda.");
      return;
    }

    usersResultsBody.innerHTML = users
      .map((user) => `
        <tr>
          <td data-label="Fecha de creación">${escapeHtml(formatDateTimeLabel(user?.createdAt))}</td>
          <td data-label="Nombre">${escapeHtml(user?.name || "-")}</td>
          <td data-label="Correo">${escapeHtml(user?.email || "-")}</td>
          <td data-label="Teléfono">${escapeHtml(user?.phone || "-")}</td>
        </tr>
      `)
      .join("");
  }

  function applyFilters() {
    const rawSearch = String(usersSearchInput?.value || "").trim().toLowerCase();

    const filteredUsers = allUsers.filter((user) => {
      if (rawSearch && !normalizeUserSearchText(user).includes(rawSearch)) {
        return false;
      }

      return true;
    });

    renderUsersTable(filteredUsers);
  }

  async function loadUsersPage() {
    try {
      const user = await loadAdminSession();

      if (String(user?.role || "").trim() === "brokerUSA") {
        window.location.replace("/admin-tracking.html");
        return;
      }

      const usersData = await fetchJson("/api/admin/users");
      allUsers = normalizeCollectionPayload(usersData, ["users"]);
      renderStats(allUsers);
      applyFilters();
      setFeedback(usersFeedback, "", "");
    } catch (error) {
      setEmptyResults(error.message || "No se pudieron cargar los usuarios.");
      setFeedback(usersFeedback, error.message || "No se pudieron cargar los usuarios.", "error");
    } finally {
      stopInitOverlayWatchdog();
      forceClearLoadingState();
    }
  }

  usersFilterButton?.addEventListener("click", applyFilters);
  usersClearButton?.addEventListener("click", () => {
    if (usersSearchInput) {
      usersSearchInput.value = "";
    }

    applyFilters();
  });
  usersSearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyFilters();
    }
  });

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);

  loadUsersPage().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    setEmptyResults(error.message || "No se pudieron cargar los usuarios.");
    setFeedback(usersFeedback, error.message || "No se pudieron cargar los usuarios.", "error");
  });
}

})();