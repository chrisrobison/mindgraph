import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { escapeHtml } from "./inspector/shared.js";

const tabs = [
  { key: "overview", label: "Overview", tag: "inspector-overview" },
  { key: "prompt", label: "Prompt", tag: "inspector-prompt" },
  { key: "data", label: "Data", tag: "inspector-data" },
  { key: "tools", label: "Tools", tag: "inspector-tools" },
  { key: "activity", label: "Activity", tag: "inspector-activity" },
  { key: "output", label: "Output", tag: "inspector-output" },
  { key: "automation", label: "Automation", tag: "inspector-automation" },
  { key: "permissions", label: "Permissions", tag: "inspector-permissions" }
];

const tabTagByKey = Object.fromEntries(tabs.map((tab) => [tab.key, tab.tag]));

const normalizeTab = (value) => (tabTagByKey[value] ? value : "overview");

class InspectorPanel extends HTMLElement {
  #dispose = [];
  #activeTab = "overview";
  #selectedNodeId = null;
  #selectedNode = null;

  connectedCallback() {
    this.addEventListener("inspector-node-patch", (event) => this.#onNodePatch(event));

    this.#dispose.push(
      subscribe(EVENTS.INSPECTOR_TAB_CHANGED, ({ payload }) => {
        this.#activeTab = normalizeTab(payload?.tab);
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
        this.#selectedNodeId = payload?.nodeId ?? null;
        this.#selectedNode = this.#selectedNodeId ? graphStore.getNode(this.#selectedNodeId) : null;
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
        this.#selectedNodeId = null;
        this.#selectedNode = null;
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
        if (payload?.nodeId == null || payload.nodeId !== this.#selectedNodeId) return;
        this.#selectedNode = graphStore.getNode(this.#selectedNodeId);
        this.render();
      })
    );

    this.render();
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #onNodePatch(event) {
    const patch = event.detail?.patch;
    if (this.#selectedNodeId == null || patch == null || typeof patch !== "object") return;

    publish(EVENTS.GRAPH_NODE_UPDATED, {
      nodeId: this.#selectedNodeId,
      patch,
      origin: "inspector-panel"
    });
  }

  #bindTabs() {
    this.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        const tab = normalizeTab(button.dataset.inspectorTab);
        publish(EVENTS.INSPECTOR_TAB_CHANGED, { tab, origin: "inspector-panel" });
      });
    });
  }

  render() {
    const node = this.#selectedNode;
    const selectedTitle = escapeHtml(node?.label ?? "No node selected");
    const selectedType = escapeHtml(node?.type ?? "none");

    this.innerHTML = `
      <aside class="mg-panel mg-inspector-panel">
        <header>Node Inspector</header>
        <div class="content inspector-layout">
          <div class="inspector-summary">
            <p class="inspector-node-title">${selectedTitle}</p>
            <p class="inspector-node-meta">Type: ${selectedType}</p>
          </div>
          <div class="inspector-tabs" role="tablist" aria-label="Inspector tabs">
            ${tabs
              .map(
                (tab) => `<button type="button" role="tab" data-inspector-tab="${tab.key}" aria-selected="${
                  this.#activeTab === tab.key
                }" aria-pressed="${this.#activeTab === tab.key}">${tab.label}</button>`
              )
              .join("")}
          </div>
          <section class="inspector-tab-content" data-role="inspector-tab-content"></section>
        </div>
      </aside>
    `;

    this.#bindTabs();

    const activeTag = tabTagByKey[this.#activeTab] ?? "inspector-overview";
    const contentEl = this.querySelector('[data-role="inspector-tab-content"]');
    if (contentEl == null) return;

    const tabEl = document.createElement(activeTag);
    tabEl.node = node;
    contentEl.append(tabEl);
  }
}

customElements.define("inspector-panel", InspectorPanel);
