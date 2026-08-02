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
const resetPasswordForm = document.getElementById("reset-password-form");
const resetPasswordInput = document.getElementById("reset-password");
const resetPasswordConfirmInput = document.getElementById("reset-password-confirm");
const resetPasswordSubmitButton = document.getElementById("reset-password-submit");
const resetPasswordFeedback = document.getElementById("reset-password-feedback");
const resetPasswordTokenState = document.getElementById("reset-password-token-state");
const resetToken = new URLSearchParams(window.location.search).get("token") || "";

function setResetPasswordFeedback(message, type = "") {
  if (!resetPasswordFeedback) {
    return;
  }

  resetPasswordFeedback.textContent = message;
  resetPasswordFeedback.className = `feedback${type ? ` ${type}` : ""}`;
}

if (!resetToken) {
  resetPasswordSubmitButton.disabled = true;
  setResetPasswordFeedback("El enlace no es válido. Solicita una nueva recuperación.", "error");

  if (resetPasswordTokenState) {
    resetPasswordTokenState.textContent = "Este enlace no contiene un token válido de recuperación.";
  }
} else if (resetPasswordTokenState) {
  resetPasswordTokenState.textContent = "Este enlace es privado, de un solo uso y fue enviado a tu correo registrado.";
}

resetPasswordForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = String(resetPasswordInput?.value || "");
  const confirmPassword = String(resetPasswordConfirmInput?.value || "");

  if (!resetToken) {
    setResetPasswordFeedback("Solicita un nuevo enlace de recuperación.", "error");
    return;
  }

  if (password.length < 6) {
    setResetPasswordFeedback("La contraseña debe tener al menos 6 caracteres.", "error");
    return;
  }

  if (password !== confirmPassword) {
    setResetPasswordFeedback("Las contraseñas no coinciden.", "error");
    return;
  }

  resetPasswordSubmitButton.disabled = true;
  setResetPasswordFeedback("Actualizando contraseña...");

  try {
    const response = await fetch(`${apiBaseUrl}/api/auth/reset-password`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: resetToken,
        password,
        confirmPassword,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "No se pudo actualizar la contraseña.");
    }

    setResetPasswordFeedback("Contraseña actualizada correctamente. Redirigiendo al acceso...", "success");

    window.setTimeout(() => {
      window.location.replace("/app/index.html?reset=success");
    }, 1200);
  } catch (error) {
    setResetPasswordFeedback(error.message, "error");
  } finally {
    resetPasswordSubmitButton.disabled = false;
  }
});