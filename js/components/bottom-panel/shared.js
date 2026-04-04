export const toArray = (value) => (Array.isArray(value) ? value : []);

export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const formatTime = (value) => {
  if (!value) return "--:--:--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString();
};

export const formatDateTime = (value) => {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
};

export const compactPreview = (value, max = 140) => {
  if (value == null) return "{}";

  let text = "";
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = "[unserializable payload]";
    }
  }

  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return "{}";
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
};

const STATUS_ALIAS_MAP = new Map([
  ["in_progress", "running"],
  ["in-progress", "running"],
  ["progress", "running"],
  ["streaming", "running"],
  ["active", "running"],
  ["pending", "queued"],
  ["succeeded", "completed"],
  ["success", "completed"],
  ["done", "completed"],
  ["error", "failed"],
  ["errored", "failed"],
  ["canceled", "cancelled"]
]);

export const normalizeRunStatus = (value) => {
  const raw = String(value ?? "unknown")
    .trim()
    .toLowerCase();
  if (!raw) return "unknown";
  return STATUS_ALIAS_MAP.get(raw) ?? raw;
};

export const toStatusClass = (value) => {
  const normalized = normalizeRunStatus(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "unknown";
};

export const isRunningStatus = (value) => normalizeRunStatus(value) === "running";
