class ActionNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "Action";
    const description = node.description ?? this.getAttribute("description") ?? "Executes operation.";

    this.className = "mg-node action compact";
    this.innerHTML = `
      <div class="compact-title">Action</div>
      <h4>${label}</h4>
      <p>${description}</p>
    `;
  }
}

customElements.define("action-node", ActionNode);
