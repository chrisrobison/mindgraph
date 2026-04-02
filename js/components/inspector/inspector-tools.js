import {
  emitNodePatch,
  escapeHtml,
  jsonToText,
  patchNodeData,
  textToJsonLike,
  textToList,
  textValue
} from "./shared.js";

class InspectorTools extends HTMLElement {
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
      this.innerHTML = '<p class="inspector-empty">Select a node to edit tool settings.</p>';
      return;
    }

    if (node.type === "agent") {
      const allowedTools = escapeHtml(
        Array.isArray(node.data?.allowedTools)
          ? node.data.allowedTools.join("\n")
          : textValue(node.data?.allowedTools)
      );

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Allowed Tools</h4>
          <label class="inspector-field">
            <span>Tool IDs (comma or newline)</span>
            <textarea rows="7" data-field="allowedTools">${allowedTools}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="allowedTools"]')?.addEventListener("change", (event) => {
        this.#patchData({ allowedTools: textToList(event.target.value) });
      });
      return;
    }

    if (node.type === "transformer" || node.type === "view" || node.type === "action") {
      const config = escapeHtml(jsonToText(node.data?.config));

      this.innerHTML = `
        <section class="inspector-group">
          <h4>${escapeHtml(node.type)} Config</h4>
          <label class="inspector-field">
            <span>Config (JSON)</span>
            <textarea rows="10" data-field="config">${config}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="config"]')?.addEventListener("change", (event) => {
        this.#patchData({ config: textToJsonLike(event.target.value) });
      });
      return;
    }

    this.innerHTML = `
      <p class="inspector-help">
        This node type has no tool restrictions in this tab.
      </p>
    `;
  }
}

customElements.define("inspector-tools", InspectorTools);
