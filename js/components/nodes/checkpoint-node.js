class CheckpointNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "Approval Checkpoint";
    const description = node.description ?? this.getAttribute("description") ?? "";
    const data = node.data ?? {};
    const status = data.status ?? "idle";
    const message = data.message ?? "";
    const decisionComment = data.decisionComment ?? "";
    const planning = node.metadata?.planning ?? null;
    const planningStatus = planning?.ready ? "Ready" : planning?.runnable ? "Blocked" : "Not Runnable";
    const planningReason = planning?.blockedReasons?.[0] ?? "";

    const isPending = status === "pending_approval";
    const isApproved = status === "approved" || status === "completed";
    const isRejected = status === "rejected" || status === "failed";

    const stateClass = isPending ? "checkpoint-pending" : isApproved ? "checkpoint-approved" : isRejected ? "checkpoint-rejected" : "";
    this.className = `mg-node checkpoint compact${stateClass ? " " + stateClass : ""}`;

    let statusBadge;
    if (isPending) {
      statusBadge = `<span class="checkpoint-status-badge checkpoint-pending-badge">⏳ Awaiting Approval</span>`;
    } else if (isApproved) {
      statusBadge = `<span class="checkpoint-status-badge checkpoint-approved-badge">✓ Approved</span>`;
    } else if (isRejected) {
      statusBadge = `<span class="checkpoint-status-badge checkpoint-rejected-badge">✗ Rejected</span>`;
    } else if (status === "running") {
      statusBadge = `<span class="checkpoint-status-badge">Running...</span>`;
    } else {
      statusBadge = `<p class="node-compact-meta">Planner: ${planningStatus}</p>`;
    }

    this.innerHTML = `
      <div class="compact-title">Checkpoint</div>
      <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      <h4>${label}</h4>
      ${description ? `<p>${description}</p>` : ""}
      ${message ? `<p class="checkpoint-message">${message}</p>` : ""}
      ${statusBadge}
      ${decisionComment && (isApproved || isRejected) ? `<p class="checkpoint-decision-comment">${decisionComment}</p>` : ""}
      ${planningReason && !isPending && !isApproved && !isRejected ? `<p class="node-planner-reason" title="${planningReason}">${planningReason}</p>` : ""}
    `;
  }
}

customElements.define("checkpoint-node", CheckpointNode);
