const multer = require("multer");

const allowedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "multipart/x-zip",
  "text/plain",
  "application/rtf",
];

const allowedFileExtensions = new Set([
  ".pdf",
  ".zip",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".bmp",
  ".heic",
  ".heif",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".rtf",
  ".txt",
]);

function getFileExtension(fileName = "") {
  const match = String(fileName || "").trim().toLowerCase().match(/\.[^.]+$/);
  return match ? match[0] : "";
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    const extension = getFileExtension(file.originalname);

    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      allowedMimeTypes.includes(file.mimetype) ||
      allowedFileExtensions.has(extension)
    ) {
      callback(null, true);
      return;
    }

    callback(new Error("Only images, videos and documents are allowed"));
  },
});

module.exports = {
  upload,
};