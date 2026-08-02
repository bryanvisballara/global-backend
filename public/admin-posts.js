(() => {
if (window.__adminPostsScriptInitialized) {
  return;
}

window.__adminPostsScriptInitialized = true;

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
  const draftPostsList = document.getElementById("draft-posts-list");
  const draftsTabBadge = document.getElementById("drafts-tab-badge");
  const regenerateQuotaNote = document.getElementById("regenerate-quota-note");
  const postsTabButtons = Array.from(document.querySelectorAll("[data-posts-tab]"));
  const postsPanels = Array.from(document.querySelectorAll("[data-posts-panel]"));
  const publishNowButton = document.getElementById("publish-now-button");
  const viewPublishedButton = document.getElementById("view-published-button");
  const scheduleSubmitButton = document.getElementById("schedule-submit-button");
  const mediaFilesInput = document.getElementById("media-files");
  const formatSelect = postForm.elements.format;
  const videoUrlGroup = document.getElementById("post-video-url-group");
  const videoUrlInput = document.getElementById("post-video-url");
  const mediaFilesGroup = document.getElementById("post-media-files-group");
  const postMediaPreview = document.getElementById("post-media-preview");
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
  const regenerateProgressModal = document.getElementById("regenerate-progress-modal");
  const regenerateProgressSubtitle = document.getElementById("regenerate-progress-subtitle");
  const regenerateProgressSteps = document.getElementById("regenerate-progress-steps");
  const regenerateProgressBar = document.getElementById("regenerate-progress-bar");
  const regenerateProgressPercent = document.getElementById("regenerate-progress-percent");
  const regenerateProgressStatus = document.getElementById("regenerate-progress-status");
  const regeneratePreviewCaption = regenerateProgressModal?.querySelector(".regen-preview-caption");

  let allPosts = [];
  let regenerateQuota = null;
  let confirmResolver = null;
  let pendingSubmitAction = "publish";
  let postMediaPreviewUrls = [];
  let regenerateProgressTimer = null;
  let regenerateProgressValue = 0;

  const REGENERATE_STEPS = [
    {
      key: "story",
      label: "Buscando noticia de autos de lujo",
      status: "Consultando fuentes de noticias…",
      caption: "Buscando noticia…",
      target: 22,
    },
    {
      key: "copy",
      label: "Escribiendo título y texto",
      status: "OpenAI está redactando el copy…",
      caption: "Escribiendo textos…",
      target: 48,
    },
    {
      key: "image",
      label: "Diseñando imagen con OpenAI",
      status: "Generando y componiendo la imagen…",
      caption: "Diseñando imagen…",
      target: 82,
    },
    {
      key: "finish",
      label: "Aplicando cambios al borrador",
      status: "Guardando el borrador regenerado…",
      caption: "Finalizando…",
      target: 94,
    },
  ];

  function setRegenerateProgress(percent, { status, caption, stepKey } = {}) {
    regenerateProgressValue = Math.max(0, Math.min(100, Math.round(percent)));

    if (regenerateProgressBar) {
      regenerateProgressBar.style.width = `${regenerateProgressValue}%`;
    }

    if (regenerateProgressPercent) {
      regenerateProgressPercent.textContent = `${regenerateProgressValue}%`;
    }

    if (status && regenerateProgressStatus) {
      regenerateProgressStatus.textContent = status;
    }

    if (caption && regeneratePreviewCaption) {
      regeneratePreviewCaption.textContent = caption;
    }

    if (stepKey && regenerateProgressSteps) {
      const stepNodes = Array.from(regenerateProgressSteps.querySelectorAll("[data-step]"));
      const activeIndex = stepNodes.findIndex((node) => node.dataset.step === stepKey);

      stepNodes.forEach((node, index) => {
        node.classList.toggle("is-done", activeIndex >= 0 && index < activeIndex);
        node.classList.toggle("is-active", index === activeIndex);
      });
    }
  }

  function stopRegenerateProgressTicker() {
    if (regenerateProgressTimer) {
      window.clearInterval(regenerateProgressTimer);
      regenerateProgressTimer = null;
    }
  }

  function openRegenerateProgressModal() {
    if (!regenerateProgressModal) {
      return;
    }

    stopRegenerateProgressTicker();
    regenerateProgressValue = 4;

    if (regenerateProgressSubtitle) {
      regenerateProgressSubtitle.textContent = "OpenAI está creando contenido e imagen nuevos…";
    }

    setRegenerateProgress(4, {
      status: REGENERATE_STEPS[0].status,
      caption: REGENERATE_STEPS[0].caption,
      stepKey: REGENERATE_STEPS[0].key,
    });

    toggleModal(regenerateProgressModal, true);

    const startedAt = Date.now();
    regenerateProgressTimer = window.setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      let nextStep = REGENERATE_STEPS[0];
      let nextPercent = 8;

      if (elapsedMs < 4500) {
        nextStep = REGENERATE_STEPS[0];
        nextPercent = 8 + (elapsedMs / 4500) * (REGENERATE_STEPS[0].target - 8);
      } else if (elapsedMs < 14000) {
        nextStep = REGENERATE_STEPS[1];
        nextPercent =
          REGENERATE_STEPS[0].target +
          ((elapsedMs - 4500) / 9500) * (REGENERATE_STEPS[1].target - REGENERATE_STEPS[0].target);
      } else if (elapsedMs < 42000) {
        nextStep = REGENERATE_STEPS[2];
        nextPercent =
          REGENERATE_STEPS[1].target +
          ((elapsedMs - 14000) / 28000) * (REGENERATE_STEPS[2].target - REGENERATE_STEPS[1].target);
      } else {
        nextStep = REGENERATE_STEPS[3];
        const finishProgress = Math.min(1, (elapsedMs - 42000) / 35000);
        nextPercent =
          REGENERATE_STEPS[2].target +
          finishProgress * (REGENERATE_STEPS[3].target - REGENERATE_STEPS[2].target);
      }

      // Never reach 100% until the request finishes.
      nextPercent = Math.min(94, nextPercent);
      if (nextPercent > regenerateProgressValue) {
        setRegenerateProgress(nextPercent, {
          status: nextStep.status,
          caption: nextStep.caption,
          stepKey: nextStep.key,
        });
      }
    }, 220);
  }

  async function finishRegenerateProgressModal({ success = true, message = "" } = {}) {
    stopRegenerateProgressTicker();

    if (!regenerateProgressModal) {
      return;
    }

    if (success) {
      if (regenerateProgressSubtitle) {
        regenerateProgressSubtitle.textContent = "Listo. La noticia se regeneró correctamente.";
      }

      const stepNodes = Array.from(regenerateProgressSteps?.querySelectorAll("[data-step]") || []);
      stepNodes.forEach((node) => {
        node.classList.add("is-done");
        node.classList.remove("is-active");
      });

      setRegenerateProgress(100, {
        status: message || "Regeneración completada",
        caption: "Imagen lista",
      });

      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }

    toggleModal(regenerateProgressModal, false);
  }

  function updateRegenerateQuotaNote(quota = regenerateQuota) {
    if (!regenerateQuotaNote) {
      return;
    }

    if (!quota) {
      regenerateQuotaNote.textContent = "Regeneraciones hoy: —";
      return;
    }

    const remaining = Math.max(0, Number(quota.remaining || 0));
    const limit = Math.max(1, Number(quota.limit || 2));
    regenerateQuotaNote.textContent =
      remaining > 0
        ? `Regeneraciones hoy: ${remaining} de ${limit} disponibles`
        : `Límite diario alcanzado (${limit}/día). Vuelve mañana (hora Colombia).`;
    regenerateQuotaNote.classList.toggle("is-exhausted", remaining <= 0);
  }

  async function loadRegenerateQuota() {
    try {
      const data = await fetchJson("/api/admin/posts/regenerate-quota", {
        loadingMessage: false,
      });
      regenerateQuota = data.quota || null;
      updateRegenerateQuotaNote(regenerateQuota);
    } catch {
      regenerateQuota = null;
      updateRegenerateQuotaNote(null);
    }
  }

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
    const hasOpenModal = [
      postsManagerModal,
      confirmActionModal,
      successActionModal,
      regenerateProgressModal,
    ].some((modal) => modal && !modal.hidden);

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

    stopRegenerateProgressTicker();

    [postsManagerModal, confirmActionModal, successActionModal, regenerateProgressModal].forEach((modal) => {
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

  function clearPostMediaPreview() {
    postMediaPreviewUrls.forEach((objectUrl) => {
      URL.revokeObjectURL(objectUrl);
    });
    postMediaPreviewUrls = [];

    if (!postMediaPreview) {
      return;
    }

    postMediaPreview.innerHTML = "";
    postMediaPreview.hidden = true;
  }

  function renderPostMediaPreview(files = []) {
    if (!postMediaPreview) {
      return;
    }

    clearPostMediaPreview();

    const selectedFiles = Array.from(files || []);

    if (!selectedFiles.length) {
      return;
    }

    postMediaPreview.innerHTML = selectedFiles.map((file, index) => {
      const objectUrl = URL.createObjectURL(file);
      const label = escapeHtml(file.name || `Archivo ${index + 1}`);

      postMediaPreviewUrls.push(objectUrl);

      if (file.type.startsWith("video/")) {
        return `
          <article class="tracking-media-card video">
            <video controls playsinline preload="metadata" src="${escapeHtml(objectUrl)}"></video>
            <strong>${label}</strong>
          </article>
        `;
      }

      if (file.type.startsWith("image/")) {
        return `
          <article class="tracking-media-card image">
            <img src="${escapeHtml(objectUrl)}" alt="${label}" loading="lazy" />
            <strong>${label}</strong>
          </article>
        `;
      }

      return `
        <article class="tracking-media-card document">
          <strong>${label}</strong>
          <span>Vista previa no disponible para este archivo.</span>
        </article>
      `;
    }).join("");

    postMediaPreview.hidden = false;
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
      clearPostMediaPreview();
      setFeedback(postFeedback, "");
      return;
    }

    try {
      await validateFiles(
        selectedFiles,
        postForm.elements.format.value,
        videoUrlInput?.value || ""
      );
      renderPostMediaPreview(selectedFiles);
      setFeedback(
        postFeedback,
        `${selectedFiles.length} archivo${selectedFiles.length > 1 ? "s" : ""} cargado${selectedFiles.length > 1 ? "s" : ""} y listo${selectedFiles.length > 1 ? "s" : ""} para publicar.`,
        "success"
      );
    } catch (error) {
      clearPostMediaPreview();
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

  function setActivePostsTab(tabName = "drafts") {
    postsTabButtons.forEach((button) => {
      const isActive = button.dataset.postsTab === tabName;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    postsPanels.forEach((panel) => {
      panel.hidden = panel.dataset.postsPanel !== tabName;
    });
  }

  function getDraftPreviewImage(post) {
    const image = (post.media || []).find((item) => item?.type === "image" && item?.url);
    return image?.url || "";
  }

  function updateDraftsBadge(count) {
    if (!draftsTabBadge) {
      return;
    }

    const safeCount = Number(count) || 0;
    const shouldShow = safeCount >= 1;
    draftsTabBadge.hidden = !shouldShow;
    draftsTabBadge.textContent = shouldShow ? String(safeCount) : "";
    draftsTabBadge.style.display = shouldShow ? "" : "none";
  }

  function renderDraftPosts(posts) {
    const draftPosts = posts.filter((post) => post.status === "draft");
    updateDraftsBadge(draftPosts.length);

    if (!draftPostsList) {
      return;
    }

    if (!draftPosts.length) {
      renderEmptyState(draftPostsList, "Todavía no hay borradores automáticos.");
      return;
    }

    draftPostsList.innerHTML = draftPosts.map((post) => {
      const previewUrl = getDraftPreviewImage(post);
      const topic = post.source?.topic || "Lifestyle";
      const fullBody = String(post.body || "").trim();

      return `
        <article class="draft-post-card" data-draft-id="${escapeHtml(post._id)}">
          <div class="draft-post-media">
            ${previewUrl
              ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(post.title)}" loading="lazy" />`
              : `<div class="draft-post-media-fallback">Sin imagen</div>`}
          </div>
          <div class="draft-post-copy">
            <span class="draft-post-topic">${escapeHtml(topic)}</span>
            <strong>${escapeHtml(post.title)}</strong>
            <p>${escapeHtml(fullBody)}</p>
          </div>
          <div class="draft-post-actions">
            <button class="primary-button" type="button" data-draft-action="publish" data-post-id="${escapeHtml(post._id)}">Publicar</button>
            <a class="secondary-button" href="${getEditPostUrl(post._id)}">Editar</a>
            <button class="secondary-button" type="button" data-draft-action="regenerate" data-post-id="${escapeHtml(post._id)}">Regenerar noticia</button>
            <button class="secondary-button" type="button" data-draft-action="discard" data-post-id="${escapeHtml(post._id)}">Descartar</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderPosts(posts) {
    const scheduledPosts = posts.filter((post) => post.status === "scheduled");
    const publishedPosts = posts.filter((post) => post.status === "published");

    renderDraftPosts(posts);

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
    const [postsData] = await Promise.all([
      fetchJson("/api/admin/posts", {
        loadingMessage: "Cargando publicaciones...",
      }),
      loadRegenerateQuota(),
    ]);
    allPosts = postsData.posts || [];
    sessionStorage.setItem("globalPublishedPosts", JSON.stringify(allPosts));
    renderPosts(allPosts);
    window.AdminApp?.refreshPostsDraftBadge?.();
  }

  async function publishDraftPost(postId) {
    const confirmed = await askForConfirmation({
      title: "Publicar borrador",
      description: "El borrador pasará al feed del cliente y se enviará la notificación push.",
      confirmLabel: "Publicar ahora",
    });

    if (!confirmed) {
      return;
    }

    await fetchJson(`/api/admin/posts/${postId}/publish-draft`, {
      method: "POST",
      loadingMessage: "Publicando borrador...",
    });

    setFeedback(postFeedback, "Borrador publicado correctamente.", "success");
    showSuccessModal("El borrador ya está visible en el feed del cliente.");
    await loadPostsPage();
  }

  async function discardDraftPost(postId) {
    const confirmed = await askForConfirmation({
      title: "Descartar borrador",
      description: "Se eliminará este borrador automático. Esta acción no se puede deshacer.",
      confirmLabel: "Descartar",
    });

    if (!confirmed) {
      return;
    }

    await fetchJson(`/api/admin/posts/${postId}`, {
      method: "DELETE",
      loadingMessage: "Descartando borrador...",
    });

    setFeedback(postFeedback, "Borrador descartado.", "success");
    await loadPostsPage();
  }

  async function regenerateDraftPost(postId) {
    const remaining = Number(regenerateQuota?.remaining);
    const limit = Number(regenerateQuota?.limit || 2);

    if (regenerateQuota && remaining <= 0) {
      setFeedback(
        postFeedback,
        `Límite diario alcanzado: solo ${limit} regeneraciones por día (hora Colombia).`,
        "error"
      );
      return;
    }

    const remainingLabel =
      Number.isFinite(remaining) && remaining >= 0
        ? ` Te quedan ${remaining} de ${limit} hoy.`
        : ` Máximo ${limit} por día.`;

    const confirmed = await askForConfirmation({
      title: "Regenerar noticia",
      description: `Se buscará una noticia nueva (prioridad autos de lujo), se reescribirán los textos y se rediseñará la imagen.${remainingLabel}`,
      confirmLabel: "Regenerar noticia",
    });

    if (!confirmed) {
      return;
    }

    openRegenerateProgressModal();

    try {
      const result = await fetchJson(`/api/admin/posts/${postId}/regenerate-draft`, {
        method: "POST",
        loadingMessage: false,
        requestTimeoutMs: 120000,
      });

      if (result.quota) {
        regenerateQuota = result.quota;
        updateRegenerateQuotaNote(regenerateQuota);
      }

      const left = Number(result.quota?.remaining);
      const leftText = Number.isFinite(left)
        ? ` Quedan ${left} regeneración${left === 1 ? "" : "es"} hoy.`
        : "";

      await finishRegenerateProgressModal({
        success: true,
        message: `Noticia regenerada.${leftText}`,
      });

      setFeedback(postFeedback, `Noticia regenerada.${leftText}`, "success");
      showSuccessModal(`La noticia se regeneró con textos e imagen nuevos.${leftText}`);
      await loadPostsPage();
    } catch (error) {
      await finishRegenerateProgressModal({ success: false });
      throw error;
    }
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
  window.addEventListener("beforeunload", clearPostMediaPreview);
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

  postsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActivePostsTab(button.dataset.postsTab || "drafts");
    });
  });

  draftPostsList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-draft-action][data-post-id]");

    if (!button) {
      return;
    }

    const postId = button.dataset.postId;
    const action = button.dataset.draftAction;

    try {
      if (action === "publish") {
        await publishDraftPost(postId);
      } else if (action === "regenerate") {
        await regenerateDraftPost(postId);
      } else if (action === "discard") {
        await discardDraftPost(postId);
      }
    } catch (error) {
      setFeedback(postFeedback, error.message, "error");
    }
  });

  viewPublishedButton.addEventListener("click", () => {
    toggleModal(postsManagerModal, true);
  });

  setActivePostsTab("drafts");

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
})();