import {
  boolValue,
  emitNodePatch,
  escapeHtml,
  jsonToText,
  patchNodeData,
  textToJsonLike
} from "./shared.js";

class InspectorPermissions extends HTMLElement {
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
      this.innerHTML = '<p class="inspector-empty">Select a node to edit permissions.</p>';
      return;
    }

    if (node.type !== "agent") {
      this.innerHTML = `
        <p class="inspector-help">
          Permissions controls are available for agent nodes.
        </p>
      `;
      return;
    }

    const memoryEnabled = boolValue(node.data?.memoryEnabled, false);
    const permissions = escapeHtml(jsonToText(node.data?.permissions));

    this.innerHTML = `
      <section class="inspector-group">
        <h4>Permissions</h4>
        <label class="inspector-field checkbox">
          <input type="checkbox" data-field="memoryEnabled" ${memoryEnabled ? "checked" : ""} />
          <span>Memory Enabled</span>
        </label>
        <label class="inspector-field">
          <span>Permissions (JSON)</span>
          <textarea rows="8" data-field="permissions">${permissions}</textarea>
        </label>
      </section>
    `;

    this.querySelector('[data-field="memoryEnabled"]')?.addEventListener("change", (event) => {
      this.#patchData({ memoryEnabled: event.target.checked });
    });
    this.querySelector('[data-field="permissions"]')?.addEventListener("change", (event) => {
      this.#patchData({ permissions: textToJsonLike(event.target.value) });
    });
  }
}

customElements.define("inspector-permissions", InspectorPermissions);
