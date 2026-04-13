const VirtualShowcaseVehicle = require("../models/VirtualShowcaseVehicle");
const { isCloudinaryConfigured, uploadBufferToCloudinary } = require("../config/cloudinary");

function normalizeImages(images = []) {
  return (Array.isArray(images) ? images : [])
    .filter((item) => item && item.url)
    .map((item) => ({
      url: String(item.url).trim(),
      caption: item.caption ? String(item.caption).trim() : undefined,
    }));
}

async function uploadVehicleFilesToCloudinary(files = []) {
  if (!files.length) {
    return [];
  }

  if (!isCloudinaryConfigured()) {
    throw new Error("Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.");
  }

  return Promise.all(
    files.map(async (file) => {
      const result = await uploadBufferToCloudinary(file);
      return {
        url: result.secure_url,
        caption: file.originalname ? String(file.originalname).replace(/\.[^.]+$/, "") : undefined,
      };
    })
  );
}

async function listVirtualDealershipVehicles(req, res) {
  try {
    const includeUnpublished = req.query.includeUnpublished === "true";
    const filter = includeUnpublished ? {} : { isPublished: true };

    const vehicles = await VirtualShowcaseVehicle.find(filter)
      .populate("listedBy", "name email role")
      .sort({ isPublished: -1, createdAt: -1 });

    return res.status(200).json({ vehicles });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching virtual dealership vehicles" });
  }
}

async function createVirtualDealershipVehicle(req, res) {
  try {
    const {
      brand,
      model,
      version,
      year,
      mileage,
      engine,
      horsepower,
      price,
      currency,
      exteriorColor,
      interiorColor,
      description,
      status,
      isPublished,
    } = req.body;

    if (!brand || !model || !version || price == null) {
      return res.status(400).json({ message: "brand, model, version and price are required" });
    }

    const uploadedImages = await uploadVehicleFilesToCloudinary(req.files || []);
    const finalImages = normalizeImages(uploadedImages);

    if (!finalImages.length) {
      return res.status(400).json({ message: "Debes subir al menos una imagen para publicar el vehículo" });
    }

    const vehicle = await VirtualShowcaseVehicle.create({
      brand: String(brand).trim(),
      model: String(model).trim(),
      version: String(version).trim(),
      year: year ? Number(year) : undefined,
      mileage: typeof mileage !== "undefined" && mileage !== "" ? Number(mileage) : undefined,
      engine: engine ? String(engine).trim() : undefined,
      horsepower: typeof horsepower !== "undefined" && horsepower !== "" ? Number(horsepower) : undefined,
      price: Number(price),
      currency: currency ? String(currency).trim().toUpperCase() : "COP",
      exteriorColor: exteriorColor ? String(exteriorColor).trim() : undefined,
      interiorColor: interiorColor ? String(interiorColor).trim() : undefined,
      description: description ? String(description).trim() : undefined,
      status: ["available", "reserved", "sold"].includes(status) ? status : "available",
      images: finalImages,
      listedBy: req.user._id,
      isPublished: isPublished !== "false",
      immediatePurchase: true,
      publishedAt: new Date(),
    });

    const populatedVehicle = await VirtualShowcaseVehicle.findById(vehicle._id).populate("listedBy", "name email role");

    return res.status(201).json({
      message: "Vehicle published in virtual dealership",
      vehicle: populatedVehicle,
    });
  } catch (error) {
    if (error.message === "Cloudinary is not configured. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.") {
      return res.status(503).json({ message: error.message });
    }

    return res.status(500).json({ message: error.message || "Error publishing virtual dealership vehicle" });
  }
}

async function updateVirtualDealershipVehicle(req, res) {
  try {
    const { vehicleId } = req.params;
    const { status, isPublished, price, description, exteriorColor, interiorColor, mileage, engine, horsepower } = req.body;

    const updatePayload = {};

    if (["available", "reserved", "sold"].includes(status)) {
      updatePayload.status = status;
    }

    if (typeof isPublished !== "undefined") {
      updatePayload.isPublished = String(isPublished) !== "false";
    }

    if (typeof price !== "undefined") {
      updatePayload.price = Number(price);
    }

    if (typeof description === "string") {
      updatePayload.description = description.trim();
    }

    if (typeof exteriorColor === "string") {
      updatePayload.exteriorColor = exteriorColor.trim();
    }

    if (typeof interiorColor === "string") {
      updatePayload.interiorColor = interiorColor.trim();
    }

    if (typeof mileage !== "undefined") {
      updatePayload.mileage = mileage === "" ? undefined : Number(mileage);
    }

    if (typeof engine === "string") {
      updatePayload.engine = engine.trim();
    }

    if (typeof horsepower !== "undefined") {
      updatePayload.horsepower = horsepower === "" ? undefined : Number(horsepower);
    }

    const vehicle = await VirtualShowcaseVehicle.findByIdAndUpdate(
      vehicleId,
      { $set: updatePayload },
      { new: true, runValidators: true }
    ).populate("listedBy", "name email role");

    if (!vehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    return res.status(200).json({
      message: "Virtual dealership vehicle updated",
      vehicle,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error updating virtual dealership vehicle" });
  }
}

async function deleteVirtualDealershipVehicle(req, res) {
  try {
    const { vehicleId } = req.params;
    const deletedVehicle = await VirtualShowcaseVehicle.findByIdAndDelete(vehicleId);

    if (!deletedVehicle) {
      return res.status(404).json({ message: "Vehicle not found" });
    }

    return res.status(200).json({ message: "Vehicle removed from virtual dealership" });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Error deleting virtual dealership vehicle" });
  }
}

module.exports = {
  createVirtualDealershipVehicle,
  deleteVirtualDealershipVehicle,
  listVirtualDealershipVehicles,
  updateVirtualDealershipVehicle,
};
