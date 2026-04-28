const {
  attachLogout,
  fetchJson,
  formatDateTimeInBogota,
  loadAdminSession,
  renderEmptyState,
  requireAdminAccess,
  setFeedback,
} = window.AdminApp;

if (requireAdminAccess()) {
  attachLogout();

  const postForm = document.getElementById("post-form");
  const postFeedback = document.getElementById("post-feedback");
  const scheduledPostsList = document.getElementById("scheduled-posts-list");
  const publishNowButton = document.getElementById("publish-now-button");
  const viewPublishedButton = document.getElementById("view-published-button");
  const scheduleSubmitButton = document.getElementById("schedule-submit-button");
  const mediaFilesInput = document.getElementById("media-files");
  const formatSelect = postForm.elements.format;
  const videoUrlGroup = document.getElementById("post-video-url-group");
  const videoUrlInput = document.getElementById("post-video-url");
  const mediaFilesGroup = document.getElementById("post-media-files-group");
  const scheduleDateInput = document.getElementById("schedule-date");
  const scheduleTimeInput = document.getElementById("schedule-time");
  const postsManagerModal = document.getElementById("posts-manager-modal");
  const publishedPostsModalList = document.getElementById("published-posts-modal-list");
  const closePostsManagerButton = document.getElementById("close-posts-manager-button");
  const confirmActionModal = document.getElementById("confirm-action-modal");
  const confirmActionTitle = document.getElementById("confirm-action-title");
  const confirmActionDescription = document.getElementById("confirm-action-description");
  const confirmActionCancel = document.getElementById("confirm-action-cancel");
  const confirmActionSubmit = document.getElementById("confirm-action-submit");
  const successActionModal = document.getElementById("success-action-modal");
  const successActionDescription = document.getElementById("success-action-description");
  const successActionClose = document.getElementById("success-action-close");

  let allPosts = [];
  let confirmResolver = null;
  let pendingSubmitAction = "publish";

  function isSupportedVideoUrl(value) {
    if (!value) {
      return false;
    }

    try {
      const parsedUrl = new URL(String(value).trim());
      const host = parsedUrl.hostname.toLowerCase();
      const isYoutubeHost = host.includes("youtube.com") || host.includes("youtu.be");
      const isVimeoHost = host.includes("vimeo.com");
      const isCloudinaryHost = host.includes("res.cloudinary.com");
      const isDirectVideoFile = /\.(mp4|mov|m4v|webm)(\?|$)/i.test(parsedUrl.pathname || "");
      return isYoutubeHost || isVimeoHost || isCloudinaryHost || isDirectVideoFile;
    } catch {
      return false;
    }
  }

  function syncVideoInputMode() {
    const format = formatSelect?.value || "carousel";
    const isVideoFormat = format === "video";
    const showVideoLink = isVideoFormat;

    if (videoUrlGroup) {
      videoUrlGroup.hidden = !showVideoLink;
      videoUrlGroup.style.display = showVideoLink ? "" : "none";
    }

    if (mediaFilesGroup) {
      mediaFilesGroup.hidden = false;
      mediaFilesGroup.style.display = "";
    }

    if (videoUrlInput) {
      videoUrlInput.required = false;
    }

    if (mediaFilesInput) {
      mediaFilesInput.required = !isVideoFormat;
      mediaFilesInput.accept = isVideoFormat ? "video/*" : "image/*";
    }
  }

  function getEditPostUrl(postId) {
    const editUrl = new URL("/app/admin-post-edit.html", window.location.origin);
    editUrl.searchParams.set("postId", postId);
    return editUrl.toString();
  }

  function syncModalState() {
    const hasOpenModal = [postsManagerModal, confirmActionModal, successActionModal].some(
      (modal) => modal && !modal.hidden
    );

    document.body.classList.toggle("modal-open", hasOpenModal);
  }

  function toggleModal(modal, shouldOpen) {
    if (!modal) {
      return;
    }

    modal.hidden = !shouldOpen;
    syncModalState();
  }

  function closeAllModals() {
    if (confirmResolver) {
      const resolver = confirmResolver;
      confirmResolver = null;
      resolver(false);
    }

    [postsManagerModal, confirmActionModal, successActionModal].forEach((modal) => {
      if (modal) {
        modal.hidden = true;
      }
    });

    syncModalState();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function findPostById(postId) {
    return allPosts.find((post) => post._id === postId) || null;
  }

  function askForConfirmation({ title, description, confirmLabel }) {
    confirmActionTitle.textContent = title;
    confirmActionDescription.textContent = description;
    confirmActionSubmit.textContent = confirmLabel || "Confirmar";
    toggleModal(confirmActionModal, true);

    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function showSuccessModal(message, title = "Publicación lista") {
    const successTitle = document.getElementById("success-action-title");
    successTitle.textContent = title;
    successActionDescription.textContent = message;
    toggleModal(successActionModal, true);
  }

  function resolveConfirmation(value) {
    if (confirmResolver) {
      const resolver = confirmResolver;
      confirmResolver = null;
      resolver(value);
    }

    toggleModal(confirmActionModal, false);
  }

  async function validateFiles(files, format, videoUrl = "") {
    if (format === "video") {
      const selectedFiles = Array.from(files || []);
      const hasFiles = selectedFiles.length > 0;
      const hasValidLink = isSupportedVideoUrl(videoUrl);

      if (!hasFiles && !hasValidLink) {
        throw new Error("Para video debes subir un archivo o pegar un link válido.");
      }

      if (!hasFiles) {
        return;
      }

      if (selectedFiles.some((file) => file.size > 10 * 1024 * 1024)) {
        throw new Error("Cada archivo debe pesar 10 MB o menos.");
      }

      const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/"));

      if (selectedFiles.length !== 1 || videoFiles.length !== 1) {
        throw new Error("Video requiere exactamente un archivo de video cuando se sube desde dispositivo.");
      }

      await Promise.all(
        videoFiles.map(
          (file) =>
            new Promise((resolve, reject) => {
              const previewVideo = document.createElement("video");
              const objectUrl = URL.createObjectURL(file);

              previewVideo.preload = "metadata";
              previewVideo.onloadedmetadata = () => {
                URL.revokeObjectURL(objectUrl);

                if (previewVideo.duration > 60) {
                  reject(new Error("Los videos deben durar 60 segundos o menos."));
                  return;
                }

                resolve();
              };

              previewVideo.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error("No se pudo validar la duración del video."));
              };

              previewVideo.src = objectUrl;
            })
        )
      );

      return;
    }

    const selectedFiles = Array.from(files || []);

    if (!selectedFiles.length) {
      throw new Error("Debes subir al menos un archivo multimedia.");
    }

    if (selectedFiles.some((file) => file.size > 10 * 1024 * 1024)) {
      throw new Error("Cada archivo debe pesar 10 MB o menos.");
    }

    const imageCount = selectedFiles.filter((file) => file.type.startsWith("image/")).length;
    const videoFiles = selectedFiles.filter((file) => file.type.startsWith("video/"));

    if (format === "image" && (selectedFiles.length !== 1 || imageCount !== 1)) {
      throw new Error("Imagen única requiere exactamente una imagen.");
    }

    if (format === "carousel" && (selectedFiles.length < 2 || imageCount !== selectedFiles.length)) {
      throw new Error("Carrusel requiere al menos dos imágenes.");
    }

    if (format === "video" && (selectedFiles.length !== 1 || videoFiles.length !== 1)) {
      throw new Error("Video requiere exactamente un video.");
    }

    await Promise.all(
      videoFiles.map(
        (file) =>
          new Promise((resolve, reject) => {
            const previewVideo = document.createElement("video");
            const objectUrl = URL.createObjectURL(file);

            previewVideo.preload = "metadata";
            previewVideo.onloadedmetadata = () => {
              URL.revokeObjectURL(objectUrl);

              if (previewVideo.duration > 60) {
                reject(new Error("Los videos deben durar 60 segundos o menos."));
                return;
              }

              resolve();
            };

            previewVideo.onerror = () => {
              URL.revokeObjectURL(objectUrl);
              reject(new Error("No se pudo validar la duración del video."));
            };

            previewVideo.src = objectUrl;
          })
      )
    );
  }

  mediaFilesInput.addEventListener("change", async () => {
    const selectedFiles = Array.from(mediaFilesInput.files || []);

    if (!selectedFiles.length) {
      setFeedback(postFeedback, "");
      return;
    }

    try {
      await validateFiles(
        selectedFiles,
        postForm.elements.format.value,
        videoUrlInput?.value || ""
      );
      setFeedback(
        postFeedback,
        `${selectedFiles.length} archivo${selectedFiles.length > 1 ? "s" : ""} cargado${selectedFiles.length > 1 ? "s" : ""} y listo${selectedFiles.length > 1 ? "s" : ""} para publicar.`,
        "success"
      );
    } catch (error) {
      setFeedback(postFeedback, error.message, "error");
    }
  });

  function buildColombiaScheduleIso(dateValue, timeValue) {
    if (!dateValue || !timeValue) {
      throw new Error("Selecciona fecha y hora para programar la publicación.");
    }

    return new Date(`${dateValue}T${timeValue}:00-05:00`).toISOString();
  }

  function renderPublishedPostsModal(posts) {
    if (!posts.length) {
      renderEmptyState(publishedPostsModalList, "Todavía no hay publicaciones publicadas.");
      return;
    }

    publishedPostsModalList.innerHTML = posts.map((post) => `
      <article class="published-post-item">
        <div class="published-post-copy">
          <strong>${escapeHtml(post.title)}</strong>
          <span>${formatDateTimeInBogota(post.publishedAt || post.createdAt)}</span>
        </div>
        <div class="published-post-actions">
          <button class="published-post-action" type="button" data-post-action="edit" data-post-id="${post._id}" aria-label="Modificar publicación">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 17.2V20h2.8l8.2-8.2-2.8-2.8L4 17.2Zm13.7-8.5a1 1 0 0 0 0-1.4l-1-1a1 1 0 0 0-1.4 0l-1.2 1.2 2.8 2.8 1.8-1.8Z"></path></svg>
            <span>Modificar</span>
          </button>
          <button class="published-post-action danger" type="button" data-post-action="delete" data-post-id="${post._id}" aria-label="Eliminar publicación">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v8h-2V9Zm4 0h2v8h-2V9ZM7 9h2v8H7V9Z"></path></svg>
            <span>Eliminar</span>
          </button>
        </div>
      </article>
    `).join("");
  }

  function renderPosts(posts) {
    const scheduledPosts = posts.filter((post) => post.status === "scheduled");
    const publishedPosts = posts.filter((post) => post.status === "published");

    if (!scheduledPosts.length) {
      renderEmptyState(scheduledPostsList, "Todavía no hay publicaciones programadas.");
    } else {
      scheduledPostsList.innerHTML = scheduledPosts.map((post) => `
        <article class="list-item">
          <div>
            <strong>${escapeHtml(post.title)}</strong>
            <p>${escapeHtml(post.format)} · ${post.media?.length || 0} recursos</p>
            <p>Hora Colombia: ${formatDateTimeInBogota(post.scheduledFor)}</p>
          </div>
          <span>${escapeHtml(post.status)}</span>
        </article>
      `).join("");
    }

    renderPublishedPostsModal(publishedPosts);
  }

  async function loadPostsPage() {
    await loadAdminSession();
    const postsData = await fetchJson("/api/admin/posts", {
      loadingMessage: "Cargando publicaciones...",
    });
    allPosts = postsData.posts || [];
    sessionStorage.setItem("globalPublishedPosts", JSON.stringify(allPosts));
    renderPosts(allPosts);
  }

  async function submitPost(action) {
    const formData = new FormData(postForm);
    const format = formData.get("format");
    const videoUrl = String(formData.get("videoUrl") || "").trim();

    await validateFiles(mediaFilesInput.files, format, videoUrl);

    if (format === "video" && isSupportedVideoUrl(videoUrl)) {
      formData.append("mediaUrls", videoUrl);
    }

    if (action === "schedule") {
      formData.append("status", "scheduled");
      formData.append(
        "scheduledFor",
        buildColombiaScheduleIso(scheduleDateInput.value, scheduleTimeInput.value)
      );
    } else {
      formData.append("status", "published");
    }

    setFeedback(
      postFeedback,
      action === "schedule" ? "Validando y programando publicación..." : "Subiendo archivos y publicando..."
    );

    await fetchJson("/api/admin/posts", {
      method: "POST",
      body: formData,
      loadingMessage: action === "schedule" ? "Programando publicación..." : "Publicando ahora...",
    });

    postForm.reset();
    syncVideoInputMode();
    setFeedback(
      postFeedback,
      action === "schedule" ? "Publicación programada correctamente." : "Publicación creada correctamente.",
      "success"
    );
    showSuccessModal(
      action === "schedule"
        ? "La publicación quedó programada correctamente."
        : "La publicación fue creada correctamente y ya está disponible para el feed del cliente."
    );
    await loadPostsPage();
  }

  async function deletePublishedPost(postId, feedbackElement = postFeedback) {
    const confirmed = await askForConfirmation({
      title: "Eliminar publicación",
      description: "Esta acción quitará la publicación del feed del cliente. Úsala solo si hubo un error al subirla.",
      confirmLabel: "Eliminar publicación",
    });

    if (!confirmed) {
      return;
    }

    await fetchJson(`/api/admin/posts/${postId}`, {
      method: "DELETE",
      loadingMessage: "Eliminando publicación...",
    });

    closeAllModals();
    setFeedback(feedbackElement, "Publicación eliminada correctamente.", "success");
    showSuccessModal("La publicación fue eliminada correctamente.", "Publicación eliminada");
    await loadPostsPage();
  }

  async function handleCreateAction(action) {
    setFeedback(
      postFeedback,
      action === "schedule"
        ? "Confirma en el modal para programar la publicación."
        : "Confirma en el modal para publicar ahora."
    );

    const confirmed = await askForConfirmation({
      title: action === "schedule" ? "Programar publicación" : "Publicar ahora",
      description:
        action === "schedule"
          ? "La publicación se guardará y se publicará automáticamente en la fecha y hora de Colombia indicadas."
          : "La publicación se enviará a Cloudinary, se guardarán las URLs y quedará visible inmediatamente para el cliente.",
      confirmLabel: action === "schedule" ? "Programar publicación" : "Publicar ahora",
    });

    if (!confirmed) {
      return;
    }

    try {
      await submitPost(action);
    } catch (error) {
      setFeedback(postFeedback, error.message, "error");
    }
  }

  publishNowButton.addEventListener("click", () => {
    pendingSubmitAction = "publish";
  });

  formatSelect?.addEventListener("change", syncVideoInputMode);
  postForm.addEventListener("change", (event) => {
    if (event.target?.name === "format") {
      syncVideoInputMode();
    }
  });
  window.addEventListener("pageshow", syncVideoInputMode);
  window.addEventListener("load", syncVideoInputMode);
  syncVideoInputMode();

  scheduleSubmitButton.addEventListener("click", () => {
    pendingSubmitAction = "schedule";
  });

  postForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (event.submitter?.id === "schedule-submit-button") {
      pendingSubmitAction = "schedule";
    } else if (event.submitter?.id === "publish-now-button") {
      pendingSubmitAction = "publish";
    }

    await handleCreateAction(pendingSubmitAction);
  });

  viewPublishedButton.addEventListener("click", () => {
    toggleModal(postsManagerModal, true);
  });

  publishedPostsModalList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-post-id]");

    if (!button) {
      return;
    }

    if (button.dataset.postAction === "delete") {
      deletePublishedPost(button.dataset.postId).catch((error) => {
        setFeedback(postFeedback, error.message, "error");
      });
      return;
    }

    window.location.href = getEditPostUrl(button.dataset.postId);
  });

  closePostsManagerButton.addEventListener("click", closeAllModals);
  successActionClose.addEventListener("click", closeAllModals);
  confirmActionCancel.addEventListener("click", () => resolveConfirmation(false));
  confirmActionSubmit.addEventListener("click", () => resolveConfirmation(true));

  document.querySelectorAll("[data-close-modal]").forEach((overlay) => {
    overlay.addEventListener("click", closeAllModals);
  });

  loadPostsPage().catch((error) => {
    renderEmptyState(scheduledPostsList, error.message);
    renderEmptyState(publishedPostsModalList, error.message);
  });

  window.__adminPostsInitialized = true;
}