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
      <h4>${label}</h4>
      <p>${description}</p>
    `;
  }
}

customElements.define("view-node", ViewNode);
