require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { connectToDatabase } = require("../config/db");
const Order = require("../models/Order");
const OrderGlobalUS = require("../models/OrderGlobalUS");
const OrderTrackingEvent = require("../models/OrderTrackingEvent");

const PDF_UPLOAD_DIRECTORY = path.join(__dirname, "..", "..", "uploads", "order-documents");
const BATCH_SIZE = 5;
const MAX_CONCURRENT_DOWNLOADS = 3;

function normalizeFileNameForStorage(value) {
  return String(value || "archivo")
    .trim()
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "archivo";
}

function isCloudinaryUrl(url) {
  return String(url || "").includes("res.cloudinary.com");
}

function isPdfUrl(url) {
  const urlLower = String(url || "").toLowerCase();
  return urlLower.includes("/upload/") && urlLower.includes("pdf") || urlLower.endsWith(".pdf");
}

async function downloadPdfFromCloudinary(url) {
  try {
    const response = await fetch(url, { timeout: 30000 });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("pdf") && !contentType.includes("octet-stream")) {
      throw new Error(`Invalid content-type: ${contentType}`);
    }

    return await response.arrayBuffer();
  } catch (error) {
    console.error(`Failed to download PDF from ${url}:`, error.message);
    return null;
  }
}

async function saveLocalPdfFile(buffer, originalFileName) {
  if (!buffer) {
    throw new Error("Empty PDF buffer");
  }

  await fs.promises.mkdir(PDF_UPLOAD_DIRECTORY, { recursive: true });

  const safeBaseName = normalizeFileNameForStorage(originalFileName || "documento");
  const fileName = `migrated-${Date.now()}-${randomUUID()}-${safeBaseName}.pdf`;
  const destinationPath = path.join(PDF_UPLOAD_DIRECTORY, fileName);

  const bufferToWrite = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await fs.promises.writeFile(destinationPath, bufferToWrite);

  return fileName;
}

function buildLocalPdfUrl(fileName) {
  return `/api/uploads/download/${encodeURIComponent(fileName)}`;
}

async function migratePdfInMediaArray(media = [], baseUrl = "") {
  if (!Array.isArray(media)) {
    return { updated: false, media };
  }

  let hasChanges = false;
  const updatedMedia = await Promise.all(
    media.map(async (item) => {
      if (!item || !item.url) {
        return item;
      }

      const url = String(item.url || "").trim();

      if (!isCloudinaryUrl(url) || !isPdfUrl(url)) {
        return item;
      }

      try {
        console.log(`  Migrating: ${url.substring(0, 80)}...`);
        const buffer = await downloadPdfFromCloudinary(url);

        if (!buffer) {
          console.warn(`  ⚠️  Skipped (download failed): ${url.substring(0, 80)}`);
          return item;
        }

        const fileName = await saveLocalPdfFile(buffer, item.name || item.caption || "documento");
        const newUrl = buildLocalPdfUrl(fileName);

        console.log(`  ✓ Migrated to: ${newUrl.substring(0, 60)}...`);
        hasChanges = true;

        return {
          ...item,
          url: newUrl,
          migratedAt: new Date(),
          originalCloudinaryUrl: url,
        };
      } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return item;
      }
    })
  );

  return { updated: hasChanges, media: updatedMedia };
}

async function migrateOrderDocuments(order, orderModel) {
  if (!order || !order.media) {
    return { modified: false, order };
  }

  const result = await migratePdfInMediaArray(order.media);

  if (result.updated) {
    order.media = result.media;
    return { modified: true, order };
  }

  return { modified: false, order };
}

async function migrateTrackingEvents(orderId, orderRegion) {
  try {
    const collectionName = `order-tracking-events-${orderRegion}`;
    const events = await OrderTrackingEvent.collection.find({
      orderId: orderId,
      "media.url": { $regex: "res.cloudinary.com" },
    }).toArray();

    if (!events.length) {
      return 0;
    }

    let migratedCount = 0;

    for (const event of events) {
      if (!Array.isArray(event.media)) {
        continue;
      }

      const result = await migratePdfInMediaArray(event.media);

      if (result.updated) {
        await OrderTrackingEvent.updateOne({ _id: event._id }, { $set: { media: result.media } });
        migratedCount += 1;
      }
    }

    return migratedCount;
  } catch (error) {
    console.error(`Error migrating tracking events for order ${orderId}:`, error.message);
    return 0;
  }
}

async function migrateAllPdfs() {
  try {
    await connectToDatabase();

    console.log("\n🔄 Starting PDF migration from Cloudinary to local storage...\n");

    const latamOrders = await Order.find({
      "media.url": { $regex: "res.cloudinary.com" },
    });

    const usaOrders = await OrderGlobalUS.find({
      "media.url": { $regex: "res.cloudinary.com" },
    });

    const allOrders = [
      ...latamOrders.map((o) => ({ order: o, model: Order, region: "latam" })),
      ...usaOrders.map((o) => ({ order: o, model: OrderGlobalUS, region: "usa" })),
    ];

    console.log(`📦 Found ${allOrders.length} orders with potential Cloudinary PDFs\n`);

    let totalOrdersModified = 0;
    let totalEventsModified = 0;

    for (let i = 0; i < allOrders.length; i += BATCH_SIZE) {
      const batch = allOrders.slice(i, i + BATCH_SIZE);

      for (const { order, model, region } of batch) {
        console.log(`\n[${i + 1}/${allOrders.length}] Processing order: ${order.trackingNumber || order._id}`);

        const orderResult = await migrateOrderDocuments(order, model);

        if (orderResult.modified) {
          await model.updateOne({ _id: order._id }, { $set: { media: orderResult.order.media } });
          totalOrdersModified += 1;
          console.log(`  ✓ Order documents migrated`);
        }

        const eventsMigrated = await migrateTrackingEvents(order._id, region);

        if (eventsMigrated > 0) {
          totalEventsModified += eventsMigrated;
          console.log(`  ✓ ${eventsMigrated} tracking event(s) migrated`);
        }
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`   Orders modified: ${totalOrdersModified}`);
    console.log(`   Tracking events modified: ${totalEventsModified}`);
    console.log(`   PDFs now served locally from /api/uploads/download/\n`);

    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

migrateAllPdfs();
