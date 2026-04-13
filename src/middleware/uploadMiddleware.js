const multer = require("multer");

const allowedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/rtf",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/") ||
      allowedMimeTypes.includes(file.mimetype)
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