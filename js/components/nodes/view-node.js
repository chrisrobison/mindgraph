class ViewNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "View";
    const description = node.description ?? this.getAttribute("description") ?? "Rendered insight panel.";

    this.className = "mg-node view compact";
    this.innerHTML = `
      <div class="compact-title">View</div>
      <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      <h4>${label}</h4>
      <p>${description}</p>
    `;
  }
}

customElements.define("view-node", ViewNode);
