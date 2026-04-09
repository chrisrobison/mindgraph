import { graphStore } from "../../store/graph-store.js";
import { dataConnectors } from "../../runtime/data-connectors.js";
import { inferSchema } from "../../runtime/schema-inference.js";
import {
  getU2osEntityRelatedOptions,
  listU2osEventsByDomain,
  operationNeedsEntityId,
  U2OS_ENTITIES,
  U2OS_MUTATE_OPERATIONS,
  U2OS_QUERY_OPERATIONS
} from "../../core/u2os-node-catalog.js";
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

const normalizeMappings = (value) =>
  (Array.isArray(value) ? value : [])
    .map((entry) => ({
      from: textValue(entry?.from ?? entry?.source ?? entry?.input),
      to: textValue(entry?.to ?? entry?.target ?? entry?.field)
    }))
    .filter((entry) => entry.from && entry.to);

const mappingsToRowsMarkup = (mappings, role = "map-input-row") => {
  const rows = mappings.length ? mappings : [{ from: "", to: "" }];
  return rows
    .map(
      (entry, index) => `
        <div class="inspector-inline-row" data-role="${role}">
          <input type="text" data-field="${role}-from" data-index="${index}" value="${escapeHtml(entry.from)}" placeholder="input.customerName" />
          <span>→</span>
          <input type="text" data-field="${role}-to" data-index="${index}" value="${escapeHtml(entry.to)}" placeholder="reservation.customerName" />
          <button type="button" data-action="${role}-remove" data-index="${index}">Remove</button>
        </div>
      `
    )
    .join("");
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

    this.#bindRefreshAction("refresh-data");
  }

  #bindRefreshAction(action = "refresh-data") {
    this.querySelector(`[data-action="${action}"]`)?.addEventListener("click", async () => {
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

  #collectMappingRows(role = "map-input-row") {
    const fromFields = [...this.querySelectorAll(`[data-field="${role}-from"]`)];
    return fromFields
      .map((input) => {
        const index = Number(input.dataset.index ?? -1);
        const toField = this.querySelector(`[data-field="${role}-to"][data-index="${index}"]`);
        return {
          from: textValue(input.value),
          to: textValue(toField?.value)
        };
      })
      .filter((entry) => entry.from && entry.to);
  }

  #bindMappingEditor(role = "map-input-row", targetField = "mapInputs") {
    const publishMappings = () => {
      const mappings = this.#collectMappingRows(role);
      this.#patchData({ [targetField]: mappings });
    };

    this.querySelectorAll(`[data-field="${role}-from"], [data-field="${role}-to"]`).forEach((input) => {
      input.addEventListener("change", publishMappings);
    });

    this.querySelector(`[data-action="${role}-add"]`)?.addEventListener("click", () => {
      const existing = normalizeMappings(this.#node?.data?.[targetField]);
      this.#patchData({ [targetField]: [...existing, { from: "", to: "" }] });
    });

    this.querySelectorAll(`[data-action="${role}-remove"]`).forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.index ?? -1);
        if (!Number.isInteger(index) || index < 0) return;
        const existing = normalizeMappings(this.#node?.data?.[targetField]);
        this.#patchData({
          [targetField]: existing.filter((_, mappingIndex) => mappingIndex !== index)
        });
      });
    });
  }

  #bindU2osQueryFields() {
    this.querySelector('[data-field="u2os-query-entity"]')?.addEventListener("change", (event) => {
      const nextEntity = textValue(event.target.value).toLowerCase();
      this.#patchData({
        entity: nextEntity || "reservation",
        includeRelations: []
      });
    });

    this.querySelector('[data-field="u2os-query-operation"]')?.addEventListener("change", (event) => {
      this.#patchData({ operation: textValue(event.target.value).toLowerCase() || "list" });
    });

    this.querySelector('[data-field="u2os-query-filter"]')?.addEventListener("change", (event) => {
      this.#patchData({ filter: event.target.value });
    });

    this.querySelector('[data-field="u2os-query-limit"]')?.addEventListener("change", (event) => {
      const limit = Number(event.target.value);
      this.#patchData({ limit: Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 50 });
    });

    this.querySelectorAll('[data-role="u2os-query-include"]').forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const selected = [...this.querySelectorAll('[data-role="u2os-query-include"]:checked')]
          .map((entry) => textValue(entry.value).toLowerCase())
          .filter(Boolean);
        this.#patchData({ includeRelations: selected });
      });
    });

    this.#bindRefreshAction("refresh-u2os-query");
  }

  #bindU2osMutateFields() {
    this.querySelector('[data-field="u2os-mutate-entity"]')?.addEventListener("change", (event) => {
      this.#patchData({ entity: textValue(event.target.value).toLowerCase() || "reservation" });
    });

    this.querySelector('[data-field="u2os-mutate-operation"]')?.addEventListener("change", (event) => {
      const nextOperation = textValue(event.target.value).toLowerCase() || "create";
      const requiresEntityId = operationNeedsEntityId(nextOperation);
      this.#patchData({
        operation: nextOperation,
        inputPorts: [
          {
            id: "payload",
            label: "Payload",
            payloadType: "object",
            required: true,
            schema: { type: "object", additionalProperties: true }
          },
          {
            id: "entityId",
            label: "Entity ID",
            payloadType: "string",
            required: requiresEntityId,
            schema: { type: "string" }
          }
        ]
      });
    });

    this.#bindMappingEditor("map-input-row", "mapInputs");
  }

  #bindU2osEmitFields() {
    this.querySelector('[data-field="u2os-emit-event-name"]')?.addEventListener("change", (event) => {
      this.#patchData({ eventName: textValue(event.target.value) });
    });

    this.#bindMappingEditor("payload-map-row", "payloadMapping");
  }

  #bindRunnableContractFields() {
    this.querySelector('[data-field="transformExpression"]')?.addEventListener("change", (event) => {
      this.#patchData({ transformExpression: event.target.value.trim() || "identity" });
    });

    this.querySelector('[data-field="outputTemplate"]')?.addEventListener("change", (event) => {
      this.#patchData({ outputTemplate: event.target.value.trim() || "summary_card" });
    });

    this.querySelector('[data-field="command"]')?.addEventListener("change", (event) => {
      this.#patchData({ command: event.target.value.trim() || "noop" });
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
        .filter((entry) => entry.type === "data" || entry.type === "u2os_query")
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

    if (node.type === "u2os_query") {
      const entity = textValue(node.data?.entity ?? "reservation").toLowerCase();
      const operation = textValue(node.data?.operation ?? "list").toLowerCase();
      const filter = escapeHtml(textValue(node.data?.filter));
      const limit = Number(node.data?.limit ?? 50);
      const includeRelations = new Set(
        Array.isArray(node.data?.includeRelations) ? node.data.includeRelations.map((entry) => textValue(entry).toLowerCase()) : []
      );
      const relationOptions = getU2osEntityRelatedOptions(entity);
      const cached = node.data?.cachedData;
      const lastUpdated = formatLastUpdated(node.data?.lastUpdated);
      const resultPreview = previewJson(cached?.results ?? cached);
      const metaPreview = previewJson(cached?.meta ?? {});
      const schemaPreview = jsonToText(node.data?.cachedSchema ?? inferSchema(cached));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>U2OS Query</h4>
          <label class="inspector-field">
            <span>Entity</span>
            <select data-field="u2os-query-entity">
              ${U2OS_ENTITIES.map(
                (entry) =>
                  `<option value="${escapeHtml(entry)}" ${entry === entity ? "selected" : ""}>${escapeHtml(entry)}</option>`
              ).join("")}
            </select>
          </label>
          <label class="inspector-field">
            <span>Operation</span>
            <select data-field="u2os-query-operation">
              ${U2OS_QUERY_OPERATIONS.map(
                (entry) =>
                  `<option value="${escapeHtml(entry)}" ${entry === operation ? "selected" : ""}>${escapeHtml(entry)}</option>`
              ).join("")}
            </select>
          </label>
          <label class="inspector-field">
            <span>Filter</span>
            <textarea rows="3" data-field="u2os-query-filter" placeholder="q=alice, status=active or $.status">${filter}</textarea>
          </label>
          <label class="inspector-field">
            <span>Limit</span>
            <input type="number" min="1" step="1" data-field="u2os-query-limit" value="${
              Number.isFinite(limit) && limit > 0 ? Math.round(limit) : 50
            }" />
          </label>
          <div class="inspector-field">
            <span>Include Relations</span>
            <div class="inspector-source-list">
              ${
                relationOptions.length
                  ? relationOptions
                      .map(
                        (entry) => `
                          <label class="inspector-source-item">
                            <input
                              type="checkbox"
                              data-role="u2os-query-include"
                              value="${escapeHtml(entry)}"
                              ${includeRelations.has(entry) ? "checked" : ""}
                            />
                            <span>${escapeHtml(entry)}</span>
                          </label>
                        `
                      )
                      .join("")
                  : '<p class="inspector-help">No related entity suggestions for this entity.</p>'
              }
            </div>
          </div>
          <div class="inspector-inline-row">
            <button type="button" data-action="refresh-u2os-query" ${this.#refreshing ? "disabled" : ""}>
              ${this.#refreshing ? "Refreshing..." : "Refresh now"}
            </button>
            <span class="inspector-last-updated">Last updated: ${escapeHtml(lastUpdated)}</span>
          </div>
        </section>
        <section class="inspector-group">
          <h4>Results Preview</h4>
          <pre class="inspector-preview">${escapeHtml(resultPreview)}</pre>
        </section>
        <section class="inspector-group">
          <h4>Meta Preview</h4>
          <pre class="inspector-preview">${escapeHtml(metaPreview)}</pre>
        </section>
        <section class="inspector-group">
          <h4>Schema Preview</h4>
          <pre class="inspector-preview">${escapeHtml(schemaPreview)}</pre>
        </section>
      `;

      this.#bindU2osQueryFields();
      return;
    }

    if (node.type === "u2os_mutate") {
      const entity = textValue(node.data?.entity ?? "reservation").toLowerCase();
      const operation = textValue(node.data?.operation ?? "create").toLowerCase();
      const mappings = normalizeMappings(node.data?.mapInputs);
      const requiresEntityId = operationNeedsEntityId(operation);

      this.innerHTML = `
        <section class="inspector-group">
          <h4>U2OS Mutate</h4>
          <label class="inspector-field">
            <span>Entity</span>
            <select data-field="u2os-mutate-entity">
              ${U2OS_ENTITIES.map(
                (entry) =>
                  `<option value="${escapeHtml(entry)}" ${entry === entity ? "selected" : ""}>${escapeHtml(entry)}</option>`
              ).join("")}
            </select>
          </label>
          <label class="inspector-field">
            <span>Operation</span>
            <select data-field="u2os-mutate-operation">
              ${U2OS_MUTATE_OPERATIONS.map(
                (entry) =>
                  `<option value="${escapeHtml(entry)}" ${entry === operation ? "selected" : ""}>${escapeHtml(entry)}</option>`
              ).join("")}
            </select>
          </label>
          <p class="inspector-help">
            Entity ID input port is ${requiresEntityId ? "<strong>required</strong>" : "<strong>optional</strong>"} for this operation.
          </p>
          <div class="inspector-inline-row">
            <strong>Map Inputs</strong>
            <button type="button" data-action="map-input-row-add">Add Mapping</button>
          </div>
          ${mappingsToRowsMarkup(mappings, "map-input-row")}
        </section>
      `;

      this.#bindU2osMutateFields();
      return;
    }

    if (node.type === "u2os_emit") {
      const selectedEventName = textValue(node.data?.eventName);
      const mappings = normalizeMappings(node.data?.payloadMapping);
      const eventOptionsMarkup = listU2osEventsByDomain()
        .map((group) => {
          const options = group.events
            .map(
              (entry) => `
                <option value="${escapeHtml(entry.eventName)}" ${entry.eventName === selectedEventName ? "selected" : ""}>
                  ${escapeHtml(entry.eventName)} (${escapeHtml(entry.action)})
                </option>
              `
            )
            .join("");
          return `<optgroup label="${escapeHtml(group.domain)}">${options}</optgroup>`;
        })
        .join("");

      this.innerHTML = `
        <section class="inspector-group">
          <h4>U2OS Emit</h4>
          <label class="inspector-field">
            <span>Event Name</span>
            <select data-field="u2os-emit-event-name">
              <option value="">Select U2OS event...</option>
              ${eventOptionsMarkup}
            </select>
          </label>
          <div class="inspector-inline-row">
            <strong>Payload Mapping</strong>
            <button type="button" data-action="payload-map-row-add">Add Mapping</button>
          </div>
          ${mappingsToRowsMarkup(mappings, "payload-map-row")}
        </section>
      `;

      this.#bindU2osEmitFields();
      return;
    }

    if (node.type === "transformer" || node.type === "view" || node.type === "action") {
      const transformExpression = escapeHtml(textValue(node.data?.transformExpression ?? "identity"));
      const outputTemplate = escapeHtml(textValue(node.data?.outputTemplate ?? "summary_card"));
      const command = escapeHtml(textValue(node.data?.command ?? "noop"));
      const inputSchema = escapeHtml(jsonToText(node.data?.inputSchema));
      const outputSchema = escapeHtml(jsonToText(node.data?.outputSchema));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Node Contract</h4>
          ${
            node.type === "transformer"
              ? `<label class="inspector-field">
                  <span>Transform Expression</span>
                  <input type="text" data-field="transformExpression" value="${transformExpression}" />
                </label>`
              : ""
          }
          ${
            node.type === "view"
              ? `<label class="inspector-field">
                  <span>Output Template</span>
                  <input type="text" data-field="outputTemplate" value="${outputTemplate}" />
                </label>`
              : ""
          }
          ${
            node.type === "action"
              ? `<label class="inspector-field">
                  <span>Command</span>
                  <input type="text" data-field="command" value="${command}" />
                </label>`
              : ""
          }
          <label class="inspector-field">
            <span>Input Schema (JSON)</span>
            <textarea rows="5" data-field="inputSchema">${inputSchema}</textarea>
          </label>
          <label class="inspector-field">
            <span>Output Schema (JSON)</span>
            <textarea rows="5" data-field="outputSchema">${outputSchema}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="inputSchema"]')?.addEventListener("change", (event) => {
        this.#patchData({ inputSchema: textToJsonLike(event.target.value) });
      });
      this.querySelector('[data-field="outputSchema"]')?.addEventListener("change", (event) => {
        this.#patchData({ outputSchema: textToJsonLike(event.target.value) });
      });
      this.#bindRunnableContractFields();
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
