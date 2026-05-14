const jwt = require("jsonwebtoken");

function shouldUseTokenExpiry(value) {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return normalizedValue && !["never", "none", "false", "0"].includes(normalizedValue);
}

function generateToken(user) {
  const isClient = user.role === "client";
  const configuredExpiry = isClient ? process.env.CLIENT_JWT_EXPIRES_IN : process.env.JWT_EXPIRES_IN;
  const fallbackExpiry = isClient ? "" : "7d";
  const expiresIn = configuredExpiry || fallbackExpiry;
  const signOptions = shouldUseTokenExpiry(expiresIn) ? { expiresIn } : {};

  return jwt.sign(
    {
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
    },
    process.env.JWT_SECRET,
    signOptions
  );
}

module.exports = {
  generateToken,
};
