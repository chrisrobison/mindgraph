export const nowIso = () => new Date().toISOString();

export const uid = (prefix = "id") =>
  `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;

export const parseBool = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

export const parseIntClamped = (value, fallback, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  return Math.max(min, Math.min(max, rounded));
};

export const normalizeHost = (value) => {
  const input = String(value ?? "").trim().toLowerCase();
  if (!input) return "";

  if (input.startsWith("[")) {
    const closing = input.indexOf("]");
    if (closing > 0) return input.slice(1, closing);
  }

  const withoutPort = input.split(":")[0];
  return withoutPort.replace(/\.+$/, "");
};

const isIpAddress = (value) => {
  const host = String(value ?? "").trim();
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":");
};

export const deriveDomainFromHost = (value) => {
  const host = normalizeHost(value);
  if (!host) return "";
  if (host === "localhost" || isIpAddress(host)) return host;

  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  return labels.slice(-2).join(".");
};

export const normalizeDomain = (value) => String(value ?? "").trim().toLowerCase().replace(/^\.+/, "");

export const parseJson = (value, fallback = null) => {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export const asTrimmed = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

export const getQueryValue = (requestUrl, key) => {
  const urlText = String(requestUrl ?? "").trim();
  if (!urlText) return "";
  try {
    const parsed = new URL(urlText, "http://localhost");
    return asTrimmed(parsed.searchParams.get(key), "");
  } catch {
    return "";
  }
};
