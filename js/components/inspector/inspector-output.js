import {
  emitNodePatch,
  escapeHtml,
  jsonToText,
  patchNodeData,
  textToJsonLike,
  textValue
} from "./shared.js";

class InspectorOutput extends HTMLElement {
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
      this.innerHTML = '<p class="inspector-empty">Select a node to edit output settings.</p>';
      return;
    }

    if (node.type === "agent") {
      const outputSchema = escapeHtml(jsonToText(node.data?.outputSchema));
      const lastOutput = escapeHtml(textValue(node.data?.lastOutput));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Agent Output</h4>
          <label class="inspector-field">
            <span>Output Schema (JSON)</span>
            <textarea rows="7" data-field="outputSchema">${outputSchema}</textarea>
          </label>
          <label class="inspector-field">
            <span>Last Output</span>
            <textarea rows="6" data-field="lastOutput">${lastOutput}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="outputSchema"]')?.addEventListener("change", (event) => {
        this.#patchData({ outputSchema: textToJsonLike(event.target.value) });
      });
      this.querySelector('[data-field="lastOutput"]')?.addEventListener("change", (event) => {
        this.#patchData({ lastOutput: event.target.value });
      });
      return;
    }

    if (node.type === "transformer" || node.type === "view" || node.type === "action") {
      const outputTemplate = escapeHtml(textValue(node.data?.outputTemplate));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Output</h4>
          <label class="inspector-field">
            <span>Output Template</span>
            <textarea rows="8" data-field="outputTemplate">${outputTemplate}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="outputTemplate"]')?.addEventListener("change", (event) => {
        this.#patchData({ outputTemplate: event.target.value });
      });
      return;
    }

    this.innerHTML = `
      <p class="inspector-help">
        This node type has no output-specific controls in this tab.
      </p>
    `;
  }
}

customElements.define("inspector-output", InspectorOutput);
