(function (global) {
  function normalizeSiteHostname(hostname) {
    return String(hostname || "").trim().toLowerCase().replace(/^www\./, "");
  }

  function isGlobalImportsProductionSite(hostname) {
    const normalized = normalizeSiteHostname(hostname);
    return normalized === "globalimports.app" || normalized === "globalimports.co";
  }

  function resolveApiBaseUrl() {
    const { origin, hostname } = window.location;

    if (isGlobalImportsProductionSite(hostname)) {
      return origin.replace(/\/$/, "");
    }

    const isPrivateIpv4Address = /^(10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/.test(
      hostname
    );

    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      isPrivateIpv4Address ||
      hostname === "global-backend-bdbx.onrender.com"
    ) {
      return origin.replace(/\/$/, "");
    }

    return "https://global-backend-bdbx.onrender.com";
  }

  global.GlobalImportsResolveApiBaseUrl = resolveApiBaseUrl;
  global.GlobalImportsIsProductionSite = isGlobalImportsProductionSite;
})(window);
