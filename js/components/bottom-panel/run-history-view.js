import { escapeHtml, formatDateTime, toArray } from "./shared.js";

class BottomRunHistoryView extends HTMLElement {
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
      this.innerHTML = '<p class="panel-empty">No runs recorded yet.</p>';
      return;
    }

    this.innerHTML = `
      <ul class="panel-rows">
        ${items
          .map((entry) => {
            const confidenceValue = Number(entry?.confidence);
            const confidence = Number.isFinite(confidenceValue) ? confidenceValue.toFixed(2) : "--";
            return `
              <li class="panel-row">
                <div class="panel-row-main">
                  <strong>${escapeHtml(entry?.nodeLabel ?? "Unknown node")}</strong>
                  <span class="chip">${escapeHtml(entry?.status ?? "unknown")}</span>
                  <code>${escapeHtml(entry?.runId ?? "run_unknown")}</code>
                </div>
                <div class="panel-row-meta">
                  <span>${escapeHtml(formatDateTime(entry?.at))}</span>
                  <span>Confidence ${escapeHtml(confidence)}</span>
                </div>
                <div class="panel-row-detail">${escapeHtml(entry?.summary ?? "(no summary)")}</div>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }
}

customElements.define("bottom-run-history-view", BottomRunHistoryView);
