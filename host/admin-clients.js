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
  const clientFormFeedback = document.getElementById("client-form-feedback");
  const createModal = document.getElementById("client-create-modal");
  const openCreateButton = document.getElementById("clients-new-button");
  const cancelCreateButton = document.getElementById("client-create-cancel");
  const clientModalTitle = document.getElementById("client-create-title");
  const clientModalCopy = createModal?.querySelector(".modal-copy") || null;
  const clientSubmitButton = document.getElementById("client-submit-button");
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
  const clientOrdersModal = document.getElementById("client-orders-modal");
  const clientOrdersTitle = document.getElementById("client-orders-title");
  const clientOrdersCopy = document.getElementById("client-orders-copy");
  const clientOrdersList = document.getElementById("client-orders-list");
  const clientOrdersCloseButton = document.getElementById("client-orders-close");
  const clientDeleteModal = document.getElementById("client-delete-modal");
  const clientDeleteCopy = document.getElementById("client-delete-copy");
  const clientDeleteFeedback = document.getElementById("client-delete-feedback");
  const clientDeleteCancelButton = document.getElementById("client-delete-cancel");
  const clientDeleteConfirmButton = document.getElementById("client-delete-confirm");

  let allClients = [];
  let allOrders = [];
  let orderStatsByClientId = new Map();
  let initOverlayWatchdog = null;
  let editingClientId = "";
  let editingClientRegion = "";
  let pendingDeleteClientId = "";
  let pendingDeleteClientRegion = "";

  const CLIENT_MODAL_COPY_CREATE = "Completa la información para registrar un nuevo cliente.";
  const CLIENT_MODAL_COPY_EDIT = "Actualiza la información del cliente seleccionado.";

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

  function getClientId(client) {
    return String(client?._id || client?.id || "").trim();
  }

  function getClientRegion(client) {
    return String(client?.clientRegion || "").trim().toLowerCase();
  }

  function getOrderClientId(order) {
    return String(order?.client?._id || order?.client?.id || order?.client || "").trim();
  }

  function getClientById(clientId) {
    return allClients.find((client) => getClientId(client) === String(clientId || "").trim()) || null;
  }

  function updateBodyModalState() {
    const isAnyModalOpen = [createModal, clientOrdersModal, clientDeleteModal].some((modal) => modal && !modal.hidden);
    document.body.classList.toggle("modal-open", isAnyModalOpen);
  }

  function setEmptyResults(message) {
    clientsResultsBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
  }

  function openModal(modal) {
    if (!modal) {
      return false;
    }

    modal.hidden = false;
    updateBodyModalState();
    return false;
  }

  function closeModal(modal) {
    if (!modal) {
      return false;
    }

    modal.hidden = true;
    updateBodyModalState();
    return false;
  }

  function setClientFormMode(mode, client = null) {
    const normalizedMode = mode === "edit" ? "edit" : "create";

    editingClientId = normalizedMode === "edit" ? getClientId(client) : "";
    editingClientRegion = normalizedMode === "edit" ? getClientRegion(client) : "";
    clientForm.dataset.mode = normalizedMode;
    clientForm.dataset.clientId = editingClientId;
    clientForm.dataset.clientRegion = editingClientRegion;

    if (clientModalTitle) {
      clientModalTitle.textContent = normalizedMode === "edit" ? "Editar cliente" : "Crear cliente";
    }

    if (clientModalCopy) {
      clientModalCopy.textContent = normalizedMode === "edit" ? CLIENT_MODAL_COPY_EDIT : CLIENT_MODAL_COPY_CREATE;
    }

    if (clientSubmitButton) {
      clientSubmitButton.textContent = normalizedMode === "edit" ? "Guardar cambios" : "Crear cliente";
    }
  }

  function populateClientForm(client = null) {
    const fields = ["name", "email", "phone", "identification", "address", "city", "country", "notes"];

    fields.forEach((fieldName) => {
      const field = clientForm?.elements?.namedItem(fieldName);

      if (field && "value" in field) {
        field.value = client ? String(client[fieldName] || "") : "";
      }
    });
  }

  function openCreateModal() {
    if (!createModal || !clientForm) {
      return false;
    }

    clientForm.reset();
    setClientFormMode("create");
    setFeedback(clientFormFeedback, "");
    return openModal(createModal);
  }

  function closeCreateModal() {
    setFeedback(clientFormFeedback, "");
    return closeModal(createModal);
  }

  function openEditModal(clientId) {
    const client = getClientById(clientId);

    if (!client || !clientForm) {
      setFeedback(clientFeedback, "No se encontró el cliente seleccionado.", "error");
      return;
    }

    setClientFormMode("edit", client);
    populateClientForm(client);
    setFeedback(clientFormFeedback, "");
    openModal(createModal);
  }

  function getClientOrders(clientId) {
    return allOrders
      .filter((order) => getOrderClientId(order) === String(clientId || "").trim())
      .sort((left, right) => new Date(right.updatedAt || right.createdAt || 0).getTime() - new Date(left.updatedAt || left.createdAt || 0).getTime());
  }

  function formatClientOrderLabel(order) {
    return [
      order?.vehicle?.brand,
      order?.vehicle?.model,
      order?.vehicle?.version,
      order?.vehicle?.year,
    ].filter(Boolean).join(" ") || "Vehículo sin detalle";
  }

  function formatClientOrderDate(dateValue) {
    if (!dateValue) {
      return "Sin fecha";
    }

    return new Date(dateValue).toLocaleDateString("es-CO", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
  }

  function renderClientOrders(client) {
    if (!clientOrdersModal || !clientOrdersList) {
      return;
    }

    const clientName = String(client?.name || "Cliente").trim() || "Cliente";
    const clientOrders = getClientOrders(getClientId(client));

    if (clientOrdersTitle) {
      clientOrdersTitle.textContent = `Pedidos de ${clientName}`;
    }

    if (clientOrdersCopy) {
      clientOrdersCopy.textContent = `${clientOrders.length} pedido(s) relacionado(s) con este cliente.`;
    }

    if (!clientOrders.length) {
      clientOrdersList.innerHTML = '<div class="empty-state">Este cliente no tiene pedidos relacionados.</div>';
      openModal(clientOrdersModal);
      return;
    }

    clientOrdersList.innerHTML = clientOrders.map((order) => {
      const orderId = String(order?._id || "").trim();
      const trackingNumber = String(order?.trackingNumber || "Sin tracking").trim();
      const destination = String(order?.vehicle?.destination || "Sin destino").trim();
      const createdAt = formatClientOrderDate(order?.createdAt);

      return `
        <article class="published-post-item client-related-order-item">
          <div class="published-post-copy">
            <strong>${escapeHtml(formatClientOrderLabel(order))}</strong>
            <span>Tracking ${escapeHtml(trackingNumber)}</span>
            <span>Destino ${escapeHtml(destination)} · ${escapeHtml(createdAt)}</span>
          </div>
          ${orderId
            ? `<a class="published-post-action" href="/admin-tracking.html?orderId=${encodeURIComponent(orderId)}">Ver pedido</a>`
            : ""}
        </article>
      `;
    }).join("");

    openModal(clientOrdersModal);
  }

  function closeClientOrdersModal() {
    return closeModal(clientOrdersModal);
  }

  function openDeleteModal(clientId) {
    const client = getClientById(clientId);

    if (!client) {
      setFeedback(clientFeedback, "No se encontró el cliente seleccionado.", "error");
      return;
    }

    pendingDeleteClientId = getClientId(client);
    pendingDeleteClientRegion = getClientRegion(client);
    const orderCount = getClientOrders(pendingDeleteClientId).length;
    const clientName = String(client.name || "este cliente").trim() || "este cliente";

    if (clientDeleteCopy) {
      clientDeleteCopy.textContent = orderCount > 0
        ? `${clientName} tiene ${orderCount} pedido(s) asociado(s), por lo que no se puede eliminar desde aquí.`
        : `Vas a eliminar a ${clientName}. Esta acción no se puede deshacer.`;
    }

    if (clientDeleteConfirmButton) {
      clientDeleteConfirmButton.disabled = orderCount > 0;
    }

    setFeedback(clientDeleteFeedback, orderCount > 0 ? "Elimina o reasigna los pedidos relacionados antes de borrar este cliente." : "");
    openModal(clientDeleteModal);
  }

  function closeDeleteModal() {
    pendingDeleteClientId = "";
    pendingDeleteClientRegion = "";

    if (clientDeleteConfirmButton) {
      clientDeleteConfirmButton.disabled = false;
    }

    setFeedback(clientDeleteFeedback, "");
    return closeModal(clientDeleteModal);
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
          <td data-label="Contacto">${escapeHtml(contactLine)}</td>
          <td data-label="Ubicación">${escapeHtml(locationLine)}</td>
          <td data-label="Pedidos">${escapeHtml(String(orderCount))}</td>
          <td class="clients-actions-cell" data-label="Acciones">
            <div class="clients-row-actions">
              <button
                type="button"
                class="maintenance-action-icon"
                data-edit-client="${escapeHtml(clientId)}"
                title="Editar cliente"
                aria-label="Editar cliente"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25Zm2.92 2.33H5v-.92l8.06-8.06.92.92L5.92 19.58ZM20.71 7.04a1 1 0 0 0 0-1.41L18.37 3.3a1 1 0 0 0-1.41 0l-1.42 1.41 3.75 3.75 1.42-1.42Z"></path></svg>
              </button>
              <button
                type="button"
                class="maintenance-action-icon"
                data-view-client-orders="${escapeHtml(clientId)}"
                title="Ver pedidos del cliente"
                aria-label="Ver pedidos del cliente"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4H3v2h2.14l1.72 7.59A2 2 0 0 0 8.81 15H18a2 2 0 0 0 1.94-1.51L21.7 7H7.42l-.27-1.2A2 2 0 0 0 5.2 4H7Zm1.81 9-.91-4h11.28l-1 4H8.81ZM9 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"></path></svg>
              </button>
              <button
                type="button"
                class="maintenance-action-icon is-danger"
                data-delete-client="${escapeHtml(clientId)}"
                title="Eliminar cliente"
                aria-label="Eliminar cliente"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.23 4.81 4.81 6.23 10.59 12l-5.78 5.77 1.42 1.42L12 13.41l5.77 5.78 1.42-1.42L13.41 12l5.78-5.77-1.42-1.42L12 10.59 6.23 4.81Z"></path></svg>
              </button>
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

      allClients = Array.isArray(usersData.clients) ? usersData.clients : [];
      allOrders = Array.isArray(ordersData.orders) ? ordersData.orders : [];
      orderStatsByClientId = buildOrderStats(allOrders);

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
    const clientPayload = {
      name: normalizeUppercaseInputValue(formData.get("name")),
      email: normalizeUppercaseInputValue(formData.get("email")),
      phone: normalizeUppercaseInputValue(formData.get("phone")),
      identification: normalizeUppercaseInputValue(formData.get("identification")),
      address: normalizeUppercaseInputValue(formData.get("address")),
      city: normalizeUppercaseInputValue(formData.get("city")),
      country: normalizeUppercaseInputValue(formData.get("country")),
      notes: normalizeUppercaseInputValue(formData.get("notes")),
      clientRegion: editingClientRegion || undefined,
    };
    const isEditing = clientForm.dataset.mode === "edit" && Boolean(editingClientId);

    setFeedback(clientFormFeedback, isEditing ? "Guardando cambios..." : "Creando cliente...");

    try {
      await fetchJson(isEditing ? `/api/admin/clients/${encodeURIComponent(editingClientId)}` : "/api/admin/clients", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(clientPayload),
      });

      clientForm.reset();
      setFeedback(clientFormFeedback, isEditing ? "Cliente actualizado correctamente." : "Cliente creado correctamente.", "success");
      closeCreateModal();
      setFeedback(clientFeedback, isEditing ? "Cliente actualizado correctamente." : "Cliente creado correctamente.", "success");
      await loadClients();
    } catch (error) {
      setFeedback(clientFormFeedback, error.message, "error");
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

  openCreateButton?.addEventListener("click", openCreateModal);
  cancelCreateButton?.addEventListener("click", closeCreateModal);
  createModal?.querySelector('[data-close-modal="client-create-modal"]')?.addEventListener("click", closeCreateModal);
  clientOrdersCloseButton?.addEventListener("click", closeClientOrdersModal);
  clientOrdersModal?.querySelector('[data-close-modal="client-orders-modal"]')?.addEventListener("click", closeClientOrdersModal);
  clientDeleteCancelButton?.addEventListener("click", closeDeleteModal);
  clientDeleteModal?.querySelector('[data-close-modal="client-delete-modal"]')?.addEventListener("click", closeDeleteModal);
  clientsResultsBody?.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-client]");

    if (editButton) {
      openEditModal(editButton.dataset.editClient || "");
      return;
    }

    const ordersButton = event.target.closest("[data-view-client-orders]");

    if (ordersButton) {
      const client = getClientById(ordersButton.dataset.viewClientOrders || "");

      if (!client) {
        setFeedback(clientFeedback, "No se encontró el cliente seleccionado.", "error");
        return;
      }

      renderClientOrders(client);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-client]");

    if (deleteButton) {
      openDeleteModal(deleteButton.dataset.deleteClient || "");
    }
  });
  clientDeleteConfirmButton?.addEventListener("click", async () => {
    if (!pendingDeleteClientId) {
      return;
    }

    if (clientDeleteConfirmButton) {
      clientDeleteConfirmButton.disabled = true;
    }

    setFeedback(clientDeleteFeedback, "Eliminando cliente...");

    try {
      await fetchJson(`/api/admin/clients/${encodeURIComponent(pendingDeleteClientId)}?clientRegion=${encodeURIComponent(pendingDeleteClientRegion || "")}`, {
        method: "DELETE",
        body: JSON.stringify({ clientRegion: pendingDeleteClientRegion || undefined }),
      });

      closeDeleteModal();
      setFeedback(clientFeedback, "Cliente eliminado correctamente.", "success");
      await loadClients();
    } catch (error) {
      setFeedback(clientDeleteFeedback, error.message, "error");

      if (clientDeleteConfirmButton) {
        clientDeleteConfirmButton.disabled = false;
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && clientDeleteModal && !clientDeleteModal.hidden) {
      closeDeleteModal();
      return;
    }

    if (event.key === "Escape" && clientOrdersModal && !clientOrdersModal.hidden) {
      closeClientOrdersModal();
      return;
    }

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