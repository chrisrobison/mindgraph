import { emitNodePatch, escapeHtml, patchNodeData, textValue } from "./shared.js";

class InspectorPrompt extends HTMLElement {
  #node = null;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #patchAgentData(partialData) {
    if (this.#node == null) return;
    emitNodePatch(this, patchNodeData(this.#node, partialData));
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to edit prompt settings.</p>';
      return;
    }

    if (node.type !== "agent") {
      this.innerHTML = `
        <p class="inspector-help">
          Prompt settings are available for agent nodes. Current type: <strong>${escapeHtml(
            node.type
          )}</strong>.
        </p>
      `;
      return;
    }

    const systemPrompt = escapeHtml(textValue(node.data?.systemPrompt));
    const objective = escapeHtml(textValue(node.data?.objective));
    const mode = escapeHtml(textValue(node.data?.mode ?? "orchestrate"));

    this.innerHTML = `
      <section class="inspector-group">
        <h4>Prompt</h4>
        <label class="inspector-field">
          <span>System Prompt</span>
          <textarea rows="8" data-field="systemPrompt">${systemPrompt}</textarea>
        </label>
        <label class="inspector-field">
          <span>Objective</span>
          <textarea rows="4" data-field="objective">${objective}</textarea>
        </label>
        <label class="inspector-field">
          <span>Mode</span>
          <input type="text" data-field="mode" value="${mode}" />
        </label>
      </section>
    `;

    this.querySelector('[data-field="systemPrompt"]')?.addEventListener("change", (event) => {
      this.#patchAgentData({ systemPrompt: event.target.value });
    });
    this.querySelector('[data-field="objective"]')?.addEventListener("change", (event) => {
      this.#patchAgentData({ objective: event.target.value });
    });
    this.querySelector('[data-field="mode"]')?.addEventListener("change", (event) => {
      this.#patchAgentData({ mode: event.target.value.trim() || "orchestrate" });
    });
  }
}

customElements.define("inspector-prompt", InspectorPrompt);
