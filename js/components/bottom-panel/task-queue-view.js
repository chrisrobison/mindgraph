import { escapeHtml, formatDateTime, isRunningStatus, normalizeRunStatus, toArray, toStatusClass } from "./shared.js";

class BottomTaskQueueView extends HTMLElement {
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
      this.innerHTML = '<p class="panel-empty">No queued tasks.</p>';
      return;
    }

    this.innerHTML = `
      <ol class="panel-rows">
        ${items
          .map((task) => {
            const progress = Number(task?.progress);
            const progressLabel = Number.isFinite(progress) ? `${Math.round(progress * 100)}%` : "--";
            const status = normalizeRunStatus(task?.status ?? "unknown");
            const statusClass = toStatusClass(status);
            const running = isRunningStatus(status);
            return `
              <li class="panel-row ${running ? "panel-row-running" : ""}">
                <div class="panel-row-main">
                  <strong>${escapeHtml(task?.label ?? "Untitled task")}</strong>
                  <span class="chip chip-status chip-status-${statusClass} ${running ? "chip-running" : ""}">${escapeHtml(status)}</span>
                </div>
                <div class="panel-row-meta">
                  <span>Progress ${escapeHtml(progressLabel)}</span>
                  <span>Updated ${escapeHtml(formatDateTime(task?.updatedAt))}</span>
                </div>
              </li>
            `;
          })
          .join("")}
      </ol>
    `;
  }
}

customElements.define("bottom-task-queue-view", BottomTaskQueueView);
