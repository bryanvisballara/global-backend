const authContent = {
  login: {
    title: "Ingresa a tu cuenta",
    subtitle:
      "Accede con tu correo y contraseña para continuar con tu proceso dentro de Global Imports.",
    email: "correo@globalimports.com",
    button: "Ingresar",
  },
  register: {
    title: "Crea tu cuenta",
    subtitle:
      "Completa tus datos para registrarte y empezar el seguimiento de tu vehiculo.",
    email: "correo@ejemplo.com",
    button: "Registrarme",
  },
};

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

function resolveApiBaseUrlCandidates() {
  const { protocol, hostname, port, origin } = window.location;
  const candidates = [];

  function pushCandidate(value) {
    if (!value || candidates.includes(value)) {
      return;
    }

    candidates.push(value);
  }

  if (protocol === "http:" || protocol === "https:") {
    pushCandidate(origin);
  }

  if (hostname && protocol) {
    pushCandidate(`${protocol}//${hostname}:${port || "10000"}`);
  }

  pushCandidate("http://localhost:10000");
  pushCandidate("http://127.0.0.1:10000");
  pushCandidate("http://192.168.1.95:10000");
  pushCandidate(resolveApiBaseUrl());

  return candidates;
}

async function postJsonWithFallback(path, payload) {
  let lastError = null;

  for (const baseUrl of resolveApiBaseUrlCandidates()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      return response;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No se pudo conectar con la API.");
}

const apiBaseUrl = resolveApiBaseUrl();

const formTitle = document.getElementById("form-title");
const formSubtitle = document.getElementById("form-subtitle");
const nameField = document.getElementById("name-field");
const phoneField = document.getElementById("phone-field");
const nameInput = document.getElementById("name");
const phoneInput = document.getElementById("phone");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePasswordButton = document.getElementById("toggle-password");
const submitButton = document.getElementById("submit-button");
const feedbackMessage = document.getElementById("feedback-message");
const loginForm = document.getElementById("login-form");
const signupLink = document.querySelector(".signup-link");
const logoSymbol = document.getElementById("logo-symbol");
const logoWordmark = document.getElementById("logo-wordmark");
const brandFallback = document.getElementById("brand-fallback");
const utilityRow = document.querySelector(".utility-row");

let authMode = "login";

function clearAuthState() {
  localStorage.removeItem("globalAppToken");
  localStorage.removeItem("globalAppRole");
  sessionStorage.removeItem("globalAppToken");
  sessionStorage.removeItem("globalAppRole");
}

async function redirectAuthenticatedUser() {
  const currentUrl = new URL(window.location.href);

  if (currentUrl.searchParams.get("logout") === "1") {
    clearAuthState();
    currentUrl.searchParams.delete("logout");
    currentUrl.searchParams.delete("t");
    window.history.replaceState({}, document.title, currentUrl.pathname);
    return;
  }

  const token = localStorage.getItem("globalAppToken");
  const role = localStorage.getItem("globalAppRole");

  if (!token) {
    return;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error("Stored session is no longer valid");
    }

    const data = await response.json();
    const resolvedRole = data.user?.role || role;

    if (!resolvedRole) {
      throw new Error("Stored session is missing role information");
    }

    localStorage.setItem("globalAppRole", resolvedRole);
    sessionStorage.setItem("globalAppToken", token);
    sessionStorage.setItem("globalAppRole", resolvedRole);

    if (resolvedRole === "admin") {
      window.location.replace("/app/admin.html");
      return;
    }

    window.location.replace("/app/client.html");
    return;
  } catch {
    clearAuthState();
  }

}

function setFeedback(message, type = "") {
  if (!feedbackMessage) {
    return;
  }

  feedbackMessage.textContent = message;
  feedbackMessage.className = `feedback${type ? ` ${type}` : ""}`;
}

function applyAuthContent() {
  const content = authContent[authMode];
  const isRegisterMode = authMode === "register";

  formTitle.textContent = content.title;
  formSubtitle.textContent = content.subtitle;
  emailInput.placeholder = content.email;
  submitButton.textContent = content.button;

  if (nameField) {
    nameField.hidden = !isRegisterMode;
  }

  if (phoneField) {
    phoneField.hidden = !isRegisterMode;
  }

  if (nameInput) {
    nameInput.required = isRegisterMode;
  }

  if (phoneInput) {
    phoneInput.required = isRegisterMode;
  }

  if (utilityRow) {
    utilityRow.style.display = isRegisterMode ? "none" : "flex";
  }

  if (signupLink) {
    signupLink.textContent = isRegisterMode ? "Ya tengo cuenta" : "Regístrate ahora";
  }

  setFeedback(isRegisterMode ? "Completa todos los campos para crear tu cuenta." : "Ingresa tus credenciales para continuar.");
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  applyAuthContent();
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

redirectAuthenticatedUser().catch(() => {
  clearAuthState();
});

window.addEventListener("load", () => {
  document.body.classList.add("motion-ready");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const payload = authMode === "register"
    ? {
        name: String(formData.get("name") || "").trim(),
        phone: String(formData.get("phone") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || ""),
      }
    : {
        email: formData.get("email"),
        password: formData.get("password"),
      };

  submitButton.disabled = true;
  setFeedback(authMode === "register" ? "Creando cuenta..." : "Validando acceso...", "");

  try {
    const authPath = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const response = await postJsonWithFallback(authPath, payload);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo iniciar sesión.");
    }

    localStorage.setItem("globalAppToken", data.token);
    if (data.user.role) {
      localStorage.setItem("globalAppRole", data.user.role);
      sessionStorage.setItem("globalAppRole", data.user.role);
    } else {
      localStorage.removeItem("globalAppRole");
      sessionStorage.removeItem("globalAppRole");
    }
    sessionStorage.setItem("globalAppToken", data.token);

    setFeedback(
      authMode === "register"
        ? "Cuenta creada correctamente. Redirigiendo..."
        : "Acceso correcto. Redirigiendo...",
      "success"
    );

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
    const errorMessage = error?.message === "Failed to fetch"
      ? "No pudimos conectar con la API local. Verifica que el servidor siga corriendo en el puerto 10000."
      : error.message;
    setFeedback(errorMessage, "error");
  } finally {
    submitButton.disabled = false;
  }
});

applyAuthContent();
updateApiStatus();

if (signupLink) {
  signupLink.addEventListener("click", toggleAuthMode);
}