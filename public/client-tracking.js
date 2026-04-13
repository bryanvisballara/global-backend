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
const trackingForm = document.getElementById("tracking-page-form");
const trackingInput = document.getElementById("tracking-page-input");
const trackingResults = document.getElementById("tracking-page-results");
const trackingFeedback = document.getElementById("tracking-page-feedback");
const trackingNavButtons = Array.from(document.querySelectorAll("[data-nav-go]"));
let registeredPushToken = "";
let activeTrackingOrder = null;

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
  const loginUrl = new URL("/app/index.html", window.location.origin);
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
        videoId = parsedUrl.searchParams.get("v") || "";
      }

      if (!videoId) {
        return "";
      }

      return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&mute=1&controls=1&playsinline=1&rel=0&modestbranding=1`;
    }

    if (host.includes("vimeo.com")) {
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      const videoId = segments[segments.length - 1] || "";

      if (!videoId) {
        return "";
      }

      return `https://player.vimeo.com/video/${encodeURIComponent(videoId)}?autoplay=1&muted=1&controls=1&title=0&byline=0&portrait=0`;
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

  return `<video controls autoplay muted playsinline preload="metadata" controlsList="nodownload noplaybackrate" src="${escapeHtml(url)}"></video>`;
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

function buildTimelineStates(visibleConfirmedStates = []) {
  const visibleByKey = new Map(
    (visibleConfirmedStates || []).map((item) => [String(item.key || ""), item])
  );

  return TRACKING_TIMELINE_STATES.map((stateTemplate) => {
    const confirmedState = visibleByKey.get(stateTemplate.key);

    return {
      key: stateTemplate.key,
      label: confirmedState?.label || stateTemplate.label,
      confirmed: Boolean(confirmedState),
    };
  });
}

function renderTruckIcon() {
  return `
    <img class="tracking-road-truck-image" src="/app/camionglobal.jpg" alt="Camion de seguimiento" loading="lazy" />
  `;
}

function renderTrackingTimeline(order, selectedStateKey = "") {
  const timelineStates = buildTimelineStates(order?.trackingSteps || []);
  const completedCount = timelineStates.filter((state) => state.confirmed).length;
  const maxIndex = timelineStates.length - 1;
  const activeIndex = Math.min(completedCount, maxIndex);
  const progressPercent = maxIndex > 0 ? (activeIndex / maxIndex) * 100 : 0;

  const statesMarkup = timelineStates
    .map((state, index) => {
      let stateClass = "pending";
      let stateStatus = "Pendiente";

      if (index < completedCount) {
        stateClass = "completed";
        stateStatus = "Completado";
      } else if (index === activeIndex) {
        stateClass = "current";
        stateStatus = completedCount >= timelineStates.length ? "Completado" : "En curso";
      }

      const selectedClass = state.key === selectedStateKey ? " is-selected" : "";

      return `
        <button class="tracking-road-state ${stateClass}${selectedClass}" type="button" data-timeline-state="${escapeHtml(state.key)}">
          <small>Etapa ${index + 1}</small>
          <strong>${escapeHtml(state.label)}</strong>
          <span>${stateStatus}</span>
        </button>
      `;
    })
    .join("");

  return `
    <section class="tracking-roadmap" aria-label="Linea de tiempo del tracking">
      <div class="tracking-road" role="presentation">
        <div class="tracking-road-line"></div>
        <div class="tracking-road-progress" style="width:${progressPercent.toFixed(2)}%"></div>
        <div class="tracking-road-truck" style="left:${progressPercent.toFixed(2)}%">
          ${renderTruckIcon()}
        </div>
      </div>
      <div class="tracking-road-states">${statesMarkup}</div>
    </section>
  `;
}

function renderSelectedStateDetail(order, stateKey) {
  const detailPanel = trackingResults.querySelector("#tracking-state-detail-panel");

  if (!detailPanel || !order) {
    return;
  }

  const selectedTemplate = TRACKING_TIMELINE_STATES.find((item) => item.key === stateKey) || TRACKING_TIMELINE_STATES[0];
  const selectedStep = (order.trackingSteps || []).find((item) => item.key === selectedTemplate.key);

  if (!selectedStep) {
    detailPanel.innerHTML = `
      <section class="tracking-state-detail-panel">
        <strong>${escapeHtml(selectedTemplate.label)}</strong>
        <p>Este estado aun no tiene informacion visible.</p>
      </section>
    `;
    bindTrackingCarousels(detailPanel);
    return;
  }

  detailPanel.innerHTML = `
    <section class="tracking-state-detail-panel">
      <strong>${escapeHtml(selectedStep.label || selectedTemplate.label)}</strong>
      <p>${escapeHtml(selectedStep.updatedAt ? `Actualizado ${formatDate(selectedStep.updatedAt)}` : "Esperando actualización")}</p>
      <p>${escapeHtml(selectedStep.notes || "Sin observaciones por ahora.")}</p>
      ${renderCategorizedMediaSections(selectedStep.media || [])}
    </section>
  `;

  bindTrackingCarousels(detailPanel);
}

function activateTimelineState(order, stateKey) {
  trackingResults.querySelectorAll("[data-timeline-state]").forEach((button) => {
    button.classList.toggle("is-selected", button.getAttribute("data-timeline-state") === stateKey);
  });

  renderSelectedStateDetail(order, stateKey);
}

function renderTrackingResult(order) {
  activeTrackingOrder = order;
  const defaultStep = (order.trackingSteps || [])[order.trackingSteps.length - 1] || TRACKING_TIMELINE_STATES[0];
  const defaultStateKey = defaultStep?.key || TRACKING_TIMELINE_STATES[0].key;
  const timelineMarkup = renderTrackingTimeline(order, defaultStateKey);

  const mediaMarkup = (order.media || [])
    .map((item) => {
      if (item.type === "video") {
        return `<div class="feed-media-card video">${renderVideoElement(item.url, "Video del pedido")}</div>`;
      }

      return `<div class="feed-media-card"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(order.vehicle?.brand || "Vehículo")}" loading="lazy" /></div>`;
    })
    .join("");

  trackingResults.innerHTML = `
    <section class="tracking-preview">
      <div class="tracking-card-header">
        <strong>${escapeHtml(order.vehicle?.brand || "Vehículo")} ${escapeHtml(order.vehicle?.model || "")}</strong>
        <p>Guía ${escapeHtml(order.trackingNumber)}</p>
        <p>Compra ${escapeHtml(formatDate(order.purchaseDate))} · Llegada estimada ${escapeHtml(formatDate(order.expectedArrivalDate))}</p>
      </div>
      ${mediaMarkup ? `<div class="feed-media-strip">${mediaMarkup}</div>` : ""}
      ${timelineMarkup}
      <div id="tracking-state-detail-panel"></div>
    </section>
  `;

  activateTimelineState(order, defaultStateKey);
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

  const stateButton = event.target.closest("[data-timeline-state]");

  if (!stateButton || !activeTrackingOrder) {
    return;
  }

  const stateKey = stateButton.getAttribute("data-timeline-state");
  if (stateKey) {
    activateTimelineState(activeTrackingOrder, stateKey);
  }
});

trackingNavButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetView = button.dataset.navGo;

    if (!targetView || targetView === "tracking") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const targetUrl = new URL("/app/client.html", window.location.origin);
    targetUrl.searchParams.set("view", targetView);
    window.location.href = targetUrl.toString();
  });
});

function updateUrl(query) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("tracking", query);
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
  const params = new URLSearchParams(window.location.search);
  const trackingQuery = params.get("tracking") || "";
  trackingInput.value = trackingQuery;

  if (getToken() && getRole() === "client") {
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
  registerNativePushToken(event.detail || {}).catch(() => null);
});

loadTrackingPage().catch((error) => {
  setFeedback(error.message, "error");
  renderEmptyState(error.message);
});