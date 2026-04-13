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
const phoneCountryCodeSelect = document.getElementById("phone-country-code");
const phoneInput = document.getElementById("phone");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const togglePasswordButton = document.getElementById("toggle-password");
const submitButton = document.getElementById("submit-button");
const feedbackMessage = document.getElementById("feedback-message");
const loginForm = document.getElementById("login-form");
const signupLink = document.querySelector(".signup-link");
const signupPromptPrefix = document.getElementById("signup-prompt-prefix");
const verificationModal = document.getElementById("verification-modal");
const verificationForm = document.getElementById("verification-form");
const verificationCodeInput = document.getElementById("verification-code");
const verificationFeedback = document.getElementById("verification-feedback");
const verificationSubmitButton = document.getElementById("verification-submit-button");
const verificationResendButton = document.getElementById("verification-resend-button");
const verificationCopy = document.getElementById("verification-copy");
const logoSymbol = document.getElementById("logo-symbol");
const logoWordmark = document.getElementById("logo-wordmark");
const brandFallback = document.getElementById("brand-fallback");
const utilityRow = document.querySelector(".utility-row");

let authMode = "login";
let pendingVerificationPayload = null;

const COUNTRY_CODES = [
  ["Colombia", "+57"], ["Argentina", "+54"], ["Bolivia", "+591"], ["Brasil", "+55"], ["Chile", "+56"], ["Ecuador", "+593"],
  ["Paraguay", "+595"], ["Peru", "+51"], ["Uruguay", "+598"], ["Venezuela", "+58"], ["Mexico", "+52"], ["Estados Unidos", "+1"],
  ["Canada", "+1"], ["Costa Rica", "+506"], ["Cuba", "+53"], ["El Salvador", "+503"], ["Guatemala", "+502"], ["Honduras", "+504"],
  ["Nicaragua", "+505"], ["Panama", "+507"], ["Republica Dominicana", "+1"], ["Puerto Rico", "+1"], ["España", "+34"], ["Portugal", "+351"],
  ["Francia", "+33"], ["Alemania", "+49"], ["Italia", "+39"], ["Reino Unido", "+44"], ["Irlanda", "+353"], ["Paises Bajos", "+31"],
  ["Belgica", "+32"], ["Suiza", "+41"], ["Austria", "+43"], ["Suecia", "+46"], ["Noruega", "+47"], ["Dinamarca", "+45"],
  ["Finlandia", "+358"], ["Polonia", "+48"], ["Grecia", "+30"], ["Turquia", "+90"], ["Rusia", "+7"], ["Ucrania", "+380"],
  ["Marruecos", "+212"], ["Egipto", "+20"], ["Sudafrica", "+27"], ["Nigeria", "+234"], ["Kenia", "+254"], ["India", "+91"],
  ["Pakistan", "+92"], ["China", "+86"], ["Japon", "+81"], ["Corea del Sur", "+82"], ["Indonesia", "+62"], ["Filipinas", "+63"],
  ["Vietnam", "+84"], ["Tailandia", "+66"], ["Malasia", "+60"], ["Singapur", "+65"], ["Australia", "+61"], ["Nueva Zelanda", "+64"],
  ["Emiratos Arabes Unidos", "+971"], ["Arabia Saudita", "+966"], ["Qatar", "+974"], ["Israel", "+972"]
];

function populateCountryCodes() {
  if (!phoneCountryCodeSelect) {
    return;
  }

  const defaultCode = "+57";
  phoneCountryCodeSelect.innerHTML = [
    `<option value="${defaultCode}" data-current="true" selected>${defaultCode}</option>`,
    ...COUNTRY_CODES.map(([country, code]) => `<option value="${code}">${code} ${country}</option>`),
  ].join("");
}

function bindCountryCodeSelector() {
  if (!phoneCountryCodeSelect) {
    return;
  }

  phoneCountryCodeSelect.addEventListener("change", () => {
    const currentOption = phoneCountryCodeSelect.querySelector("option[data-current='true']");
    const selectedCode = String(phoneCountryCodeSelect.value || "+57").trim();

    if (currentOption) {
      currentOption.value = selectedCode;
      currentOption.textContent = selectedCode;
    }

    // Keep the control compact after choosing: closed state shows only code.
    phoneCountryCodeSelect.selectedIndex = 0;
  });
}

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

function setVerificationFeedback(message, type = "") {
  if (!verificationFeedback) {
    return;
  }

  verificationFeedback.textContent = message;
  verificationFeedback.className = `feedback${type ? ` ${type}` : ""}`;
}

function openVerificationModal(email) {
  if (!verificationModal) {
    return;
  }

  if (verificationCopy) {
    verificationCopy.textContent = `Te enviamos un código de 6 dígitos a ${email}. Escríbelo para activar tu cuenta.`;
  }

  verificationCodeInput.value = "";
  setVerificationFeedback("Revisa tu bandeja de entrada y escribe el código.");
  verificationModal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => verificationCodeInput?.focus(), 50);
}

function closeVerificationModal() {
  if (!verificationModal) {
    return;
  }

  verificationModal.hidden = true;
  document.body.classList.remove("modal-open");
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
    nameField.style.display = isRegisterMode ? "" : "none";
  }

  if (phoneField) {
    phoneField.hidden = !isRegisterMode;
    phoneField.style.display = isRegisterMode ? "" : "none";
  }

  if (nameInput) {
    nameInput.required = isRegisterMode;
    nameInput.disabled = !isRegisterMode;
  }

  if (phoneInput) {
    phoneInput.required = isRegisterMode;
    phoneInput.disabled = !isRegisterMode;
  }

  if (phoneCountryCodeSelect) {
    phoneCountryCodeSelect.disabled = !isRegisterMode;
  }

  if (utilityRow) {
    utilityRow.style.display = isRegisterMode ? "none" : "flex";
  }

  if (signupLink) {
    signupLink.textContent = isRegisterMode ? "Ya tengo cuenta" : "Regístrate ahora";
  }

  if (signupPromptPrefix) {
    signupPromptPrefix.hidden = isRegisterMode;
  }

  setFeedback(isRegisterMode ? "Completa todos los campos para crear tu cuenta." : "Ingresa tus credenciales para continuar.");
}

function toggleAuthMode() {
  authMode = authMode === "login" ? "register" : "login";
  closeVerificationModal();
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
  const rawPhone = String(formData.get("phone") || "").trim();
  const selectedCode = String(formData.get("phoneCountryCode") || "+57").trim();
  const composedPhone = rawPhone.startsWith("+")
    ? rawPhone
    : `${selectedCode} ${rawPhone}`.trim();
  const payload = authMode === "register"
    ? {
        name: String(formData.get("name") || "").trim(),
        phone: composedPhone,
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || ""),
      }
    : {
        email: formData.get("email"),
        password: formData.get("password"),
      };

  submitButton.disabled = true;
  setFeedback(authMode === "register" ? "Preparando verificación..." : "Validando acceso...", "");

  try {
    const authPath = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    const response = await postJsonWithFallback(authPath, payload);

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo iniciar sesión.");
    }

    if (authMode === "register") {
      pendingVerificationPayload = payload;
      setFeedback("Te enviamos un código de verificación a tu correo.", "success");
      openVerificationModal(payload.email);
      return;
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

if (verificationForm) {
  verificationForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!pendingVerificationPayload?.email) {
      setVerificationFeedback("No hay una verificación pendiente. Vuelve a registrarte.", "error");
      return;
    }

    const code = String(verificationCodeInput?.value || "").replace(/\D/g, "").slice(0, 6);

    if (code.length !== 6) {
      setVerificationFeedback("Ingresa un código válido de 6 dígitos.", "error");
      return;
    }

    verificationSubmitButton.disabled = true;
    setVerificationFeedback("Verificando código...");

    try {
      const response = await postJsonWithFallback("/api/auth/register/verify", {
        email: pendingVerificationPayload.email,
        code,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "No se pudo verificar el código.");
      }

      localStorage.setItem("globalAppToken", data.token);
      localStorage.setItem("globalAppRole", data.user.role);
      sessionStorage.setItem("globalAppToken", data.token);
      sessionStorage.setItem("globalAppRole", data.user.role);

      setVerificationFeedback("Cuenta verificada correctamente. Redirigiendo...", "success");
      pendingVerificationPayload = null;

      window.setTimeout(() => {
        window.location.href = "/app/client.html";
      }, 300);
    } catch (error) {
      setVerificationFeedback(error.message, "error");
    } finally {
      verificationSubmitButton.disabled = false;
    }
  });
}

if (verificationResendButton) {
  verificationResendButton.addEventListener("click", async () => {
    if (!pendingVerificationPayload) {
      setVerificationFeedback("No hay una verificación pendiente.", "error");
      return;
    }

    verificationResendButton.disabled = true;
    setVerificationFeedback("Reenviando código...");

    try {
      const response = await postJsonWithFallback("/api/auth/register", pendingVerificationPayload);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "No se pudo reenviar el código.");
      }

      setVerificationFeedback("Código reenviado correctamente.", "success");
    } catch (error) {
      setVerificationFeedback(error.message, "error");
    } finally {
      verificationResendButton.disabled = false;
    }
  });
}

document.querySelectorAll("[data-close-verification-modal]").forEach((element) => {
  element.addEventListener("click", closeVerificationModal);
});

applyAuthContent();
populateCountryCodes();
bindCountryCodeSelector();
updateApiStatus();

if (signupLink) {
  signupLink.addEventListener("click", toggleAuthMode);
}