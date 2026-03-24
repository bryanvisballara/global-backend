const roleContent = {
  client: {
    title: "Accede a tu seguimiento",
    subtitle:
      "Entra para consultar el estado de tu vehiculo por tracking y revisar novedades del pedido.",
    email: "cliente@globalimports.com",
    button: "Ingresar a mi cuenta",
  },
  admin: {
    title: "Entrar al portal admin",
    subtitle:
      "Los del León",
    email: "admin@globalapp.com",
    button: "Ingresa al portal admin",
  },
};

const apiBaseUrl = window.location.hostname === "localhost"
  ? "http://localhost:10000"
  : "https://global-backend-bdbx.onrender.com";

const segments = document.querySelectorAll(".segment");
const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");
const emailInput = document.getElementById("email");
const submitButton = document.getElementById("submit-button");
const feedbackMessage = document.getElementById("feedback-message");
const loginForm = document.getElementById("login-form");
const signupPrompt = document.querySelector(".signup-prompt");
const authPanel = document.querySelector(".auth-panel");
const logoSymbol = document.getElementById("logo-symbol");
const logoWordmark = document.getElementById("logo-wordmark");
const brandFallback = document.getElementById("brand-fallback");

let selectedRole = "client";

function setFeedback(message, type = "") {
  feedbackMessage.textContent = message;
  feedbackMessage.className = `feedback${type ? ` ${type}` : ""}`;
}

function updateRole(role) {
  selectedRole = role;
  const nextContent = roleContent[role];

  segments.forEach((segment) => {
    segment.classList.toggle("active", segment.dataset.role === role);
  });

  formTitle.textContent = nextContent.title;
  formSubtitle.textContent = nextContent.subtitle;
  emailInput.placeholder = nextContent.email;
  submitButton.textContent = nextContent.button;

  if (signupPrompt) {
    signupPrompt.style.display = role === "admin" ? "none" : "block";
  }

  if (authPanel) {
    authPanel.classList.remove("role-switching");
    void authPanel.offsetWidth;
    authPanel.classList.add("role-switching");
  }

  setFeedback("Pantalla lista para conectar con tu flujo real.");
}

async function updateApiStatus() {
  if (!document.getElementById("api-status")) {
    return;
  }

  const apiStatus = document.getElementById("api-status");

  try {
    const response = await fetch(`${apiBaseUrl}/api/health`);
    const data = await response.json();
    const connected = data.database === "connected";

    apiStatus.textContent = connected ? "API lista" : "API con DB pendiente";
    apiStatus.style.color = connected ? "#0c8b63" : "#c07d16";
  } catch (error) {
    apiStatus.textContent = "API no disponible";
    apiStatus.style.color = "#c54414";
  }
}

segments.forEach((segment) => {
  segment.addEventListener("click", () => updateRole(segment.dataset.role));
});

function hideMissingAsset(element) {
  if (!element) {
    return;
  }

  element.classList.add("hidden-asset");

  if (brandFallback) {
    brandFallback.style.display = "block";
  }
}

if (logoSymbol) {
  logoSymbol.addEventListener("error", () => hideMissingAsset(logoSymbol));
}

if (logoWordmark) {
  logoWordmark.addEventListener("error", () => hideMissingAsset(logoWordmark));
}

window.addEventListener("load", () => {
  document.body.classList.add("motion-ready");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const payload = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  submitButton.disabled = true;
  setFeedback("Validando acceso...", "");

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo iniciar sesion.");
    }

    localStorage.setItem("globalAppToken", data.token);
    localStorage.setItem("globalAppRole", data.user.role);

    setFeedback(
      selectedRole === "admin"
        ? "Acceso admin validado. El siguiente paso es construir el portal de gestion."
        : "Acceso correcto. El siguiente modulo sera el tracking del vehiculo.",
      "success"
    );
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

updateRole(selectedRole);
updateApiStatus();