const {
  attachLogout,
  fetchJson,
  formatDateTimeInBogota,
  resetLoadingOverlay,
  loadAdminSession,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const params = new URLSearchParams(window.location.search);
  let resolvedPostId = params.get("postId") || "";
  const legacyTitle = params.get("title") || "";
  const legacyBody = params.get("body") || "";
  const form = document.getElementById("edit-post-page-form");
  const submitButton = document.getElementById("edit-post-submit-button");
  const postIdInput = document.getElementById("edit-post-page-id");
  const titleInput = document.getElementById("edit-post-page-title");
  const bodyInput = document.getElementById("edit-post-page-body");
  const currentTitle = document.getElementById("edit-post-current-title");
  const currentBody = document.getElementById("edit-post-current-body");
  const editTitleTrigger = document.getElementById("edit-title-trigger");
  const editBodyTrigger = document.getElementById("edit-body-trigger");
  const metaContainer = document.getElementById("edit-post-page-meta");
  const feedback = document.getElementById("edit-post-page-feedback");
  const successModal = document.getElementById("success-action-modal");
  const successDescription = document.getElementById("success-action-description");
  const successClose = document.getElementById("success-action-close");
  const mediaSection = document.getElementById("edit-post-media-section");
  const mediaInput = document.getElementById("edit-post-page-media-files");
  const mediaPreview = document.getElementById("edit-post-page-media-preview");

  let currentPost = null;
  let editableMediaItems = [];
  let draggedMediaId = "";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unlockField(field, shouldSelect = false) {
    if (!field) {
      return;
    }

    field.readOnly = false;
    field.removeAttribute("readonly");
    field.focus();

    if (shouldSelect && typeof field.select === "function") {
      field.select();
    }
  }

  function normalizeComparableText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function scoreLegacyMatch(post) {
    const normalizedTitle = normalizeComparableText(legacyTitle);
    const normalizedBody = normalizeComparableText(legacyBody);
    const postTitle = normalizeComparableText(post?.title);
    const postBody = normalizeComparableText(post?.body);
    let score = 0;

    if (normalizedTitle && postTitle === normalizedTitle) {
      score += 100;
    } else if (normalizedTitle && (postTitle.includes(normalizedTitle) || normalizedTitle.includes(postTitle))) {
      score += 60;
    }

    if (normalizedBody && postBody === normalizedBody) {
      score += 100;
    } else if (normalizedBody && postBody && (postBody.includes(normalizedBody) || normalizedBody.includes(postBody))) {
      score += 45;
    }

    if (!normalizedTitle && normalizedBody && postBody) {
      score += 10;
    }

    return score;
  }

  function findBestLegacyMatch(posts) {
    return (posts || [])
      .map((post) => ({ post, score: scoreLegacyMatch(post) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)[0]?.post || null;
  }

  function setSubmitButtonState(isSaving) {
    if (!submitButton) {
      return;
    }

    submitButton.disabled = Boolean(isSaving);
    submitButton.textContent = isSaving ? "Guardando..." : "Guardar cambios";
  }

  function toggleSuccessModal(shouldOpen) {
    if (typeof resetLoadingOverlay === "function") {
      resetLoadingOverlay();
    }

    successModal.hidden = !shouldOpen;
    document.body.classList.toggle("modal-open", shouldOpen);
  }

  function forceCloseSuccessModal() {
    if (typeof resetLoadingOverlay === "function") {
      resetLoadingOverlay();
    }

    if (successModal) {
      successModal.hidden = true;
    }

    document.body.classList.remove("modal-open");
    document.body.classList.remove("loading-active");
  }

  window.__closeAdminEditSuccessModal = forceCloseSuccessModal;

  function updateUrlWithPostId(postId) {
    if (!postId) {
      return;
    }

    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.search = "";
    canonicalUrl.searchParams.set("postId", postId);
    window.history.replaceState({}, document.title, canonicalUrl.toString());
  }

  function buildMediaItemId(prefix = "media") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function createExistingMediaItem(item = {}) {
    return {
      id: buildMediaItemId("existing"),
      source: "existing",
      type: String(item.type || "image").trim() || "image",
      url: String(item.url || "").trim(),
      caption: String(item.caption || "").trim(),
    };
  }

  function createNewMediaItem(file) {
    return {
      id: buildMediaItemId("new"),
      source: "new",
      type: file.type.startsWith("video/") ? "video" : "image",
      file,
      url: URL.createObjectURL(file),
      caption: file.name ? String(file.name).replace(/\.[^.]+$/, "") : "Imagen nueva",
    };
  }

  function revokeRemovedMediaItem(item) {
    if (item?.source === "new" && item.url) {
      URL.revokeObjectURL(item.url);
    }
  }

  function clearEditableMediaItems() {
    editableMediaItems.forEach((item) => revokeRemovedMediaItem(item));
    editableMediaItems = [];
    renderMediaPreview();
  }

  function isImageManagedFormat(format = currentPost?.format) {
    return ["image", "carousel"].includes(String(format || "").trim().toLowerCase());
  }

  function validateSelectedImageFiles(files = []) {
    const selectedFiles = Array.from(files || []);

    if (selectedFiles.some((file) => !String(file.type || "").startsWith("image/"))) {
      throw new Error("Solo puedes subir imágenes en esta publicación.");
    }

    if (selectedFiles.some((file) => file.size > 10 * 1024 * 1024)) {
      throw new Error("Cada imagen debe pesar 10 MB o menos.");
    }
  }

  function validateManagedPostMedia() {
    if (!isImageManagedFormat()) {
      return;
    }

    if (currentPost?.format === "image" && editableMediaItems.length !== 1) {
      throw new Error("Imagen única requiere exactamente una imagen.");
    }

    if (currentPost?.format === "carousel" && editableMediaItems.length < 2) {
      throw new Error("Carrusel requiere al menos dos imágenes.");
    }
  }

  function renderMediaPreview() {
    if (!mediaPreview) {
      return;
    }

    if (!isImageManagedFormat() || !editableMediaItems.length) {
      mediaPreview.innerHTML = "";
      mediaPreview.hidden = true;
      return;
    }

    mediaPreview.innerHTML = editableMediaItems.map((item, index) => `
      <article
        class="tracking-media-card admin-sortable-media-card"
        draggable="true"
        data-media-item-id="${escapeHtml(item.id)}"
      >
        <button class="admin-sortable-media-remove" type="button" data-remove-media-item="${escapeHtml(item.id)}" aria-label="Eliminar imagen ${index + 1}">&times;</button>
        <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || `Imagen ${index + 1}`)}" loading="lazy" />
        <div class="admin-sortable-media-meta">
          <strong>${escapeHtml(item.caption || `Imagen ${index + 1}`)}</strong>
          <span>${item.source === "existing" ? "Imagen actual" : "Imagen nueva"}</span>
          <small>Arrastra para cambiar el orden</small>
        </div>
      </article>
    `).join("");

    mediaPreview.hidden = false;
  }

  function moveMediaItem(itemId, targetId) {
    if (!itemId || !targetId || itemId === targetId) {
      return;
    }

    const currentIndex = editableMediaItems.findIndex((item) => item.id === itemId);
    const targetIndex = editableMediaItems.findIndex((item) => item.id === targetId);

    if (currentIndex === -1 || targetIndex === -1) {
      return;
    }

    const [movedItem] = editableMediaItems.splice(currentIndex, 1);
    editableMediaItems.splice(targetIndex, 0, movedItem);
    renderMediaPreview();
  }

  function removeMediaItem(itemId) {
    const itemIndex = editableMediaItems.findIndex((item) => item.id === itemId);

    if (itemIndex === -1) {
      return;
    }

    const [removedItem] = editableMediaItems.splice(itemIndex, 1);
    revokeRemovedMediaItem(removedItem);
    renderMediaPreview();
  }

  function handleNewMediaFiles(fileList) {
    if (!isImageManagedFormat()) {
      return;
    }

    const selectedFiles = Array.from(fileList || []);

    if (!selectedFiles.length) {
      return;
    }

    validateSelectedImageFiles(selectedFiles);
    editableMediaItems = [...editableMediaItems, ...selectedFiles.map(createNewMediaItem)];
    renderMediaPreview();

    if (mediaInput) {
      mediaInput.value = "";
    }
  }

  function populateMediaSection(post) {
    if (!mediaSection) {
      return;
    }

    const managedFormat = isImageManagedFormat(post?.format);
    mediaSection.hidden = !managedFormat;

    clearEditableMediaItems();

    if (!managedFormat) {
      return;
    }

    editableMediaItems = (Array.isArray(post?.media) ? post.media : [])
      .filter((item) => item?.url && String(item.type || "image") === "image")
      .map(createExistingMediaItem);
    renderMediaPreview();
  }

  function fillForm(post) {
    if (!post) {
      return;
    }

    currentPost = post;
    postIdInput.value = post._id || resolvedPostId;
    titleInput.value = post.title || "";
    bodyInput.value = post.body || "";
    currentTitle.textContent = post.title || "Sin título";
    currentBody.textContent = post.body || "Sin texto";
    populateMediaSection(post);

    if (post.format || post.publishedAt || post.createdAt) {
      metaContainer.innerHTML = `
        <div class="info-box modal-info-box">
          <span>${post.format || "publicación"}</span>
          <strong>Publicada: ${formatDateTimeInBogota(post.publishedAt || post.createdAt)}</strong>
        </div>
      `;
    }
  }

  function buildOrderedMediaPayload() {
    const existingMediaItems = editableMediaItems.filter((item) => item.source === "existing");
    const newMediaItems = editableMediaItems.filter((item) => item.source === "new");
    const existingIndexById = new Map(existingMediaItems.map((item, index) => [item.id, index]));
    const newIndexById = new Map(newMediaItems.map((item, index) => [item.id, index]));

    return {
      existingMedia: existingMediaItems.map((item) => ({
        type: item.type,
        url: item.url,
        caption: item.caption || undefined,
      })),
      newFiles: newMediaItems.map((item) => item.file),
      mediaOrder: editableMediaItems.map((item) => (
        item.source === "existing"
          ? `existing:${existingIndexById.get(item.id)}`
          : `new:${newIndexById.get(item.id)}`
      )),
    };
  }

  async function resolvePostId() {
    if (postIdInput.value) {
      resolvedPostId = postIdInput.value;
      return resolvedPostId;
    }

    if (resolvedPostId) {
      return resolvedPostId;
    }

    if (!legacyTitle && !legacyBody) {
      return "";
    }

    let cachedPosts = [];

    try {
      cachedPosts = JSON.parse(sessionStorage.getItem("globalPublishedPosts") || "[]");
    } catch {
      cachedPosts = [];
    }

    const cachedMatch = findBestLegacyMatch(cachedPosts);

    if (cachedMatch?._id) {
      resolvedPostId = cachedMatch._id;
      postIdInput.value = resolvedPostId;
      updateUrlWithPostId(resolvedPostId);
      return resolvedPostId;
    }

    const data = await fetchJson("/api/admin/posts", {
      loadingMessage: "Ubicando publicación...",
    });

    const matchedPost = findBestLegacyMatch(data.posts || []);

    if (!matchedPost?._id) {
      throw new Error("No se pudo identificar la publicación a modificar.");
    }

    resolvedPostId = matchedPost._id;
    postIdInput.value = resolvedPostId;
    updateUrlWithPostId(resolvedPostId);
    return resolvedPostId;
  }

  async function loadPost() {
    loadAdminSession().catch(() => null);

    const effectivePostId = await resolvePostId();

    if (!effectivePostId) {
      throw new Error("No se recibió la publicación a modificar.");
    }

    const data = await fetchJson(`/api/admin/posts/${effectivePostId}`, {
      loadingMessage: "Cargando publicación...",
    });
    const post = data.post;

    if (!post) {
      throw new Error("No se encontró la publicación seleccionada.");
    }

    fillForm(post);
  }

  async function submitEdit(event) {
    event.preventDefault();

    if (!form?.reportValidity()) {
      return;
    }

    try {
      setSubmitButtonState(true);
      const effectivePostId = await resolvePostId();

      if (!effectivePostId) {
        throw new Error("No se pudo identificar la publicación a modificar.");
      }

      validateManagedPostMedia();

      const formData = new FormData();
      formData.append("title", titleInput.value);
      formData.append("body", bodyInput.value);
      formData.append("format", currentPost?.format || "carousel");

      if (isImageManagedFormat()) {
        const mediaPayload = buildOrderedMediaPayload();
        formData.append("existingMedia", JSON.stringify(mediaPayload.existingMedia));
        formData.append("mediaOrder", JSON.stringify(mediaPayload.mediaOrder));
        mediaPayload.newFiles.forEach((file) => {
          formData.append("mediaFiles", file);
        });
      }

      const data = await fetchJson(`/api/admin/posts/${effectivePostId}`, {
        method: "PATCH",
        body: formData,
        loadingMessage: "Guardando publicación...",
      });

      setFeedback(feedback, "Publicación modificada correctamente.", "success");
      fillForm(data.post || {
        _id: effectivePostId,
        title: titleInput.value,
        body: bodyInput.value,
        format: currentPost?.format,
        media: currentPost?.media || [],
      });
      successDescription.textContent = "La publicación fue modificada correctamente.";
      toggleSuccessModal(true);
    } catch (error) {
      setFeedback(feedback, error.message, "error");
    } finally {
      setSubmitButtonState(false);
      if (typeof resetLoadingOverlay === "function") {
        resetLoadingOverlay();
      }
    }
  }

  editTitleTrigger?.addEventListener("click", () => unlockField(titleInput, true));
  editBodyTrigger?.addEventListener("click", () => unlockField(bodyInput));
  mediaInput?.addEventListener("change", (event) => {
    try {
      handleNewMediaFiles(event.target.files);
      validateManagedPostMedia();
      setFeedback(feedback, editableMediaItems.length ? "Imágenes listas para guardar." : "", editableMediaItems.length ? "success" : "");
    } catch (error) {
      setFeedback(feedback, error.message, "error");
      event.target.value = "";
    }
  });

  mediaPreview?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-media-item]");

    if (!removeButton) {
      return;
    }

    removeMediaItem(String(removeButton.dataset.removeMediaItem || ""));
  });

  mediaPreview?.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-media-item-id]");

    if (!card) {
      return;
    }

    draggedMediaId = String(card.dataset.mediaItemId || "");
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
  });

  mediaPreview?.addEventListener("dragover", (event) => {
    if (!draggedMediaId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  mediaPreview?.addEventListener("drop", (event) => {
    if (!draggedMediaId) {
      return;
    }

    event.preventDefault();
    const targetCard = event.target.closest("[data-media-item-id]");

    if (!targetCard) {
      return;
    }

    moveMediaItem(draggedMediaId, String(targetCard.dataset.mediaItemId || ""));
  });

  mediaPreview?.addEventListener("dragend", () => {
    draggedMediaId = "";
    mediaPreview.querySelectorAll(".is-dragging").forEach((element) => {
      element.classList.remove("is-dragging");
    });
  });

  successClose?.addEventListener("click", forceCloseSuccessModal);
  document.querySelector('[data-close-modal="success-action-modal"]')?.addEventListener("click", forceCloseSuccessModal);
  form?.addEventListener("submit", submitEdit);

  loadPost().catch((error) => {
    setFeedback(feedback, error.message, "error");
    if (currentTitle) {
      currentTitle.textContent = "No se pudo cargar el título.";
    }
    if (currentBody) {
      currentBody.textContent = "No se pudo cargar el texto.";
    }
  });

  window.addEventListener("beforeunload", clearEditableMediaItems);
}
