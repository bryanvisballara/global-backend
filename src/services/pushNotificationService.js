const http2 = require("http2");
const https = require("https");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Post = require("../models/Post");

const PUSH_SOUND_FILENAME = "0414.WAV";
const ADMIN_NOTIFICATION_ROLES = ["manager", "admin", "gerenteUSA", "adminUSA"];
const FIREBASE_MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

let firebaseAccessTokenCache = {
  token: "",
  expiresAt: 0,
};

const loggedPushWarnings = new Set();

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

function getTrackingNotificationPayload({ order, previousStep, step }) {
  const trackingNumber = String(order?.trackingNumber || "");
  const previousStepLabel = String(previousStep?.label || "").trim();
  const nextStepLabel = String(step?.label || "Estado actualizado").trim();
  const body = previousStepLabel && previousStepLabel !== nextStepLabel
    ? `Tracking ${trackingNumber} - Tu vehículo pasó de ${previousStepLabel} a ${nextStepLabel}. Revisa más detalles aquí.`
    : `Tracking ${trackingNumber} - Tu vehículo tiene una actualización al estado ${nextStepLabel}. Revisa más detalles aquí.`;

  return {
    title: "Order Update",
    body,
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
          logPushWarningOnce(
            "apns-missing-config",
            "[push] Skipping APNs notification because APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY or APNS_BUNDLE_ID is missing."
          );
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
          logPushWarningOnce(
            "fcm-missing-config",
            "[push] Skipping FCM notification because Firebase credentials are not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Render."
          );
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
      console.error(
        `[push] Failed sending ${String(device?.provider || "unknown")}/${String(device?.platform || "unknown")} notification`,
        error?.message || error
      );
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

function logPushWarningOnce(key, message) {
  if (loggedPushWarnings.has(key)) {
    return;
  }

  loggedPushWarnings.add(key);
  console.warn(message);
}

function getFirebaseConfig() {
  return {
    projectId: String(process.env.FIREBASE_PROJECT_ID || process.env.FCM_PROJECT_ID || "").trim(),
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || "").trim(),
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim(),
    legacyServerKey: String(process.env.FCM_SERVER_KEY || "").trim(),
  };
}

function isFcmV1Configured() {
  const { projectId, clientEmail, privateKey } = getFirebaseConfig();
  return Boolean(projectId && clientEmail && privateKey);
}

function isFcmLegacyConfigured() {
  return Boolean(getFirebaseConfig().legacyServerKey);
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
  return isFcmV1Configured() || isFcmLegacyConfigured();
}

function normalizeFirebaseDataPayload(data) {
  const normalizedPayload = {};

  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) {
      continue;
    }

    normalizedPayload[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  return normalizedPayload;
}

function getFirebaseAccessToken() {
  if (firebaseAccessTokenCache.token && firebaseAccessTokenCache.expiresAt > Date.now() + 60 * 1000) {
    return Promise.resolve(firebaseAccessTokenCache.token);
  }

  const { clientEmail, privateKey } = getFirebaseConfig();
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    {
      iss: clientEmail,
      sub: clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      scope: FIREBASE_MESSAGING_SCOPE,
      iat: nowInSeconds,
      exp: nowInSeconds + 3600,
    },
    privateKey,
    { algorithm: "RS256" }
  );

  const requestBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();

  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(requestBody),
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Firebase OAuth request failed with status ${response.statusCode}`));
            return;
          }

          try {
            const parsedBody = JSON.parse(body || "{}");
            const accessToken = String(parsedBody.access_token || "").trim();
            const expiresInMs = Math.max(0, Number(parsedBody.expires_in || 3600) * 1000);

            if (!accessToken) {
              reject(new Error("Firebase OAuth response did not include an access token"));
              return;
            }

            firebaseAccessTokenCache = {
              token: accessToken,
              expiresAt: Date.now() + expiresInMs,
            };
            resolve(accessToken);
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on("error", reject);
    request.end(requestBody);
  });
}

function sendFcmLegacyNotification(deviceToken, notification) {
  const { legacyServerKey } = getFirebaseConfig();

  return new Promise((resolve, reject) => {
    const request = https.request(
      "https://fcm.googleapis.com/fcm/send",
      {
        method: "POST",
        headers: {
          Authorization: `key=${legacyServerKey}`,
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

          reject(new Error(`FCM legacy request failed with status ${response.statusCode}`));
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

async function sendFcmV1Notification(deviceToken, notification) {
  const accessToken = await getFirebaseAccessToken();
  const { projectId } = getFirebaseConfig();

  return new Promise((resolve, reject) => {
    const request = https.request(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
            resolve({ ok: true });
            return;
          }

          try {
            const parsedBody = JSON.parse(body || "{}");
            const errorCode = String(parsedBody?.error?.status || "").trim();
            const errorMessage = String(parsedBody?.error?.message || "").trim();
            const reason = errorCode || errorMessage || `FCM v1 request failed with status ${response.statusCode}`;
            resolve({ ok: false, reason });
          } catch {
            reject(new Error(`FCM v1 request failed with status ${response.statusCode}`));
          }
        });
      }
    );

    request.on("error", reject);
    request.end(
      JSON.stringify({
        message: {
          token: deviceToken,
          notification: {
            title: notification.title,
            body: notification.body,
          },
          data: normalizeFirebaseDataPayload(notification.data),
          apns: {
            headers: {
              "apns-priority": "10",
            },
            payload: {
              aps: {
                sound: String(notification?.sound || PUSH_SOUND_FILENAME),
                ...(Number.isFinite(Number(notification?.badge))
                  ? { badge: Math.max(0, Number(notification.badge)) }
                  : {}),
              },
            },
          },
          android: {
            priority: "high",
            notification: {
              sound: String(notification?.sound || PUSH_SOUND_FILENAME),
            },
          },
        },
      })
    );
  });
}

function sendFcmNotification(deviceToken, notification) {
  if (isFcmV1Configured()) {
    return sendFcmV1Notification(deviceToken, notification);
  }

  return sendFcmLegacyNotification(deviceToken, notification);
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
            logPushWarningOnce(
              "apns-missing-config",
              "[push] Skipping APNs notification because APNS_TEAM_ID, APNS_KEY_ID, APNS_PRIVATE_KEY or APNS_BUNDLE_ID is missing."
            );
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
            logPushWarningOnce(
              "fcm-missing-config",
              "[push] Skipping FCM notification because Firebase credentials are not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in Render."
            );
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
        console.error(
          `[push] Failed sending ${String(device?.provider || "unknown")}/${String(device?.platform || "unknown")} notification`,
          error?.message || error
        );
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

async function sendTrackingUpdateNotifications(order, step, previousStep = null) {
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
      ...getTrackingNotificationPayload({ order, previousStep, step }),
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
