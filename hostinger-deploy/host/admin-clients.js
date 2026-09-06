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
  const clientCreateTitle = document.getElementById("client-create-title");
  const clientCreateCopy = createModal?.querySelector(".modal-copy");
  const clientSubmitButton = document.getElementById("client-submit-button");
  const clientFormFeedback = document.getElementById("client-form-feedback");
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
  let editingClient = null;

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

  function setClientModalMode(mode = "create") {
    const isEdit = mode === "edit";

    if (clientCreateTitle) {
      clientCreateTitle.textContent = isEdit ? "Editar cliente" : "Crear cliente";
    }

    if (clientCreateCopy) {
      clientCreateCopy.textContent = isEdit
        ? "Actualiza la información del cliente seleccionado."
        : "Completa la información para registrar un nuevo cliente.";
    }

    if (clientSubmitButton) {
      clientSubmitButton.textContent = isEdit ? "Guardar cambios" : "Crear cliente";
    }
  }

  function fillClientForm(client = {}) {
    if (!clientForm) {
      return;
    }

    const fields = ["name", "email", "phone", "identification", "address", "city", "country", "notes"];
    fields.forEach((fieldName) => {
      if (clientForm.elements[fieldName]) {
        clientForm.elements[fieldName].value = String(client[fieldName] || "");
      }
    });
  }

  function openCreateModal() {
    if (!createModal) {
      return false;
    }

    editingClient = null;
    clientForm?.reset();
    setClientModalMode("create");
    setFeedback(clientFormFeedback, "");
    createModal.hidden = false;
    document.body.classList.add("modal-open");
    return false;
  }

  function openEditModal(client) {
    if (!createModal || !client) {
      return false;
    }

    editingClient = client;
    fillClientForm(client);
    setClientModalMode("edit");
    setFeedback(clientFormFeedback, "");
    createModal.hidden = false;
    document.body.classList.add("modal-open");
    return false;
  }

  function closeCreateModal() {
    if (!createModal) {
      return false;
    }

    editingClient = null;
    clientForm?.reset();
    setClientModalMode("create");
    createModal.hidden = true;
    document.body.classList.remove("modal-open");
    return false;
  }

  window.__openClientCreateModal = openCreateModal;

  function normalizeUppercaseInputValue(value) {
    return String(value || "").toUpperCase().trim();
  }

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
          <td data-label="Contacto">
            ${escapeHtml(contactLine)}
            <small>${escapeHtml(locationLine)}</small>
          </td>
          <td data-label="Pedidos">${escapeHtml(String(orderCount))}</td>
          <td data-label="Acciones" class="clients-actions-cell">
            <div class="clients-row-actions">
              <button class="secondary-button clients-edit-button" type="button" data-edit-client="${escapeHtml(clientId)}">Editar</button>
            </div>
          </td>
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

    const payload = {
      name: normalizeUppercaseInputValue(formData.get("name")),
      email: normalizeUppercaseInputValue(formData.get("email")),
      phone: normalizeUppercaseInputValue(formData.get("phone")),
      identification: normalizeUppercaseInputValue(formData.get("identification")),
      address: normalizeUppercaseInputValue(formData.get("address")),
      city: normalizeUppercaseInputValue(formData.get("city")),
      country: normalizeUppercaseInputValue(formData.get("country")),
      notes: normalizeUppercaseInputValue(formData.get("notes")),
    };
    const isEdit = Boolean(editingClient?._id || editingClient?.id);

    setFeedback(clientFormFeedback, isEdit ? "Guardando cambios..." : "Creando cliente...");
    setFeedback(clientFeedback, isEdit ? "Guardando cambios..." : "Creando cliente...");

    try {
      if (isEdit) {
        const clientId = String(editingClient._id || editingClient.id);
        await fetchJson(`/api/admin/clients/${encodeURIComponent(clientId)}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...payload,
            clientRegion: editingClient.clientRegion || "",
          }),
        });
        setFeedback(clientFeedback, "Cliente actualizado correctamente.", "success");
      } else {
        await fetchJson("/api/admin/clients", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFeedback(clientFeedback, "Cliente creado correctamente.", "success");
      }

      clientForm.reset();
      closeCreateModal();
      await loadClients();
    } catch (error) {
      setFeedback(clientFormFeedback, error.message, "error");
      setFeedback(clientFeedback, error.message, "error");
    }
  });

  clientForm?.addEventListener("input", (event) => {
    const field = event.target;

    if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLTextAreaElement)) {
      return;
    }

    if (!["text", "email", "textarea"].includes(field.type || (field instanceof HTMLTextAreaElement ? "textarea" : ""))) {
      return;
    }

    const cursorStart = field.selectionStart;
    const cursorEnd = field.selectionEnd;
    field.value = String(field.value || "").toUpperCase();

    if (typeof cursorStart === "number" && typeof cursorEnd === "number") {
      field.setSelectionRange(cursorStart, cursorEnd);
    }
  });

  clientsResultsBody?.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-client]");

    if (!editButton) {
      return;
    }

    const clientId = String(editButton.dataset.editClient || "");
    const client = allClients.find((entry) => String(entry._id || entry.id || "") === clientId);

    if (!client) {
      setFeedback(clientFeedback, "No se encontró el cliente seleccionado.", "error");
      return;
    }

    openEditModal(client);
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