const fs = require("fs");
const { v2: cloudinary } = require("cloudinary");
const { Readable } = require("stream");

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
  );
}

function configureCloudinary() {
  if (!isCloudinaryConfigured()) {
    return false;
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  return true;
}

function resolveCloudinaryResourceType(file) {
  if (file?.mimetype?.startsWith("video/")) {
    return "video";
  }

  if (file?.mimetype?.startsWith("image/")) {
    return "image";
  }

  return "raw";
}

async function uploadBufferToCloudinary(file, folder = process.env.CLOUDINARY_FOLDER || "global-app/posts") {
  if (!configureCloudinary()) {
    throw new Error("Cloudinary is not configured");
  }

  if (!file?.buffer && !file?.path) {
    throw new Error("Uploaded file is missing both buffer and path");
  }

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resolveCloudinaryResourceType(file),
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );

    const sourceStream = file.buffer
      ? Readable.from(file.buffer)
      : fs.createReadStream(file.path);

    sourceStream.on("error", reject);
    sourceStream.pipe(uploadStream);
  });
}

module.exports = {
  isCloudinaryConfigured,
  uploadBufferToCloudinary,
};