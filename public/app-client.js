const authContent = {
  title: "Ingresa a tu cuenta",
  subtitle:
    "Accede con tu correo y contrasena para continuar con tu proceso dentro de Global Imports.",
  email: "correo@globalimports.com",
  button: "Ingresar",
};

function resolveApiBaseUrl() {
  const { protocol, hostname, port } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:${port || "10000"}`;
  }

  return "https://global-backend-bdbx.onrender.com";
}

const apiBaseUrl = resolveApiBaseUrl();

const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePasswordButton = document.getElementById("toggle-password");
const submitButton = document.getElementById("submit-button");
const feedbackMessage = document.getElementById("feedback-message");
const loginForm = document.getElementById("login-form");
const logoSymbol = document.getElementById("logo-symbol");
const logoWordmark = document.getElementById("logo-wordmark");
const brandFallback = document.getElementById("brand-fallback");

function redirectAuthenticatedUser() {
  const token = localStorage.getItem("globalAppToken");
  const role = localStorage.getItem("globalAppRole");

  if (!token) {
    return;
  }

  if (role === "admin") {
    window.location.href = "/app/admin.html";
    return;
  }

  window.location.href = "/app/client.html";
}

function setFeedback(message, type = "") {
  if (!feedbackMessage) {
    return;
  }

  feedbackMessage.textContent = message;
  feedbackMessage.className = `feedback${type ? ` ${type}` : ""}`;
}

function applyAuthContent() {
  formTitle.textContent = authContent.title;
  formSubtitle.textContent = authContent.subtitle;
  emailInput.placeholder = authContent.email;
  submitButton.textContent = authContent.button;

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

if (togglePasswordButton && passwordInput) {
  togglePasswordButton.addEventListener("click", () => {
    const isVisible = passwordInput.type === "text";

    passwordInput.type = isVisible ? "password" : "text";
    togglePasswordButton.setAttribute("aria-pressed", String(!isVisible));
    togglePasswordButton.setAttribute(
      "aria-label",
      isVisible ? "Mostrar contraseña" : "Ocultar contraseña"
    );
    togglePasswordButton.setAttribute(
      "title",
      isVisible ? "Mostrar contraseña" : "Ocultar contraseña"
    );
  });
}

redirectAuthenticatedUser();

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
    if (data.user.role) {
      localStorage.setItem("globalAppRole", data.user.role);
    } else {
      localStorage.removeItem("globalAppRole");
    }

    setFeedback("Acceso correcto. El siguiente paso es continuar con el flujo autenticado.", "success");

    if (data.user.role === "admin") {
      window.setTimeout(() => {
        window.location.href = "/app/admin.html";
      }, 250);
      return;
    }

    window.setTimeout(() => {
      window.location.href = "/app/client.html";
    }, 250);
  } catch (error) {
    setFeedback(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

applyAuthContent();
updateApiStatus();