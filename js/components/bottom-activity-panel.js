import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";

class BottomActivityPanel extends HTMLElement {
  #dispose = [];
  #tab = "activity";
  #logs = [];
  #tasks = [];

  connectedCallback() {
    this.render();

    this.#dispose.push(
      subscribe(EVENTS.PANEL_BOTTOM_TAB_CHANGED, ({ payload }) => {
        this.#tab = payload?.tab ?? "activity";
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.ACTIVITY_LOG_APPENDED, ({ payload, timestamp }) => {
        this.#logs = [
          {
            timestamp,
            level: payload?.level ?? "info",
            message: payload?.message ?? "(empty log message)"
          },
          ...this.#logs
        ].slice(0, 50);
        if (this.#tab === "activity") this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.TASK_QUEUE_UPDATED, ({ payload }) => {
        this.#tasks = payload?.tasks ?? [];
        if (this.#tab === "queue") this.render();
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bindTabs() {
    this.querySelectorAll("[data-bottom-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        publish(EVENTS.PANEL_BOTTOM_TAB_CHANGED, { tab: button.dataset.bottomTab });
      });
    });
  }

  #renderActivity() {
    if (!this.#logs.length) return "<p>No activity yet.</p>";

    return `<ul class="log-list">${this.#logs
      .map(
        (entry) => `<li class="log-item">${new Date(entry.timestamp).toLocaleTimeString()} [${entry.level}] ${entry.message}</li>`
      )
      .join("")}</ul>`;
  }

  #renderQueue() {
    if (!this.#tasks.length) return "<p>No queued tasks.</p>";

    return `<ol>${this.#tasks
      .map((task) => {
        const progress = Number(task.progress);
        const showProgress = Number.isFinite(progress);
        const progressLabel = showProgress ? ` ${Math.round(progress * 100)}%` : "";
        return `<li>${task.label} <em>(${task.status}${progressLabel})</em></li>`;
      })
      .join("")}</ol>`;
  }

  render() {
    const content =
      this.#tab === "activity"
        ? this.#renderActivity()
        : this.#tab === "queue"
          ? this.#renderQueue()
          : "<pan-event-console></pan-event-console>";

    this.innerHTML = `
      <section class="mg-panel">
        <header>Activity & Runtime</header>
        <div class="content">
          <div class="toolbar-actions" style="margin-bottom:0.5rem;">
            <button type="button" data-bottom-tab="activity" aria-pressed="${this.#tab === "activity"}">Activity</button>
            <button type="button" data-bottom-tab="queue" aria-pressed="${this.#tab === "queue"}">Task Queue</button>
            <button type="button" data-bottom-tab="events" aria-pressed="${this.#tab === "events"}">PAN Events</button>
          </div>
          ${content}
        </div>
      </section>
    `;

    this.#bindTabs();
  }
}

customElements.define("bottom-activity-panel", BottomActivityPanel);
