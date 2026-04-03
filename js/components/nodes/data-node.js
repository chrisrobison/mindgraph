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
    const sourceType = String(node.data?.sourceType ?? node.data?.source ?? "json").toUpperCase();
    const readonly = node.data?.readonly !== false;
    const lastUpdated = node.data?.lastUpdated
      ? new Date(node.data.lastUpdated).toLocaleTimeString()
      : "Never";
    const payloadState = node.data?.cachedData == null ? "Empty" : "Loaded";

    this.className = "mg-node data";
    this.innerHTML = `
      <div class="node-title-row">
        <h4>${label}</h4>
        <span class="readonly-badge">${readonly ? "Read-only" : "Writable"}</span>
        <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      </div>
      <p>${description}</p>
      <div class="node-meta-grid">
        <span>Source</span><strong>${sourceType}</strong>
        <span>Updated</span><strong>${lastUpdated}</strong>
        <span>Payload</span><strong>${payloadState}</strong>
      </div>
    `;
  }
}

customElements.define("data-node", DataNode);
