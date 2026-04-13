const jwt = require("jsonwebtoken");
const User = require("../models/User");

function getCookieToken(req) {
  const cookieHeader = req.headers.cookie || "";
  const authCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("globalAppToken="));

  if (!authCookie) {
    return "";
  }

  return authCookie.slice("globalAppToken=".length);
}

function resolveRequestToken(req) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const bearerToken = authHeader.split(" ")[1];

    if (bearerToken && bearerToken !== "null" && bearerToken !== "undefined") {
      return bearerToken;
    }
  }

  return getCookieToken(req);
}

async function requireAuth(req, res, next) {
  try {
    const token = resolveRequestToken(req);

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decodedToken.sub).select("-password");

    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
