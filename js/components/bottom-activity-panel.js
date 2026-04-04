import { EVENTS } from "../core/event-constants.js";
import { subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";

const tabs = [
  { key: "messages", label: "Messages", tag: "bottom-messages-view" },
  { key: "activity", label: "Activity Log", tag: "bottom-activity-log-view" },
  { key: "queue", label: "Task Queue", tag: "bottom-task-queue-view" },
  { key: "history", label: "Run History", tag: "bottom-run-history-view" },
  { key: "timeline", label: "Timeline", tag: "bottom-run-session-view" },
  { key: "traces", label: "Run Traces", tag: "bottom-trace-view" },
  { key: "plannerDiff", label: "Planner Diff", tag: "bottom-planner-diff-view" },
  { key: "settings", label: "Settings", tag: "bottom-runtime-settings-view" },
  { key: "errors", label: "Errors", tag: "bottom-error-view" }
];

const tabByKey = Object.fromEntries(tabs.map((tab) => [tab.key, tab]));
const normalizeTab = (value) => (tabByKey[value] ? value : "messages");

class BottomActivityPanel extends HTMLElement {
  #dispose = [];
  #tab = "messages";
  #runtime = uiStore.getRuntimeState();
  #selectedNodeId = null;
  #selectedNode = null;

  #isSelectionSensitiveTab() {
    return this.#tab === "activity" || this.#tab === "timeline";
  }

  connectedCallback() {
    const state = uiStore.getState();
    this.#tab = normalizeTab(state.bottomTab);
    this.#runtime = uiStore.getRuntimeState();
    this.#selectedNodeId = state.selectedNodeId;
    this.#selectedNode = state.selectedNodeId ? graphStore.getNode(state.selectedNodeId) : null;

    this.render();
    this.#bind();

    this.#dispose.push(
      subscribe(EVENTS.PANEL_BOTTOM_TAB_CHANGED, ({ payload }) => {
        this.#tab = normalizeTab(payload?.tab);
        this.render();
        this.#bind();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.UI_RUNTIME_STATE_CHANGED, () => {
        this.#runtime = uiStore.getRuntimeState();
        this.renderView();
        this.#syncDevConsoleToggle();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_CHANGED, () => {
        if (this.#tab === "settings" || this.#tab === "plannerDiff") this.renderView();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
        const selectedIds = Array.isArray(payload?.nodeIds) ? payload.nodeIds : [];
        this.#selectedNodeId = payload?.nodeId ?? selectedIds[0] ?? null;
        this.#selectedNode = this.#selectedNodeId ? graphStore.getNode(this.#selectedNodeId) : null;
        if (this.#isSelectionSensitiveTab()) this.renderView();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
        this.#selectedNodeId = null;
        this.#selectedNode = null;
        if (this.#isSelectionSensitiveTab()) this.renderView();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
        if (!this.#selectedNodeId || payload?.nodeId !== this.#selectedNodeId) return;
        this.#selectedNode = graphStore.getNode(this.#selectedNodeId);
        if (this.#isSelectionSensitiveTab()) this.renderView();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_DELETED, ({ payload }) => {
        if (!this.#selectedNodeId || payload?.nodeId !== this.#selectedNodeId) return;
        this.#selectedNodeId = null;
        this.#selectedNode = null;
        if (this.#isSelectionSensitiveTab()) this.renderView();
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bind() {
    this.querySelectorAll("[data-bottom-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        uiStore.setBottomTab(button.dataset.bottomTab);
      });
    });

    this.querySelector("[data-action='toggle-dev-console']")?.addEventListener("click", () => {
      uiStore.setDevConsoleVisible(!this.#runtime.devConsoleVisible);
    });
  }

  #syncDevConsoleToggle() {
    const button = this.querySelector("[data-action='toggle-dev-console']");
    if (!button) return;
    button.setAttribute("aria-pressed", this.#runtime.devConsoleVisible ? "true" : "false");
    button.textContent = this.#runtime.devConsoleVisible ? "Hide PAN Console" : "Show PAN Console";
  }

  renderView() {
    const panel = this.querySelector("[data-role='bottom-tab-content']");
    if (!panel) return;

    const active = tabByKey[this.#tab] ?? tabByKey.messages;
    panel.innerHTML = "";
    const view = document.createElement(active.tag);

    if (this.#tab === "messages") {
      view.items = this.#runtime.activityItems;
    } else if (this.#tab === "activity") {
      view.items = this.#runtime.activityItems;
      view.selectedNode = this.#selectedNode;
    } else if (this.#tab === "queue") {
      view.items = this.#runtime.taskQueue;
    } else if (this.#tab === "history") {
      view.items = this.#runtime.runHistory;
    } else if (this.#tab === "timeline") {
      const document = graphStore.getDocument();
      view.traces = this.#runtime.traces;
      view.runHistory = this.#runtime.runHistory;
      view.selectedNodeId = this.#selectedNodeId;
      view.nodeCatalog = document?.nodes ?? [];
    } else if (this.#tab === "traces") {
      view.items = this.#runtime.traces;
    } else if (this.#tab === "settings") {
      view.settings = this.#runtime.providerSettings;
      view.runtimeMode = this.#runtime.runtimeMode;
      view.uiSettings = this.#runtime.uiSettings;
      const document = graphStore.getDocument();
      view.documentTitle = document?.title ?? "";
      view.documentDescription = document?.description ?? "";
    } else if (this.#tab === "plannerDiff") {
      const document = graphStore.getDocument();
      view.snapshots = document?.metadata?.executionAudit?.plannerSnapshots ?? [];
      view.nodeLabels = document?.nodes ?? [];
    } else {
      view.items = this.#runtime.errors;
    }

    panel.append(view);

    const devPanel = this.querySelector("[data-role='pan-dev-console']");
    if (!devPanel) return;

    devPanel.innerHTML = this.#runtime.devConsoleVisible ? "<pan-event-console></pan-event-console>" : "";
  }

  render() {
    this.innerHTML = `
      <section class="mg-panel">
        <header>Activity & Runtime</header>
        <div class="content bottom-panel-content">
          <div class="bottom-panel-toolbar">
            <div class="toolbar-actions" role="tablist" aria-label="Bottom activity tabs">
              ${tabs
                .map(
                  (tab) => `<button type="button" role="tab" data-bottom-tab="${tab.key}" aria-pressed="${this.#tab === tab.key}">${tab.label}</button>`
                )
                .join("")}
            </div>
            <button type="button" class="bottom-dev-toggle" data-action="toggle-dev-console" aria-pressed="${this.#runtime.devConsoleVisible}">
              ${this.#runtime.devConsoleVisible ? "Hide PAN Console" : "Show PAN Console"}
            </button>
          </div>
          <section class="bottom-panel-tab-content" data-role="bottom-tab-content"></section>
          <section class="bottom-panel-dev" data-role="pan-dev-console"></section>
        </div>
      </section>
    `;

    this.renderView();
  }
}

customElements.define("bottom-activity-panel", BottomActivityPanel);
