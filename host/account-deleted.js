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
const feedbackForm = document.getElementById("deleted-account-feedback-form");
const recommendationInput = document.getElementById("deleted-account-recommendation");
const feedbackMessage = document.getElementById("deleted-account-feedback");
const feedbackSubmitButton = document.getElementById("deleted-account-feedback-submit");
const feedbackToken = new URLSearchParams(window.location.search).get("token") || "";

function setFeedback(message, type = "") {
  if (!feedbackMessage) {
    return;
  }

  feedbackMessage.textContent = message;
  feedbackMessage.className = `feedback${type ? ` ${type}` : ""}`;
}

if (!feedbackToken) {
  setFeedback("Este enlace de despedida ya no es válido, pero gracias por habernos acompañado.", "error");

  if (feedbackSubmitButton) {
    feedbackSubmitButton.disabled = true;
  }
}

feedbackForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const recommendation = String(recommendationInput?.value || "").trim();

  if (!feedbackToken) {
    setFeedback("No encontramos el token para guardar tu recomendación.", "error");
    return;
  }

  if (!recommendation) {
    setFeedback("Escribe una recomendación antes de enviarla, o vuelve al acceso si prefieres omitirla.", "error");
    return;
  }

  if (feedbackSubmitButton) {
    feedbackSubmitButton.disabled = true;
  }

  setFeedback("Guardando tu recomendación...");

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/delete-account/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: feedbackToken,
        recommendation,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo guardar tu recomendación.");
    }

    setFeedback("Gracias por compartir tu recomendación con nosotros.", "success");
    recommendationInput.disabled = true;
    feedbackSubmitButton.disabled = true;
  } catch (error) {
    setFeedback(error.message, "error");

    if (feedbackSubmitButton) {
      feedbackSubmitButton.disabled = false;
    }
  }
});