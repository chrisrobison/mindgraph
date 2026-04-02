import {
  emitNodePatch,
  escapeHtml,
  numberValue,
  patchNodeData,
  textToJsonLike,
  textValue
} from "./shared.js";

class InspectorAutomation extends HTMLElement {
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
      this.innerHTML = '<p class="inspector-empty">Select a node to edit automation settings.</p>';
      return;
    }

    if (node.type === "data") {
      const refreshMode = escapeHtml(textValue(node.data?.refreshMode ?? "manual"));
      const refreshInterval = numberValue(node.data?.refreshInterval, 0);

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Refresh Controls</h4>
          <label class="inspector-field">
            <span>Refresh Mode</span>
            <input type="text" data-field="refreshMode" value="${refreshMode}" />
          </label>
          <label class="inspector-field">
            <span>Refresh Interval (sec)</span>
            <input type="number" min="0" step="1" data-field="refreshInterval" value="${refreshInterval}" />
          </label>
        </section>
      `;

      this.querySelector('[data-field="refreshMode"]')?.addEventListener("change", (event) => {
        this.#patchData({ refreshMode: event.target.value.trim() || "manual" });
      });
      this.querySelector('[data-field="refreshInterval"]')?.addEventListener("change", (event) => {
        this.#patchData({ refreshInterval: Math.max(0, numberValue(event.target.value, refreshInterval)) });
      });
      return;
    }

    if (node.type === "agent") {
      const automation = escapeHtml(
        typeof node.data?.automation === "string"
          ? node.data.automation
          : JSON.stringify(node.data?.automation ?? {}, null, 2)
      );

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Agent Automation</h4>
          <label class="inspector-field">
            <span>Automation Settings (JSON)</span>
            <textarea rows="8" data-field="automation">${automation}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="automation"]')?.addEventListener("change", (event) => {
        this.#patchData({ automation: textToJsonLike(event.target.value) });
      });
      return;
    }

    this.innerHTML = `
      <p class="inspector-help">
        Automation settings are not defined for this node type.
      </p>
    `;
  }
}

customElements.define("inspector-automation", InspectorAutomation);
