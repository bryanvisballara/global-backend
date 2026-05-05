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

const apiBaseUrl = resolveApiBaseUrl();
const TRACKING_PAGE_VERSION = "20260504-clientevents14";
const PULL_REFRESH_THRESHOLD = 78;
const trackingForm = document.getElementById("tracking-page-form");
const trackingInput = document.getElementById("tracking-page-input");
const trackingResults = document.getElementById("tracking-page-results");
const trackingFeedback = document.getElementById("tracking-page-feedback");
const refreshIndicator = document.getElementById("feed-refresh-indicator");
const refreshLabel = document.getElementById("feed-refresh-label");
const trackingNavButtons = Array.from(document.querySelectorAll("[data-nav-go]"));
let registeredPushToken = "";
let activeTrackingOrder = null;
let touchStartY = 0;
let pullDistance = 0;
let isPulling = false;
let isRefreshingTracking = false;
let wheelUpRefreshAccumulator = 0;
let lastWheelRefreshAt = 0;

function installZoomGuards() {
  document.documentElement.style.touchAction = "manipulation";
  document.body?.style?.setProperty("touch-action", "manipulation");

  const preventGesture = (event) => {
    event.preventDefault();
  };

  ["gesturestart", "gesturechange", "gestureend", "dblclick"].forEach((eventName) => {
    document.addEventListener(eventName, preventGesture, { passive: false });
  });

  let lastTouchEndAt = 0;

  document.addEventListener("touchend", (event) => {
    const now = Date.now();

    if (now - lastTouchEndAt <= 280) {
      event.preventDefault();
    }

    lastTouchEndAt = now;
  }, { passive: false });
}

installZoomGuards();

const TRACKING_TIMELINE_STATES = [
  { key: "order-received", label: "Orden recibida" },
  { key: "vehicle-search", label: "Busqueda del carro" },
  { key: "booking-and-shipping", label: "Booking y tracking naviera" },
  { key: "in-transit", label: "En transito" },
  { key: "nationalization", label: "Proceso de nacionalizacion" },
  { key: "port-exit", label: "Salida del puerto" },
  { key: "vehicle-preparation", label: "Alistamiento" },
  { key: "delivery", label: "Entrega" },
  { key: "registration", label: "Matricula" },
];

function redirectToLogin() {
  const loginUrl = new URL("/index.html", window.location.origin);
  loginUrl.searchParams.set("logout", "1");
  loginUrl.searchParams.set("t", String(Date.now()));
  window.location.replace(loginUrl.toString());
}

function clearAuth() {
  localStorage.removeItem("globalAppToken");
  localStorage.removeItem("globalAppRole");
  sessionStorage.removeItem("globalAppToken");
  sessionStorage.removeItem("globalAppRole");
}

function getToken() {
  return localStorage.getItem("globalAppToken");
}

function getRole() {
  return localStorage.getItem("globalAppRole");
}

function hasAuthenticatedClientSession() {
  return Boolean(getToken()) && getRole() === "client";
}

function fetchJson(path, options = {}) {
  const token = getToken();

  return fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const data = await response.json();

    if (!response.ok) {
      if (
        data.message === "Invalid or expired token" ||
        data.message === "Authentication required" ||
        response.status === 401
      ) {
        clearAuth();
        redirectToLogin();
      }

      throw new Error(data.message || "Request failed");
    }

    return data;
  });
}

function fetchPublicTracking(trackingNumber) {
  return fetchJson(`/api/public/tracking/${encodeURIComponent(trackingNumber)}`);
}

async function registerNativePushToken(pushInfo) {
  if (!pushInfo?.token || registeredPushToken === pushInfo.token) {
    return;
  }

  await fetchJson("/api/client/push-devices", {
    method: "POST",
    body: JSON.stringify({
      token: pushInfo.token,
      platform: pushInfo.platform || "ios",
      provider: pushInfo.provider || "apns",
      appVersion: pushInfo.appVersion || "ios-webview",
      bundleId: pushInfo.bundleId || "",
    }),
  });

  registeredPushToken = pushInfo.token;
}

function syncNativePushToken() {
  const nativePushInfo = window.__globalImportsNativePush;

  if (!nativePushInfo?.token) {
    return;
  }

  registerNativePushToken(nativePushInfo).catch(() => null);
}

function setFeedback(message, type = "") {
  if (!trackingFeedback) {
    return;
  }

  trackingFeedback.textContent = message;
  trackingFeedback.className = `feedback${type ? ` ${type}` : ""}`;
}

function updateRefreshIndicator() {
  if (!refreshIndicator || !refreshLabel) {
    return;
  }

  refreshIndicator.style.setProperty("--pull-distance", `${Math.min(pullDistance, 96)}px`);

  if (isRefreshingTracking) {
    refreshIndicator.classList.add("is-active", "is-refreshing");
    refreshLabel.textContent = "Actualizando tracking...";
    return;
  }

  refreshIndicator.classList.remove("is-refreshing");
  refreshIndicator.classList.toggle("is-active", pullDistance > 8);
  refreshLabel.textContent =
    pullDistance >= PULL_REFRESH_THRESHOLD
      ? "Suelta para actualizar"
      : "Desliza hacia abajo para actualizar";
}

function isPullRefreshAvailable() {
  return Boolean(refreshIndicator && refreshLabel && !document.body.classList.contains("modal-open"));
}

async function refreshTrackingPage() {
  if (isRefreshingTracking) {
    return;
  }

  isRefreshingTracking = true;
  updateRefreshIndicator();

  try {
    await loadTrackingPage();
  } finally {
    isRefreshingTracking = false;
    pullDistance = 0;
    updateRefreshIndicator();
  }
}

function handlePullStart(event) {
  if (!isPullRefreshAvailable() || window.scrollY > 0 || isRefreshingTracking) {
    isPulling = false;
    return;
  }

  touchStartY = event.touches[0].clientY;
  pullDistance = 0;
  isPulling = true;
  updateRefreshIndicator();
}

function handlePullMove(event) {
  if (!isPulling) {
    return;
  }

  const currentY = event.touches[0].clientY;
  const deltaY = currentY - touchStartY;

  if (deltaY <= 0) {
    pullDistance = 0;
    updateRefreshIndicator();
    return;
  }

  pullDistance = Math.min(deltaY * 0.6, 110);
  updateRefreshIndicator();

  if (pullDistance > 0) {
    event.preventDefault();
  }
}

function handlePullEnd() {
  if (!isPulling) {
    return;
  }

  isPulling = false;

  if (pullDistance >= PULL_REFRESH_THRESHOLD) {
    refreshTrackingPage().catch((error) => {
      isRefreshingTracking = false;
      pullDistance = 0;
      updateRefreshIndicator();
      setFeedback(error.message || "No se pudo actualizar la guía.", "error");
    });
    return;
  }

  pullDistance = 0;
  updateRefreshIndicator();
}

function handleWheelRefresh(event) {
  if (!isPullRefreshAvailable() || isRefreshingTracking) {
    wheelUpRefreshAccumulator = 0;
    return;
  }

  if (window.scrollY > 2) {
    wheelUpRefreshAccumulator = 0;
    return;
  }

  const deltaY = Number(event.deltaY || 0);

  if (deltaY >= 0) {
    wheelUpRefreshAccumulator = 0;
    return;
  }

  wheelUpRefreshAccumulator += Math.abs(deltaY);

  if (wheelUpRefreshAccumulator < 120) {
    return;
  }

  const now = Date.now();

  if (now - lastWheelRefreshAt < 1200) {
    return;
  }

  wheelUpRefreshAccumulator = 0;
  lastWheelRefreshAt = now;

  refreshTrackingPage().catch((error) => {
    isRefreshingTracking = false;
    pullDistance = 0;
    updateRefreshIndicator();
    setFeedback(error.message || "No se pudo actualizar la guía.", "error");
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "Sin fecha";
  }

  return new Date(dateValue).toLocaleDateString("es-VE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getFileExtension(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (!normalizedValue.includes(".")) {
    return "";
  }

  return normalizedValue.split(".").pop() || "";
}

function isImageLikeDocument(item = {}) {
  if (item?.type === "image") {
    return true;
  }

  const extension = getFileExtension(item?.name || item?.caption || item?.url || "");
  return ["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "heic", "heif"].includes(extension);
}

function buildEmbeddedVideoUrl(rawUrl) {
  const url = String(rawUrl || "").trim();

  if (!url) {
    return "";
  }

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();

    if (host.includes("youtu.be") || host.includes("youtube.com")) {
      let videoId = "";

      if (host.includes("youtu.be")) {
        videoId = parsedUrl.pathname.split("/").filter(Boolean)[0] || "";
      } else {
        const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

        videoId =
          parsedUrl.searchParams.get("v") ||
          (pathSegments[0] === "embed" ? pathSegments[1] || "" : "") ||
          (pathSegments[0] === "shorts" ? pathSegments[1] || "" : "") ||
          (pathSegments[0] === "live" ? pathSegments[1] || "" : "") ||
          (pathSegments[0] === "v" ? pathSegments[1] || "" : "");
      }

      if (!videoId) {
        return "";
      }

      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?controls=1&playsinline=1&rel=0&modestbranding=1`;
    }

    if (host.includes("vimeo.com")) {
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      const videoId = segments[segments.length - 1] || "";

      if (!videoId) {
        return "";
      }

      return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?controls=1&title=0&byline=0&portrait=0`;
    }
  } catch {
    return "";
  }

  return "";
}

function renderVideoElement(url, title = "Video") {
  const embeddedUrl = buildEmbeddedVideoUrl(url);

  if (embeddedUrl) {
    return `
      <iframe
        src="${escapeHtml(embeddedUrl)}"
        title="${escapeHtml(title)}"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        loading="lazy"
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    `;
  }

  return `<video controls playsinline preload="metadata" controlsList="nodownload noplaybackrate" src="${escapeHtml(url)}"></video>`;
}

function renderMediaItems(media = []) {
  if (!media.length) {
    return "";
  }

  const isImageItem = (item) => item && item.type !== "video" && item.type !== "document" && item.category !== "document";
  const onlyImages = media.every((item) => isImageItem(item));

  const renderImageCard = (item) => `
    <article class="tracking-media-card image tracking-carousel-item">
      <button
        class="tracking-media-download-icon"
        type="button"
        data-download-url="${escapeHtml(item.url)}"
        data-download-name="${escapeHtml(item.name || item.caption || "imagen")}" 
        aria-label="Descargar imagen"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 3a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.4L11 12.6V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"></path>
        </svg>
      </button>
      <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || item.name || "Adjunto")}" loading="lazy" />
    </article>
  `;

  if (onlyImages && media.length > 1) {
    return `
      <div class="tracking-carousel-shell">
        <div class="tracking-carousel-strip" data-tracking-carousel>
          ${media.map((item) => renderImageCard(item)).join("")}
        </div>
        <div class="tracking-carousel-indicators">
          ${media
            .map(
              (_, index) => `
                <button
                  class="feed-carousel-dot ${index === 0 ? "is-active" : ""}"
                  type="button"
                  data-tracking-carousel-dot
                  data-tracking-carousel-index="${index}"
                  aria-label="Ir a la imagen ${index + 1}"
                ></button>
              `
            )
            .join("")}
        </div>
      </div>
    `;
  }

  return `
    <div class="tracking-state-media-list client">
      ${media
        .map((item) => {
          if (item.type === "video") {
            return `
              <article class="tracking-media-card video">
                ${renderVideoElement(item.url, item.caption || item.name || "Video")}
                <strong>${escapeHtml(item.caption || item.name || "Video")}</strong>
              </article>
            `;
          }

          if (item.type === "document" || item.category === "document") {
            const fileName = item.name || item.caption || "documento";
            const extension = fileName.includes(".") ? fileName.split(".").pop() : "PDF";
            return `
              <button
                class="tracking-document-download"
                type="button"
                data-download-url="${escapeHtml(item.url)}"
                data-download-name="${escapeHtml(fileName)}"
                aria-label="Descargar ${escapeHtml(fileName)}"
              >
                <span class="tracking-document-pill">${escapeHtml(String(extension).toUpperCase())}</span>
                <span class="tracking-document-name">${escapeHtml(item.caption || item.name || "Documento")}</span>
                <span class="tracking-document-cta">Descargar</span>
              </button>
            `;
          }

          return renderImageCard(item);
        })
        .join("")}
    </div>
  `;
}

function updateTrackingCarouselDots(carouselElement) {
  const shell = carouselElement.closest(".tracking-carousel-shell");
  const dots = Array.from(shell?.querySelectorAll("[data-tracking-carousel-dot]") || []);

  if (!dots.length) {
    return;
  }

  const activeIndex = Math.round(carouselElement.scrollLeft / Math.max(carouselElement.clientWidth, 1));

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === activeIndex);
  });
}

function bindTrackingCarousels(scope = trackingResults) {
  scope.querySelectorAll("[data-tracking-carousel]").forEach((carouselElement) => {
    if (carouselElement.dataset.carouselBound === "true") {
      updateTrackingCarouselDots(carouselElement);
      return;
    }

    carouselElement.dataset.carouselBound = "true";
    updateTrackingCarouselDots(carouselElement);

    carouselElement.addEventListener("scroll", () => {
      updateTrackingCarouselDots(carouselElement);
    }, { passive: true });
  });
}

function buildStateMediaBuckets(media = []) {
  return {
    document: media.filter((item) => item.category === "document" || item.type === "document"),
    photoSingle: media.filter((item) => item.category === "photo-single"),
    photoCarousel: media.filter((item) => item.category === "photo-carousel" || (item.type === "image" && !item.category)),
    video: media.filter((item) => item.category === "video" || item.type === "video"),
  };
}

function renderCategorizedMediaSections(media = []) {
  const buckets = buildStateMediaBuckets(media);
  const sections = [];

  if (buckets.document.length) {
    sections.push(`
      <section class="tracking-state-media-block">
        <strong>Documentos importantes</strong>
        ${renderMediaItems(buckets.document)}
      </section>
    `);
  }

  if (buckets.photoSingle.length) {
    sections.push(`
      <section class="tracking-state-media-block no-title">
        ${renderMediaItems(buckets.photoSingle)}
      </section>
    `);
  }

  if (buckets.photoCarousel.length) {
    sections.push(`
      <section class="tracking-state-media-block no-title">
        ${renderMediaItems(buckets.photoCarousel)}
      </section>
    `);
  }

  if (buckets.video.length) {
    sections.push(`
      <section class="tracking-state-media-block no-title">
        ${renderMediaItems(buckets.video)}
      </section>
    `);
  }

  if (!sections.length) {
    return '<p class="tracking-state-empty">Sin archivos para este estado.</p>';
  }

  return `
    <div class="tracking-state-media-groups">
      ${sections.join("")}
    </div>
  `;
}

async function downloadDocument(url, fileName) {
  const nativeDownloadHandler = window.webkit?.messageHandlers?.globalImportsDownload;

  if (nativeDownloadHandler?.postMessage) {
    nativeDownloadHandler.postMessage({
      url,
      fileName,
    });
    return;
  }

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName || "documento";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function renderEmptyState(message) {
  trackingResults.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function getClientVisibleTrackingEvents(order) {
  return (Array.isArray(order?.trackingEvents) ? order.trackingEvents : [])
    .filter((event) => event?.clientVisible)
    .map((event) => ({
      ...event,
      key: String(event?.stateKey || event?.stepKey || "").trim(),
      label: String(event?.stateLabel || "").trim(),
      media: Array.isArray(event?.media) ? event.media.filter((item) => item?.clientVisible !== false) : [],
      updatedAt: event?.updatedAt || event?.createdAt || null,
      createdAt: event?.createdAt || null,
      inProgress: Boolean(event?.completed ? false : event?.inProgress),
      completed: Boolean(event?.completed),
    }))
    .filter((event) => event.key);
}

function buildTrackingStepsFromEvents(order) {
  const events = getClientVisibleTrackingEvents(order);
  const eventsByStepKey = new Map();
  const sourceStepsByKey = new Map(
    (Array.isArray(order?.trackingSteps) ? order.trackingSteps : []).map((step) => [String(step?.key || "").trim(), step])
  );

  events.forEach((event) => {
    if (!eventsByStepKey.has(event.key)) {
      eventsByStepKey.set(event.key, []);
    }

    eventsByStepKey.get(event.key).push(event);
  });

  return TRACKING_TIMELINE_STATES.map((stateTemplate) => {
    const sourceStep = sourceStepsByKey.get(stateTemplate.key) || null;
    const stepEvents = (eventsByStepKey.get(stateTemplate.key) || []).sort((left, right) => {
      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return leftTime - rightTime;
    });
    const latestEvent = stepEvents[stepEvents.length - 1] || null;

    return {
      key: stateTemplate.key,
      label: String(sourceStep?.label || latestEvent?.label || stateTemplate.label).trim(),
      clientVisible: Boolean(sourceStep?.clientVisible) || stepEvents.length > 0,
      confirmed: Boolean(sourceStep?.confirmed) || stepEvents.some((event) => event.completed),
      inProgress:
        !Boolean(sourceStep?.confirmed) &&
        (Boolean(sourceStep?.inProgress) || stepEvents.some((event) => event.inProgress && !event.completed)),
      updatedAt: latestEvent?.updatedAt || latestEvent?.createdAt || sourceStep?.updatedAt || null,
      updates: stepEvents,
    };
  });
}

function buildTimelineStates(visibleConfirmedStates = []) {
  const visibleByKey = new Map(
    (visibleConfirmedStates || []).map((item) => [String(item.key || ""), item])
  );

  const baseStates = TRACKING_TIMELINE_STATES.map((stateTemplate) => {
    const visibleState = visibleByKey.get(stateTemplate.key);

    return {
      key: stateTemplate.key,
      label: visibleState?.label || stateTemplate.label,
      confirmed: Boolean(visibleState?.confirmed),
      inProgress: Boolean(visibleState?.inProgress),
    };
  });

  const furthestReachedIndex = baseStates.reduce(
    (maxIndex, state, index) => (state.confirmed || state.inProgress ? index : maxIndex),
    -1
  );

  const normalizedStates = baseStates.map((state, index) => {
    if (furthestReachedIndex > 0 && index < furthestReachedIndex) {
      return {
        ...state,
        confirmed: true,
        inProgress: false,
      };
    }

    return state;
  });

  if (normalizedStates.some((state) => state.inProgress && !state.confirmed)) {
    return normalizedStates;
  }

  const firstPendingIndex = normalizedStates.findIndex((state) => !state.confirmed);

  if (firstPendingIndex <= 0) {
    return normalizedStates;
  }

  return normalizedStates.map((state, index) => ({
    ...state,
    inProgress: index === firstPendingIndex,
  }));
}

function buildTrackingEventRows(order) {
  function getTrackingEventStageIndex(event) {
    return TRACKING_TIMELINE_STATES.findIndex((item) => item.key === event.key);
  }

  return getClientVisibleTrackingEvents(order)
    .sort((left, right) => {
      const leftStageIndex = getTrackingEventStageIndex(left);
      const rightStageIndex = getTrackingEventStageIndex(right);

      if (leftStageIndex !== rightStageIndex) {
        if (leftStageIndex === -1) {
          return 1;
        }

        if (rightStageIndex === -1) {
          return -1;
        }

        return leftStageIndex - rightStageIndex;
      }

      const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return leftTime - rightTime;
    })
    .map((event, index) => {
      const matchedState = TRACKING_TIMELINE_STATES.find((item) => item.key === event.key);
      const matchedStateIndex = TRACKING_TIMELINE_STATES.findIndex((item) => item.key === event.key);
      const title = String(event.title || event.headline || "").trim();
      const descriptionSource = String(event.notes || event.description || "").trim();
      const hasDescription = Boolean(descriptionSource);
      const stageLabel = event.label || matchedState?.label || "Etapa";

      return {
        key: `${event.key}-${event.updatedAt || event.createdAt || index}`,
        date: event.updatedAt || event.createdAt || null,
        stage: matchedStateIndex >= 0 ? `E${matchedStateIndex + 1} - ${stageLabel}` : stageLabel,
        title,
        description: hasDescription ? descriptionSource : "Sin descripción por ahora.",
        hasDescription,
      };
    });
}

function buildTrackingVehicleDetailsMarkup(order) {
  const detailItems = [
    {
      label: "VIN",
      value: String(order?.vehicle?.vin || "").trim() || "Sin VIN",
      valueClassName: "tracking-card-detail-value-vin",
    },
    {
      label: "Año",
      value: String(order?.vehicle?.year || "").trim() || "-",
    },
    {
      label: "Exterior",
      value: String(order?.vehicle?.exteriorColor || order?.vehicle?.color || "").trim() || "-",
    },
    {
      label: "Interior",
      value: String(order?.vehicle?.interiorColor || "").trim() || "-",
    },
  ];

  return detailItems
    .map((item) => `
      <article class="tracking-card-detail-item">
        <span class="tracking-card-detail-label">${escapeHtml(item.label)}</span>
        <strong class="tracking-card-detail-value${item.valueClassName ? ` ${item.valueClassName}` : ""}">${escapeHtml(item.value)}</strong>
      </article>
    `)
    .join("");
}

function buildTrackingVehicleTitle(order) {
  const vehicle = order?.vehicle || {};
  return [vehicle.brand || "Vehículo", vehicle.model || "", vehicle.version || "", vehicle.year || ""]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");
}

function getTrackingClientName(order) {
  const clientName = order?.client && typeof order.client === "object"
    ? order.client.name
    : "";

  return String(clientName || "").trim() || "Cliente";
}

function buildTrackingFiles(order) {
  const eventFiles = getClientVisibleTrackingEvents(order)
    .flatMap((event, eventIndex) => {
      const matchedState = TRACKING_TIMELINE_STATES.find((item) => item.key === event.key);
      const stageLabel = event.label || matchedState?.label || "Etapa";

      return (Array.isArray(event.media) ? event.media : [])
        .filter((item) => item?.url && item.type !== "video" && item.category !== "video")
        .map((item, mediaIndex) => ({
          key: `${event.key}-${event.updatedAt || event.createdAt || eventIndex}-${mediaIndex}`,
          url: item.url,
          type: item.type || (item.category === "document" ? "document" : "image"),
          category: item.category || "",
          name: String(item.name || "").trim(),
          caption: String(item.caption || item.name || stageLabel || "Archivo").trim(),
          note: "",
          stageLabel,
          date: event.updatedAt || event.createdAt || null,
        }));
    });

  const orderDocumentFiles = (Array.isArray(order?.media) ? order.media : [])
    .filter((item) => item?.url && item?.clientVisible && item?.category === "document")
    .map((item, index) => ({
      key: `order-document-${String(item.documentId || index)}`,
      url: item.url,
      type: isImageLikeDocument(item) ? "image" : "document",
      category: item.category || "document",
      name: String(item.name || "").trim(),
      caption: String(item.caption || item.name || item.documentType || "Archivo").trim(),
      note: String(item.note || "").trim(),
      stageLabel: "Documentos del pedido",
      date: item.updatedAt || item.createdAt || null,
    }));

  return eventFiles
    .concat(orderDocumentFiles)
    .sort((left, right) => {
      const leftTime = new Date(left.date || 0).getTime();
      const rightTime = new Date(right.date || 0).getTime();
      return rightTime - leftTime;
    });
}

function renderTrackingImageModal() {
  return `
    <div class="tracking-image-modal" data-tracking-image-modal hidden>
      <div class="tracking-image-modal-backdrop" data-close-tracking-image-modal="true"></div>
      <div class="tracking-image-modal-dialog" role="dialog" aria-modal="true" aria-label="Vista ampliada de imagen">
        <button type="button" class="tracking-image-modal-close" data-close-tracking-image-modal="true" aria-label="Cerrar vista ampliada">&times;</button>
        <img data-tracking-image-modal-src alt="Imagen ampliada del tracking" />
        <p class="tracking-image-modal-note" data-tracking-image-modal-note></p>
      </div>
    </div>
  `;
}

function openTrackingImageModal(url, note = "") {
  const modal = trackingResults.querySelector("[data-tracking-image-modal]");
  const imageElement = modal?.querySelector("[data-tracking-image-modal-src]");
  const noteElement = modal?.querySelector("[data-tracking-image-modal-note]");

  if (!modal || !imageElement) {
    return;
  }

  imageElement.src = url;
  noteElement.textContent = note || "";
  modal.hidden = false;
  document.body.classList.add("tracking-image-modal-open");
}

function closeTrackingImageModal() {
  const modal = trackingResults.querySelector("[data-tracking-image-modal]");
  const imageElement = modal?.querySelector("[data-tracking-image-modal-src]");
  const noteElement = modal?.querySelector("[data-tracking-image-modal-note]");

  if (!modal) {
    return;
  }

  modal.hidden = true;
  document.body.classList.remove("tracking-image-modal-open");

  if (imageElement) {
    imageElement.removeAttribute("src");
  }

  if (noteElement) {
    noteElement.textContent = "";
  }
}

function renderTrackingTimeline(order) {
  const timelineStates = buildTimelineStates(buildTrackingStepsFromEvents(order));
  const statesMarkup = timelineStates
    .map((state, index) => {
      let stateClass = "pending";
      let stateStatus = "Pendiente";

      if (state.confirmed) {
        stateClass = "completed";
        stateStatus = "Completado";
      } else if (state.inProgress) {
        stateClass = "current";
        stateStatus = "En curso";
      }
      const connectorClass = state.confirmed
        ? "is-completed"
        : state.inProgress
          ? "is-current"
          : "is-pending";

      return `
        <article class="tracking-journey-step ${stateClass}">
          <div class="tracking-journey-rail" aria-hidden="true">
            ${index > 0 ? '<span class="tracking-journey-segment is-top"></span>' : '<span class="tracking-journey-segment is-top is-hidden"></span>'}
            <span class="tracking-journey-dot ${stateClass}"></span>
            ${index < timelineStates.length - 1 ? `<span class="tracking-journey-segment is-bottom ${connectorClass}"></span>` : '<span class="tracking-journey-segment is-bottom is-hidden"></span>'}
          </div>
          <div class="tracking-journey-copy">
            <small>Etapa ${index + 1}</small>
            <strong>${escapeHtml(state.label)}</strong>
            <span>${stateStatus}</span>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <section class="tracking-roadmap" aria-label="Linea de tiempo del tracking">
      <div class="tracking-journey-head">
        <p class="tracking-journey-kicker">Ruta del pedido</p>
        <h2>Etapas del proceso</h2>
        <p>Cada punto muestra si la etapa ya se completó, si está en curso o si sigue pendiente.</p>
      </div>
      <div class="tracking-journey-list">${statesMarkup}</div>
    </section>
  `;
}

function renderTrackingEventsTable(order) {
  const eventRows = buildTrackingEventRows(order);

  if (!eventRows.length) {
    return `
      <section class="tracking-events-card">
        <div class="tracking-events-head">
          <p class="tracking-journey-kicker">Historial</p>
          <h2>Eventos del pedido</h2>
        </div>
        <p class="tracking-events-empty">Todavía no hay eventos visibles para este pedido.</p>
      </section>
    `;
  }

  return `
    <section class="tracking-events-card">
      <div class="tracking-events-head">
        <p class="tracking-journey-kicker">Historial</p>
        <h2>Eventos del pedido</h2>
      </div>
      <div class="tracking-events-scroll-hint" aria-hidden="true">
        <span>Desliza la tabla para ver todo</span>
        <span class="tracking-events-scroll-hint-arrows">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </div>
      <div class="tracking-events-table-wrap">
        <table class="tracking-events-table" aria-label="Historial de eventos del pedido">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Etapa</th>
              <th>Título</th>
              <th>Descripción</th>
            </tr>
          </thead>
          <tbody>
            ${eventRows
              .map((event) => `
                <tr>
                  <td>${escapeHtml(event.date ? formatDate(event.date) : "Sin fecha")}</td>
                  <td>${escapeHtml(event.stage || "Etapa")}</td>
                  <td>${event.title ? escapeHtml(event.title) : '<span class="tracking-event-title-placeholder">-</span>'}</td>
                  <td class="tracking-events-description-cell">
                    ${event.hasDescription
                      ? `<span class="tracking-event-description-text">${escapeHtml(event.description || "")}</span>`
                      : '<span class="tracking-event-description-fallback">Sin descripción por ahora.</span>'}
                  </td>
                </tr>
              `)
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTrackingFilesSection(order) {
  const files = buildTrackingFiles(order);
  const imageFiles = files.filter((item) => item.type !== "document" && item.category !== "document");
  const documentFiles = files.filter((item) => item.type === "document" || item.category === "document");

  if (!files.length) {
    return `
      <section class="tracking-files-card">
        <div class="tracking-events-head">
          <p class="tracking-journey-kicker">Archivos</p>
          <h2>Fotos y documentos</h2>
          <p class="tracking-files-intro">Aquí verás los archivos que tu asesor comparta contigo durante el proceso.</p>
        </div>
        <p class="tracking-events-empty">Todavía no hay archivos visibles para este pedido.</p>
      </section>
    `;
  }

  return `
    <section class="tracking-files-card">
      <div class="tracking-events-head">
        <p class="tracking-journey-kicker">Archivos</p>
        <h2>Fotos y documentos</h2>
        <p class="tracking-files-intro">Aquí verás los archivos que tu asesor comparta contigo durante el proceso.</p>
      </div>
      <div class="tracking-files-gallery">
        ${imageFiles.length
          ? `
            <div class="tracking-files-carousel-shell tracking-carousel-shell">
              <div class="tracking-carousel-strip tracking-files-carousel" data-tracking-carousel>
                ${imageFiles
                  .map((item) => {
                    const footerText = item.note || item.caption || item.stageLabel || "Archivo";

                    return `
                      <article class="tracking-file-card image tracking-carousel-item tracking-files-carousel-item">
                        <button
                          class="tracking-file-image-button"
                          type="button"
                          data-open-tracking-image="true"
                          data-image-url="${escapeHtml(item.url)}"
                          data-image-note="${escapeHtml(footerText)}"
                          aria-label="Ampliar imagen del tracking"
                        >
                          <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.caption || item.name || "Archivo del pedido")}" loading="lazy" />
                        </button>
                        <button
                          class="tracking-media-download-icon"
                          type="button"
                          data-download-url="${escapeHtml(item.url)}"
                          data-download-name="${escapeHtml(item.name || item.caption || "imagen")}"
                          aria-label="Descargar imagen"
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M12 3a1 1 0 0 1 1 1v8.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 1.4-1.4L11 12.6V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"></path>
                          </svg>
                        </button>
                        <div class="tracking-file-meta">
                          <p class="tracking-file-caption">${escapeHtml(footerText)}</p>
                        </div>
                      </article>
                    `;
                  })
                  .join("")}
              </div>
              ${imageFiles.length > 1
                ? `
                  <div class="tracking-carousel-indicators">
                    ${imageFiles
                      .map(
                        (_, index) => `
                          <button
                            class="feed-carousel-dot ${index === 0 ? "is-active" : ""}"
                            type="button"
                            data-tracking-carousel-dot
                            data-tracking-carousel-index="${index}"
                            aria-label="Ir a la imagen ${index + 1}"
                          ></button>
                        `
                      )
                      .join("")}
                  </div>
                `
                : ""}
            </div>
          `
          : ""}
        ${documentFiles.length
          ? `
            <div class="tracking-files-documents-grid">
              ${documentFiles
                .map((item) => {
                  const footerText = item.note || item.caption || item.stageLabel || "Archivo";
                  const fileName = item.name || item.caption || "documento";
                  const extension = fileName.includes(".") ? fileName.split(".").pop() : "PDF";

                  return `
                    <article class="tracking-file-card document">
                      <button
                        class="tracking-document-download tracking-file-download"
                        type="button"
                        data-download-url="${escapeHtml(item.url)}"
                        data-download-name="${escapeHtml(fileName)}"
                        aria-label="Descargar ${escapeHtml(fileName)}"
                      >
                        <span class="tracking-document-pill">${escapeHtml(String(extension).toUpperCase())}</span>
                        <span class="tracking-document-name">${escapeHtml(item.caption || item.name || "Documento")}</span>
                        <span class="tracking-document-cta">Descargar</span>
                      </button>
                      <div class="tracking-file-meta">
                        <p class="tracking-file-caption">${escapeHtml(footerText)}</p>
                      </div>
                    </article>
                  `;
                })
                .join("")}
            </div>
          `
          : ""}
      </div>
    </section>
  `;
}

function renderTrackingResult(order) {
  activeTrackingOrder = order;
  const timelineMarkup = renderTrackingTimeline(order);
  const eventsTableMarkup = renderTrackingEventsTable(order);
  const filesSectionMarkup = renderTrackingFilesSection(order);
  const vehicleTitle = buildTrackingVehicleTitle(order);
  const clientName = getTrackingClientName(order);

  const mediaMarkup = (Array.isArray(order?.media) ? order.media : [])
    .filter((item) => item?.url && (item?.type === "video" || item?.category === "video"))
    .map((item) => {
      if (item.type === "video") {
        return `<div class="feed-media-card video">${renderVideoElement(item.url, "Video del pedido")}</div>`;
      }

      return "";
    })
    .join("");

  trackingResults.innerHTML = `
    <section class="tracking-preview">
      <div class="tracking-card-header">
        <strong class="tracking-card-title">${escapeHtml(vehicleTitle)}</strong>
        <p class="tracking-card-guide">Guía ${escapeHtml(order.trackingNumber)}</p>
        <div class="tracking-card-client">
          <span class="tracking-card-client-label">Cliente</span>
          <strong class="tracking-card-client-name">${escapeHtml(clientName)}</strong>
        </div>
        <div class="tracking-card-details-grid">
          ${buildTrackingVehicleDetailsMarkup(order)}
        </div>
      </div>
      ${mediaMarkup ? `<div class="feed-media-strip">${mediaMarkup}</div>` : ""}
      ${timelineMarkup}
      ${eventsTableMarkup}
      ${filesSectionMarkup}
      ${renderTrackingImageModal()}
    </section>
  `;

  bindTrackingCarousels(trackingResults);
}

trackingResults.addEventListener("click", (event) => {
  const downloadButton = event.target.closest("[data-download-url]");

  if (downloadButton) {
    const url = downloadButton.getAttribute("data-download-url");
    const name = downloadButton.getAttribute("data-download-name") || "documento";
    if (url) {
      downloadDocument(url, name);
    }
    return;
  }

  const carouselDot = event.target.closest("[data-tracking-carousel-dot]");

  if (carouselDot) {
    const shell = carouselDot.closest(".tracking-carousel-shell");
    const carouselElement = shell?.querySelector("[data-tracking-carousel]");
    const targetIndex = Number(carouselDot.dataset.trackingCarouselIndex || 0);

    if (carouselElement) {
      carouselElement.scrollTo({
        left: carouselElement.clientWidth * targetIndex,
        behavior: "smooth",
      });
    }

    return;
  }

  const imageCardButton = event.target.closest("[data-open-tracking-image]");

  if (imageCardButton) {
    const imageUrl = imageCardButton.getAttribute("data-image-url") || "";
    const imageNote = imageCardButton.getAttribute("data-image-note") || "";

    if (imageUrl) {
      openTrackingImageModal(imageUrl, imageNote);
    }

    return;
  }

  const closeModalTrigger = event.target.closest("[data-close-tracking-image-modal]");

  if (closeModalTrigger) {
    closeTrackingImageModal();
    return;
  }

});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeTrackingImageModal();
  }
});

trackingNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetView = button.dataset.navGo;

    if (!targetView || targetView === "tracking") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const targetUrl = new URL("/client.html", window.location.origin);
    targetUrl.searchParams.set("view", targetView);
    window.location.href = targetUrl.toString();
  });
});

function updateUrl(query) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("v", TRACKING_PAGE_VERSION);
  nextUrl.searchParams.set("tracking", query);
  window.history.replaceState({}, document.title, nextUrl.toString());
}

function ensureTrackingPageVersion() {
  const nextUrl = new URL(window.location.href);

  if (nextUrl.searchParams.get("v") === TRACKING_PAGE_VERSION) {
    return;
  }

  nextUrl.searchParams.set("v", TRACKING_PAGE_VERSION);
  window.history.replaceState({}, document.title, nextUrl.toString());
}

async function handleTrackingSearch() {
  const query = trackingInput.value.trim().toLowerCase();

  if (!query) {
    setFeedback("Ingresa tu número de guía para continuar.", "error");
    renderEmptyState("Ingresa tu número de guía para ver las actualizaciones de tu nuevo juguete.");
    return;
  }

  setFeedback("Buscando guía...", "");

  let order = null;

  try {
    const response = await fetchPublicTracking(query);
    order = response.order || null;
  } catch (error) {
    setFeedback("No encontramos una guía con ese número.", "error");
    renderEmptyState("No encontramos una guía con ese número.");
    return;
  }

  if (!order) {
    setFeedback("No encontramos una guía con ese número.", "error");
    renderEmptyState("No encontramos una guía con ese número.");
    return;
  }

  setFeedback("");
  updateUrl(order.trackingNumber);
  renderTrackingResult(order);
}

async function loadTrackingPage() {
  ensureTrackingPageVersion();
  const params = new URLSearchParams(window.location.search);
  const trackingQuery = params.get("tracking") || "";
  trackingInput.value = trackingQuery;

  if (hasAuthenticatedClientSession()) {
    syncNativePushToken();
  }

  if (!trackingQuery) {
    renderEmptyState("Ingresa tu número de guía y presiona Rastrear para ver las actualizaciones de tu nuevo juguete.");
    return;
  }

  await handleTrackingSearch();
}

trackingForm.addEventListener("submit", (event) => {
  event.preventDefault();
  handleTrackingSearch().catch((error) => {
    setFeedback(error.message || "Error consultando la guía.", "error");
  });
});

window.addEventListener("globalimports:push-token", (event) => {
  if (!hasAuthenticatedClientSession()) {
    console.info("[push][tracking] Native push token received without authenticated client session; skipping registration on public tracking page.");
    return;
  }

  registerNativePushToken(event.detail || {}).catch((error) => {
    console.warn("[push][tracking] Failed registering native push token on tracking page.", error);
  });
});

window.addEventListener("touchstart", handlePullStart, { passive: true });
window.addEventListener("touchmove", handlePullMove, { passive: false });
window.addEventListener("touchend", handlePullEnd, { passive: true });
window.addEventListener("wheel", handleWheelRefresh, { passive: true });

loadTrackingPage().catch((error) => {
  setFeedback(error.message, "error");
  renderEmptyState(error.message);
});