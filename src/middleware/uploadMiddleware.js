const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 10,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter(req, file, callback) {
    if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
      callback(null, true);
      return;
    }

    callback(new Error("Only image and video uploads are allowed"));
  },
});

module.exports = {
  upload,
};