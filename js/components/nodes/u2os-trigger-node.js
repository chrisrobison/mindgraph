const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatWhen = (value) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const toPayloadPreview = (node, maxLength = 80) => {
  const fromData = String(node?.data?.lastReceivedPayloadPreview ?? "").trim();
  if (fromData) return fromData.slice(0, maxLength);

  const payload = node?.data?.cachedData;
  if (payload == null) return "(none)";
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return String(text ?? "").slice(0, maxLength);
};

const toStatus = (eventName, lastReceivedAt) => {
  if (!eventName) return "Idle";
  if (lastReceivedAt) return "Received";
  return "Listening";
};

const toStatusClass = (status) => {
  const normalized = String(status ?? "idle").toLowerCase();
  if (normalized === "received") return "status-ready";
  if (normalized === "listening") return "status-active";
  return "status-idle";
};

class U2osTriggerNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "U2OS Trigger";
    const description =
      node.description ??
      this.getAttribute("description") ??
      "Activates when a matching U2OS event is received.";
    const eventName = String(node.data?.eventName ?? "").trim();
    const eventBadge = eventName || "No event selected";
    const lastReceivedAt = String(node.data?.lastReceivedAt ?? node.data?.lastUpdated ?? "").trim();
    const status = toStatus(eventName, lastReceivedAt);
    const preview = toPayloadPreview(node, 80);

    this.className = "mg-node u2os-trigger";
    this.innerHTML = `
      <div class="node-title-row">
        <h4>${escapeHtml(label)}</h4>
        <span class="readonly-badge node-trigger-event-badge" title="${escapeHtml(eventBadge)}">${escapeHtml(eventBadge)}</span>
        <span class="status-badge ${toStatusClass(status)}">${escapeHtml(status)}</span>
        <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      </div>
      <p>${escapeHtml(description)}</p>
      <div class="node-meta-grid">
        <span>Status</span><strong>${escapeHtml(status)}</strong>
        <span>Last Received</span><strong>${escapeHtml(formatWhen(lastReceivedAt))}</strong>
      </div>
      <p class="node-trigger-preview" title="${escapeHtml(preview)}">Payload: ${escapeHtml(preview)}</p>
    `;
  }
}

customElements.define("u2os-trigger-node", U2osTriggerNode);
