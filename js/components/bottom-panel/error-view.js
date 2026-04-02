import { escapeHtml, formatDateTime, toArray } from "./shared.js";

class BottomErrorView extends HTMLElement {
  #items = [];

  set items(value) {
    this.#items = toArray(value);
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const items = this.#items.slice(0, 60);
    if (!items.length) {
      this.innerHTML = '<p class="panel-empty">No runtime errors captured.</p>';
      return;
    }

    this.innerHTML = `
      <ul class="panel-rows">
        ${items
          .map(
            (entry) => `
              <li class="panel-row panel-row-error">
                <div class="panel-row-main">
                  <strong>${escapeHtml(entry?.nodeLabel ?? "Unknown node")}</strong>
                  <code>${escapeHtml(entry?.runId ?? "run_unknown")}</code>
                </div>
                <div class="panel-row-meta">
                  <span>${escapeHtml(formatDateTime(entry?.at))}</span>
                  <span>${escapeHtml(entry?.source ?? "runtime")}</span>
                </div>
                <div class="panel-row-detail">${escapeHtml(entry?.message ?? "Unknown error")}</div>
              </li>
            `
          )
          .join("")}
      </ul>
    `;
  }
}

customElements.define("bottom-error-view", BottomErrorView);
