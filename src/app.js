const cors = require("cors");
const express = require("express");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const path = require("path");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const mechanicRoutes = require("./routes/mechanicRoutes");
const vigilanceRoutes = require("./routes/vigilanceRoutes");
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
const hostDirectory = path.join(__dirname, "..", "host");
const publicDirectory = path.join(__dirname, "..", "public");
const frontendStaticDirectories = [hostDirectory, publicDirectory];
const uploadsDirectory = path.join(__dirname, "..", "uploads");
const orderDocumentsDirectory = path.join(uploadsDirectory, "order-documents");
const adminPagePattern = /^\/(?:app\/)?admin(?:-[a-z0-9-]+)?\.html$/i;
const DEFAULT_ALLOWED_ORIGINS = [
  "https://teal-flamingo-532353.hostingersite.com",
  "https://globalimports.app",
  "https://www.globalimports.app",
  "https://globalimports.co",
  "https://www.globalimports.co",
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

function stripWwwHostname(hostname = "") {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
}

function expandOriginVariants(originValue) {
  const normalizedOrigin = normalizeOrigin(originValue);

  if (!normalizedOrigin) {
    return [];
  }

  try {
    const parsedOrigin = new URL(normalizedOrigin);
    const hostnameWithoutWww = stripWwwHostname(parsedOrigin.hostname);
    const variants = new Set([normalizedOrigin]);

    if (hostnameWithoutWww) {
      variants.add(`${parsedOrigin.protocol}//${hostnameWithoutWww}`);
      variants.add(`${parsedOrigin.protocol}//www.${hostnameWithoutWww}`);
    }

    return Array.from(variants);
  } catch {
    return [normalizedOrigin];
  }
}

function resolveAllowedOrigins() {
  const defaultOrigins = DEFAULT_ALLOWED_ORIGINS.flatMap((originValue) => expandOriginVariants(originValue));

  if (corsOrigin === "*") {
    return Array.from(new Set(defaultOrigins));
  }

  const configuredOrigins = corsOrigin
    .split(",")
    .flatMap((item) => expandOriginVariants(item));

  return Array.from(new Set([...configuredOrigins, ...defaultOrigins]));
}

function isAllowedCorsOrigin(originValue) {
  if (!originValue) {
    return true;
  }

  const normalizedRequestOrigin = normalizeOrigin(originValue);
  const allowedOrigins = resolveAllowedOrigins();

  if (allowedOrigins.includes(normalizedRequestOrigin)) {
    return true;
  }

  try {
    const requestUrl = new URL(normalizedRequestOrigin);
    const requestHost = stripWwwHostname(requestUrl.hostname);

    return allowedOrigins.some((allowedOrigin) => {
      try {
        const allowedUrl = new URL(allowedOrigin);
        return (
          allowedUrl.protocol === requestUrl.protocol &&
          stripWwwHostname(allowedUrl.hostname) === requestHost
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
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

function sanitizeAttachmentFileName(fileName, fallback = "documento") {
  const normalizedFallback = String(fallback || "documento").trim() || "documento";
  const normalizedName = String(fileName || "").trim();
  const resolvedName = normalizedName || normalizedFallback;
  const sanitizedName = resolvedName
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  return sanitizedName || normalizedFallback;
}

function ensurePdfFileName(fileName, fallback = "document.pdf") {
  const sanitizedName = sanitizeAttachmentFileName(fileName, fallback);
  return /\.pdf$/i.test(sanitizedName) ? sanitizedName : `${sanitizedName}.pdf`;
}

function isPdfDownloadRequest(fileUrl, fileName) {
  const normalizedFileName = String(fileName || "").trim();

  if (/\.pdf(?:$|[?#])/i.test(normalizedFileName)) {
    return true;
  }

  try {
    const parsedUrl = new URL(String(fileUrl || ""), "http://local");
    return /\.pdf$/i.test(decodeURIComponent(parsedUrl.pathname || ""));
  } catch {
    return /\.pdf(?:$|[?#])/i.test(String(fileUrl || ""));
  }
}

function resolveDownloadFileName(fileUrl, requestedFileName, fallback = "documento") {
  const normalizedRequestedFileName = String(requestedFileName || "").trim();

  if (normalizedRequestedFileName) {
    return isPdfDownloadRequest(fileUrl, normalizedRequestedFileName)
      ? ensurePdfFileName(normalizedRequestedFileName, fallback)
      : sanitizeAttachmentFileName(normalizedRequestedFileName, fallback);
  }

  try {
    const parsedUrl = new URL(String(fileUrl || ""), "http://local");
    const urlFileName = decodeURIComponent(path.basename(parsedUrl.pathname || ""));

    return isPdfDownloadRequest(fileUrl, urlFileName)
      ? ensurePdfFileName(urlFileName, fallback)
      : sanitizeAttachmentFileName(urlFileName, fallback);
  } catch {
    return isPdfDownloadRequest(fileUrl, "") ? ensurePdfFileName("", fallback) : sanitizeAttachmentFileName("", fallback);
  }
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getRecoverableRemoteUrl(mediaItem = {}) {
  const candidateUrls = [
    mediaItem.originalCloudinaryUrl,
    mediaItem.cloudinaryUrl,
    mediaItem.sourceUrl,
    mediaItem.backupUrl,
    mediaItem.url,
  ];

  return candidateUrls
    .map((value) => String(value || "").trim())
    .find((value) => value && /^https?:\/\//i.test(value) && !/\/api\/uploads\/download\//i.test(value) && !/\/uploads\//i.test(value)) || "";
}

function collectRecoverableMediaUrls(media = []) {
  return (Array.isArray(media) ? media : [])
    .map((item) => getRecoverableRemoteUrl(item))
    .filter(Boolean);
}

async function findRecoverableDownloadUrlForLocalUpload(fileName) {
  const normalizedFileName = String(fileName || "").trim();

  if (!normalizedFileName) {
    return "";
  }

  const fileNamePattern = new RegExp(escapeRegex(normalizedFileName), "i");
  const query = {
    $or: [
      { "media.url": fileNamePattern },
      { "media.name": fileNamePattern },
      { "media.originalCloudinaryUrl": fileNamePattern },
    ],
  };

  try {
    const [Order, OrderGlobalUS, OrderTrackingEvent] = [
      require("./models/Order"),
      require("./models/OrderGlobalUS"),
      require("./models/OrderTrackingEvent"),
    ];

    const collections = [Order, OrderGlobalUS, OrderTrackingEvent];

    for (const Model of collections) {
      const document = await Model.findOne(query).lean();
      const recoveredUrl = collectRecoverableMediaUrls(document?.media || [])[0] || "";

      if (recoveredUrl) {
        return recoveredUrl;
      }
    }
  } catch (error) {
    console.error("Error looking up recoverable download URL:", error.message);
  }

  return "";
}

async function resolveLocalUploadPath(fileName) {
  const normalizedFileName = String(fileName || "").trim();

  if (!normalizedFileName || normalizedFileName.includes("..") || normalizedFileName.includes("/") || normalizedFileName.includes("\\")) {
    return null;
  }

  const candidateDirectories = [uploadsDirectory, orderDocumentsDirectory];

  for (const candidateDirectory of candidateDirectories) {
    const candidatePath = path.resolve(candidateDirectory, normalizedFileName);
    const resolvedDirectory = path.resolve(candidateDirectory);

    if (candidatePath !== resolvedDirectory && candidatePath.startsWith(`${resolvedDirectory}${path.sep}`)) {
      try {
        await fs.promises.access(candidatePath, fs.constants.R_OK);
        return candidatePath;
      } catch {
        // Try the next supported uploads location.
      }
    }
  }

  return null;
}

function getRemoteFileStream(fileUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    let parsedUrl;

    try {
      parsedUrl = new URL(fileUrl);
    } catch (error) {
      reject(error);
      return;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      reject(new Error("Invalid file URL"));
      return;
    }

    const protocol = parsedUrl.protocol === "https:" ? require("https") : require("http");

    protocol.get(parsedUrl, (response) => {
      const statusCode = Number(response.statusCode || 0);

      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location && redirectCount < 5) {
        response.resume();
        const redirectUrl = new URL(response.headers.location, parsedUrl).toString();
        getRemoteFileStream(redirectUrl, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${statusCode}`));
        return;
      }

      resolve(response);
    }).on("error", reject);
  });
}

async function proxyDownloadFile(req, res, fallbackFileName = "documento", options = {}) {
  try {
    const fileUrl = String(req.query.url || "").trim();

    if (!fileUrl) {
      return res.status(400).json({ message: "Missing file URL" });
    }

    const isPdfDownload = isPdfDownloadRequest(fileUrl, req.query.fileName || fallbackFileName);
    const requestedFileName = resolveDownloadFileName(fileUrl, req.query.fileName, isPdfDownload ? "document.pdf" : fallbackFileName);
    const dispositionType = options.inline ? "inline" : "attachment";
    res.setHeader("Content-Disposition", `${dispositionType}; filename="${requestedFileName}"; filename*=UTF-8''${encodeURIComponent(requestedFileName)}`);
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (isPdfDownload) {
      res.setHeader("Content-Type", "application/pdf");
    }

    let localDownloadFileName = "";

    try {
      const parsedUrl = new URL(fileUrl, "http://local");

      if (parsedUrl.pathname.startsWith("/uploads/") || parsedUrl.pathname.startsWith("/api/uploads/download/")) {
        localDownloadFileName = decodeURIComponent(path.basename(parsedUrl.pathname));
      }
    } catch {
      localDownloadFileName = "";
    }

    if (localDownloadFileName) {
      const localPath = await resolveLocalUploadPath(path.basename(localDownloadFileName));

      if (!localPath) {
        const recoveredUrl = await findRecoverableDownloadUrlForLocalUpload(localDownloadFileName);

        if (recoveredUrl) {
          const response = await getRemoteFileStream(recoveredUrl);

          if (!isPdfDownload && response.headers["content-type"]) {
            res.setHeader("Content-Type", response.headers["content-type"]);
          }

          if (response.headers["content-length"]) {
            res.setHeader("Content-Length", response.headers["content-length"]);
          }

          return response.pipe(res);
        }

        return res.status(404).json({ message: "Local file not found" });
      }

      return res.sendFile(localPath);
    }

    if (fileUrl.includes("res.cloudinary.com") || fileUrl.startsWith("http")) {
      try {
        const response = await getRemoteFileStream(fileUrl);

        if (!isPdfDownload && response.headers["content-type"]) {
          res.setHeader("Content-Type", response.headers["content-type"]);
        }

        if (response.headers["content-length"]) {
          res.setHeader("Content-Length", response.headers["content-length"]);
        }

        return response.pipe(res);
      } catch (error) {
        console.error("Error proxying file from URL:", error.message);
        return res.status(502).json({ message: "Error downloading file from source" });
      }
    }

    return res.status(400).json({ message: "Invalid file URL" });
  } catch (error) {
    console.error("File download error:", error.message);
    return res.status(500).json({ message: "Error downloading file" });
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (corsOrigin === "*") {
      return callback(null, true);
    }

    if (isAllowedCorsOrigin(origin)) {
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

app.get("/client-dev-config.json", (req, res) => {
  if (String(process.env.NODE_ENV || "").trim() !== "development") {
    return res.status(404).json({ message: "Not found" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.json({
    previewFeedVideo: String(process.env.LOCAL_FEED_VIDEO_PREVIEW_URL || "").trim(),
    pushNotificationsDisabled: String(process.env.DISABLE_POST_PUSH_NOTIFICATIONS || "").trim().toLowerCase() === "true",
  });
});

function setFrontendStaticHeaders(res, filePath) {
  const normalizedFilePath = filePath.replace(/\\/g, "/");
  const fileName = path.basename(normalizedFilePath);

  if (
    filePath.endsWith(".html") ||
    fileName === "styles.css" ||
    fileName === "app-client.js" ||
    fileName === "admin-dashboard.js" ||
    fileName === "admin-common.js" ||
    fileName === "admin-mobile-fix.css"
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
}

frontendStaticDirectories.forEach((staticDirectory) => {
  app.use(
    express.static(staticDirectory, {
      setHeaders: setFrontendStaticHeaders,
    })
  );
});

frontendStaticDirectories.forEach((staticDirectory) => {
  app.use(
    "/app",
    express.static(staticDirectory, {
      setHeaders: setFrontendStaticHeaders,
    })
  );
});

app.use("/uploads", express.static(uploadsDirectory, {
  setHeaders(res, filePath) {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (filePath.endsWith(".pdf")) {
      const downloadName = sanitizeDownloadFileName(path.basename(filePath), "document.pdf");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
  },
}));

app.get("/api/uploads/download/:fileName", async (req, res) => {
  try {
    const fileName = String(req.params.fileName || "").trim();
    
    if (!fileName || fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return res.status(400).json({ message: "Invalid file name" });
    }

    const filePath = await resolveLocalUploadPath(fileName);

    if (!filePath) {
      return res.status(404).json({ message: "File not found" });
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

app.get("/api/downloads/file", (req, res) => proxyDownloadFile(req, res));
app.get("/api/downloads/pdf", (req, res) => proxyDownloadFile(req, res, "document.pdf"));
app.get("/api/downloads/view", (req, res) => proxyDownloadFile(req, res, "documento", { inline: true }));

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
app.use("/api/mechanic", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ message: "Database unavailable. Please try again in a moment." });
  }

  next();
});
app.use("/api/mechanic", mechanicRoutes);
app.use("/api/vigilance", (req, res, next) => {
  if (!isDatabaseReady()) {
    return res.status(503).json({ message: "Database unavailable. Please try again in a moment." });
  }
  next();
});
app.use("/api/vigilance", vigilanceRoutes);

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
