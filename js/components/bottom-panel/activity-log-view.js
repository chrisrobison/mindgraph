import { escapeHtml, formatTime, toArray } from "./shared.js";

class BottomActivityLogView extends HTMLElement {
  #items = [];
  #selectedNode = null;

  set items(value) {
    this.#items = toArray(value);
    if (this.isConnected) this.render();
  }

  set selectedNode(value) {
    this.#selectedNode = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #renderRows(items) {
    if (!items.length) return '<p class="panel-empty">No activity yet.</p>';

    return `
      <ul class="log-list">
        ${items
          .map(
            (entry) => `<li class="log-item"><span class="row-meta">${escapeHtml(formatTime(entry.timestamp ?? entry.at))}</span> <strong class="level-${escapeHtml(entry.level ?? "info")}">[${escapeHtml(entry.level ?? "info")}]</strong> ${escapeHtml(entry.message ?? "(no message)")}</li>`
          )
          .join("")}
      </ul>
    `;
  }

  render() {
    const globalItems = this.#items.slice(0, 40);
    const nodeActivity = toArray(this.#selectedNode?.data?.activityHistory).map((entry) => ({
      at: entry?.at,
      level: entry?.level ?? "info",
      message: entry?.message ?? "(no message)"
    }));

    const nodeMarkup = nodeActivity.length
      ? `
        <section class="panel-split">
          <h4>Selected Node Activity: ${escapeHtml(this.#selectedNode?.label ?? "Unknown")}</h4>
          ${this.#renderRows(nodeActivity.slice(0, 20))}
        </section>
      `
      : "";

    this.innerHTML = `
      ${nodeMarkup}
      <section class="panel-split">
        <h4>Global Activity Log</h4>
        ${this.#renderRows(globalItems)}
      </section>
    `;
  }
}

customElements.define("bottom-activity-log-view", BottomActivityLogView);
