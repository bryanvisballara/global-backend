const { runScheduledGlobalDraftJob, getBogotaParts } = require("../services/postsAuto.service");

const POLL_INTERVAL_MS = Number(process.env.POSTS_AUTO_POLL_MS || 60_000);
const ENABLED = String(process.env.POSTS_AUTO_ENABLED || "true").trim().toLowerCase() !== "false";

let intervalRef = null;
let inProgress = false;

async function runPostsAutoCycle() {
  if (!ENABLED || inProgress) {
    return;
  }

  inProgress = true;

  try {
    const result = await runScheduledGlobalDraftJob(new Date());

    if (result?.ran) {
      console.info(`[POSTS_AUTO] draft generated slot=${result.slotKey} id=${result.draft?._id || "n/a"}`);
    }
  } catch (error) {
    const bogota = getBogotaParts(new Date());
    console.warn(
      `[POSTS_AUTO] ${bogota.dateKey} ${bogota.hour}:${String(bogota.minute).padStart(2, "0")} failed: ${error.message || error}`
    );
  } finally {
    inProgress = false;
  }
}

function startPostsAutoWorker() {
  if (!ENABLED) {
    console.info("[POSTS_AUTO] worker disabled (POSTS_AUTO_ENABLED=false)");
    return;
  }

  if (intervalRef) {
    return;
  }

  console.info("[POSTS_AUTO] worker started (16:00 America/Bogota, 1 draft/day)");
  runPostsAutoCycle();
  intervalRef = setInterval(runPostsAutoCycle, POLL_INTERVAL_MS);

  if (typeof intervalRef.unref === "function") {
    intervalRef.unref();
  }
}

module.exports = {
  startPostsAutoWorker,
  runPostsAutoCycle,
};
