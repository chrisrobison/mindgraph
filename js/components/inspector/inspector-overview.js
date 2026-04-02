import {
  emitNodePatch,
  escapeHtml,
  patchNodeData,
  textToList,
  textValue
} from "./shared.js";

class InspectorOverview extends HTMLElement {
  #node = null;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #applyPatch(patch) {
    if (this.#node == null) return;
    const next = { ...this.#node, ...patch };
    if (patch.data) {
      next.data = { ...(this.#node.data ?? {}), ...patch.data };
    }
    this.#node = next;
    emitNodePatch(this, patch);
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to edit overview fields.</p>';
      return;
    }

    const type = node.type ?? "note";
    const title = escapeHtml(textValue(node.label));
    const description = escapeHtml(textValue(node.description));

    if (type === "note") {
      const color = escapeHtml(textValue(node.data?.color ?? "#fff9b1"));
      const tags = escapeHtml(
        Array.isArray(node.data?.tags) ? node.data.tags.join("\n") : textValue(node.data?.tags)
      );

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Note</h4>
          <label class="inspector-field">
            <span>Title</span>
            <input type="text" data-field="title" value="${title}" />
          </label>
          <label class="inspector-field">
            <span>Body</span>
            <textarea data-field="body" rows="6">${description}</textarea>
          </label>
        </section>
        <section class="inspector-group">
          <h4>Appearance</h4>
          <label class="inspector-field">
            <span>Color</span>
            <input type="color" data-field="color" value="${color || "#fff9b1"}" />
          </label>
          <label class="inspector-field">
            <span>Tags (comma or newline)</span>
            <textarea data-field="tags" rows="3">${tags}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="title"]')?.addEventListener("change", (event) => {
        this.#applyPatch({ label: event.target.value.trim() || "Untitled Note" });
      });
      this.querySelector('[data-field="body"]')?.addEventListener("change", (event) => {
        this.#applyPatch({ description: event.target.value });
      });
      this.querySelector('[data-field="color"]')?.addEventListener("change", (event) => {
        this.#applyPatch(patchNodeData(node, { color: event.target.value }));
      });
      this.querySelector('[data-field="tags"]')?.addEventListener("change", (event) => {
        this.#applyPatch(patchNodeData(node, { tags: textToList(event.target.value) }));
      });
      return;
    }

    this.innerHTML = `
      <section class="inspector-group">
        <h4>General</h4>
        <label class="inspector-field">
          <span>Title</span>
          <input type="text" data-field="title" value="${title}" />
        </label>
        <label class="inspector-field">
          <span>Description</span>
          <textarea data-field="description" rows="5">${description}</textarea>
        </label>
      </section>
      <section class="inspector-group">
        <h4>Node Type</h4>
        <p class="inspector-help">Editing ${escapeHtml(type)} node.</p>
      </section>
    `;

    this.querySelector('[data-field="title"]')?.addEventListener("change", (event) => {
      this.#applyPatch({ label: event.target.value.trim() || "Untitled Node" });
    });
    this.querySelector('[data-field="description"]')?.addEventListener("change", (event) => {
      this.#applyPatch({ description: event.target.value });
    });
  }
}

customElements.define("inspector-overview", InspectorOverview);
