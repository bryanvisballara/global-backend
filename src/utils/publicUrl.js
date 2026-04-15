function normalizePublicBaseUrl(rawValue) {
  const trimmedValue = String(rawValue || "").trim();

  if (!trimmedValue || trimmedValue === "*") {
    return "";
  }

  const valueWithProtocol = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmedValue)
    ? trimmedValue
    : `https://${trimmedValue.replace(/^\/+/, "")}`;

  try {
    const parsedUrl = new URL(valueWithProtocol);

    if (!/^https?:$/.test(parsedUrl.protocol)) {
      return "";
    }

    parsedUrl.hash = "";
    parsedUrl.search = "";
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    return parsedUrl.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

module.exports = {
  normalizePublicBaseUrl,
};