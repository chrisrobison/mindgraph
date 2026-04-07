// @ts-check

import {
  getEdgeContractEndpoints,
  getNodePorts,
  edgeAffectsExecution,
  edgeAffectsDataFlow,
  edgeDefinesHierarchy,
  getNodeTypeSpec,
  isExecutableNodeType,
  SEMANTIC_EDGE_GROUPS
} from "../core/graph-semantics.js";

/** @typedef {import("../core/jsdoc-types.js").GraphDocument} GraphDocument */
/** @typedef {import("../core/jsdoc-types.js").GraphNode} GraphNode */
/** @typedef {import("../core/jsdoc-types.js").ExecutionPlan} ExecutionPlan */

const toArray = (value) => (Array.isArray(value) ? value : []);

/**
 * @param {GraphNode | null | undefined} node
 * @returns {number}
 */
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

/**
 * @param {GraphNode | null | undefined} node
 * @returns {boolean}
 */
const hasMaterializedOutput = (node) => {
  if (!node) return false;
  if (node.type === "data") return node.data?.cachedData != null;
  return node.data?.lastOutput != null;
};

/**
 * @param {{ type?: string, source?: string, target?: string }[]} edges
 * @param {string | null | undefined} rootNodeId
 * @returns {Set<string> | null}
 */
const buildHierarchyScope = (edges, rootNodeId) => {
  if (!rootNodeId) return null;

  const scope = new Set();
  const queue = [rootNodeId];

  while (queue.length) {
    const current = queue.shift();
    if (!current || scope.has(current)) continue;
    scope.add(current);

    for (const edge of edges) {
      if (!edgeDefinesHierarchy(edge.type)) continue;
      if (edge.source !== current) continue;
      queue.push(edge.target);
    }
  }

  return scope;
};

/**
 * @param {string[]} nodeIds
 * @param {Map<string, string[]>} incomingByNode
 * @returns {string[][]}
 */
const detectCycles = (nodeIds, incomingByNode) => {
  const inScope = new Set(nodeIds);
  const state = new Map();
  const stack = [];
  const cycles = [];

  const visit = (nodeId) => {
    state.set(nodeId, "visiting");
    stack.push(nodeId);

    const upstream = incomingByNode.get(nodeId) ?? [];
    for (const depId of upstream) {
      if (!inScope.has(depId)) continue;
      const depState = state.get(depId);
      if (depState === "visiting") {
        const start = stack.indexOf(depId);
        const path = [...stack.slice(start), depId];
        const signature = path.join("->");
        if (!cycles.some((entry) => entry.signature === signature)) {
          cycles.push({ signature, path });
        }
        continue;
      }
      if (depState === "visited") continue;
      visit(depId);
    }

    stack.pop();
    state.set(nodeId, "visited");
  };

  nodeIds.forEach((nodeId) => {
    if (!state.has(nodeId)) visit(nodeId);
  });

  return cycles.map(({ path }) => path);
};

/**
 * @param {string[]} nodeIds
 * @param {Map<string, string[]>} incomingByNode
 * @param {Map<string, string[]>} outgoingByNode
 * @returns {string[]}
 */
const buildTopologicalOrder = (nodeIds, incomingByNode, outgoingByNode) => {
  const inScope = new Set(nodeIds);
  const indegree = new Map(nodeIds.map((id) => [id, 0]));

  nodeIds.forEach((nodeId) => {
    const upstream = incomingByNode.get(nodeId) ?? [];
    const count = upstream.filter((dep) => inScope.has(dep)).length;
    indegree.set(nodeId, count);
  });

  const queue = nodeIds.filter((nodeId) => (indegree.get(nodeId) ?? 0) === 0);
  const order = [];

  while (queue.length) {
    const current = queue.shift();
    order.push(current);

    const downstream = outgoingByNode.get(current) ?? [];
    downstream.forEach((targetId) => {
      if (!inScope.has(targetId)) return;
      const next = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, next);
      if (next === 0) queue.push(targetId);
    });
  }

  const leftovers = nodeIds.filter((nodeId) => !order.includes(nodeId));
  return [...order, ...leftovers];
};

/**
 * @param {Partial<ExecutionPlan>} [plan]
 */
export const buildRunnableDependencyGraph = (plan = {}) => {
  const runnableNodeIds = toArray(plan?.executionOrder).filter((nodeId) => Boolean(plan?.nodes?.[nodeId]?.runnable));
  const runnableSet = new Set(runnableNodeIds);
  const orderIndexByNode = new Map(runnableNodeIds.map((nodeId, index) => [nodeId, index]));
  const upstreamByNode = new Map();
  const downstreamByNode = new Map(runnableNodeIds.map((nodeId) => [nodeId, []]));

  runnableNodeIds.forEach((nodeId) => {
    const upstream = [...new Set(toArray(plan?.nodes?.[nodeId]?.upstreamDependencies).filter((depId) => runnableSet.has(depId)))];
    upstreamByNode.set(nodeId, upstream);
    upstream.forEach((depId) => {
      if (!downstreamByNode.has(depId)) return;
      downstreamByNode.get(depId).push(nodeId);
    });
  });

  downstreamByNode.forEach((targets, depId) => {
    targets.sort((a, b) => (orderIndexByNode.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIndexByNode.get(b) ?? Number.MAX_SAFE_INTEGER));
    downstreamByNode.set(depId, [...new Set(targets)]);
  });

  return {
    runnableNodeIds,
    orderIndexByNode,
    upstreamByNode,
    downstreamByNode
  };
};

/**
 * @param {GraphDocument | null | undefined} document
 * @param {{ rootNodeId?: string | null }} [options]
 * @returns {ExecutionPlan}
 */
export const buildExecutionPlan = (document, options = {}) => {
  const nodes = toArray(document?.nodes);
  const edges = toArray(document?.edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootNodeId = options.rootNodeId ?? null;
  const scopeSet = buildHierarchyScope(edges, rootNodeId);
  const nodeIdsInScope = (scopeSet ? [...scopeSet] : nodes.map((node) => node.id)).filter((id) => nodeById.has(id));

  const incomingExecution = new Map();
  const outgoingExecution = new Map();
  const dataProviders = new Map();
  const dataConsumers = new Map();
  const incomingDataEdges = new Map();

  nodeIdsInScope.forEach((nodeId) => {
    incomingExecution.set(nodeId, []);
    outgoingExecution.set(nodeId, []);
    dataProviders.set(nodeId, []);
    dataConsumers.set(nodeId, []);
    incomingDataEdges.set(nodeId, []);
  });

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    if (scopeSet && (!scopeSet.has(edge.source) || !scopeSet.has(edge.target))) continue;

    if (edgeAffectsExecution(edge.type) && incomingExecution.has(edge.target) && outgoingExecution.has(edge.source)) {
      incomingExecution.get(edge.target).push(edge.source);
      outgoingExecution.get(edge.source).push(edge.target);
    }

    if (!edgeAffectsDataFlow(edge.type)) continue;

    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const endpoints = getEdgeContractEndpoints(edge, sourceNode, targetNode);
    const contract = edge.metadata?.contract ?? {};
    const inputOwnerId = endpoints.consumerNode?.id ?? null;
    const providerId = endpoints.providerNode?.id ?? null;

    if (edge.type === "reads_from") {
      if (dataProviders.has(edge.source)) dataProviders.get(edge.source).push(edge.target);
      if (dataConsumers.has(edge.target)) dataConsumers.get(edge.target).push(edge.source);
      if (inputOwnerId && incomingDataEdges.has(inputOwnerId)) {
        incomingDataEdges.get(inputOwnerId).push({
          edgeId: edge.id,
          contract,
          providerId
        });
      }
      continue;
    }

    if (dataProviders.has(edge.target)) dataProviders.get(edge.target).push(edge.source);
    if (dataConsumers.has(edge.source)) dataConsumers.get(edge.source).push(edge.target);
    if (inputOwnerId && incomingDataEdges.has(inputOwnerId)) {
      incomingDataEdges.get(inputOwnerId).push({
        edgeId: edge.id,
        contract,
        providerId
      });
    }
  }

  const runnableNodeIds = nodeIdsInScope.filter((nodeId) => isExecutableNodeType(nodeById.get(nodeId)?.type));
  const cycles = detectCycles(runnableNodeIds, incomingExecution);
  const cycleSet = new Set(cycles.flat());
  const executionOrder = buildTopologicalOrder(runnableNodeIds, incomingExecution, outgoingExecution);

  const nodesPlan = {};
  const readyNodeIds = [];
  const blockedNodeIds = [];

  nodeIdsInScope.forEach((nodeId) => {
    const node = nodeById.get(nodeId);
    const spec = getNodeTypeSpec(node.type);
    const runnable = isExecutableNodeType(node.type);
    const upstreamDependencies = toArray(incomingExecution.get(nodeId));
    const providerIds = [...new Set(toArray(dataProviders.get(nodeId)).concat(toArray(node.data?.allowedDataSources)))].filter((id) => nodeById.has(id));
    const requiredInputPorts = getNodePorts(node, "input").filter((port) => port.required !== false);
    const connectedInputPorts = new Set(
      toArray(incomingDataEdges.get(nodeId)).map((entry) => entry?.contract?.targetPort).filter(Boolean)
    );

    const missingDependencyRuns = upstreamDependencies.filter((depId) => {
      const depNode = nodeById.get(depId);
      if (!depNode) return true;
      return !hasMaterializedOutput(depNode);
    });

    const missingProviderOutputs = providerIds.filter((providerId) => {
      const providerNode = nodeById.get(providerId);
      if (!providerNode) return true;
      return !hasMaterializedOutput(providerNode);
    });

    const staleDependencies = upstreamDependencies.filter((depId) => {
      const upstreamNode = nodeById.get(depId);
      if (!upstreamNode) return false;
      return latestRunAt(upstreamNode) > latestRunAt(node);
    });

    const contractMissingFields = (spec.requiredDataKeys ?? []).filter((key) => node.data?.[key] == null || node.data?.[key] === "");
    const missingRequiredPorts = requiredInputPorts
      .filter((port) => !connectedInputPorts.has(port.id))
      .map((port) => port.id);

    const blockedReasons = [];

    if (runnable && cycleSet.has(nodeId)) blockedReasons.push("Node is in an execution cycle");
    if (runnable && missingDependencyRuns.length) {
      blockedReasons.push(`Waiting for dependencies: ${missingDependencyRuns.join(", ")}`);
    }
    if (runnable && providerIds.length < (spec.requiredInputSources ?? 0)) {
      blockedReasons.push(`Requires at least ${spec.requiredInputSources} input source(s)`);
    }
    if (runnable && missingProviderOutputs.length) {
      blockedReasons.push(`Missing input payloads from: ${missingProviderOutputs.join(", ")}`);
    }
    if (runnable && contractMissingFields.length) {
      blockedReasons.push(`Missing required fields: ${contractMissingFields.join(", ")}`);
    }
    if (runnable && missingRequiredPorts.length) {
      blockedReasons.push(`Missing required input ports: ${missingRequiredPorts.join(", ")}`);
    }

    const ready = runnable && blockedReasons.length === 0;
    if (ready) readyNodeIds.push(nodeId);
    if (runnable && !ready) blockedNodeIds.push(nodeId);

    nodesPlan[nodeId] = {
      nodeId,
      type: node.type,
      role: spec.role,
      runnable,
      ready,
      blocked: runnable && !ready,
      blockedReasons,
      contractMissingFields,
      missingRequiredPorts,
      upstreamDependencies,
      dataProviderIds: providerIds,
      staleDependencies,
      needsRerun: staleDependencies.length > 0,
      isInCycle: cycleSet.has(nodeId),
      executionOrderIndex: executionOrder.indexOf(nodeId)
    };
  });

  return {
    rootNodeId,
    scopeNodeIds: nodeIdsInScope,
    runnableNodeIds,
    readyNodeIds,
    blockedNodeIds,
    cycles,
    executionOrder,
    nodes: nodesPlan,
    edgeGroups: SEMANTIC_EDGE_GROUPS
  };
};

/**
 * @param {GraphDocument | null | undefined} document
 * @param {string} nodeId
 * @param {{ rootNodeId?: string | null }} [options]
 */
export const getNodePlan = (document, nodeId, options = {}) => buildExecutionPlan(document, options).nodes?.[nodeId] ?? null;
