import { EVENTS } from "../core/event-constants.js";
import { getNodeTypeSpec } from "../core/graph-semantics.js";
import { subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { escapeHtml } from "./inspector/shared.js";

const EXCLUDED_DATA_KEYS = new Set([
  "label",
  "description",
  "sourceType",
  "source",
  "sourcePath",
  "sourceUrl",
  "jsonPath",
  "refreshMode",
  "refreshInterval",
  "readonly",
  "lastUpdated",
  "role",
  "mode",
  "allowedDataSources",
  "linkedDataCount",
  "inputSchema",
  "outputSchema",
  "inputPorts",
  "outputPorts",
  "transformExpression",
  "outputTemplate",
  "command",
  "entity",
  "operation",
  "eventName",
  "filter",
  "limit",
  "includeRelations",
  "mapInputs",
  "payloadMapping"
]);

const toLabel = (key) =>
  String(key ?? "")
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^./u, (c) => c.toUpperCase());

const toJsonText = (value) => {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const looksLikeCsv = (value) => {
  if (typeof value !== "string") return false;
  const lines = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  return lines.some((line) => line.includes(","));
};

const parseCsvLine = (line) => {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
};

const parseCsv = (value) => {
  if (!looksLikeCsv(value)) return null;

  const lines = String(value)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  const headers = parseCsvLine(lines[0]);
  if (!headers.length) return null;

  const rows = lines.slice(1).map((line) => parseCsvLine(line));
  return { headers, rows };
};

const isDataLike = (key, value) => {
  if (value == null) return false;
  if (EXCLUDED_DATA_KEYS.has(key)) return false;
  if (typeof value === "object") return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return true;
    if (looksLikeCsv(trimmed)) return true;
    return trimmed.length > 120;
  }
  return false;
};

const collectDataEntries = (node) => {
  if (!node || typeof node !== "object") return [];

  const entries = [];
  const seen = new Set();
  const push = (key, label, value) => {
    if (seen.has(key) || value == null) return;
    entries.push({ key, label, value });
    seen.add(key);
  };

  const outputField = getNodeTypeSpec(node.type)?.outputField;
  if (outputField) {
    push(outputField, `Primary Payload (${outputField})`, node.data?.[outputField]);
  }

  push("cachedData", "Cached Data", node.data?.cachedData);
  push("lastOutput", "Last Output", node.data?.lastOutput);
  push("lastReceivedMetadata", "Last Received Metadata", node.data?.lastReceivedMetadata);

  for (const [key, value] of Object.entries(node.data ?? {})) {
    if (!isDataLike(key, value)) continue;
    push(key, toLabel(key), value);
  }

  return entries;
};

const renderCsvTable = (csv) => {
  const headers = csv.headers.slice(0, 20);
  const rows = csv.rows.slice(0, 200);

  return `
    <div class="node-data-viewer-table-wrap">
      <table class="node-data-viewer-table">
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `<tr>${headers
                .map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`)
                .join("")}</tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
};

class NodeDataViewerDialog extends HTMLElement {
  #dispose = [];
  #selectedNodeId = null;
  #activeEntryKey = null;

  connectedCallback() {
    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
        const wasOpen = this.open;
        this.#selectedNodeId = payload?.nodeId ?? null;
        this.#activeEntryKey = null;
        if (wasOpen) this.#renderAndMaybeOpen(true);
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
        this.#selectedNodeId = null;
        this.close();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_SELECTED, () => {
        this.close();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
        const wasOpen = this.open;
        if (!wasOpen) return;
        if (!this.#selectedNodeId || payload?.nodeId !== this.#selectedNodeId) return;
        this.#renderAndMaybeOpen(true);
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_DELETED, ({ payload }) => {
        if (!this.#selectedNodeId || payload?.nodeId !== this.#selectedNodeId) return;
        this.#selectedNodeId = null;
        this.close();
      })
    );

    this.render();
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  get open() {
    return this.querySelector("dialog")?.open ?? false;
  }

  #renderAndMaybeOpen(shouldOpen = false) {
    this.render();
    if (!shouldOpen) return;
    const dialog = this.querySelector("dialog");
    if (dialog && !dialog.open) dialog.showModal();
  }

  openForNode(nodeId) {
    this.#selectedNodeId = nodeId ? String(nodeId) : graphStore.getSelectedNodeId();
    this.#activeEntryKey = null;
    this.#renderAndMaybeOpen(true);
  }

  close() {
    const dialog = this.querySelector("dialog");
    if (dialog?.open) dialog.close();
  }

  #bindEvents() {
    this.querySelector('[data-action="close-data-viewer"]')?.addEventListener("click", () => this.close());

    this.querySelector('[data-field="data-entry"]')?.addEventListener("change", (event) => {
      const wasOpen = this.open;
      this.#activeEntryKey = String(event.target.value ?? "");
      this.#renderAndMaybeOpen(wasOpen);
    });

    this.querySelector("dialog")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        this.close();
      }
    });
  }

  render() {
    const selectedNode = this.#selectedNodeId ? graphStore.getNode(this.#selectedNodeId) : null;
    const nodeLabel = selectedNode?.label ?? "No node selected";
    const entries = collectDataEntries(selectedNode);
    const fallbackEntry = entries[0] ?? null;
    const activeEntry = entries.find((entry) => entry.key === this.#activeEntryKey) ?? fallbackEntry;

    if (activeEntry && this.#activeEntryKey == null) {
      this.#activeEntryKey = activeEntry.key;
    }

    const csv = parseCsv(typeof activeEntry?.value === "string" ? activeEntry.value : "");
    const hasStructuredObject = activeEntry?.value != null && typeof activeEntry.value === "object";
    const jsonText = toJsonText(activeEntry?.value);

    this.innerHTML = `
      <dialog class="node-data-viewer-dialog">
        <article class="node-data-viewer-surface">
          <header class="node-data-viewer-header">
            <div>
              <h3>Data Viewer</h3>
              <p>${escapeHtml(nodeLabel)}</p>
            </div>
            <button type="button" data-action="close-data-viewer" aria-label="Close data viewer">Close</button>
          </header>
          <section class="node-data-viewer-controls">
            <label>
              <span>Payload</span>
              <select data-field="data-entry" ${entries.length ? "" : "disabled"}>
                ${
                  entries.length
                    ? entries
                        .map(
                          (entry) =>
                            `<option value="${escapeHtml(entry.key)}" ${entry.key === activeEntry?.key ? "selected" : ""}>${escapeHtml(
                              entry.label
                            )}</option>`
                        )
                        .join("")
                    : '<option value="">No data found</option>'
                }
              </select>
            </label>
          </section>
          <section class="node-data-viewer-body">
            ${
              !selectedNode
                ? '<p class="node-data-viewer-empty">Select a node, then click View Data.</p>'
                : !activeEntry
                  ? '<p class="node-data-viewer-empty">No attached or generated data is available for this node yet.</p>'
                  : csv
                    ? `
                      <p class="node-data-viewer-meta">Detected CSV payload (${csv.rows.length} rows).</p>
                      ${renderCsvTable(csv)}
                      <pre class="node-data-viewer-code">${escapeHtml(String(activeEntry.value ?? ""))}</pre>
                    `
                    : hasStructuredObject || (typeof activeEntry?.value === "string" && jsonText.trim().startsWith("{")) ||
                        (typeof activeEntry?.value === "string" && jsonText.trim().startsWith("["))
                      ? `<pre class="node-data-viewer-code">${escapeHtml(jsonText)}</pre>`
                      : `<pre class="node-data-viewer-code">${escapeHtml(String(activeEntry?.value ?? ""))}</pre>`
            }
          </section>
        </article>
      </dialog>
    `;

    this.#bindEvents();
  }
}

customElements.define("node-data-viewer-dialog", NodeDataViewerDialog);
