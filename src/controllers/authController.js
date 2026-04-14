const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const EmailVerification = require("../models/EmailVerification");
const PasswordResetToken = require("../models/PasswordResetToken");
const {
  sendPasswordResetEmail,
  sendRegistrationVerificationEmail,
} = require("../services/brevoEmailService");
const { generateToken } = require("../utils/token");

const VERIFICATION_TTL_MINUTES = 10;
const VERIFICATION_RESEND_COOLDOWN_MS = 30 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 8;
const PASSWORD_RESET_TTL_MINUTES = 30;

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generateVerificationCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function buildVerificationExpiryDate() {
  return new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60 * 1000);
}

function buildPasswordResetExpiryDate() {
  return new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function generatePasswordResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

function resolvePublicAppBaseUrl(req) {
  const configuredBaseUrl = String(process.env.PUBLIC_APP_URL || process.env.APP_BASE_URL || "").trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, "");
  }

  const forwardedProto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;

  return `${forwardedProto}://${host}`.replace(/\/$/, "");
}

function buildPasswordResetUrl(req, token) {
  const appBaseUrl = resolvePublicAppBaseUrl(req);
  return `${appBaseUrl}/app/reset-password.html?token=${encodeURIComponent(token)}`;
}

function getAuthCookieOptions(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  // Siempre secure y SameSite=None en producción (HTTPS)
  const isProduction = process.env.NODE_ENV === "production";
  const isSecure = isProduction || req.secure || forwardedProto === "https";

  return {
    httpOnly: true,
    sameSite: isProduction ? "none" : "lax",
    secure: isSecure,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

function setAuthCookie(req, res, token) {
  res.cookie("globalAppToken", token, getAuthCookieOptions(req));
}

function clearAuthCookie(req, res) {
  res.clearCookie("globalAppToken", {
    ...getAuthCookieOptions(req),
    maxAge: undefined,
  });
}

async function startRegistrationVerification(req, res) {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({ message: "Name, email, password and phone are required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const trimmedName = name.trim();
    const trimmedPhone = String(phone).trim();

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    const existingVerification = await EmailVerification.findOne({ email: normalizedEmail });

    if (existingVerification?.lastSentAt && Date.now() - existingVerification.lastSentAt.getTime() < VERIFICATION_RESEND_COOLDOWN_MS) {
      return res.status(429).json({
        message: "Espera unos segundos antes de solicitar otro código.",
      });
    }

    const verificationCode = generateVerificationCode();
    const passwordHash = await bcrypt.hash(password, 10);

    await EmailVerification.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        name: trimmedName,
        phone: trimmedPhone,
        passwordHash,
        codeHash: hashVerificationCode(verificationCode),
        expiresAt: buildVerificationExpiryDate(),
        lastSentAt: new Date(),
        attempts: 0,
        $inc: { sentCount: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await sendRegistrationVerificationEmail({
      toEmail: normalizedEmail,
      toName: trimmedName,
      verificationCode,
    });

    return res.status(200).json({
      message: "Código de verificación enviado correctamente.",
      email: normalizedEmail,
      expiresInMinutes: VERIFICATION_TTL_MINUTES,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error sending verification code" });
  }
}

async function verifyRegistrationCode(req, res) {
  try {
    const { email, code } = req.body;

    if (!email || !code) {
      return res.status(400).json({ message: "Email and verification code are required" });
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const normalizedCode = String(code).trim();

    if (!/^\d{6}$/.test(normalizedCode)) {
      return res.status(400).json({ message: "El código debe tener 6 dígitos." });
    }

    const pendingVerification = await EmailVerification.findOne({ email: normalizedEmail });

    if (!pendingVerification) {
      return res.status(404).json({ message: "No hay verificación pendiente para este correo." });
    }

    if (pendingVerification.expiresAt.getTime() < Date.now()) {
      await EmailVerification.deleteOne({ _id: pendingVerification._id });
      return res.status(410).json({ message: "El código expiró. Solicita uno nuevo." });
    }

    if (pendingVerification.attempts >= VERIFICATION_MAX_ATTEMPTS) {
      await EmailVerification.deleteOne({ _id: pendingVerification._id });
      return res.status(429).json({ message: "Demasiados intentos. Solicita un nuevo código." });
    }

    const matches = pendingVerification.codeHash === hashVerificationCode(normalizedCode);

    if (!matches) {
      pendingVerification.attempts += 1;
      await pendingVerification.save();
      return res.status(401).json({ message: "Código inválido." });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      await EmailVerification.deleteOne({ _id: pendingVerification._id });
      return res.status(409).json({ message: "User already exists" });
    }

    const user = await User.create({
      name: pendingVerification.name,
      email: pendingVerification.email,
      password: pendingVerification.passwordHash,
      phone: pendingVerification.phone,
      role: "client",
    });

    await EmailVerification.deleteOne({ _id: pendingVerification._id });

    const token = generateToken(user);

    setAuthCookie(req, res, token);

    return res.status(201).json({
      message: "User created successfully",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error verifying signup code" });
  }
}

async function requestPasswordReset(req, res) {
  try {
    const normalizedEmail = String(req.body?.email || "").toLowerCase().trim();

    if (!normalizedEmail) {
      return res.status(400).json({ message: "El correo es obligatorio." });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.isActive === false) {
      return res.status(200).json({
        message: "Si el correo existe, enviaremos un enlace de recuperación en unos instantes.",
      });
    }

    const rawToken = generatePasswordResetToken();
    const tokenHash = hashResetToken(rawToken);

    await PasswordResetToken.deleteMany({ user: user._id });

    await PasswordResetToken.create({
      user: user._id,
      email: normalizedEmail,
      tokenHash,
      expiresAt: buildPasswordResetExpiryDate(),
      requestedAt: new Date(),
    });

    await sendPasswordResetEmail({
      toEmail: user.email,
      toName: user.name,
      resetUrl: buildPasswordResetUrl(req, rawToken),
    });

    return res.status(200).json({
      message: "Si el correo existe, enviaremos un enlace de recuperación en unos instantes.",
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error sending password reset email" });
  }
}

async function resetPassword(req, res) {
  try {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ message: "Token, contraseña y confirmación son obligatorios." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres." });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: "Las contraseñas no coinciden." });
    }

    const resetRecord = await PasswordResetToken.findOne({
      tokenHash: hashResetToken(token),
      consumedAt: null,
    }).populate("user");

    if (!resetRecord || !resetRecord.user) {
      return res.status(400).json({ message: "El enlace de recuperación ya no es válido." });
    }

    if (resetRecord.expiresAt.getTime() < Date.now()) {
      await PasswordResetToken.deleteOne({ _id: resetRecord._id });
      return res.status(410).json({ message: "El enlace expiró. Solicita uno nuevo." });
    }

    resetRecord.user.password = await bcrypt.hash(password, 10);
    await resetRecord.user.save();

    resetRecord.consumedAt = new Date();
    await resetRecord.save();
    await PasswordResetToken.deleteMany({ user: resetRecord.user._id });

    return res.status(200).json({ message: "Contraseña actualizada correctamente." });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error resetting password" });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    console.log("[LOGIN] MONGODB_URI:", process.env.MONGODB_URI);
    console.log("[LOGIN] Email recibido:", email);
    console.log("[LOGIN] Password recibido:", password);

    if (!email || !password) {
      console.log("[LOGIN] Faltan email o password");
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    console.log("[LOGIN] Usuario encontrado:", user ? user.email : null);

    if (!user) {
      console.log("[LOGIN] Usuario no existe");
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    console.log("[LOGIN] Password coincide:", passwordMatches);

    if (!passwordMatches) {
      console.log("[LOGIN] Password incorrecto");
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user);
    setAuthCookie(req, res, token);

    console.log("[LOGIN] Login exitoso para:", user.email);
    return res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.log("[LOGIN] Error en login:", error);
    return res.status(500).json({ message: "Error logging in" });
  }
}

async function me(req, res) {
  return res.status(200).json({
    user: req.user,
  });
}

async function logout(req, res) {
  clearAuthCookie(req, res);

  return res.status(200).json({
    message: "Logout successful",
  });
}

async function deleteAccount(req, res) {
  try {
    const password = String(req.body?.password || "");

    if (!password) {
      return res.status(400).json({ message: "La contraseña es obligatoria." });
    }

    const user = await User.findById(req.user?._id);

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado." });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(403).json({ message: "La contraseña no es correcta." });
    }

    await PasswordResetToken.deleteMany({ user: user._id });
    await EmailVerification.deleteMany({ email: user.email });
    await User.deleteOne({ _id: user._id });

    clearAuthCookie(req, res);

    return res.status(200).json({ message: "Tu cuenta fue eliminada correctamente." });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error eliminando la cuenta" });
  }
}

module.exports = {
  startRegistrationVerification,
  verifyRegistrationCode,
  requestPasswordReset,
  resetPassword,
  login,
  logout,
  deleteAccount,
  me,
};
