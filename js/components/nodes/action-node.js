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
    const planning = node.metadata?.planning ?? null;
    const planningStatus = planning?.ready ? "Ready" : planning?.runnable ? "Blocked" : "Reference";
    const planningReason = planning?.blockedReasons?.[0] ?? "";

    this.className = "mg-node action compact";
    this.innerHTML = `
      <div class="compact-title">Action</div>
      <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      <h4>${label}</h4>
      <p>${description}</p>
      <p class="node-compact-meta">Planner: ${planningStatus}</p>
      ${planningReason ? `<p class="node-planner-reason" title="${planningReason}">${planningReason}</p>` : ""}
    `;
  }
}

customElements.define("action-node", ActionNode);
