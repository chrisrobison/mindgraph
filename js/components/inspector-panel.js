import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { escapeHtml } from "./inspector/shared.js";
import { EDGE_TYPE_VALUES } from "../core/types.js";
import { getEdgeTypeSpec, validateEdgeSemantics } from "../core/graph-semantics.js";
import { getNodePlan } from "../runtime/execution-planner.js";

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
  #selectedEdgeId = null;
  #selectedEdge = null;

  connectedCallback() {
    this.addEventListener("inspector-node-patch", (event) => this.#onNodePatch(event));

    this.#dispose.push(
      subscribe(EVENTS.INSPECTOR_TAB_CHANGED, ({ payload }) => {
        this.#activeTab = normalizeTab(payload?.tab);
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
        this.#selectedNodeId = payload?.nodeId ?? null;
        this.#selectedNode = this.#selectedNodeId ? graphStore.getNode(this.#selectedNodeId) : null;
        this.#selectedEdgeId = null;
        this.#selectedEdge = null;
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
      subscribe(EVENTS.GRAPH_EDGE_SELECTED, ({ payload }) => {
        this.#selectedEdgeId = payload?.edgeId ?? null;
        this.#selectedEdge = this.#selectedEdgeId ? graphStore.getEdge(this.#selectedEdgeId) : null;
        this.#selectedNodeId = null;
        this.#selectedNode = null;
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_SELECTION_CLEARED, () => {
        this.#selectedEdgeId = null;
        this.#selectedEdge = null;
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

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_DELETED, ({ payload }) => {
        if (payload?.nodeId == null || payload.nodeId !== this.#selectedNodeId) return;
        this.#selectedNodeId = null;
        this.#selectedNode = null;
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_UPDATED, ({ payload }) => {
        if (payload?.edgeId == null || payload.edgeId !== this.#selectedEdgeId) return;
        this.#selectedEdge = graphStore.getEdge(this.#selectedEdgeId);
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_DELETED, ({ payload }) => {
        if (payload?.edgeId == null || payload.edgeId !== this.#selectedEdgeId) return;
        this.#selectedEdgeId = null;
        this.#selectedEdge = null;
        this.render();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_CHANGED, () => {
        if (this.#selectedNodeId) {
          this.#selectedNode = graphStore.getNode(this.#selectedNodeId);
        }
        if (this.#selectedEdgeId) {
          this.#selectedEdge = graphStore.getEdge(this.#selectedEdgeId);
        }
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

    publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
      nodeId: this.#selectedNodeId,
      patch,
      origin: "inspector-panel"
    });
  }

  #bindEdgeInspector() {
    if (!this.#selectedEdgeId || !this.#selectedEdge) return;

    this.querySelector('[data-field="edge-type"]')?.addEventListener("change", (event) => {
      publish(EVENTS.GRAPH_EDGE_UPDATE_REQUESTED, {
        edgeId: this.#selectedEdgeId,
        patch: { type: event.target.value },
        origin: "inspector-panel"
      });
    });

    this.querySelector('[data-field="edge-label"]')?.addEventListener("change", (event) => {
      publish(EVENTS.GRAPH_EDGE_UPDATE_REQUESTED, {
        edgeId: this.#selectedEdgeId,
        patch: { label: event.target.value },
        origin: "inspector-panel"
      });
    });

    this.querySelector('[data-action="delete-edge"]')?.addEventListener("click", () => {
      publish(EVENTS.GRAPH_EDGE_DELETE_REQUESTED, {
        edgeId: this.#selectedEdgeId,
        origin: "inspector-panel"
      });
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
    if (this.#selectedEdge) {
      const edge = this.#selectedEdge;
      const sourceNode = graphStore.getNode(edge.source);
      const targetNode = graphStore.getNode(edge.target);
      const semantic = getEdgeTypeSpec(edge.type);
      const semanticValidation = validateEdgeSemantics(edge, sourceNode, targetNode);
      const sourceLabel = escapeHtml(sourceNode?.label ?? edge.source ?? "(unknown)");
      const targetLabel = escapeHtml(targetNode?.label ?? edge.target ?? "(unknown)");
      const label = escapeHtml(String(edge.label ?? ""));

      this.innerHTML = `
        <aside class="mg-panel mg-inspector-panel">
          <header>Connection Inspector</header>
          <div class="content inspector-layout">
            <div class="inspector-summary">
              <p class="inspector-node-title">${sourceLabel} → ${targetLabel}</p>
              <p class="inspector-node-meta">Type: ${escapeHtml(edge.type ?? "depends_on")}</p>
            </div>
            <section class="inspector-group">
              <h4>Connection Details</h4>
              <label class="inspector-field">
                <span>Edge Type</span>
                <select data-field="edge-type">
                  ${EDGE_TYPE_VALUES.map(
                    (type) => `<option value="${type}" ${type === edge.type ? "selected" : ""}>${type}</option>`
                  ).join("")}
                </select>
              </label>
              <label class="inspector-field">
                <span>Label</span>
                <input type="text" data-field="edge-label" value="${label}" placeholder="Optional label" />
              </label>
              <label class="inspector-field">
                <span>Source Node</span>
                <input type="text" value="${sourceLabel}" disabled />
              </label>
              <label class="inspector-field">
                <span>Target Node</span>
                <input type="text" value="${targetLabel}" disabled />
              </label>
              <div class="inspector-inline-row">
                <button type="button" data-action="delete-edge">Delete Edge</button>
              </div>
            </section>
            <section class="inspector-group">
              <h4>Edge Semantics</h4>
              <p class="inspector-help">${escapeHtml(semantic?.description ?? "Unknown edge type semantics.")}</p>
              <p class="inspector-help">
                Category: <strong>${escapeHtml(semantic?.category ?? "unknown")}</strong> |
                Execution: <strong>${semantic?.affectsExecution ? "yes" : "no"}</strong> |
                Data: <strong>${semantic?.affectsDataFlow ? "yes" : "no"}</strong> |
                Hierarchy: <strong>${semantic?.affectsHierarchy ? "yes" : "no"}</strong>
              </p>
              <p class="inspector-help">
                Valid: <strong>${semanticValidation.valid ? "yes" : "no"}</strong>
                ${
                  semanticValidation.valid
                    ? ""
                    : `- ${escapeHtml((semanticValidation.errors ?? []).join("; "))}`
                }
              </p>
            </section>
          </div>
        </aside>
      `;
      this.#bindEdgeInspector();
      return;
    }

    const node = this.#selectedNode;
    const selectedTitle = escapeHtml(node?.label ?? "No node selected");
    const selectedType = escapeHtml(node?.type ?? "none");
    const nodePlan = node ? getNodePlan(graphStore.getDocument(), node.id) : null;
    const plannerMeta = nodePlan?.runnable
      ? `Planner: ${nodePlan.ready ? "Ready" : "Blocked"}`
      : "Planner: Not Runnable";

    this.innerHTML = `
      <aside class="mg-panel mg-inspector-panel">
        <header>Node Inspector</header>
        <div class="content inspector-layout">
          <div class="inspector-summary">
            <p class="inspector-node-title">${selectedTitle}</p>
            <p class="inspector-node-meta">Type: ${selectedType}</p>
            <p class="inspector-node-meta">${escapeHtml(plannerMeta)}</p>
            ${
              nodePlan?.blockedReasons?.length
                ? `<p class="inspector-help">${escapeHtml(nodePlan.blockedReasons[0])}</p>`
                : ""
            }
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
