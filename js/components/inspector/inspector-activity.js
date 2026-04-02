import { emitNodePatch, escapeHtml, numberValue, patchNodeData, textValue } from "./shared.js";

class InspectorActivity extends HTMLElement {
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
      this.innerHTML = '<p class="inspector-empty">Select a node to inspect activity settings.</p>';
      return;
    }

    if (node.type !== "agent") {
      this.innerHTML = `
        <section class="inspector-group">
          <h4>Activity</h4>
          <p class="inspector-help">
            Agent nodes expose status and confidence in this tab.
          </p>
        </section>
      `;
      return;
    }

    const status = escapeHtml(textValue(node.data?.status ?? "idle"));
    const confidence = numberValue(node.data?.confidence, 0.5);

    this.innerHTML = `
      <section class="inspector-group">
        <h4>Runtime Status</h4>
        <label class="inspector-field">
          <span>Status</span>
          <input type="text" data-field="status" value="${status}" />
        </label>
        <label class="inspector-field">
          <span>Confidence</span>
          <input type="number" min="0" max="1" step="0.01" data-field="confidence" value="${confidence}" />
        </label>
      </section>
    `;

    this.querySelector('[data-field="status"]')?.addEventListener("change", (event) => {
      this.#patchData({ status: event.target.value.trim() || "idle" });
    });
    this.querySelector('[data-field="confidence"]')?.addEventListener("change", (event) => {
      const nextConfidence = numberValue(event.target.value, confidence);
      this.#patchData({ confidence: Math.min(1, Math.max(0, nextConfidence)) });
    });
  }
}

customElements.define("inspector-activity", InspectorActivity);
