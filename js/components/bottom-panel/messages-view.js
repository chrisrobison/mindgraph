import { escapeHtml, formatTime, toArray } from "./shared.js";

class BottomMessagesView extends HTMLElement {
  #items = [];

  set items(value) {
    this.#items = toArray(value);
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const items = this.#items
      .map((entry) => ({
        level: entry?.level ?? "info",
        message: entry?.message ?? "(no message)",
        timestamp: entry?.timestamp ?? entry?.at
      }))
      .slice(0, 40);

    if (!items.length) {
      this.innerHTML = '<p class="panel-empty">No messages yet.</p>';
      return;
    }

    this.innerHTML = `
      <ul class="log-list">
        ${items
          .map(
            (entry) => `<li class="log-item"><span class="row-meta">${escapeHtml(formatTime(entry.timestamp))}</span> <strong class="level-${escapeHtml(entry.level)}">[${escapeHtml(entry.level)}]</strong> ${escapeHtml(entry.message)}</li>`
          )
          .join("")}
      </ul>
    `;
  }
}

customElements.define("bottom-messages-view", BottomMessagesView);
