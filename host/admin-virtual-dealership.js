(function bootstrapVirtualDealershipAdminPage() {
  if (window.__virtualDealershipAdminInitialized) {
    return;
  }

  window.__virtualDealershipAdminInitialized = true;

  const {
    attachLogout,
    fetchJson,
    formatCurrency,
    formatDateTimeInBogota,
    loadAdminSession,
    renderEmptyState,
    requireAdminAccess,
    setFeedback,
  } = window.AdminApp;

  if (!requireAdminAccess()) {
    return;
  }

  attachLogout();

  const form = document.getElementById("virtual-dealership-form");
  const feedback = document.getElementById("virtual-dealership-feedback");
  const listContainer = document.getElementById("virtual-dealership-list");
  const successModal = document.getElementById("virtual-dealership-success-modal");
  const successDescription = document.getElementById("virtual-dealership-success-description");
  const successMeta = document.getElementById("virtual-dealership-success-meta");
  const editModal = document.getElementById("virtual-dealership-edit-modal");
  const editForm = document.getElementById("virtual-dealership-edit-form");
  const editFeedback = document.getElementById("virtual-dealership-edit-feedback");
  const editVehicleIdInput = document.getElementById("virtual-dealership-edit-id");
  const editPriceInput = document.getElementById("virtual-dealership-edit-price");
  const editExteriorColorInput = document.getElementById("virtual-dealership-edit-exterior-color");
  const editInteriorColorInput = document.getElementById("virtual-dealership-edit-interior-color");
  const editMileageInput = document.getElementById("virtual-dealership-edit-mileage");
  const editEngineInput = document.getElementById("virtual-dealership-edit-engine");
  const editHorsepowerInput = document.getElementById("virtual-dealership-edit-horsepower");
  const editDescriptionInput = document.getElementById("virtual-dealership-edit-description");
  const editCancelButton = document.getElementById("virtual-dealership-edit-cancel");
  const editSubmitButton = document.getElementById("virtual-dealership-edit-submit");
  let currentVehicles = [];

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeStatusLabel(status) {
    if (status === "reserved") {
      return "Reservado";
    }

    if (status === "sold") {
      return "Vendido";
    }

    return "Disponible";
  }

  function syncModalState() {
    const hasOpenModal = (successModal && !successModal.hidden) || (editModal && !editModal.hidden);
    document.body.classList.toggle("modal-open", hasOpenModal);
  }

  function closeSuccessModal() {
    if (!successModal) {
      return;
    }

    successModal.hidden = true;
    syncModalState();
  }

  function showSuccessModal(vehicle) {
    if (!successModal) {
      return;
    }

    const title = `${vehicle?.brand || "Vehículo"} ${vehicle?.model || ""} ${vehicle?.version || ""}`.trim();
    const formattedPrice = formatCurrency(vehicle?.price || 0, vehicle?.currency || "COP");

    if (successDescription) {
      successDescription.textContent = `${title} se publicó correctamente en el concesionario virtual.`;
    }

    if (successMeta) {
      successMeta.innerHTML = `
        <div class="info-box modal-info-box">
          <span>Vehículo</span>
          <strong>${escapeHtml(title || "Sin referencia")}</strong>
        </div>
        <div class="info-box modal-info-box">
          <span>Precio</span>
          <strong>${escapeHtml(formattedPrice)}</strong>
        </div>
      `;
    }

    successModal.hidden = false;
    syncModalState();
  }

  function findVehicle(vehicleId) {
    return currentVehicles.find((vehicle) => String(vehicle?._id || "") === String(vehicleId || "")) || null;
  }

  function openEditModal(vehicleId) {
    const vehicle = findVehicle(vehicleId);

    if (!vehicle || !editModal || !editForm) {
      return;
    }

    editVehicleIdInput.value = String(vehicle._id || "");
    editPriceInput.value = vehicle.price ?? "";
    editExteriorColorInput.value = vehicle.exteriorColor || "";
    editInteriorColorInput.value = vehicle.interiorColor || "";
    editMileageInput.value = vehicle.mileage ?? "";
    editEngineInput.value = vehicle.engine || "";
    editHorsepowerInput.value = vehicle.horsepower ?? "";
    editDescriptionInput.value = vehicle.description || "";
    setFeedback(editFeedback, "");
    editModal.hidden = false;
    syncModalState();
  }

  function closeEditModal() {
    if (!editModal || !editForm) {
      return;
    }

    editModal.hidden = true;
    editForm.reset();
    editVehicleIdInput.value = "";
    setFeedback(editFeedback, "");
    syncModalState();
  }

  function renderVehicles(vehicles) {
    if (!vehicles.length) {
      renderEmptyState(listContainer, "Todavía no hay vehículos publicados en vitrina.");
      return;
    }

    listContainer.innerHTML = vehicles
      .map((vehicle) => {
        const firstImage = vehicle.images?.[0]?.url || "";
        return `
          <article class="list-item virtual-dealer-item">
            <div class="virtual-dealer-item-main">
              ${firstImage ? `<img src="${escapeHtml(firstImage)}" alt="${escapeHtml(`${vehicle.brand} ${vehicle.model}`)}" />` : ""}
              <div>
                <strong>${escapeHtml(vehicle.brand)} ${escapeHtml(vehicle.model)} ${escapeHtml(vehicle.version)}</strong>
                <p>${escapeHtml(formatCurrency(vehicle.price, vehicle.currency || "COP"))}</p>
                <p>${escapeHtml(vehicle.exteriorColor || "Sin color exterior")} · ${escapeHtml(vehicle.interiorColor || "Sin cojinería")}</p>
                <p>${escapeHtml(vehicle.mileage != null ? `${vehicle.mileage} km` : "Kilometraje N/D")} · ${escapeHtml(vehicle.engine || "Motor N/D")} · ${escapeHtml(vehicle.horsepower != null ? `${vehicle.horsepower} HP` : "Potencia N/D")}</p>
                <p>${escapeHtml(normalizeStatusLabel(vehicle.status))} · ${escapeHtml(formatDateTimeInBogota(vehicle.createdAt))}</p>
              </div>
            </div>
            <div class="virtual-dealer-item-actions">
              <button class="secondary-button" type="button" data-vehicle-action="edit" data-vehicle-id="${vehicle._id}">Editar</button>
              <button class="secondary-button" type="button" data-vehicle-action="status" data-vehicle-id="${vehicle._id}" data-next-status="available">Disponible</button>
              <button class="secondary-button" type="button" data-vehicle-action="status" data-vehicle-id="${vehicle._id}" data-next-status="reserved">Reservar</button>
              <button class="secondary-button" type="button" data-vehicle-action="status" data-vehicle-id="${vehicle._id}" data-next-status="sold">Vender</button>
              <button class="secondary-button danger" type="button" data-vehicle-action="delete" data-vehicle-id="${vehicle._id}">Eliminar</button>
            </div>
          </article>
        `;
      })
      .join("");
  }

  async function loadVehicles() {
    await loadAdminSession();
    const data = await fetchJson("/api/admin/virtual-dealership", {
      loadingMessage: "Cargando vehículos de vitrina...",
    });
    currentVehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
    renderVehicles(currentVehicles);
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const selectedFiles = form.querySelector('input[name="mediaFiles"]')?.files || [];

    if (!selectedFiles.length) {
      setFeedback(feedback, "Debes subir al menos una imagen para publicar el vehículo.", "error");
      return;
    }

    try {
      setFeedback(feedback, "Publicando vehículo en vitrina...");
      await fetchJson("/api/admin/virtual-dealership", {
        method: "POST",
        body: formData,
        loadingMessage: "Subiendo vehículo al concesionario virtual...",
      });

      const publishedBrand = String(formData.get("brand") || "Vehículo").trim();
      const publishedModel = String(formData.get("model") || "").trim();
      const publishedVersion = String(formData.get("version") || "").trim();
      const publishedPrice = Number(formData.get("price") || 0);
      const publishedCurrency = String(formData.get("currency") || "COP");

      form.reset();
      setFeedback(feedback, "Vehículo publicado correctamente.", "success");
      await loadVehicles();
      showSuccessModal({
        brand: publishedBrand,
        model: publishedModel,
        version: publishedVersion,
        price: publishedPrice,
        currency: publishedCurrency,
      });
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    }
  });

  document.getElementById("virtual-dealership-success-close")?.addEventListener("click", closeSuccessModal);
  document.querySelector('[data-close-modal="virtual-dealership-success-modal"]')?.addEventListener("click", closeSuccessModal);
  editCancelButton?.addEventListener("click", closeEditModal);
  document.querySelector('[data-close-modal="virtual-dealership-edit-modal"]')?.addEventListener("click", closeEditModal);

  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const vehicleId = String(editVehicleIdInput.value || "").trim();
    const price = Number(editPriceInput.value || 0);

    if (!vehicleId) {
      setFeedback(editFeedback, "No se pudo identificar el vehículo que vas a modificar.", "error");
      return;
    }

    if (!Number.isFinite(price) || price < 0) {
      setFeedback(editFeedback, "Ingresa un precio válido.", "error");
      return;
    }

    editSubmitButton.disabled = true;
    setFeedback(editFeedback, "Guardando cambios...");

    try {
      await fetchJson(`/api/admin/virtual-dealership/${vehicleId}`, {
        method: "PATCH",
        body: JSON.stringify({
          price,
          exteriorColor: editExteriorColorInput.value,
          interiorColor: editInteriorColorInput.value,
          mileage: editMileageInput.value,
          engine: editEngineInput.value,
          horsepower: editHorsepowerInput.value,
          description: editDescriptionInput.value,
        }),
        loadingMessage: "Actualizando vehículo en vitrina...",
      });

      closeEditModal();
      await loadVehicles();
      setFeedback(feedback, "Vehículo actualizado correctamente.", "success");
    } catch (error) {
      setFeedback(editFeedback, error.message, "error");
    } finally {
      editSubmitButton.disabled = false;
    }
  });

  listContainer?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-vehicle-action]");

    if (!button) {
      return;
    }

    const vehicleId = button.dataset.vehicleId;
    const action = button.dataset.vehicleAction;

    try {
      if (action === "edit") {
        openEditModal(vehicleId);
        return;
      }

      if (action === "delete") {
        await fetchJson(`/api/admin/virtual-dealership/${vehicleId}`, {
          method: "DELETE",
          loadingMessage: "Eliminando vehículo...",
        });
      }

      if (action === "status") {
        await fetchJson(`/api/admin/virtual-dealership/${vehicleId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.nextStatus }),
          loadingMessage: "Actualizando estado del vehículo...",
        });
      }

      await loadVehicles();
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    }
  });

  loadVehicles().catch((error) => {
    setFeedback(feedback, error.message, "error");
    renderEmptyState(listContainer, error.message);
  });
})();
