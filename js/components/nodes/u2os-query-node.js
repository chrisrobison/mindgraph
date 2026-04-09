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

const toCount = (cachedData) => {
  if (typeof cachedData?.count === "number") return cachedData.count;
  if (Array.isArray(cachedData?.results)) return cachedData.results.length;
  if (Array.isArray(cachedData)) return cachedData.length;
  return 0;
};

class U2osQueryNode extends HTMLElement {
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
    const label = node.label ?? this.getAttribute("label") ?? "U2OS Query";
    const description =
      node.description ?? this.getAttribute("description") ?? "Queries U2OS entities through the bridge.";
    const entity = String(node.data?.entity ?? "reservation");
    const operation = String(node.data?.operation ?? "list").toUpperCase();
    const updatedAt = formatWhen(node.data?.lastUpdated);
    const count = toCount(node.data?.cachedData);
    const status = node.data?.cachedData == null ? "Empty" : "Loaded";

    this.className = "mg-node u2os-query";
    this.innerHTML = `
      <div class="node-title-row">
        <h4>${escapeHtml(label)}</h4>
        <span class="readonly-badge node-trigger-event-badge" title="${escapeHtml(entity)}">${escapeHtml(entity)}</span>
        <button class="node-connect-handle" type="button" data-action="connect-handle" title="Connect from this node" aria-label="Connect from this node"></button>
      </div>
      <p>${escapeHtml(description)}</p>
      <div class="node-meta-grid">
        <span>Operation</span><strong>${escapeHtml(operation)}</strong>
        <span>Updated</span><strong>${escapeHtml(updatedAt)}</strong>
        <span>Results</span><strong>${escapeHtml(String(count))} (${escapeHtml(status)})</strong>
      </div>
    `;
  }
}

customElements.define("u2os-query-node", U2osQueryNode);
