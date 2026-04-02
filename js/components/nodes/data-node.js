class DataNode extends HTMLElement {
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
    const node = this.#node ?? {};
    const label = node.label ?? this.getAttribute("label") ?? "Data";
    const description = node.description ?? this.getAttribute("description") ?? "";
    const source = node.data?.source ?? "Local";
    const readonly = node.data?.readonly !== false;

    this.className = "mg-node data";
    this.innerHTML = `
      <div class="node-title-row">
        <h4>${label}</h4>
        <span class="readonly-badge">${readonly ? "Read-only" : "Writable"}</span>
      </div>
      <p>${description}</p>
      <div class="node-meta-inline">Source: <strong>${source}</strong></div>
    `;
  }
}

customElements.define("data-node", DataNode);
