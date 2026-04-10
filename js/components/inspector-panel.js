import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { escapeHtml } from "./inspector/shared.js";
import { EDGE_TYPE_VALUES, NODE_TYPES } from "../core/types.js";
import { getSchemaPreset, inferSchemaPresetId, listSchemaPresets } from "../core/contract-presets.js";
import {
  applyEdgeContractDefaults,
  getEdgeContractEndpoints,
  getEdgeTypeSpec,
  isExecutableNodeType,
  validateEdgeSemantics
} from "../core/graph-semantics.js";
import { getNodePlan } from "../runtime/execution-planner.js";

const tabs = [
  { key: "overview", label: "Overview", tag: "inspector-overview", visible: () => true },
  {
    key: "prompt",
    label: "Prompt",
    tag: "inspector-prompt",
    visible: (nodeType) => nodeType === NODE_TYPES.AGENT
  },
  {
    key: "data",
    label: "Data",
    tag: "inspector-data",
    visible: (nodeType) => nodeType !== NODE_TYPES.NOTE
  },
  {
    key: "u2os-trigger",
    label: "Trigger",
    tag: "inspector-u2os-trigger",
    visible: (nodeType) => nodeType === NODE_TYPES.U2OS_TRIGGER
  },
  {
    key: "tools",
    label: "Tools",
    tag: "inspector-tools",
    visible: (nodeType) => nodeType === NODE_TYPES.AGENT
  },
  { key: "diagnostics", label: "Diagnostics", tag: "inspector-diagnostics", visible: () => true },
  {
    key: "activity",
    label: "Activity",
    tag: "inspector-activity",
    visible: (nodeType) => isExecutableNodeType(nodeType)
  },
  {
    key: "output",
    label: "Output",
    tag: "inspector-output",
    visible: (nodeType) => isExecutableNodeType(nodeType)
  },
  {
    key: "automation",
    label: "Automation",
    tag: "inspector-automation",
    visible: (nodeType) => nodeType === NODE_TYPES.AGENT
  },
  {
    key: "permissions",
    label: "Permissions",
    tag: "inspector-permissions",
    visible: (nodeType) => nodeType === NODE_TYPES.AGENT
  }
];

const tabTagByKey = Object.fromEntries(tabs.map((tab) => [tab.key, tab.tag]));
const edgeSchemaPresets = listSchemaPresets();

const normalizeTab = (value) => (tabTagByKey[value] ? value : "overview");
const isTabVisible = (tab, nodeType) => tab.visible(nodeType);
const getVisibleTabsForNodeType = (nodeType) => {
  if (!nodeType) return tabs;
  return tabs.filter((tab) => isTabVisible(tab, nodeType));
};
const resolveActiveTab = (tab, visibleTabs) => {
  const normalized = normalizeTab(tab);
  if (visibleTabs.some((entry) => entry.key === normalized)) return normalized;
  return visibleTabs[0]?.key ?? "overview";
};

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
    const sourceNode = graphStore.getNode(this.#selectedEdge.source);
    const targetNode = graphStore.getNode(this.#selectedEdge.target);
    const currentEdge = applyEdgeContractDefaults(this.#selectedEdge, sourceNode, targetNode);
    const endpoints = getEdgeContractEndpoints(currentEdge, sourceNode, targetNode);
    const sourceOutputs = endpoints.providerPorts;
    const targetInputs = endpoints.consumerPorts;
    const currentContract = currentEdge.metadata?.contract ?? {};

    const publishContract = (partial = {}) => {
      publish(EVENTS.GRAPH_EDGE_UPDATE_REQUESTED, {
        edgeId: this.#selectedEdgeId,
        patch: {
          metadata: {
            ...(currentEdge.metadata ?? {}),
            contract: {
              ...currentContract,
              ...partial
            }
          }
        },
        origin: "inspector-panel"
      });
    };

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

    this.querySelector('[data-field="edge-contract-source-port"]')?.addEventListener("change", (event) => {
      publishContract({ sourcePort: event.target.value || null });
    });

    this.querySelector('[data-field="edge-contract-target-port"]')?.addEventListener("change", (event) => {
      publishContract({ targetPort: event.target.value || null });
    });

    this.querySelector('[data-field="edge-contract-payload-type"]')?.addEventListener("change", (event) => {
      publishContract({ payloadType: event.target.value || "any" });
    });

    this.querySelector('[data-field="edge-contract-required"]')?.addEventListener("change", (event) => {
      publishContract({ required: Boolean(event.target.checked) });
    });

    this.querySelector('[data-field="edge-contract-schema"]')?.addEventListener("change", (event) => {
      let parsed = {};
      const raw = String(event.target.value ?? "").trim();
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = { raw };
        }
      }
      publishContract({ schema: parsed });
    });

    this.querySelector('[data-field="edge-contract-schema-preset"]')?.addEventListener("change", (event) => {
      const preset = getSchemaPreset(event.target.value);
      if (!preset) return;
      publishContract({ payloadType: preset.payloadType, schema: preset.schema });
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

  #bindNodeInspectorActions() {
    this.querySelector('[data-action="open-data-viewer"]')?.addEventListener("click", () => {
      if (!this.#selectedNodeId) return;
      const viewer = document.querySelector("node-data-viewer-dialog");
      if (!viewer || typeof viewer.openForNode !== "function") return;
      viewer.openForNode(this.#selectedNodeId);
    });
  }

  render() {
    if (this.#selectedEdge) {
      const edge = this.#selectedEdge;
      const sourceNode = graphStore.getNode(edge.source);
      const targetNode = graphStore.getNode(edge.target);
      const normalizedEdge = applyEdgeContractDefaults(edge, sourceNode, targetNode);
      const semantic = getEdgeTypeSpec(edge.type);
      const semanticValidation = validateEdgeSemantics(normalizedEdge, sourceNode, targetNode);
      const sourceLabel = escapeHtml(sourceNode?.label ?? edge.source ?? "(unknown)");
      const targetLabel = escapeHtml(targetNode?.label ?? edge.target ?? "(unknown)");
      const label = escapeHtml(String(edge.label ?? ""));
      const endpoints = getEdgeContractEndpoints(normalizedEdge, sourceNode, targetNode);
      const sourcePorts = endpoints.providerPorts;
      const targetPorts = endpoints.consumerPorts;
      const contract = normalizedEdge.metadata?.contract ?? {};
      const selectedPresetId = inferSchemaPresetId(contract) ?? "custom";
      const contractSchema = escapeHtml(
        contract.schema && typeof contract.schema === "object" ? JSON.stringify(contract.schema, null, 2) : ""
      );
      const schemaPresetOptions = edgeSchemaPresets
        .map(
          (preset) =>
            `<option value="${escapeHtml(preset.id)}" ${
              selectedPresetId === preset.id ? "selected" : ""
            }>${escapeHtml(preset.label)}</option>`
        )
        .join("");

      this.innerHTML = `
        <aside class="mg-panel mg-inspector-panel inspector-shell">
          <div class="inspector-header"><span>Connection Inspector</span></div>
          <div class="inspector-layout inspector-content">
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
              <h4>Payload Contract</h4>
              <label class="inspector-field">
                <span>Payload Source Port</span>
                <select data-field="edge-contract-source-port">
                  ${sourcePorts
                    .map(
                      (port) =>
                        `<option value="${escapeHtml(port.id)}" ${
                          String(contract.sourcePort ?? "") === String(port.id) ? "selected" : ""
                        }>${escapeHtml(port.label)} (${escapeHtml(port.payloadType)})</option>`
                    )
                    .join("")}
                </select>
              </label>
              <label class="inspector-field">
                <span>Payload Target Port</span>
                <select data-field="edge-contract-target-port">
                  ${targetPorts
                    .map(
                      (port) =>
                        `<option value="${escapeHtml(port.id)}" ${
                          String(contract.targetPort ?? "") === String(port.id) ? "selected" : ""
                        }>${escapeHtml(port.label)} (${escapeHtml(port.payloadType)})</option>`
                    )
                    .join("")}
                </select>
              </label>
              <label class="inspector-field">
                <span>Payload Type</span>
                <input type="text" data-field="edge-contract-payload-type" value="${escapeHtml(contract.payloadType ?? "any")}" />
              </label>
              <label class="inspector-field">
                <span>Schema Preset</span>
                <select data-field="edge-contract-schema-preset">
                  <option value="custom" ${selectedPresetId === "custom" ? "selected" : ""}>Custom / Manual</option>
                  ${schemaPresetOptions}
                </select>
              </label>
              <label class="inspector-field checkbox">
                <input type="checkbox" data-field="edge-contract-required" ${contract.required !== false ? "checked" : ""} />
                <span>Required for execution/data readiness</span>
              </label>
              <label class="inspector-field">
                <span>Contract Schema (JSON)</span>
                <textarea rows="4" data-field="edge-contract-schema">${contractSchema}</textarea>
              </label>
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
    const visibleTabs = getVisibleTabsForNodeType(node?.type);
    const activeTab = resolveActiveTab(this.#activeTab, visibleTabs);

    this.innerHTML = `
      <aside class="mg-panel mg-inspector-panel inspector-shell">
        <div class="inspector-header"><span>Node Inspector</span></div>
        <div class="inspector-layout inspector-content">
          <div class="inspector-summary">
            <p class="inspector-node-title">${selectedTitle}</p>
            <p class="inspector-node-meta">Type: ${selectedType}</p>
            <p class="inspector-node-meta">${escapeHtml(plannerMeta)}</p>
            ${
              nodePlan?.blockedReasons?.length
                ? `<p class="inspector-help">${escapeHtml(nodePlan.blockedReasons[0])}</p>`
                : ""
            }
            <div class="inspector-inline-row inspector-summary-actions">
              <button type="button" data-action="open-data-viewer" ${node ? "" : "disabled"}>View Data</button>
            </div>
          </div>
          <div class="inspector-tabs" role="tablist" aria-label="Inspector tabs">
            ${visibleTabs
              .map(
                (tab) => `<button type="button" role="tab" data-inspector-tab="${tab.key}" aria-selected="${
                  activeTab === tab.key
                }" aria-pressed="${activeTab === tab.key}">${tab.label}</button>`
              )
              .join("")}
          </div>
          <section class="inspector-tab-content" data-role="inspector-tab-content"></section>
        </div>
      </aside>
    `;

    this.#bindTabs();

    const activeTag = tabTagByKey[activeTab] ?? "inspector-overview";
    const contentEl = this.querySelector('[data-role="inspector-tab-content"]');
    if (contentEl == null) return;

    const tabEl = document.createElement(activeTag);
    tabEl.node = node;
    contentEl.append(tabEl);
    this.#bindNodeInspectorActions();
  }
}

customElements.define("inspector-panel", InspectorPanel);
