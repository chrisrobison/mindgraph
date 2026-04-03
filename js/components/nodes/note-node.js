class NoteNode extends HTMLElement {
  #node = null;

  static get observedAttributes() {
    return ["label", "description"];
  }

  set node(value) {
    this.#node = value;
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const label = this.#node?.label ?? this.getAttribute("label") ?? "Note";
    const description =
      this.#node?.description ?? this.getAttribute("description") ?? "Add context for the graph.";

    this.className = "mg-node note";
    this.innerHTML = `
      <h4>${label}</h4>
      <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      <p>${description}</p>
    `;
  }
}

customElements.define("note-node", NoteNode);
