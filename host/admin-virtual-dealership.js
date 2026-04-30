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
  const createMediaInput = document.getElementById("virtual-dealership-media-files");
  const createMediaPreview = document.getElementById("virtual-dealership-media-preview");
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
  const editMediaInput = document.getElementById("virtual-dealership-edit-media-files");
  const editMediaPreview = document.getElementById("virtual-dealership-edit-media-preview");
  const editCancelButton = document.getElementById("virtual-dealership-edit-cancel");
  const editSubmitButton = document.getElementById("virtual-dealership-edit-submit");
  let currentVehicles = [];
  let createImageItems = [];
  let editImageItems = [];
  let draggedCreateImageId = "";
  let draggedEditImageId = "";

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

  function buildMediaItemId(prefix = "media") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function createExistingImageItem(item = {}) {
    return {
      id: buildMediaItemId("existing"),
      source: "existing",
      url: String(item.url || "").trim(),
      caption: String(item.caption || "").trim(),
    };
  }

  function createNewImageItem(file) {
    return {
      id: buildMediaItemId("new"),
      source: "new",
      file,
      url: URL.createObjectURL(file),
      caption: file.name ? String(file.name).replace(/\.[^.]+$/, "") : "Imagen nueva",
    };
  }

  function revokeImageItems(items = []) {
    items.forEach((item) => {
      if (item?.source === "new" && item.url) {
        URL.revokeObjectURL(item.url);
      }
    });
  }

  function validateImageFiles(files = []) {
    const selectedFiles = Array.from(files || []);

    if (selectedFiles.some((file) => !String(file.type || "").startsWith("image/"))) {
      throw new Error("Solo puedes subir imágenes para la vitrina.");
    }

    if (selectedFiles.some((file) => file.size > 10 * 1024 * 1024)) {
      throw new Error("Cada imagen debe pesar 10 MB o menos.");
    }
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

  function renderImagePreview(items = [], container) {
    if (!container) {
      return;
    }

    if (!items.length) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }

    container.innerHTML = items.map((item, index) => `
      <article class="tracking-media-card image admin-sortable-media-card" draggable="true" data-media-item-id="${escapeHtml(item.id)}">
        <button class="admin-sortable-media-remove" type="button" data-remove-media-item="${escapeHtml(item.id)}" aria-label="Eliminar imagen ${index + 1}">&times;</button>
        <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || `Imagen ${index + 1}`)}" loading="lazy" />
        <div class="admin-sortable-media-meta">
          <strong>${escapeHtml(item.caption || `Imagen ${index + 1}`)}</strong>
          <span>${item.source === "existing" ? "Imagen actual" : "Imagen nueva"}</span>
          <small>Arrastra para cambiar el orden</small>
        </div>
      </article>
    `).join("");

    container.hidden = false;
  }

  function setCreateImageItems(files = []) {
    revokeImageItems(createImageItems);
    createImageItems = Array.from(files || []).map(createNewImageItem);
    renderImagePreview(createImageItems, createMediaPreview);
  }

  function setEditImageItems(items = []) {
    revokeImageItems(editImageItems);
    editImageItems = items;
    renderImagePreview(editImageItems, editMediaPreview);
  }

  function removeImageItem(items, itemId, container) {
    const itemIndex = items.findIndex((item) => item.id === itemId);

    if (itemIndex === -1) {
      return items;
    }

    const [removedItem] = items.splice(itemIndex, 1);
    revokeImageItems([removedItem]);
    renderImagePreview(items, container);
    return items;
  }

  function moveImageItem(items, itemId, targetId, container) {
    if (!itemId || !targetId || itemId === targetId) {
      return;
    }

    const currentIndex = items.findIndex((item) => item.id === itemId);
    const targetIndex = items.findIndex((item) => item.id === targetId);

    if (currentIndex === -1 || targetIndex === -1) {
      return;
    }

    const [movedItem] = items.splice(currentIndex, 1);
    items.splice(targetIndex, 0, movedItem);
    renderImagePreview(items, container);
  }

  function buildOrderedImagePayload(items = []) {
    const existingImages = items.filter((item) => item.source === "existing");
    const newImages = items.filter((item) => item.source === "new");
    const existingIndexById = new Map(existingImages.map((item, index) => [item.id, index]));
    const newIndexById = new Map(newImages.map((item, index) => [item.id, index]));

    return {
      existingImages: existingImages.map((item) => ({
        url: item.url,
        caption: item.caption || undefined,
      })),
      newFiles: newImages.map((item) => item.file),
      imageOrder: items.map((item) => (
        item.source === "existing"
          ? `existing:${existingIndexById.get(item.id)}`
          : `new:${newIndexById.get(item.id)}`
      )),
    };
  }

  function assertAtLeastOneImage(items = []) {
    if (!items.length) {
      throw new Error("Debes conservar o subir al menos una imagen.");
    }
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
    if (editMediaInput) {
      editMediaInput.value = "";
    }
    setEditImageItems((Array.isArray(vehicle.images) ? vehicle.images : []).map(createExistingImageItem));
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
    setEditImageItems([]);
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

  createMediaInput?.addEventListener("change", (event) => {
    try {
      const selectedFiles = Array.from(event.target.files || []);
      if (!selectedFiles.length) {
        return;
      }

      validateImageFiles(selectedFiles);
      setCreateImageItems(selectedFiles);
      setFeedback(feedback, `${selectedFiles.length} imagen(es) listas para publicar.`, "success");
      event.target.value = "";
    } catch (error) {
      setFeedback(feedback, error.message, "error");
      event.target.value = "";
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      assertAtLeastOneImage(createImageItems);
      const formData = new FormData(form);
      formData.delete("mediaFiles");
      createImageItems.forEach((item) => {
        formData.append("mediaFiles", item.file);
      });

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
      setCreateImageItems([]);
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

  editMediaInput?.addEventListener("change", (event) => {
    try {
      const selectedFiles = Array.from(event.target.files || []);

      if (!selectedFiles.length) {
        return;
      }

      validateImageFiles(selectedFiles);
      editImageItems = [...editImageItems, ...selectedFiles.map(createNewImageItem)];
      renderImagePreview(editImageItems, editMediaPreview);
      setFeedback(editFeedback, "Imágenes listas para guardar.", "success");
      event.target.value = "";
    } catch (error) {
      setFeedback(editFeedback, error.message, "error");
      event.target.value = "";
    }
  });

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

    try {
      assertAtLeastOneImage(editImageItems);
      editSubmitButton.disabled = true;
      setFeedback(editFeedback, "Guardando cambios...");

      const formData = new FormData();
      formData.append("price", String(price));
      formData.append("exteriorColor", editExteriorColorInput.value);
      formData.append("interiorColor", editInteriorColorInput.value);
      formData.append("mileage", editMileageInput.value);
      formData.append("engine", editEngineInput.value);
      formData.append("horsepower", editHorsepowerInput.value);
      formData.append("description", editDescriptionInput.value);

      const imagePayload = buildOrderedImagePayload(editImageItems);
      formData.append("existingImages", JSON.stringify(imagePayload.existingImages));
      formData.append("imageOrder", JSON.stringify(imagePayload.imageOrder));
      imagePayload.newFiles.forEach((file) => {
        formData.append("mediaFiles", file);
      });

      await fetchJson(`/api/admin/virtual-dealership/${vehicleId}`, {
        method: "PATCH",
        body: formData,
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

  function bindPreviewInteractions(container, getItems, setItems, getDraggedId, setDraggedId) {
    container?.addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove-media-item]");

      if (!removeButton) {
        return;
      }

      const nextItems = getItems();
      setItems(removeImageItem(nextItems, String(removeButton.dataset.removeMediaItem || ""), container));
    });

    container?.addEventListener("dragstart", (event) => {
      const card = event.target.closest("[data-media-item-id]");

      if (!card) {
        return;
      }

      setDraggedId(String(card.dataset.mediaItemId || ""));
      card.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
    });

    container?.addEventListener("dragover", (event) => {
      if (!getDraggedId()) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    container?.addEventListener("drop", (event) => {
      const draggedId = getDraggedId();

      if (!draggedId) {
        return;
      }

      event.preventDefault();
      const targetCard = event.target.closest("[data-media-item-id]");

      if (!targetCard) {
        return;
      }

      const nextItems = getItems();
      moveImageItem(nextItems, draggedId, String(targetCard.dataset.mediaItemId || ""), container);
      setItems(nextItems);
    });

    container?.addEventListener("dragend", () => {
      setDraggedId("");
      container.querySelectorAll(".is-dragging").forEach((element) => {
        element.classList.remove("is-dragging");
      });
    });
  }

  bindPreviewInteractions(
    createMediaPreview,
    () => createImageItems,
    (items) => {
      createImageItems = items;
      renderImagePreview(createImageItems, createMediaPreview);
    },
    () => draggedCreateImageId,
    (value) => {
      draggedCreateImageId = value;
    }
  );

  bindPreviewInteractions(
    editMediaPreview,
    () => editImageItems,
    (items) => {
      editImageItems = items;
      renderImagePreview(editImageItems, editMediaPreview);
    },
    () => draggedEditImageId,
    (value) => {
      draggedEditImageId = value;
    }
  );

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

  window.addEventListener("beforeunload", () => {
    revokeImageItems(createImageItems);
    revokeImageItems(editImageItems);
  });
})();
