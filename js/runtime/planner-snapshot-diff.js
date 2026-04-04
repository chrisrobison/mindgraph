const toArray = (value) => (Array.isArray(value) ? value : []);

const toUniqueList = (value) => {
  const out = [];
  const seen = new Set();
  toArray(value).forEach((entry) => {
    const id = String(entry ?? "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
};

const emptyNode = (nodeId) => ({
  nodeId,
  runnable: false,
  ready: false,
  blocked: false,
  blockedReasons: [],
  upstreamDependencies: [],
  dataProviderIds: [],
  missingRequiredPorts: [],
  staleDependencies: [],
  needsRerun: false,
  executionOrderIndex: -1
});

const normalizeNodePlan = (nodeId, rawNode, fallbackOrderIndex = -1) => {
  const blockedReasons = toUniqueList(rawNode?.blockedReasons);
  const upstreamDependencies = toUniqueList(rawNode?.upstreamDependencies);
  const dataProviderIds = toUniqueList(rawNode?.dataProviderIds);
  const missingRequiredPorts = toUniqueList(rawNode?.missingRequiredPorts);
  const staleDependencies = toUniqueList(rawNode?.staleDependencies);

  const orderIndex = Number(rawNode?.executionOrderIndex);
  const executionOrderIndex = Number.isInteger(orderIndex) ? orderIndex : fallbackOrderIndex;

  const ready = Boolean(rawNode?.ready);
  const blocked = Boolean(rawNode?.blocked) || (!ready && blockedReasons.length > 0);
  const runnable =
    rawNode?.runnable == null
      ? ready || blocked || executionOrderIndex >= 0
      : Boolean(rawNode.runnable);

  return {
    nodeId,
    runnable,
    ready,
    blocked,
    blockedReasons,
    upstreamDependencies,
    dataProviderIds,
    missingRequiredPorts,
    staleDependencies,
    needsRerun: Boolean(rawNode?.needsRerun) || staleDependencies.length > 0,
    executionOrderIndex
  };
};

export const normalizePlannerSnapshot = (snapshot, fallbackId = "planner_snapshot") => {
  // Backward compatibility: older snapshots may only include summary arrays.
  const executionOrder = toUniqueList(snapshot?.executionOrder);
  const readyNodeIds = toUniqueList(snapshot?.readyNodeIds);
  const blockedNodeIds = toUniqueList(snapshot?.blockedNodeIds);

  const nodePlans = {};
  const rawNodes = snapshot?.nodes && typeof snapshot.nodes === "object" ? snapshot.nodes : {};

  Object.entries(rawNodes).forEach(([key, value]) => {
    const nodeId = String(value?.nodeId ?? key ?? "").trim();
    if (!nodeId) return;
    const orderIndex = executionOrder.indexOf(nodeId);
    nodePlans[nodeId] = normalizeNodePlan(nodeId, value, orderIndex);
  });

  [...executionOrder, ...readyNodeIds, ...blockedNodeIds].forEach((nodeId) => {
    if (!nodeId) return;
    if (!nodePlans[nodeId]) {
      nodePlans[nodeId] = normalizeNodePlan(nodeId, {}, executionOrder.indexOf(nodeId));
    }
  });

  const readySet = new Set(readyNodeIds);
  const blockedSet = new Set(blockedNodeIds);

  Object.values(nodePlans).forEach((node) => {
    if (node.ready) readySet.add(node.nodeId);
    if (node.blocked) blockedSet.add(node.nodeId);
  });

  Object.values(nodePlans).forEach((node) => {
    const fromOrder = executionOrder.indexOf(node.nodeId);
    const executionOrderIndex = node.executionOrderIndex >= 0 ? node.executionOrderIndex : fromOrder;
    const ready = readySet.has(node.nodeId) || node.ready;
    const blocked = blockedSet.has(node.nodeId) || node.blocked;
    const runnable = node.runnable || ready || blocked || executionOrderIndex >= 0;

    node.executionOrderIndex = executionOrderIndex;
    node.ready = ready;
    node.blocked = blocked;
    node.runnable = runnable;
  });

  const normalizedReady = Object.values(nodePlans)
    .filter((node) => node.ready)
    .map((node) => node.nodeId);
  const normalizedBlocked = Object.values(nodePlans)
    .filter((node) => node.blocked)
    .map((node) => node.nodeId);

  return {
    kind: "planner_snapshot",
    snapshotId: String(snapshot?.snapshotId ?? fallbackId),
    at: snapshot?.at ?? null,
    mode: snapshot?.mode ?? "unknown",
    rootNodeId: snapshot?.rootNodeId ?? null,
    executionOrder,
    readyNodeIds: toUniqueList(normalizedReady),
    blockedNodeIds: toUniqueList(normalizedBlocked),
    cycles: toArray(snapshot?.cycles).map((path) => toUniqueList(path)),
    nodes: nodePlans
  };
};

const listDelta = (before = [], after = []) => {
  const beforeList = toUniqueList(before);
  const afterList = toUniqueList(after);
  const beforeSet = new Set(beforeList);
  const afterSet = new Set(afterList);

  const added = afterList.filter((entry) => !beforeSet.has(entry));
  const removed = beforeList.filter((entry) => !afterSet.has(entry));

  return {
    before: beforeList,
    after: afterList,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0
  };
};

const statusOfNode = (nodePlan) => {
  if (!nodePlan?.runnable) return "reference";
  if (nodePlan.ready) return "ready";
  if (nodePlan.blocked) return "blocked";
  return "runnable";
};

export const diffPlannerSnapshots = (beforeSnapshot, afterSnapshot) => {
  const before = normalizePlannerSnapshot(beforeSnapshot, "before");
  const after = normalizePlannerSnapshot(afterSnapshot, "after");

  const nodeIds = toUniqueList([...Object.keys(before.nodes), ...Object.keys(after.nodes)]);
  const nodeChanges = [];

  const summary = {
    changedNodeCount: 0,
    statusChangedCount: 0,
    newlyBlockedCount: 0,
    newlyReadyCount: 0,
    blockedReasonChangedCount: 0,
    dependencyChangedCount: 0,
    executionOrderChangedCount: 0,
    staleChangedCount: 0
  };

  nodeIds.forEach((nodeId) => {
    const beforeNode = before.nodes[nodeId] ?? emptyNode(nodeId);
    const afterNode = after.nodes[nodeId] ?? emptyNode(nodeId);

    const statusBefore = statusOfNode(beforeNode);
    const statusAfter = statusOfNode(afterNode);
    const statusChanged = statusBefore !== statusAfter;
    const newlyBlocked = !beforeNode.blocked && afterNode.blocked;
    const newlyReady = !beforeNode.ready && afterNode.ready;

    const blockedReasons = listDelta(beforeNode.blockedReasons, afterNode.blockedReasons);
    const upstreamDependencies = listDelta(beforeNode.upstreamDependencies, afterNode.upstreamDependencies);
    const missingRequiredPorts = listDelta(beforeNode.missingRequiredPorts, afterNode.missingRequiredPorts);
    const staleDependencies = listDelta(beforeNode.staleDependencies, afterNode.staleDependencies);

    const executionOrderBefore = Number.isInteger(beforeNode.executionOrderIndex)
      ? beforeNode.executionOrderIndex
      : -1;
    const executionOrderAfter = Number.isInteger(afterNode.executionOrderIndex)
      ? afterNode.executionOrderIndex
      : -1;
    const executionOrderChanged = executionOrderBefore !== executionOrderAfter;

    const staleChanged =
      Boolean(beforeNode.needsRerun) !== Boolean(afterNode.needsRerun) || staleDependencies.changed;

    const changed =
      statusChanged ||
      blockedReasons.changed ||
      upstreamDependencies.changed ||
      missingRequiredPorts.changed ||
      executionOrderChanged ||
      staleChanged;

    if (!changed) return;

    summary.changedNodeCount += 1;
    if (statusChanged) summary.statusChangedCount += 1;
    if (newlyBlocked) summary.newlyBlockedCount += 1;
    if (newlyReady) summary.newlyReadyCount += 1;
    if (blockedReasons.changed) summary.blockedReasonChangedCount += 1;
    if (upstreamDependencies.changed || missingRequiredPorts.changed) summary.dependencyChangedCount += 1;
    if (executionOrderChanged) summary.executionOrderChangedCount += 1;
    if (staleChanged) summary.staleChangedCount += 1;

    nodeChanges.push({
      nodeId,
      statusBefore,
      statusAfter,
      statusChanged,
      newlyBlocked,
      newlyReady,
      blockedReasons,
      upstreamDependencies,
      missingRequiredPorts,
      executionOrder: {
        before: executionOrderBefore,
        after: executionOrderAfter,
        changed: executionOrderChanged
      },
      stale: {
        beforeNeedsRerun: Boolean(beforeNode.needsRerun),
        afterNeedsRerun: Boolean(afterNode.needsRerun),
        dependencies: staleDependencies,
        changed: staleChanged
      }
    });
  });

  nodeChanges.sort((a, b) => {
    if (a.newlyBlocked !== b.newlyBlocked) return a.newlyBlocked ? -1 : 1;
    if (a.statusChanged !== b.statusChanged) return a.statusChanged ? -1 : 1;
    if (a.executionOrder.changed !== b.executionOrder.changed) return a.executionOrder.changed ? -1 : 1;
    return a.nodeId.localeCompare(b.nodeId);
  });

  return {
    before,
    after,
    summary,
    nodeChanges
  };
};

export const plannerStatusLabel = (status) => {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  if (status === "runnable") return "Runnable";
  return "Reference";
};
