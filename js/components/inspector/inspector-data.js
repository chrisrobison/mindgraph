import {
  boolValue,
  emitNodePatch,
  escapeHtml,
  jsonToText,
  patchNodeData,
  textToJsonLike,
  textToList,
  textValue
} from "./shared.js";

class InspectorData extends HTMLElement {
  #node = null;

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

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to edit data bindings.</p>';
      return;
    }

    if (node.type === "agent") {
      const dataSources = escapeHtml(
        Array.isArray(node.data?.allowedDataSources)
          ? node.data.allowedDataSources.join("\n")
          : textValue(node.data?.allowedDataSources)
      );
      const inputSchema = escapeHtml(jsonToText(node.data?.inputSchema));
      const outputSchema = escapeHtml(jsonToText(node.data?.outputSchema));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Agent Data Sources</h4>
          <label class="inspector-field">
            <span>Allowed Data Sources</span>
            <textarea rows="5" data-field="allowedDataSources">${dataSources}</textarea>
          </label>
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

      this.querySelector('[data-field="allowedDataSources"]')?.addEventListener("change", (event) => {
        this.#patchData({ allowedDataSources: textToList(event.target.value) });
      });
      this.querySelector('[data-field="inputSchema"]')?.addEventListener("change", (event) => {
        this.#patchData({ inputSchema: textToJsonLike(event.target.value) });
      });
      this.querySelector('[data-field="outputSchema"]')?.addEventListener("change", (event) => {
        this.#patchData({ outputSchema: textToJsonLike(event.target.value) });
      });
      return;
    }

    if (node.type === "data") {
      const sourceType = escapeHtml(textValue(node.data?.sourceType ?? node.data?.source));
      const sourcePath = escapeHtml(textValue(node.data?.sourcePath));
      const sourceUrl = escapeHtml(textValue(node.data?.sourceUrl));
      const jsonPath = escapeHtml(textValue(node.data?.jsonPath));
      const readonly = boolValue(node.data?.readonly, false);

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Data Source</h4>
          <label class="inspector-field">
            <span>Source Type</span>
            <input type="text" data-field="sourceType" value="${sourceType}" />
          </label>
          <label class="inspector-field">
            <span>Source Path</span>
            <input type="text" data-field="sourcePath" value="${sourcePath}" />
          </label>
          <label class="inspector-field">
            <span>Source URL</span>
            <input type="url" data-field="sourceUrl" value="${sourceUrl}" />
          </label>
          <label class="inspector-field">
            <span>JSON Path</span>
            <input type="text" data-field="jsonPath" value="${jsonPath}" />
          </label>
          <label class="inspector-field checkbox">
            <input type="checkbox" data-field="readonly" ${readonly ? "checked" : ""} />
            <span>Read-only</span>
          </label>
        </section>
      `;

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
      this.querySelector('[data-field="readonly"]')?.addEventListener("change", (event) => {
        this.#patchData({ readonly: event.target.checked });
      });
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
