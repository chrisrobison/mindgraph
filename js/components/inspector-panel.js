import { EVENTS } from "../core/event-constants.js";
import { subscribe, publish } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";

const tabElementByKey = {
  overview: "inspector-overview",
  prompt: "inspector-prompt",
  data: "inspector-data",
  tools: "inspector-tools",
  activity: "inspector-activity",
  output: "inspector-output",
  automation: "inspector-automation",
  permissions: "inspector-permissions"
};

class InspectorPanel extends HTMLElement {
  #dispose = [];
  #activeTab = "overview";
  #selectedNodeId = null;

  connectedCallback() {
    this.render();

    this.#dispose.push(
      subscribe(EVENTS.INSPECTOR_TAB_CHANGED, ({ payload }) => {
        this.#activeTab = payload?.tab ?? "overview";
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
        this.#selectedNodeId = payload?.nodeId ?? null;
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
        this.#selectedNodeId = null;
        this.render();
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bindTabs() {
    this.querySelectorAll("[data-inspector-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        publish(EVENTS.INSPECTOR_TAB_CHANGED, { tab: button.dataset.inspectorTab });
      });
    });
  }

  render() {
    const selectedNode = this.#selectedNodeId ? graphStore.getNode(this.#selectedNodeId) : null;
    const selectedTitle = selectedNode?.label ?? "No node selected";
    const selectedType = selectedNode?.type ?? "none";
    const activeTag = tabElementByKey[this.#activeTab] ?? "inspector-overview";

    this.innerHTML = `
      <aside class="mg-panel">
        <header>Node Inspector</header>
        <div class="content">
          <p><strong>${selectedTitle}</strong></p>
          <p>Type: ${selectedType}</p>
          <div class="inspector-tabs">
            <button type="button" data-inspector-tab="overview" aria-pressed="${this.#activeTab === "overview"}">Overview</button>
            <button type="button" data-inspector-tab="prompt" aria-pressed="${this.#activeTab === "prompt"}">Prompt</button>
            <button type="button" data-inspector-tab="data" aria-pressed="${this.#activeTab === "data"}">Data</button>
            <button type="button" data-inspector-tab="tools" aria-pressed="${this.#activeTab === "tools"}">Tools</button>
            <button type="button" data-inspector-tab="activity" aria-pressed="${this.#activeTab === "activity"}">Activity</button>
            <button type="button" data-inspector-tab="output" aria-pressed="${this.#activeTab === "output"}">Output</button>
            <button type="button" data-inspector-tab="automation" aria-pressed="${this.#activeTab === "automation"}">Automation</button>
            <button type="button" data-inspector-tab="permissions" aria-pressed="${this.#activeTab === "permissions"}">Permissions</button>
          </div>
          <div style="margin-top:0.6rem;">
            <${activeTag}></${activeTag}>
          </div>
        </div>
      </aside>
    `;

    this.#bindTabs();
  }
}

customElements.define("inspector-panel", InspectorPanel);
