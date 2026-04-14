const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const path = require("path");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const clientRoutes = require("./routes/clientRoutes");
const clientRequestRoutes = require("./routes/clientRequestRoutes");
const publicRoutes = require("./routes/publicRoutes");
const { isDatabaseReady } = require("./config/db");

const app = express();

// Endpoint temporal para depuración: listar usuarios desde backend

app.get("/api/debug/list-users", async (req, res) => {
  const secret = req.query.secret;
  if (secret !== process.env.DEBUG_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const User = require("./models/User");
    const users = await User.find({});
    return res.json({ users: users.map(u => ({ email: u.email, name: u.name, role: u.role })) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
const publicDirectory = path.join(__dirname, "..", "public");
const adminPagePattern = /^\/app\/admin(?:-[a-z0-9-]+)?\.html$/i;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://teal-flamingo-532353.hostingersite.com",
  "https://global-backend-bdbx.onrender.com",
];

app.set("trust proxy", 1);

const corsOrigin = process.env.CORS_ORIGIN || "*";

function resolveAllowedOrigins() {
  if (corsOrigin === "*") {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  const configuredOrigins = corsOrigin
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return Array.from(new Set([...configuredOrigins, ...DEFAULT_ALLOWED_ORIGINS]));
}

const corsOptions = {
  origin(origin, callback) {
    if (corsOrigin === "*") {
      return callback(null, true);
    }

    const allowedOrigins = resolveAllowedOrigins();

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json());

app.use((req, res, next) => {
  if (!adminPagePattern.test(req.path)) {
    return next();
  }

  const cookieHeader = req.headers.cookie || "";
  const authCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("globalAppToken="));

  if (!authCookie) {
    return res.redirect("/app/index.html");
  }

  const token = authCookie.slice("globalAppToken=".length);

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    if (!["admin", "manager", "adminUSA", "gerenteUSA"].includes(decodedToken.role)) {
      return res.redirect("/app/index.html");
    }

    return next();
  } catch (error) {
    return res.redirect("/app/index.html");
  }
});

app.use(
  "/app",
  express.static(publicDirectory, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

app.get("/", (req, res) => {
  res.redirect("/app/index.html");
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: isDatabaseReady() ? "ok" : "degraded",
    database: isDatabaseReady() ? "connected" : "disconnected",
  });
});

app.use("/api/auth", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({
      message: "Database unavailable. Please try again in a moment.",
    });
  }

  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/client-requests", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ message: "Database unavailable. Please try again in a moment." });
  }

  next();
});
app.use("/api/client-requests", clientRequestRoutes);
app.use("/api/client", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ message: "Database unavailable. Please try again in a moment." });
  }

  next();
});
app.use("/api/client", clientRoutes);
app.use("/api/public", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ message: "Database unavailable. Please try again in a moment." });
  }

  next();
});
app.use("/api/public", publicRoutes);
app.use("/api/admin", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ message: "Database unavailable. Please try again in a moment." });
  }

  next();
});
app.use("/api/admin", adminRoutes);

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

app.use((error, req, res, next) => {
  if (error.message === "Not allowed by CORS") {
    return res.status(403).json({ message: error.message });
  }

  if (error.name === "MulterError") {
    return res.status(400).json({ message: error.message });
  }

  if (error.message === "Only images, videos and documents are allowed") {
    return res.status(400).json({ message: error.message });
  }

  return res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
