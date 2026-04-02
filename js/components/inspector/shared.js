export const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const textValue = (value) => (value == null ? "" : String(value));

export const boolValue = (value, fallback = false) =>
  value == null ? fallback : Boolean(value);

export const numberValue = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const listToText = (value) =>
  Array.isArray(value)
    ? value.join("\n")
    : String(value ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join("\n");

export const textToList = (value) =>
  String(value ?? "")
    .split(/\r?\n|,/) 
    .map((entry) => entry.trim())
    .filter(Boolean);

export const jsonToText = (value) => {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
};

export const textToJsonLike = (value) => {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

export const emitNodePatch = (element, patch) => {
  element.dispatchEvent(
    new CustomEvent("inspector-node-patch", {
      detail: { patch },
      bubbles: true,
      composed: true
    })
  );
};

export const patchNodeData = (node, patchData) => ({
  data: {
    ...(node?.data ?? {}),
    ...patchData
  }
});
