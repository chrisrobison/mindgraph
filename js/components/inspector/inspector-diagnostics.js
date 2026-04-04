import { EVENTS } from "../../core/event-constants.js";
import { publish } from "../../core/pan.js";
import { buildExecutionPlan } from "../../runtime/execution-planner.js";
import { graphStore } from "../../store/graph-store.js";
import { escapeHtml } from "./shared.js";

const toArray = (value) => (Array.isArray(value) ? value : []);

const splitList = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const toTitle = (value) =>
  String(value ?? "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\s+/g, " ")
    .trim();

const hasMaterializedOutput = (node) => {
  if (!node) return false;
  if (node.type === "data") return node.data?.cachedData != null;
  return node.data?.lastOutput != null;
};

const latestRunAt = (node) => {
  if (!node) return 0;
  const explicit = Date.parse(node.data?.lastRunAt ?? "");
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const historyAt = Date.parse(node.data?.runHistory?.[0]?.at ?? "");
  if (Number.isFinite(historyAt) && historyAt > 0) return historyAt;

  const updatedAt = Date.parse(node.data?.lastUpdated ?? "");
  if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt;

  return 0;
};

const nodeLabel = (nodeById, nodeId) => {
  const node = nodeById.get(nodeId);
  return String(node?.label ?? nodeId ?? "Unknown node");
};

const humanizeBlockedReason = (reason, nodeById) => {
  const text = String(reason ?? "").trim();
  const waitingPrefix = "Waiting for dependencies:";
  const payloadPrefix = "Missing input payloads from:";
  const fieldsPrefix = "Missing required fields:";
  const portsPrefix = "Missing required input ports:";

  if (text === "Node is in an execution cycle") {
    return {
      title: "Execution loop detected",
      detail: "This node is part of a cycle. Break the loop before running.",
      relatedNodeIds: []
    };
  }

  if (text.startsWith(waitingPrefix)) {
    const ids = splitList(text.slice(waitingPrefix.length));
    const labels = ids.map((nodeId) => nodeLabel(nodeById, nodeId));
    return {
      title: "Waiting on upstream runs",
      detail: `Run ${labels.join(", ")} before this node can execute.`,
      relatedNodeIds: ids
    };
  }

  if (text.startsWith(payloadPrefix)) {
    const ids = splitList(text.slice(payloadPrefix.length));
    const labels = ids.map((nodeId) => nodeLabel(nodeById, nodeId));
    return {
      title: "Input payloads not ready",
      detail: `Expected input data from ${labels.join(", ")} is not available yet.`,
      relatedNodeIds: ids
    };
  }

  if (text.startsWith(fieldsPrefix)) {
    const fields = splitList(text.slice(fieldsPrefix.length));
    return {
      title: "Configuration is incomplete",
      detail: `Fill required fields: ${fields.map(toTitle).join(", ")}.`,
      relatedNodeIds: []
    };
  }

  if (text.startsWith(portsPrefix)) {
    const ports = splitList(text.slice(portsPrefix.length));
    return {
      title: "Required ports are not connected",
      detail: `Connect input ports: ${ports.map(toTitle).join(", ")}.`,
      relatedNodeIds: []
    };
  }

  const minSourcesMatch = text.match(/^Requires at least\s+(\d+)\s+input source\(s\)$/);
  if (minSourcesMatch) {
    return {
      title: "More input sources needed",
      detail: `This node needs at least ${minSourcesMatch[1]} connected input source(s).`,
      relatedNodeIds: []
    };
  }

  return {
    title: "Planner blocked this node",
    detail: text || "Planner reported a blocking condition.",
    relatedNodeIds: []
  };
};

const findRelevantEdgeId = (edges, sourceNodeId, targetNodeId) => {
  if (!sourceNodeId || !targetNodeId) return null;
  const direct = edges.find((edge) => edge.source === sourceNodeId && edge.target === targetNodeId);
  if (direct?.id) return direct.id;

  const reverse = edges.find((edge) => edge.source === targetNodeId && edge.target === sourceNodeId);
  return reverse?.id ?? null;
};

const renderNodeActions = (nodeIds, currentNodeId, edges, nodeById) => {
  const uniqueNodeIds = [...new Set(toArray(nodeIds).filter(Boolean))];
  if (!uniqueNodeIds.length) return "";

  return `
    <div class="inspector-diagnostics-actions">
      ${uniqueNodeIds
        .map((nodeId) => {
          const edgeId = findRelevantEdgeId(edges, nodeId, currentNodeId);
          const label = escapeHtml(nodeLabel(nodeById, nodeId));
          return `
            <div class="inspector-diagnostics-action-row">
              <button type="button" data-action="focus-node" data-node-id="${escapeHtml(nodeId)}">Select ${label}</button>
              ${
                edgeId
                  ? `<button type="button" data-action="focus-edge" data-edge-id="${escapeHtml(edgeId)}">Inspect edge</button>`
                  : ""
              }
            </div>
          `;
        })
        .join("")}
    </div>
  `;
};

class InspectorDiagnostics extends HTMLElement {
  #node = null;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #bindActions() {
    this.querySelectorAll('[data-action="focus-node"]').forEach((button) => {
      button.addEventListener("click", () => {
        const nodeId = button.dataset.nodeId;
        if (!nodeId) return;
        publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
          nodeId,
          additive: false,
          toggle: false,
          origin: "inspector-diagnostics"
        });
      });
    });

    this.querySelectorAll('[data-action="focus-edge"]').forEach((button) => {
      button.addEventListener("click", () => {
        const edgeId = button.dataset.edgeId;
        if (!edgeId) return;
        publish(EVENTS.GRAPH_EDGE_SELECT_REQUESTED, {
          edgeId,
          origin: "inspector-diagnostics"
        });
      });
    });
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to view planner diagnostics.</p>';
      return;
    }

    const document = graphStore.getDocument();
    const plan = buildExecutionPlan(document);
    const nodePlan = plan.nodes?.[node.id] ?? null;

    if (!nodePlan) {
      this.innerHTML = '<p class="inspector-empty">Planner diagnostics are unavailable for this node.</p>';
      return;
    }

    const nodes = toArray(document?.nodes);
    const edges = toArray(document?.edges);
    const nodeById = new Map(nodes.map((entry) => [entry.id, entry]));

    const blockedReasons = toArray(nodePlan.blockedReasons).map((reason) => humanizeBlockedReason(reason, nodeById));
    const missingPorts = toArray(nodePlan.missingRequiredPorts);
    const upstreamDependencies = toArray(nodePlan.upstreamDependencies);
    const staleDependencies = toArray(nodePlan.staleDependencies);
    const dataProviderIds = toArray(nodePlan.dataProviderIds);

    const statusLabel = !nodePlan.runnable
      ? "Reference"
      : nodePlan.ready
        ? "Runnable"
        : "Blocked";
    const statusToneClass = !nodePlan.runnable
      ? "is-info"
      : nodePlan.ready
        ? "is-good"
        : "is-warn";
    const statusSummary = !nodePlan.runnable
      ? "This node type is reference-only and does not execute."
      : nodePlan.ready
        ? "All dependencies and required inputs are satisfied."
        : `${blockedReasons.length} planner blocker(s) currently prevent execution.`;
    const executionOrderText =
      nodePlan.runnable && Number.isInteger(nodePlan.executionOrderIndex) && nodePlan.executionOrderIndex >= 0
        ? `Step ${nodePlan.executionOrderIndex + 1} of ${plan.executionOrder.length}`
        : "Not part of runnable execution order";

    const dependencyRows = upstreamDependencies.length
      ? upstreamDependencies
          .map((depId) => {
            const depNode = nodeById.get(depId);
            const depPlan = plan.nodes?.[depId];
            const hasOutput = hasMaterializedOutput(depNode);
            const isStale = staleDependencies.includes(depId);
            const freshness = !hasOutput
              ? "No output yet"
              : isStale
                ? "Newer output detected"
                : "Output available";
            const orderHint =
              depPlan?.executionOrderIndex >= 0
                ? `Planner step ${depPlan.executionOrderIndex + 1}`
                : "No execution index";

            return `
              <li class="inspector-diagnostics-item">
                <div>
                  <p class="inspector-diagnostics-item-title">${escapeHtml(nodeLabel(nodeById, depId))}</p>
                  <p class="inspector-diagnostics-item-meta">${escapeHtml(freshness)} • ${escapeHtml(orderHint)}</p>
                </div>
                ${renderNodeActions([depId], node.id, edges, nodeById)}
              </li>
            `;
          })
          .join("")
      : '<p class="inspector-help">No upstream execution dependencies.</p>';

    const providerRows = dataProviderIds.length
      ? dataProviderIds
          .map((providerId) => {
            const providerNode = nodeById.get(providerId);
            const hasPayload = hasMaterializedOutput(providerNode);
            return `
              <li class="inspector-diagnostics-item">
                <div>
                  <p class="inspector-diagnostics-item-title">${escapeHtml(nodeLabel(nodeById, providerId))}</p>
                  <p class="inspector-diagnostics-item-meta">${hasPayload ? "Payload available" : "Payload missing"}</p>
                </div>
                ${renderNodeActions([providerId], node.id, edges, nodeById)}
              </li>
            `;
          })
          .join("")
      : '<p class="inspector-help">No explicit data providers are connected.</p>';

    const staleRows = staleDependencies.length
      ? staleDependencies
          .map((depId) => {
            const depNode = nodeById.get(depId);
            const depRunAt = latestRunAt(depNode);
            const atText = depRunAt > 0 ? new Date(depRunAt).toLocaleString() : "unknown time";
            return `
              <li class="inspector-diagnostics-item">
                <div>
                  <p class="inspector-diagnostics-item-title">${escapeHtml(nodeLabel(nodeById, depId))}</p>
                  <p class="inspector-diagnostics-item-meta">Updated ${escapeHtml(atText)} after this node last ran.</p>
                </div>
                ${renderNodeActions([depId], node.id, edges, nodeById)}
              </li>
            `;
          })
          .join("")
      : '<p class="inspector-help">Inputs are not stale relative to this node.</p>';

    this.innerHTML = `
      <section class="inspector-group">
        <h4>Runnability</h4>
        <div class="inspector-diagnostics-status ${statusToneClass}">
          <p class="inspector-diagnostics-status-label">${escapeHtml(statusLabel)}</p>
          <p class="inspector-diagnostics-status-summary">${escapeHtml(statusSummary)}</p>
          <p class="inspector-diagnostics-status-meta">Execution order: ${escapeHtml(executionOrderText)}</p>
        </div>
      </section>

      <section class="inspector-group">
        <h4>Blocked Reasons</h4>
        ${
          blockedReasons.length
            ? `<ul class="inspector-diagnostics-list">
                ${blockedReasons
                  .map(
                    (reason) => `
                      <li class="inspector-diagnostics-reason">
                        <p class="inspector-diagnostics-item-title">${escapeHtml(reason.title)}</p>
                        <p class="inspector-diagnostics-item-meta">${escapeHtml(reason.detail)}</p>
                        ${renderNodeActions(reason.relatedNodeIds, node.id, edges, nodeById)}
                      </li>
                    `
                  )
                  .join("")}
              </ul>`
            : '<p class="inspector-help">No blocking reasons from the planner.</p>'
        }
      </section>

      <section class="inspector-group">
        <h4>Missing Required Ports</h4>
        ${
          missingPorts.length
            ? `<ul class="inspector-diagnostics-chips">${missingPorts
                .map((portId) => `<li>${escapeHtml(toTitle(portId))}</li>`)
                .join("")}</ul>
               <p class="inspector-help">Connect each required port to make this node runnable.</p>`
            : '<p class="inspector-help">All required input ports are connected.</p>'
        }
      </section>

      <section class="inspector-group">
        <h4>Upstream Dependencies</h4>
        ${
          upstreamDependencies.length
            ? `<ul class="inspector-diagnostics-list">${dependencyRows}</ul>`
            : dependencyRows
        }
      </section>

      <section class="inspector-group">
        <h4>Input Providers</h4>
        ${
          dataProviderIds.length
            ? `<ul class="inspector-diagnostics-list">${providerRows}</ul>`
            : providerRows
        }
      </section>

      <section class="inspector-group">
        <h4>Stale Inputs / Rerun Hints</h4>
        <p class="inspector-help">
          ${
            nodePlan.needsRerun
              ? "This node has newer upstream inputs and likely needs a rerun."
              : "No rerun hint from planner."
          }
        </p>
        ${
          staleDependencies.length
            ? `<ul class="inspector-diagnostics-list">${staleRows}</ul>`
            : staleRows
        }
      </section>
    `;

    this.#bindActions();
  }
}

customElements.define("inspector-diagnostics", InspectorDiagnostics);
