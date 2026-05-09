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
const uploadsDirectory = path.join(__dirname, "..", "uploads");
const adminPagePattern = /^\/(?:app\/)?admin(?:-[a-z0-9-]+)?\.html$/i;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://teal-flamingo-532353.hostingersite.com",
  "https://globalimports.app",
  "https://global-backend-bdbx.onrender.com",
];

app.set("trust proxy", 1);

const corsOrigin = process.env.CORS_ORIGIN || "*";

function normalizeOrigin(originValue) {
  const trimmedOrigin = String(originValue || "").trim();

  if (!trimmedOrigin) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmedOrigin)) {
    return trimmedOrigin.replace(/\/$/, "");
  }

  return `https://${trimmedOrigin}`.replace(/\/$/, "");
}

function resolveAllowedOrigins() {
  if (corsOrigin === "*") {
    return DEFAULT_ALLOWED_ORIGINS.map((originValue) => normalizeOrigin(originValue)).filter(Boolean);
  }

  const configuredOrigins = corsOrigin
    .split(",")
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

  const defaultOrigins = DEFAULT_ALLOWED_ORIGINS.map((originValue) => normalizeOrigin(originValue)).filter(Boolean);

  return Array.from(new Set([...configuredOrigins, ...defaultOrigins]));
}

function sanitizeDownloadFileName(fileName, fallback = "document.pdf") {
  const normalizedFallback = String(fallback || "document.pdf").trim() || "document.pdf";
  const normalizedName = String(fileName || "").trim();

  if (!normalizedName) {
    return normalizedFallback;
  }

  const sanitizedName = normalizedName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  if (!sanitizedName) {
    return normalizedFallback;
  }

  return /\.pdf$/i.test(sanitizedName) ? sanitizedName : `${sanitizedName}.pdf`;
}

const corsOptions = {
  origin(origin, callback) {
    if (corsOrigin === "*") {
      return callback(null, true);
    }

    const allowedOrigins = resolveAllowedOrigins();

    const normalizedRequestOrigin = normalizeOrigin(origin);

    if (!origin || allowedOrigins.includes(normalizedRequestOrigin)) {
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

  if (req.path.startsWith("/app/")) {
    return next();
  }

  const cookieHeader = req.headers.cookie || "";
  const authCookie = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("globalAppToken=") || item.startsWith("token="));

  if (!authCookie) {
    return res.redirect(req.path.startsWith("/app/") ? "/app/index.html" : "/index.html");
  }

  const token = authCookie.includes("=") ? authCookie.slice(authCookie.indexOf("=") + 1) : "";

  try {
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

    if (!["admin", "manager", "adminUSA", "gerenteUSA", "brokerUSA"].includes(decodedToken.role)) {
      return res.redirect(req.path.startsWith("/app/") ? "/app/index.html" : "/index.html");
    }

    return next();
  } catch (error) {
    return res.redirect(req.path.startsWith("/app/") ? "/app/index.html" : "/index.html");
  }
});

app.use(
  express.static(publicDirectory, {
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  })
);

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

app.use("/uploads", express.static(uploadsDirectory, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".pdf")) {
      const downloadName = sanitizeDownloadFileName(path.basename(filePath), "document.pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

app.get("/api/uploads/download/:fileName", (req, res) => {
  try {
    const fileName = String(req.params.fileName || "").trim();
    
    if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return res.status(400).json({ message: "Invalid file name" });
    }

    const filePath = path.join(uploadsDirectory, fileName);
    
    if (!filePath.startsWith(uploadsDirectory)) {
      return res.status(400).json({ message: "Invalid file path" });
    }

    return res.download(filePath, fileName, (error) => {
      if (error && error.code !== "ERR_HTTP_HEADERS_SENT") {
        console.error("File download error", error.message);
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Error downloading file" });
  }
});

app.get("/api/downloads/pdf", async (req, res) => {
  try {
    const fileUrl = String(req.query.url || "").trim();
    const requestedFileName = sanitizeDownloadFileName(req.query.fileName, "document.pdf");

    if (!fileUrl) {
      return res.status(400).json({ message: "Missing file URL" });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${requestedFileName}"; filename*=UTF-8''${encodeURIComponent(requestedFileName)}`);
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (fileUrl.startsWith("/uploads/")) {
      const localPath = path.join(uploadsDirectory, path.basename(fileUrl));

      if (!localPath.startsWith(uploadsDirectory)) {
        return res.status(400).json({ message: "Invalid local path" });
      }

      try {
        await fs.promises.access(localPath);
        return res.sendFile(localPath);
      } catch {
        return res.status(404).json({ message: "Local file not found" });
      }
    }

    if (fileUrl.includes("res.cloudinary.com") || fileUrl.startsWith("http")) {
      try {
        const response = await (async () => {
          const https = require("https");
          const http = require("http");
          const protocol = fileUrl.startsWith("https") ? https : http;

          return new Promise((resolve, reject) => {
            protocol.get(fileUrl, (response) => {
              if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}`));
              }

              resolve(response);
            }).on("error", reject);
          });
        })();

        return response.pipe(res);
      } catch (error) {
        console.error("Error proxying file from URL:", error.message);
        return res.status(502).json({ message: "Error downloading file from source" });
      }
    }

    return res.status(400).json({ message: "Invalid file URL" });
  } catch (error) {
    console.error("PDF download error:", error.message);
    return res.status(500).json({ message: "Error downloading PDF" });
  }
});

app.get("/", (req, res) => {
  res.redirect("/index.html");
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
