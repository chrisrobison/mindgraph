class TransformerNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "Transformer";
    const description = node.description ?? this.getAttribute("description") ?? "Transforms inputs.";

    this.className = "mg-node transformer compact";
    this.innerHTML = `
      <div class="compact-title">Transformer</div>
      <h4>${label}</h4>
      <p>${description}</p>
    `;
  }
}

customElements.define("transformer-node", TransformerNode);
