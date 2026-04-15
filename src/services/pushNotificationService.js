const http2 = require("http2");
const https = require("https");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Post = require("../models/Post");

const PUSH_SOUND_FILENAME = "0414.WAV";
const ADMIN_NOTIFICATION_ROLES = ["manager", "admin", "gerenteUSA", "adminUSA"];

async function resolveTrackingRecipientUsers(order) {
  const emails = new Set();
  const userIds = new Set();

  const clientEmail = String(order?.client?.email || "").toLowerCase().trim();
  if (clientEmail) {
    emails.add(clientEmail);
  }

  for (const subscriber of order?.trackingSubscribers || []) {
    const subscriberEmail = String(subscriber?.email || "").toLowerCase().trim();
    const subscriberUserId = String(subscriber?.user || "").trim();

    if (subscriberEmail) {
      emails.add(subscriberEmail);
    }

    if (subscriberUserId) {
      userIds.add(subscriberUserId);
    }
  }

  if (!emails.size && !userIds.size) {
    return [];
  }

  const query = {
    role: "client",
    isActive: true,
    $or: [],
  };

  if (emails.size) {
    query.$or.push({ email: { $in: Array.from(emails) } });
  }

  if (userIds.size) {
    query.$or.push({ _id: { $in: Array.from(userIds) } });
  }

  return User.find(query).select("name email isActive pushDevices notificationBadgeCount");
}

function getNotificationPayload(post) {
  return {
    title: "Nueva publicación en Global Imports",
    body: post.title,
    sound: PUSH_SOUND_FILENAME,
    data: {
      postId: String(post._id),
      type: "post",
    },
  };
}

function getTrackingNotificationPayload({ order, step }) {
  const trackingNumber = String(order?.trackingNumber || "");
  const stepLabel = String(step?.label || "Estado actualizado");
  const stepNotes = String(step?.notes || "Tu tracking tiene una actualización.").trim();

  return {
    title: `Tracking ${trackingNumber}`,
    body: `${stepLabel}: ${stepNotes}`,
    sound: PUSH_SOUND_FILENAME,
    data: {
      type: "tracking",
      orderId: String(order?._id || ""),
      trackingNumber,
      stepKey: String(step?.key || ""),
    },
  };
}

function getAdminTrackingNotificationPayload({ order, step }) {
  const trackingNumber = String(order?.trackingNumber || "");
  const stepLabel = String(step?.label || "Estado actualizado");
  const internalIdentifier = String(order?.vehicle?.internalIdentifier || order?.vehicle?.description || "Sin identificador");
  const vin = String(order?.vehicle?.vin || "Sin VIN");

  return {
    title: `Tracking ${trackingNumber}`,
    body: `${stepLabel} · INT: ${internalIdentifier} · VIN: ${vin}`,
    sound: PUSH_SOUND_FILENAME,
    data: {
      type: "tracking-admin",
      orderId: String(order?._id || ""),
      trackingNumber,
      internalIdentifier,
      vin,
      stepKey: String(step?.key || ""),
    },
  };
}

async function sendNotificationToDevices(devices = [], notification) {
  const invalidTokens = [];
  let sent = 0;
  let skipped = 0;

  for (const device of devices || []) {
    try {
      if (device.provider === "apns" && device.platform === "ios") {
        if (!isApnsConfigured()) {
          skipped += 1;
          continue;
        }

        const result = await sendApnsNotification(device.token, notification);

        if (result.ok) {
          sent += 1;
        } else if (["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(result.reason)) {
          invalidTokens.push(device.token);
        }

        continue;
      }

      if (device.provider === "fcm") {
        if (!isFcmConfigured()) {
          skipped += 1;
          continue;
        }

        const result = await sendFcmNotification(device.token, notification);

        if (result.ok) {
          sent += 1;
        } else if (["NotRegistered", "InvalidRegistration"].includes(result.reason)) {
          invalidTokens.push(device.token);
        }

        continue;
      }

      skipped += 1;
    } catch {
      skipped += 1;
    }
  }

  if (invalidTokens.length) {
    await removeInvalidDeviceTokens(invalidTokens);
  }

  return { sent, skipped };
}

function isApnsConfigured() {
  return Boolean(
    process.env.APNS_TEAM_ID &&
      process.env.APNS_KEY_ID &&
      process.env.APNS_PRIVATE_KEY &&
      process.env.APNS_BUNDLE_ID
  );
}

function buildApnsJwt() {
  const privateKey = String(process.env.APNS_PRIVATE_KEY || "").replace(/\\n/g, "\n");

  return jwt.sign({}, privateKey, {
    algorithm: "ES256",
    issuer: process.env.APNS_TEAM_ID,
    header: {
      alg: "ES256",
      kid: process.env.APNS_KEY_ID,
    },
  });
}

function sendApnsNotification(deviceToken, notification) {
  return new Promise((resolve, reject) => {
    const host = process.env.APNS_USE_PRODUCTION === "true"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
    const client = http2.connect(host);

    client.on("error", reject);

    const request = client.request({
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${buildApnsJwt()}`,
      "apns-topic": process.env.APNS_BUNDLE_ID,
      "content-type": "application/json",
    });

    let responseBody = "";
    let statusCode = 0;

    request.on("response", (headers) => {
      statusCode = Number(headers[":status"] || 0);
    });

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("end", () => {
      client.close();

      if (statusCode >= 200 && statusCode < 300) {
        resolve({ ok: true });
        return;
      }

      let reason = "APNs request failed";

      try {
        const parsedBody = JSON.parse(responseBody || "{}");
        reason = parsedBody.reason || reason;
      } catch {
        // Keep default reason.
      }

      resolve({ ok: false, reason });
    });
    request.on("error", (error) => {
      client.close();
      reject(error);
    });

    const apsPayload = {
      alert: {
        title: notification.title,
        body: notification.body,
      },
      sound: String(notification?.sound || PUSH_SOUND_FILENAME),
    };

    if (Number.isFinite(Number(notification?.badge))) {
      apsPayload.badge = Math.max(0, Number(notification.badge));
    }

    request.end(
      JSON.stringify({
        aps: apsPayload,
        data: notification.data,
      })
    );
  });
}

function isFcmConfigured() {
  return Boolean(process.env.FCM_SERVER_KEY);
}

function sendFcmNotification(deviceToken, notification) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://fcm.googleapis.com/fcm/send",
      {
        method: "POST",
        headers: {
          Authorization: `key=${process.env.FCM_SERVER_KEY}`,
          "Content-Type": "application/json",
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              const parsed = JSON.parse(body || "{}");
              const firstResult = parsed.results?.[0] || {};

              if (firstResult.error) {
                resolve({ ok: false, reason: firstResult.error });
                return;
              }
            } catch {
              // Ignore parse issues on successful status codes.
            }

            resolve({ ok: true });
            return;
          }

          reject(new Error(`FCM request failed with status ${response.statusCode}`));
        });
      }
    );

    request.on("error", reject);
    request.end(
      JSON.stringify({
        to: deviceToken,
        notification: {
          title: notification.title,
          body: notification.body,
          sound: String(notification?.sound || PUSH_SOUND_FILENAME),
        },
        data: notification.data,
        priority: "high",
      })
    );
  });
}

async function removeInvalidDeviceTokens(tokens = []) {
  if (!tokens.length) {
    return;
  }

  await User.updateMany(
    { "pushDevices.token": { $in: tokens } },
    {
      $pull: {
        pushDevices: {
          token: { $in: tokens },
        },
      },
    }
  );
}

async function sendPublishedPostNotifications(post) {
  if (!post || post.pushNotificationSentAt) {
    return { sent: 0, skipped: 0 };
  }

  const users = await User.find({ role: "client", isActive: true, "pushDevices.0": { $exists: true } })
    .select("pushDevices notificationBadgeCount");

  if (!users.length) {
    await Post.findByIdAndUpdate(post._id, { $set: { pushNotificationSentAt: new Date() } });
    return { sent: 0, skipped: 0 };
  }

  const baseNotification = getNotificationPayload(post);
  const invalidTokens = [];
  let sent = 0;
  let skipped = 0;

  for (const user of users) {
    const nextBadgeCount = Math.max(0, Number(user.notificationBadgeCount || 0) + 1);
    const notification = {
      ...baseNotification,
      badge: nextBadgeCount,
    };

    user.notificationBadgeCount = nextBadgeCount;
    await user.save();

    for (const device of user.pushDevices || []) {
      try {
        if (device.provider === "apns" && device.platform === "ios") {
          if (!isApnsConfigured()) {
            skipped += 1;
            continue;
          }

          const result = await sendApnsNotification(device.token, notification);

          if (result.ok) {
            sent += 1;
          } else if (["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(result.reason)) {
            invalidTokens.push(device.token);
          }

          continue;
        }

        if (device.provider === "fcm") {
          if (!isFcmConfigured()) {
            skipped += 1;
            continue;
          }

          const result = await sendFcmNotification(device.token, notification);

          if (result.ok) {
            sent += 1;
          } else if (["NotRegistered", "InvalidRegistration"].includes(result.reason)) {
            invalidTokens.push(device.token);
          }

          continue;
        }

        skipped += 1;
      } catch (error) {
        skipped += 1;
      }
    }
  }

  if (invalidTokens.length) {
    await removeInvalidDeviceTokens(invalidTokens);
  }

  await Post.findByIdAndUpdate(post._id, { $set: { pushNotificationSentAt: new Date() } });

  return { sent, skipped };
}

async function sendTrackingUpdateNotifications(order, step) {
  const users = await resolveTrackingRecipientUsers(order);

  if (!users.length) {
    return { sent: 0, skipped: 0 };
  }

  let aggregateSent = 0;
  let aggregateSkipped = 0;

  for (const user of users) {
    if (!Array.isArray(user.pushDevices) || !user.pushDevices.length) {
      aggregateSkipped += 1;
      continue;
    }

    const nextBadgeCount = Math.max(0, Number(user.notificationBadgeCount || 0) + 1);
    const notification = {
      ...getTrackingNotificationPayload({ order, step }),
      badge: nextBadgeCount,
    };

    user.notificationBadgeCount = nextBadgeCount;
    await user.save();

    const result = await sendNotificationToDevices(user.pushDevices, notification);
    aggregateSent += Number(result.sent || 0);
    aggregateSkipped += Number(result.skipped || 0);
  }

  return { sent: aggregateSent, skipped: aggregateSkipped };
}

async function sendTrackingUpdateAdminNotifications(order, step) {
  const admins = await User.find({
    role: { $in: ADMIN_NOTIFICATION_ROLES },
    isActive: true,
    "pushDevices.0": { $exists: true },
  }).select("pushDevices");

  if (!admins.length) {
    return { sent: 0, skipped: 0 };
  }

  const notification = getAdminTrackingNotificationPayload({ order, step });
  const devices = admins.flatMap((admin) => admin.pushDevices || []);

  if (!devices.length) {
    return { sent: 0, skipped: 0 };
  }

  return sendNotificationToDevices(devices, notification);
}

module.exports = {
  ADMIN_NOTIFICATION_ROLES,
  PUSH_SOUND_FILENAME,
  sendTrackingUpdateAdminNotifications,
  sendTrackingUpdateNotifications,
  sendPublishedPostNotifications,
};
