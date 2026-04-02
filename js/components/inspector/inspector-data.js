import { graphStore } from "../../store/graph-store.js";
import { dataConnectors } from "../../runtime/data-connectors.js";
import { inferSchema } from "../../runtime/schema-inference.js";
import {
  boolValue,
  emitNodePatch,
  escapeHtml,
  jsonToText,
  patchNodeData,
  textToJsonLike,
  textValue
} from "./shared.js";

const formatLastUpdated = (value) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return String(value);
  return parsed.toLocaleString();
};

const previewJson = (value) => {
  if (value == null) return "(no data loaded)";
  return jsonToText(value);
};

class InspectorData extends HTMLElement {
  #node = null;
  #refreshing = false;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #patchData(data) {
    if (this.#node == null) return;
    emitNodePatch(this, patchNodeData(this.#node, data));
  }

  #bindAgentDataSourceSelection() {
    const node = this.#node;
    if (!node) return;

    this.querySelectorAll('[data-role="data-source-checkbox"]').forEach((input) => {
      input.addEventListener("change", () => {
        const selectedIds = [...this.querySelectorAll('[data-role="data-source-checkbox"]:checked')]
          .map((entry) => entry.value)
          .filter(Boolean);

        this.#patchData({
          allowedDataSources: selectedIds,
          linkedDataCount: selectedIds.length
        });
      });
    });

    this.querySelector('[data-field="inputSchema"]')?.addEventListener("change", (event) => {
      this.#patchData({ inputSchema: textToJsonLike(event.target.value) });
    });

    this.querySelector('[data-field="outputSchema"]')?.addEventListener("change", (event) => {
      this.#patchData({ outputSchema: textToJsonLike(event.target.value) });
    });
  }

  #bindDataNodeFields() {
    this.querySelector('[data-field="sourceType"]')?.addEventListener("change", (event) => {
      this.#patchData({ sourceType: event.target.value, source: event.target.value });
    });

    this.querySelector('[data-field="sourcePath"]')?.addEventListener("change", (event) => {
      this.#patchData({ sourcePath: event.target.value });
    });

    this.querySelector('[data-field="sourceUrl"]')?.addEventListener("change", (event) => {
      this.#patchData({ sourceUrl: event.target.value });
    });

    this.querySelector('[data-field="jsonPath"]')?.addEventListener("change", (event) => {
      this.#patchData({ jsonPath: event.target.value });
    });

    this.querySelector('[data-field="refreshMode"]')?.addEventListener("change", (event) => {
      this.#patchData({ refreshMode: event.target.value });
    });

    this.querySelector('[data-field="refreshInterval"]')?.addEventListener("change", (event) => {
      const interval = Number(event.target.value);
      this.#patchData({ refreshInterval: Number.isFinite(interval) && interval > 0 ? interval : 60 });
    });

    this.querySelector('[data-field="readonly"]')?.addEventListener("change", (event) => {
      this.#patchData({ readonly: event.target.checked });
    });

    this.querySelector('[data-action="refresh-data"]')?.addEventListener("click", async () => {
      if (!this.#node || this.#refreshing) return;
      this.#refreshing = true;
      this.render();

      try {
        await dataConnectors.refresh(this.#node.id, {
          reason: "manual",
          force: true
        });
      } catch {
        // data-connectors publishes an activity entry for failures
      } finally {
        this.#refreshing = false;
        this.render();
      }
    });
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to edit data bindings.</p>';
      return;
    }

    if (node.type === "agent") {
      const dataNodes = graphStore
        .getNodes()
        .filter((entry) => entry.type === "data")
        .sort((a, b) => a.label.localeCompare(b.label));

      const selectedSources = new Set(
        Array.isArray(node.data?.allowedDataSources) ? node.data.allowedDataSources : []
      );

      const inputSchema = escapeHtml(jsonToText(node.data?.inputSchema));
      const outputSchema = escapeHtml(jsonToText(node.data?.outputSchema));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Agent Data Sources</h4>
          <p class="inspector-help">Select data nodes this agent can access.</p>
          <div class="inspector-source-list">
            ${
              dataNodes.length
                ? dataNodes
                    .map(
                      (entry) => `
                        <label class="inspector-source-item">
                          <input
                            type="checkbox"
                            data-role="data-source-checkbox"
                            value="${escapeHtml(entry.id)}"
                            ${selectedSources.has(entry.id) ? "checked" : ""}
                          />
                          <span>${escapeHtml(entry.label)} <code>${escapeHtml(entry.id)}</code></span>
                        </label>
                      `
                    )
                    .join("")
                : '<p class="inspector-help">No data nodes found in graph.</p>'
            }
          </div>
          <label class="inspector-field">
            <span>Input Schema (JSON)</span>
            <textarea rows="6" data-field="inputSchema">${inputSchema}</textarea>
          </label>
          <label class="inspector-field">
            <span>Output Schema (JSON)</span>
            <textarea rows="6" data-field="outputSchema">${outputSchema}</textarea>
          </label>
        </section>
      `;

      this.#bindAgentDataSourceSelection();
      return;
    }

    if (node.type === "data") {
      const sourceType = textValue(node.data?.sourceType ?? node.data?.source ?? "json").toLowerCase();
      const sourcePath = escapeHtml(textValue(node.data?.sourcePath));
      const sourceUrl = escapeHtml(textValue(node.data?.sourceUrl));
      const jsonPath = escapeHtml(textValue(node.data?.jsonPath));
      const refreshMode = textValue(node.data?.refreshMode ?? "manual").toLowerCase();
      const refreshInterval = Number(node.data?.refreshInterval ?? 60);
      const readonly = boolValue(node.data?.readonly, true);
      const lastUpdated = formatLastUpdated(node.data?.lastUpdated);
      const preview = previewJson(node.data?.cachedData);
      const schemaPreview = jsonToText(node.data?.cachedSchema ?? inferSchema(node.data?.cachedData));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Data Source</h4>
          <label class="inspector-field">
            <span>Source Type</span>
            <select data-field="sourceType">
              <option value="json" ${sourceType === "json" ? "selected" : ""}>json</option>
              <option value="api" ${sourceType === "api" ? "selected" : ""}>api</option>
              <option value="mock" ${sourceType === "mock" ? "selected" : ""}>mock</option>
            </select>
          </label>
          <label class="inspector-field">
            <span>Source Path</span>
            <input type="text" data-field="sourcePath" value="${sourcePath}" placeholder="embedded:site_config or market_data.json" />
          </label>
          <label class="inspector-field">
            <span>Source URL</span>
            <input type="url" data-field="sourceUrl" value="${sourceUrl}" placeholder="https://... or /data/sample/file.json" />
          </label>
          <label class="inspector-field">
            <span>JSON Path</span>
            <input type="text" data-field="jsonPath" value="${jsonPath}" placeholder="$.items[0] or items.0" />
          </label>
          <label class="inspector-field">
            <span>Refresh Mode</span>
            <select data-field="refreshMode">
              <option value="manual" ${refreshMode === "manual" ? "selected" : ""}>manual</option>
              <option value="periodic" ${refreshMode === "periodic" ? "selected" : ""}>periodic</option>
              <option value="onOpen" ${refreshMode === "onopen" ? "selected" : ""}>onOpen</option>
            </select>
          </label>
          <label class="inspector-field">
            <span>Refresh Interval (seconds)</span>
            <input type="number" min="5" step="1" data-field="refreshInterval" value="${
              Number.isFinite(refreshInterval) && refreshInterval > 0 ? refreshInterval : 60
            }" />
          </label>
          <label class="inspector-field checkbox">
            <input type="checkbox" data-field="readonly" ${readonly ? "checked" : ""} />
            <span>Read-only</span>
          </label>
          <div class="inspector-inline-row">
            <button type="button" data-action="refresh-data" ${this.#refreshing ? "disabled" : ""}>
              ${this.#refreshing ? "Refreshing..." : "Refresh now"}
            </button>
            <span class="inspector-last-updated">Last updated: ${escapeHtml(lastUpdated)}</span>
          </div>
        </section>

        <section class="inspector-group">
          <h4>JSON Preview</h4>
          <pre class="inspector-preview">${escapeHtml(preview)}</pre>
        </section>

        <section class="inspector-group">
          <h4>Schema Preview</h4>
          <pre class="inspector-preview">${escapeHtml(schemaPreview)}</pre>
        </section>
      `;

      this.#bindDataNodeFields();
      return;
    }

    this.innerHTML = `
      <p class="inspector-help">
        This node type does not expose dedicated data-source fields in this tab.
      </p>
    `;
  }
}

customElements.define("inspector-data", InspectorData);
