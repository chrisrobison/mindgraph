// @ts-check

/** @typedef {import("../core/jsdoc-types.js").ExecutionPlan} ExecutionPlan */

export const clampInt = (value, fallback, min = 1, max = 6) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};

export const clampNum = (value, fallback, min = 0, max = Number.POSITIVE_INFINITY) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const toArray = (value) => (Array.isArray(value) ? value : []);
export const unique = (value) => [...new Set(toArray(value).filter(Boolean))];

export const defaultPolicy = Object.freeze({
  maxAttempts: 2,
  retryBackoffMs: 350,
  retryBackoffFactor: 1.7,
  failFast: false
});

export const defaultBatchConcurrencyLimit = 2;

export const isNonRetryable = (result) => {
  const outputType = result?.output?.type ?? "";
  const message = String(result?.error ?? "").toLowerCase();
  if (result?.status === "cancelled") return true;
  if (outputType === "validation_error" || outputType === "planner_blocked") return true;
  if (result?.blockedReasons?.length) return true;
  if (message.includes("validation") || message.includes("planner")) return true;
  return false;
};

export const snapshotNodePlan = (nodePlan = {}) => ({
  nodeId: nodePlan.nodeId ?? null,
  runnable: Boolean(nodePlan.runnable),
  ready: Boolean(nodePlan.ready),
  blocked: Boolean(nodePlan.blocked),
  blockedReasons: unique(nodePlan.blockedReasons),
  missingRequiredPorts: unique(nodePlan.missingRequiredPorts),
  upstreamDependencies: unique(nodePlan.upstreamDependencies),
  dataProviderIds: unique(nodePlan.dataProviderIds),
  staleDependencies: unique(nodePlan.staleDependencies),
  needsRerun: Boolean(nodePlan.needsRerun),
  executionOrderIndex: Number.isInteger(nodePlan.executionOrderIndex) ? nodePlan.executionOrderIndex : -1
});

/**
 * @param {ExecutionPlan} plan
 * @param {{ at: string, mode: string }} param1
 */
export const buildPlannerSnapshotTrace = (plan, { at, mode }) => {
  const snapshotId = `planner_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const nodeEntries = Object.entries(plan?.nodes ?? {}).map(([nodeId, nodePlan]) => [
    nodeId,
    snapshotNodePlan({ ...(nodePlan ?? {}), nodeId })
  ]);

  return {
    kind: "planner_snapshot",
    snapshotId,
    at,
    mode,
    rootNodeId: plan?.rootNodeId ?? null,
    executionOrder: [...(plan?.executionOrder ?? [])],
    readyNodeIds: [...(plan?.readyNodeIds ?? [])],
    blockedNodeIds: [...(plan?.blockedNodeIds ?? [])],
    cycles: [...(plan?.cycles ?? [])],
    nodes: Object.fromEntries(nodeEntries)
  };
};
