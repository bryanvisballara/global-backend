const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const User = require("../models/User");
const EmailVerification = require("../models/EmailVerification");
const { sendRegistrationVerificationEmail } = require("../services/brevoEmailService");
const { generateToken } = require("../utils/token");

const VERIFICATION_TTL_MINUTES = 10;
const VERIFICATION_RESEND_COOLDOWN_MS = 45 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 8;

function hashVerificationCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function generateVerificationCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, "0");
}

function buildVerificationExpiryDate() {
  return new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60 * 1000);
}

function getAuthCookieOptions(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const isSecure = req.secure || forwardedProto === "https";

  return {
    httpOnly: true,
    sameSite: "lax",
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

async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = generateToken(user);

    setAuthCookie(req, res, token);

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

module.exports = {
  startRegistrationVerification,
  verifyRegistrationCode,
  login,
  logout,
  me,
};
