const fs = require("fs");

function resolveLocalChromeExecutablePath() {
  const fromEnv = String(
    process.env.PUPPETEER_EXECUTABLE_PATH
    || process.env.CHROME_PATH
    || process.env.GOOGLE_CHROME_BIN
    || ""
  ).trim();

  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function loadSparticuzChromium() {
  try {
    const chromiumModule = require("@sparticuz/chromium");
    return chromiumModule?.default || chromiumModule;
  } catch (_error) {
    return null;
  }
}

async function resolveChromeLaunchOptions() {
  const localExecutablePath = resolveLocalChromeExecutablePath();

  if (localExecutablePath) {
    return {
      headless: true,
      executablePath: localExecutablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--font-render-hinting=none",
        "--hide-scrollbars",
      ],
    };
  }

  const chromium = loadSparticuzChromium();

  if (!chromium || typeof chromium.executablePath !== "function") {
    const error = new Error(
      "No se encontró Chrome/Chromium para generar el PDF. Instala @sparticuz/chromium o configura PUPPETEER_EXECUTABLE_PATH."
    );
    error.status = 500;
    throw error;
  }

  const executablePath = await chromium.executablePath();
  const chromiumArgs = typeof chromium.args === "function"
    ? await chromium.args()
    : (Array.isArray(chromium.args) ? chromium.args : []);

  return {
    headless: chromium.headless ?? "shell",
    executablePath,
    args: [
      ...chromiumArgs,
      "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--hide-scrollbars",
    ],
    defaultViewport: chromium.defaultViewport || { width: 1280, height: 720 },
  };
}

module.exports = {
  resolveChromeLaunchOptions,
  resolveLocalChromeExecutablePath,
};
