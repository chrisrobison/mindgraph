import { compactPreview, escapeHtml, formatDateTime, toArray } from "./shared.js";

class BottomTraceView extends HTMLElement {
  #items = [];

  set items(value) {
    this.#items = toArray(value);
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    const items = this.#items.slice(0, 120);
    if (!items.length) {
      this.innerHTML = '<p class="panel-empty">No runtime traces captured yet.</p>';
      return;
    }

    this.innerHTML = `
      <ul class="panel-rows">
        ${items
          .map((entry) => {
            const attempt = Number(entry?.attempt);
            return `
              <li class="panel-row">
                <div class="panel-row-main">
                  <strong>${escapeHtml(entry?.kind ?? "trace")}</strong>
                  ${entry?.mode ? `<span class="chip">${escapeHtml(entry.mode)}</span>` : ""}
                  ${entry?.runId ? `<code>${escapeHtml(entry.runId)}</code>` : ""}
                </div>
                <div class="panel-row-meta">
                  <span>${escapeHtml(formatDateTime(entry?.at))}</span>
                  ${entry?.nodeId ? `<span>Node ${escapeHtml(entry.nodeId)}</span>` : ""}
                  ${Number.isFinite(attempt) ? `<span>Attempt ${attempt}</span>` : ""}
                </div>
                <div class="panel-row-detail">${escapeHtml(compactPreview(entry?.detail ?? {}, 220))}</div>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }
}

customElements.define("bottom-trace-view", BottomTraceView);
