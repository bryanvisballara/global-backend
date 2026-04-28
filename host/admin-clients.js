(() => {
if (window.__adminClientsScriptInitialized) {
  return;
}

window.__adminClientsScriptInitialized = true;

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

  const clientForm = document.getElementById("client-form");
  const clientFeedback = document.getElementById("client-feedback");
  const createModal = document.getElementById("client-create-modal");
  const openCreateButton = document.getElementById("clients-new-button");
  const cancelCreateButton = document.getElementById("client-create-cancel");
  const clientsTotalCount = document.getElementById("clients-total-count");
  const clientsWithOrdersCount = document.getElementById("clients-with-orders-count");
  const clientsWithoutOrdersCount = document.getElementById("clients-without-orders-count");
  const clientsResultsCount = document.getElementById("clients-results-count");
  const clientsResultsBody = document.getElementById("clients-results-body");
  const clientsSearchInput = document.getElementById("clients-search-input");
  const clientsCountryFilter = document.getElementById("clients-country-filter");
  const clientsOrdersFilter = document.getElementById("clients-orders-filter");
  const clientsFilterButton = document.getElementById("clients-filter-button");
  const clientsClearButton = document.getElementById("clients-clear-button");

  let allClients = [];
  let orderStatsByClientId = new Map();
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
    clientsResultsBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  }

  function openCreateModal() {
    if (!createModal) {
      return false;
    }

    createModal.hidden = false;
    document.body.classList.add("modal-open");
    return false;
  }

  function closeCreateModal() {
    if (!createModal) {
      return false;
    }

    createModal.hidden = true;
    document.body.classList.remove("modal-open");
    return false;
  }

  window.__openClientCreateModal = openCreateModal;

  function fillCountryFilter(clients) {
    const countries = [...new Set(clients
      .map((client) => String(client.country || "").trim())
      .filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));

    clientsCountryFilter.innerHTML = '<option value="">Todos</option>';
    countries.forEach((country) => {
      const option = document.createElement("option");
      option.value = country;
      option.textContent = country;
      clientsCountryFilter.appendChild(option);
    });
  }

  function normalizeClientSearchText(client) {
    return [
      client.name,
      client.email,
      client.phone,
      client.identification,
      client.address,
      client.city,
      client.country,
      client.notes,
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ");
  }

  function applyFilters() {
    const rawSearch = String(clientsSearchInput.value || "").trim().toLowerCase();
    const country = String(clientsCountryFilter.value || "").trim();
    const ordersFilter = String(clientsOrdersFilter.value || "all").trim();

    const filteredClients = allClients.filter((client) => {
      const orderCount = Number(orderStatsByClientId.get(String(client._id || client.id || "")) || 0);

      if (ordersFilter === "with" && orderCount < 1) {
        return false;
      }

      if (ordersFilter === "without" && orderCount > 0) {
        return false;
      }

      if (country && String(client.country || "").trim() !== country) {
        return false;
      }

      if (rawSearch && !normalizeClientSearchText(client).includes(rawSearch)) {
        return false;
      }

      return true;
    });

    renderClientsTable(filteredClients);
  }

  function renderClientsTable(clients) {
    clientsResultsCount.textContent = `${clients.length} cliente(s)`;

    if (!clients.length) {
      setEmptyResults("No hay clientes que coincidan con los filtros.");
      return;
    }

    clientsResultsBody.innerHTML = clients.map((client) => {
      const clientId = String(client._id || client.id || "");
      const orderCount = Number(orderStatsByClientId.get(clientId) || 0);
      const contactLine = [client.email, client.phone].filter(Boolean).join(" · ") || "Sin datos de contacto";
      const locationLine = [client.city, client.country].filter(Boolean).join(", ") || "Sin ubicación";

      return `
        <tr>
          <td data-label="Nombre">
            <strong>${escapeHtml(client.name || "Sin nombre")}</strong>
            <small>${escapeHtml(client.identification ? `ID ${client.identification}` : "Sin identificación")}</small>
          </td>
          <td data-label="Contacto">${escapeHtml(contactLine)}</td>
          <td data-label="Ubicación">${escapeHtml(locationLine)}</td>
          <td data-label="Pedidos">${escapeHtml(String(orderCount))}</td>
        </tr>
      `;
    }).join("");
  }

  function renderStats(clients) {
    const total = clients.length;
    const withOrders = clients.reduce((count, client) => {
      const clientId = String(client._id || client.id || "");
      const orderCount = Number(orderStatsByClientId.get(clientId) || 0);
      return count + (orderCount > 0 ? 1 : 0);
    }, 0);
    const withoutOrders = total - withOrders;

    clientsTotalCount.textContent = String(total);
    clientsWithOrdersCount.textContent = String(withOrders);
    clientsWithoutOrdersCount.textContent = String(withoutOrders);
  }

  function buildOrderStats(orders) {
    const stats = new Map();

    (orders || []).forEach((order) => {
      const clientId = String(order?.client?._id || order?.client?.id || order?.client || "").trim();

      if (!clientId) {
        return;
      }

      stats.set(clientId, Number(stats.get(clientId) || 0) + 1);
    });

    return stats;
  }

  async function loadClients() {
    try {
      await loadAdminSession();

      const [usersData, ordersData] = await Promise.all([
        fetchJson("/api/admin/clients"),
        fetchJson("/api/admin/orders"),
      ]);

      allClients = usersData.clients || [];
      orderStatsByClientId = buildOrderStats(ordersData.orders || []);

      fillCountryFilter(allClients);
      renderStats(allClients);
      applyFilters();
    } finally {
      stopInitOverlayWatchdog();
      forceClearLoadingState();
    }
  }

  clientForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(clientForm);

    setFeedback(clientFeedback, "Creando cliente...");

    try {
      await fetchJson("/api/admin/clients", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          phone: formData.get("phone"),
          identification: formData.get("identification"),
          address: formData.get("address"),
          city: formData.get("city"),
          country: formData.get("country"),
          notes: formData.get("notes"),
        }),
      });

      clientForm.reset();
      setFeedback(clientFeedback, "Cliente creado correctamente.", "success");
      closeCreateModal();
      await loadClients();
    } catch (error) {
      setFeedback(clientFeedback, error.message, "error");
    }
  });

  openCreateButton?.addEventListener("click", openCreateModal);
  cancelCreateButton?.addEventListener("click", closeCreateModal);
  createModal?.querySelector('[data-close-modal="client-create-modal"]')?.addEventListener("click", closeCreateModal);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && createModal && !createModal.hidden) {
      closeCreateModal();
    }
  });

  clientsFilterButton?.addEventListener("click", applyFilters);
  clientsSearchInput?.addEventListener("input", applyFilters);
  clientsCountryFilter?.addEventListener("change", applyFilters);
  clientsOrdersFilter?.addEventListener("change", applyFilters);
  clientsClearButton?.addEventListener("click", () => {
    clientsSearchInput.value = "";
    clientsCountryFilter.value = "";
    clientsOrdersFilter.value = "all";
    applyFilters();
  });

  forceClearLoadingState();
  initOverlayWatchdog = window.setInterval(forceClearLoadingState, 600);
  window.addEventListener("pageshow", forceClearLoadingState);
  window.addEventListener("load", forceClearLoadingState);

  loadClients().catch((error) => {
    stopInitOverlayWatchdog();
    forceClearLoadingState();
    setEmptyResults(error.message);
    setFeedback(clientFeedback, error.message, "error");
  });
}
})();