(() => {
if (window.__adminPostEditScriptInitialized) {
  return;
}

window.__adminPostEditScriptInitialized = true;

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
  const mediaSection = document.getElementById("edit-post-media-section");
  const mediaFilesInput = document.getElementById("edit-post-page-media-files");
  const mediaPreview = document.getElementById("edit-post-page-media-preview");
  const metaContainer = document.getElementById("edit-post-page-meta");
  const feedback = document.getElementById("edit-post-page-feedback");
  const successModal = document.getElementById("success-action-modal");
  const successDescription = document.getElementById("success-action-description");
  const successClose = document.getElementById("success-action-close");
  let currentPostFormat = "";
  let editMediaItems = [];
  let draggedMediaId = "";

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
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

  function fillForm(post) {
    if (!post) {
      return;
    }

    currentPostFormat = String(post.format || "").trim();
    postIdInput.value = post._id || resolvedPostId;
    titleInput.value = post.title || "";
    bodyInput.value = post.body || "";
    currentTitle.textContent = post.title || "Sin título";
    currentBody.textContent = post.body || "Sin texto";
    initializeMediaManager(post);

    if (post.format || post.publishedAt || post.createdAt) {
      metaContainer.innerHTML = `
        <div class="info-box modal-info-box">
          <span>${post.format || "publicación"}</span>
          <strong>Publicada: ${formatDateTimeInBogota(post.publishedAt || post.createdAt)}</strong>
        </div>
      `;
    }
  }

  function createMediaItemId(prefix, index) {
    return `${prefix}-${index}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function isImageMedia(item) {
    return String(item?.type || "").toLowerCase() === "image";
  }

  function shouldShowMediaManager(post) {
    const format = String(post?.format || "").toLowerCase();
    return format === "carousel" || format === "image";
  }

  function revokeNewMediaPreviewUrls() {
    editMediaItems.forEach((item) => {
      if (item.source === "new" && item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
  }

  function initializeMediaManager(post) {
    revokeNewMediaPreviewUrls();
    editMediaItems = [];
    draggedMediaId = "";

    if (!mediaSection || !mediaPreview || !shouldShowMediaManager(post)) {
      if (mediaSection) {
        mediaSection.hidden = true;
      }
      return;
    }

    editMediaItems = (post.media || [])
      .filter(isImageMedia)
      .map((item, index) => ({
        id: createMediaItemId("existing", index),
        source: "existing",
        media: {
          type: "image",
          url: String(item.url || "").trim(),
          caption: item.caption ? String(item.caption).trim() : undefined,
        },
      }))
      .filter((item) => item.media.url);

    mediaSection.hidden = false;
    renderEditMediaPreview();
  }

  function renderEditMediaPreview() {
    if (!mediaPreview) {
      return;
    }

    if (!editMediaItems.length) {
      mediaPreview.innerHTML = `
        <div class="empty-state admin-media-empty-state">
          Esta publicación no tiene imágenes seleccionadas.
        </div>
      `;
      mediaPreview.hidden = false;
      return;
    }

    mediaPreview.innerHTML = editMediaItems.map((item, index) => {
      const imageUrl = item.source === "new" ? item.previewUrl : item.media.url;
      const label = item.source === "new"
        ? item.file.name || `Nueva imagen ${index + 1}`
        : item.media.caption || `Imagen ${index + 1}`;

      return `
        <article
          class="tracking-media-card image admin-edit-media-card"
          draggable="true"
          data-media-id="${escapeHtml(item.id)}"
        >
          <button class="tracking-media-hidden-pill admin-media-remove-button" type="button" data-media-remove="${escapeHtml(item.id)}" aria-label="Eliminar imagen">
            ×
          </button>
          <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(label)}" loading="lazy" />
          <div class="admin-media-card-footer">
            <strong>${escapeHtml(label)}</strong>
            <span>Posición ${index + 1}</span>
          </div>
          <span class="admin-media-drag-hint">Arrastra para ordenar</span>
        </article>
      `;
    }).join("");

    mediaPreview.hidden = false;
  }

  function addNewMediaFiles(files = []) {
    const selectedFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));

    selectedFiles.forEach((file, index) => {
      editMediaItems.push({
        id: createMediaItemId("new", index),
        source: "new",
        file,
        previewUrl: URL.createObjectURL(file),
      });
    });

    renderEditMediaPreview();

    if (mediaFilesInput) {
      mediaFilesInput.value = "";
    }
  }

  function removeMediaItem(mediaId) {
    const item = editMediaItems.find((mediaItem) => mediaItem.id === mediaId);

    if (item?.source === "new" && item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }

    editMediaItems = editMediaItems.filter((mediaItem) => mediaItem.id !== mediaId);
    renderEditMediaPreview();
  }

  function moveMediaItem(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }

    const sourceIndex = editMediaItems.findIndex((item) => item.id === sourceId);
    const targetIndex = editMediaItems.findIndex((item) => item.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) {
      return;
    }

    const [movedItem] = editMediaItems.splice(sourceIndex, 1);
    editMediaItems.splice(targetIndex, 0, movedItem);
    renderEditMediaPreview();
  }

  function appendMediaPayload(formData) {
    if (!mediaSection || mediaSection.hidden) {
      return;
    }

    const existingMedia = [];
    const mediaOrder = [];
    let existingIndex = 0;
    let newIndex = 0;

    editMediaItems.forEach((item) => {
      if (item.source === "existing") {
        existingMedia.push(item.media);
        mediaOrder.push(`existing:${existingIndex}`);
        existingIndex += 1;
        return;
      }

      if (item.source === "new" && item.file) {
        formData.append("mediaFiles", item.file);
        mediaOrder.push(`new:${newIndex}`);
        newIndex += 1;
      }
    });

    formData.append("format", currentPostFormat || "carousel");
    formData.append("existingMedia", JSON.stringify(existingMedia));
    formData.append("mediaOrder", JSON.stringify(mediaOrder));
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

  function updateUrlWithPostId(postId) {
    if (!postId) {
      return;
    }

    const canonicalUrl = new URL(window.location.href);
    canonicalUrl.search = "";
    canonicalUrl.searchParams.set("postId", postId);
    window.history.replaceState({}, document.title, canonicalUrl.toString());
  }

  function resolveApiBaseUrl() {
    const { origin, hostname } = window.location;

    const isPrivateIpv4Address = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(
      hostname
    );

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      isPrivateIpv4Address ||
      hostname === "global-backend-bdbx.onrender.com"
    ) {
      return origin;
    }

    return "https://global-backend-bdbx.onrender.com";
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

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      setSubmitButtonState(true);
      const effectivePostId = await resolvePostId();

      if (!effectivePostId) {
        throw new Error("No se pudo identificar la publicación a modificar.");
      }

      const formData = new FormData();
      formData.append("title", titleInput.value);
      formData.append("body", bodyInput.value);
      appendMediaPayload(formData);

      const patchResponse = await fetch(`${resolveApiBaseUrl()}/api/admin/posts/${effectivePostId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("globalAppToken") || ""}`,
        },
        body: formData,
      });

      const data = await patchResponse.json();

      if (!patchResponse.ok) {
        throw new Error(data.message || "No se pudo modificar la publicación.");
      }

      setFeedback(feedback, "Publicación modificada correctamente.", "success");
      fillForm(data.post || {
        _id: effectivePostId,
        title: titleInput.value,
        body: bodyInput.value,
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
  });

  successClose.addEventListener("click", () => {
    if (typeof window.__closeAdminEditSuccessModal === "function") {
      window.__closeAdminEditSuccessModal();
      return;
    }

    toggleSuccessModal(false);
  });

  editTitleTrigger.addEventListener("click", () => {
    unlockField(titleInput, true);
  });

  editBodyTrigger.addEventListener("click", () => {
    unlockField(bodyInput);
  });

  mediaFilesInput?.addEventListener("change", () => {
    addNewMediaFiles(mediaFilesInput.files || []);
  });

  mediaPreview?.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-media-remove]");

    if (!removeButton) {
      return;
    }

    removeMediaItem(removeButton.dataset.mediaRemove);
  });

  mediaPreview?.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-media-id]");

    if (!card) {
      return;
    }

    draggedMediaId = card.dataset.mediaId;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedMediaId);
  });

  mediaPreview?.addEventListener("dragover", (event) => {
    const card = event.target.closest("[data-media-id]");

    if (!card || !draggedMediaId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });

  mediaPreview?.addEventListener("drop", (event) => {
    const card = event.target.closest("[data-media-id]");

    if (!card || !draggedMediaId) {
      return;
    }

    event.preventDefault();
    moveMediaItem(draggedMediaId, card.dataset.mediaId);
    draggedMediaId = "";
  });

  mediaPreview?.addEventListener("dragend", () => {
    draggedMediaId = "";
    mediaPreview.querySelectorAll(".is-dragging").forEach((card) => {
      card.classList.remove("is-dragging");
    });
  });

  window.addEventListener("beforeunload", revokeNewMediaPreviewUrls);

  document.querySelector('[data-close-modal="success-action-modal"]')?.addEventListener("click", () => {
    if (typeof window.__closeAdminEditSuccessModal === "function") {
      window.__closeAdminEditSuccessModal();
      return;
    }

    toggleSuccessModal(false);
  });

  loadPost().catch((error) => {
    setFeedback(feedback, error.message, "error");
  });
}
})();