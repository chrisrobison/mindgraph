class U2osEmitNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "U2OS Emit";
    const description =
      node.description ?? this.getAttribute("description") ?? "Emits a named U2OS event through the bridge.";
    const eventName = String(node.data?.eventName ?? "").trim() || "(no event)";
    const planning = node.metadata?.planning ?? null;
    const planningStatus = planning?.ready ? "Ready" : planning?.runnable ? "Blocked" : "Reference";
    const planningReason = planning?.blockedReasons?.[0] ?? "";

    this.className = "mg-node u2os-emit compact";
    this.innerHTML = `
      <div class="compact-title">U2OS Emit</div>
      <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      <h4>${label}</h4>
      <p>${description}</p>
      <p class="node-compact-meta">Event: ${eventName}</p>
      <p class="node-compact-meta">Planner: ${planningStatus}</p>
      ${planningReason ? `<p class="node-planner-reason" title="${planningReason}">${planningReason}</p>` : ""}
    `;
  }
}

customElements.define("u2os-emit-node", U2osEmitNode);
