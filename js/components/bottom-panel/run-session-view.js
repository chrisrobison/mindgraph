import { uiStore } from "../../store/ui-store.js";
import { escapeHtml, formatDateTime, formatTime, toArray } from "./shared.js";
import { buildRunSessionTimelineModel, filterRunSessionTimelineModel, TIMELINE_FILTERS } from "./run-session-model.js";

class BottomRunSessionView extends HTMLElement {
  #traces = [];
  #runHistory = [];
  #nodeCatalog = [];
  #selectedNodeId = null;
  #filter = TIMELINE_FILTERS.all;
  #groupByNode = false;

  set traces(value) {
    this.#traces = toArray(value);
    this.#renderWithModel();
  }

  set runHistory(value) {
    this.#runHistory = toArray(value);
    this.#renderWithModel();
  }

  set nodeCatalog(value) {
    this.#nodeCatalog = toArray(value);
    this.#renderWithModel();
  }

  set selectedNodeId(value) {
    this.#selectedNodeId = value ? String(value) : null;
    if (!this.#selectedNodeId && this.#filter === TIMELINE_FILTERS.selectedNode) {
      this.#filter = TIMELINE_FILTERS.all;
    }
    this.#renderWithModel();
  }

  connectedCallback() {
    this.#renderWithModel();
  }

  #model() {
    return buildRunSessionTimelineModel({
      traces: this.#traces,
      runHistory: this.#runHistory,
      nodeCatalog: this.#nodeCatalog
    });
  }

  #renderWithModel() {
    if (!this.isConnected) return;
    this.render();
    this.#bind();
  }

  #renderSession(session) {
    const statusClass = `timeline-session--${escapeHtml(session.status ?? "running")}`;
    const runIds = toArray(session?.runIds);
    const runIdsLabel = runIds.length ? runIds.slice(0, 2).join(", ") : "(none)";

    const groupedMarkup = this.#groupByNode
      ? this.#renderGroupedSessionEvents(session)
      : `<ol class="timeline-events">${toArray(session?.events)
          .map((event) => this.#renderEventRow(event))
          .join("")}</ol>`;

    return `
      <article class="timeline-session ${statusClass}">
        <header class="timeline-session-header">
          <div class="timeline-session-main">
            <strong>${escapeHtml(formatDateTime(session?.startedAt))}</strong>
            <span class="chip">${escapeHtml(session?.status ?? "running")}</span>
            <span class="chip">${escapeHtml(String(session?.counts?.total ?? 0))} event(s)</span>
            <span class="chip">${escapeHtml(String(session?.nodeCount ?? 0))} node(s)</span>
          </div>
          <div class="timeline-session-meta">
            <span>${escapeHtml(formatDateTime(session?.endedAt))}</span>
            <code>${escapeHtml(runIdsLabel)}</code>
          </div>
        </header>
        <div class="timeline-session-counts">
          <span>Completed ${escapeHtml(String(session?.counts?.completed ?? 0))}</span>
          <span>Failed ${escapeHtml(String(session?.counts?.failed ?? 0))}</span>
          <span>Retries ${escapeHtml(String(session?.counts?.retries ?? 0))}</span>
          <span>Cancelled ${escapeHtml(String(session?.counts?.cancelled ?? 0))}</span>
          <span>Skipped ${escapeHtml(String(session?.counts?.skipped ?? 0))}</span>
        </div>
        ${session?.droppedEvents ? `<p class="panel-empty timeline-truncation-note">Showing latest ${escapeHtml(String(session?.events?.length ?? 0))} events; ${escapeHtml(String(session.droppedEvents))} older event(s) omitted.</p>` : ""}
        ${groupedMarkup}
      </article>
    `;
  }

  #renderGroupedSessionEvents(session) {
    const runLevelEvents = toArray(session?.runLevelEvents);
    const nodeGroups = toArray(session?.nodeGroups);

    const sections = [];

    if (runLevelEvents.length) {
      sections.push(`
        <section class="timeline-node-group">
          <h4>Run Session</h4>
          <ol class="timeline-events">
            ${runLevelEvents.map((event) => this.#renderEventRow(event)).join("")}
          </ol>
        </section>
      `);
    }

    nodeGroups.forEach((group) => {
      sections.push(`
        <section class="timeline-node-group">
          <h4>${escapeHtml(group?.nodeLabel ?? group?.nodeId ?? "Node")}</h4>
          <ol class="timeline-events">
            ${toArray(group?.events)
              .map((event) => this.#renderEventRow(event))
              .join("")}
          </ol>
        </section>
      `);
    });

    return `<div class="timeline-grouped">${sections.join("")}</div>`;
  }

  #renderEventRow(event) {
    const eventType = escapeHtml(event?.type ?? "info");
    const attempt = Number(event?.attempt);
    const maxAttempts = Number(event?.maxAttempts);
    const attemptLabel = Number.isFinite(attempt)
      ? Number.isFinite(maxAttempts)
        ? `Attempt ${attempt}/${maxAttempts}`
        : `Attempt ${attempt}`
      : "";

    const shellTag = event?.nodeId ? "button" : "div";
    const shellAttrs = event?.nodeId
      ? `type="button" class="timeline-event timeline-event-button timeline-event--${eventType}" data-action="focus-node" data-node-id="${escapeHtml(
          event.nodeId
        )}"`
      : `class="timeline-event timeline-event--${eventType}"`;

    return `
      <li>
        <${shellTag} ${shellAttrs}>
          <div class="timeline-event-head">
            <span class="timeline-event-time">${escapeHtml(formatTime(event?.at))}</span>
            <strong>${escapeHtml(event?.title ?? "Event")}</strong>
            ${event?.nodeLabel ? `<span class="chip">${escapeHtml(event.nodeLabel)}</span>` : ""}
            ${event?.runId ? `<code>${escapeHtml(event.runId)}</code>` : ""}
            ${attemptLabel ? `<span class="chip">${escapeHtml(attemptLabel)}</span>` : ""}
          </div>
          <div class="timeline-event-detail">${escapeHtml(event?.detail ?? "")}</div>
        </${shellTag}>
      </li>
    `;
  }

  #bind() {
    this.querySelectorAll("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = String(button.dataset.filter ?? TIMELINE_FILTERS.all);
        if (next === TIMELINE_FILTERS.selectedNode && !this.#selectedNodeId) return;
        this.#filter = next;
        this.render();
        this.#bind();
      });
    });

    this.querySelector("[data-action='toggle-grouping']")?.addEventListener("click", () => {
      this.#groupByNode = !this.#groupByNode;
      this.render();
      this.#bind();
    });

    this.querySelectorAll("[data-action='focus-node']").forEach((button) => {
      button.addEventListener("click", () => {
        const nodeId = button.dataset.nodeId;
        if (!nodeId) return;
        uiStore.selectNode(nodeId);
      });
    });
  }

  render() {
    const model = this.#model();
    const sessions = filterRunSessionTimelineModel(model, this.#filter, this.#selectedNodeId);

    const selectedLabel = this.#selectedNodeId ? `Selected Node (${this.#selectedNodeId})` : "Selected Node";

    if (!sessions.length) {
      this.innerHTML = `
        <div class="timeline-controls">
          <div class="toolbar-actions">
            <button type="button" data-filter="${TIMELINE_FILTERS.all}" aria-pressed="${this.#filter === TIMELINE_FILTERS.all}">All</button>
            <button type="button" data-filter="${TIMELINE_FILTERS.current}" aria-pressed="${this.#filter === TIMELINE_FILTERS.current}">Current Run</button>
            <button type="button" data-filter="${TIMELINE_FILTERS.selectedNode}" aria-pressed="${this.#filter === TIMELINE_FILTERS.selectedNode}" ${
        this.#selectedNodeId ? "" : "disabled"
      }>${escapeHtml(selectedLabel)}</button>
          </div>
          <button type="button" data-action="toggle-grouping" aria-pressed="${this.#groupByNode}">${
        this.#groupByNode ? "Ungroup Nodes" : "Group by Node"
      }</button>
        </div>
        <p class="panel-empty">No timeline events for this filter yet.</p>
      `;
      return;
    }

    this.innerHTML = `
      <div class="timeline-controls">
        <div class="toolbar-actions">
          <button type="button" data-filter="${TIMELINE_FILTERS.all}" aria-pressed="${this.#filter === TIMELINE_FILTERS.all}">All</button>
          <button type="button" data-filter="${TIMELINE_FILTERS.current}" aria-pressed="${this.#filter === TIMELINE_FILTERS.current}">Current Run</button>
          <button type="button" data-filter="${TIMELINE_FILTERS.selectedNode}" aria-pressed="${this.#filter === TIMELINE_FILTERS.selectedNode}" ${
      this.#selectedNodeId ? "" : "disabled"
    }>${escapeHtml(selectedLabel)}</button>
        </div>
        <button type="button" data-action="toggle-grouping" aria-pressed="${this.#groupByNode}">${
      this.#groupByNode ? "Ungroup Nodes" : "Group by Node"
    }</button>
      </div>

      <div class="timeline-summary">
        <span>${escapeHtml(String(sessions.length))} session(s)</span>
        <span>${escapeHtml(String(model.totalEvents))} event(s)</span>
        ${model.droppedSourceEvents ? `<span>${escapeHtml(String(model.droppedSourceEvents))} old event(s) omitted for performance</span>` : ""}
      </div>

      <section class="timeline-session-list">
        ${sessions.map((session) => this.#renderSession(session)).join("")}
      </section>
    `;
  }
}

customElements.define("bottom-run-session-view", BottomRunSessionView);
