const toStatusClass = (status) => String(status ?? "unknown").toLowerCase().replace(/\s+/g, "-");

class AgentNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "Agent";
    const description = node.description ?? this.getAttribute("description") ?? "";
    const role = node.data?.role ?? "Agent";
    const mode = node.data?.mode ?? "auto";
    const status = node.data?.status ?? "unknown";
    const linkedByIds = Array.isArray(node.data?.allowedDataSources)
      ? node.data.allowedDataSources.length
      : 0;
    const linkedByCount = Number(node.data?.linkedDataCount ?? 0);
    const linkedDataCount = Math.max(linkedByIds, linkedByCount);

    this.className = "mg-node agent";
    this.innerHTML = `
      <div class="node-title-row">
        <h4>${label}</h4>
        <span class="status-badge status-${toStatusClass(status)}">${status}</span>
      </div>
      <p>${description}</p>
      <div class="node-meta-grid">
        <span>Role</span><strong>${role}</strong>
        <span>Mode</span><strong>${mode}</strong>
        <span>Linked Data</span><strong>${linkedDataCount}</strong>
      </div>
    `;
  }
}

customElements.define("agent-node", AgentNode);
