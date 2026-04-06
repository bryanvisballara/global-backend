const cors = require("cors");
const express = require("express");
const path = require("path");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const clientRoutes = require("./routes/clientRoutes");
const clientRequestRoutes = require("./routes/clientRequestRoutes");
const { isDatabaseReady } = require("./config/db");

const app = express();
const publicDirectory = path.join(__dirname, "..", "public");

const corsOrigin = process.env.CORS_ORIGIN || "*";
const corsOptions = {
  origin(origin, callback) {
    if (corsOrigin === "*") {
      return callback(null, true);
    }

    const allowedOrigins = corsOrigin.split(",").map((item) => item.trim());

    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },
};

app.use(cors(corsOptions));
app.use(express.json());
app.use("/app", express.static(publicDirectory));

app.get("/", (req, res) => {
  res.status(200).json({
    name: "global app api",
    status: isDatabaseReady() ? "ok" : "degraded",
    database: isDatabaseReady() ? "connected" : "disconnected",
  });
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

  if (error.message === "Only image and video uploads are allowed") {
    return res.status(400).json({ message: error.message });
  }

  return res.status(500).json({ message: "Internal server error" });
});

module.exports = app;
