import { buildRunnableDependencyGraph } from "./execution-planner.js";

const asArray = (value) => (Array.isArray(value) ? value : []);
const asErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

export const resolveBatchConcurrencyLimit = (value, fallback = 2, min = 1, max = 8) => {
  const fallbackLimit = Number.isFinite(Number(fallback)) ? Math.round(Number(fallback)) : 2;
  const n = Number(value);
  if (!Number.isFinite(n)) return Math.max(min, Math.min(max, fallbackLimit));
  return Math.max(min, Math.min(max, Math.round(n)));
};

const sortByPlanOrder = (nodeIds, orderIndexByNode) =>
  [...new Set(asArray(nodeIds))].sort(
    (a, b) => (orderIndexByNode.get(a) ?? Number.MAX_SAFE_INTEGER) - (orderIndexByNode.get(b) ?? Number.MAX_SAFE_INTEGER)
  );

const removeQueuedNode = (queue, nodeId) => {
  const index = queue.indexOf(nodeId);
  if (index >= 0) queue.splice(index, 1);
};

export const runPlanWithBranchParallelism = async (plan, options = {}) => {
  const graph = buildRunnableDependencyGraph(plan);
  const runnableNodeIds = graph.runnableNodeIds;
  const orderIndexByNode = graph.orderIndexByNode;
  const upstreamByNode = graph.upstreamByNode;
  const downstreamByNode = graph.downstreamByNode;
  const concurrencyLimit = resolveBatchConcurrencyLimit(options?.concurrencyLimit, 2);
  const runNode = typeof options?.runNode === "function" ? options.runNode : async () => ({ ok: false, error: "runNode is not configured" });
  const shouldCancel = typeof options?.shouldCancel === "function" ? options.shouldCancel : () => false;
  const resolveFailFast = typeof options?.resolveFailFast === "function" ? options.resolveFailFast : () => false;
  const requestCancel = typeof options?.requestCancel === "function" ? options.requestCancel : null;
  const onNodeScheduled = typeof options?.onNodeScheduled === "function" ? options.onNodeScheduled : null;
  const onNodeResult = typeof options?.onNodeResult === "function" ? options.onNodeResult : null;
  const onNodeSkipped = typeof options?.onNodeSkipped === "function" ? options.onNodeSkipped : null;

  const remainingDeps = new Map(runnableNodeIds.map((nodeId) => [nodeId, (upstreamByNode.get(nodeId) ?? []).length]));
  const failedNodeIds = new Set();
  const terminalNodeIds = new Set();
  const queuedNodeIds = new Set();
  const readyQueue = [];
  const inFlight = new Map();
  const skippedNodeIds = [];
  const runIds = [];

  let completed = 0;
  let failed = 0;
  let scheduleIndex = 0;
  let stopScheduling = false;
  let stopReason = null;

  const enqueueIfReady = (nodeId) => {
    if (!nodeId || terminalNodeIds.has(nodeId) || inFlight.has(nodeId) || queuedNodeIds.has(nodeId)) return;
    if ((remainingDeps.get(nodeId) ?? 0) > 0) return;
    readyQueue.push(nodeId);
    const sorted = sortByPlanOrder(readyQueue, orderIndexByNode);
    readyQueue.length = 0;
    readyQueue.push(...sorted);
    queuedNodeIds.add(nodeId);
  };

  const skipNode = (nodeId, detail = {}) => {
    if (!nodeId || terminalNodeIds.has(nodeId) || inFlight.has(nodeId)) return false;
    removeQueuedNode(readyQueue, nodeId);
    queuedNodeIds.delete(nodeId);
    terminalNodeIds.add(nodeId);
    skippedNodeIds.push(nodeId);
    if (onNodeSkipped) {
      onNodeSkipped({
        nodeId,
        reason: detail.reason ?? "skipped",
        upstream: sortByPlanOrder(detail.upstream ?? [], orderIndexByNode),
        failedUpstream: sortByPlanOrder(detail.failedUpstream ?? [], orderIndexByNode),
        causeNodeId: detail.causeNodeId ?? null
      });
    }
    return true;
  };

  const skipDownstreamForFailure = (failedNodeId) => {
    const blockingNodeIds = new Set([failedNodeId]);
    const queue = [...(downstreamByNode.get(failedNodeId) ?? [])];
    while (queue.length) {
      const current = queue.shift();
      if (!current || terminalNodeIds.has(current) || inFlight.has(current)) continue;
      const upstream = upstreamByNode.get(current) ?? [];
      const failedUpstream = upstream.filter((depId) => blockingNodeIds.has(depId));
      if (!failedUpstream.length) {
        queue.push(...(downstreamByNode.get(current) ?? []));
        continue;
      }
      const skipped = skipNode(current, {
        reason: "upstream_failure",
        upstream,
        failedUpstream,
        causeNodeId: failedNodeId
      });
      if (!skipped) continue;
      blockingNodeIds.add(current);
      queue.push(...(downstreamByNode.get(current) ?? []));
    }
  };

  const skipQueuedForReason = (reason) => {
    const currentQueue = [...readyQueue];
    currentQueue.forEach((nodeId) => {
      const upstream = upstreamByNode.get(nodeId) ?? [];
      skipNode(nodeId, {
        reason,
        upstream,
        failedUpstream: upstream.filter((depId) => failedNodeIds.has(depId))
      });
    });
  };

  const beginRun = (nodeId) => {
    scheduleIndex += 1;
    if (onNodeScheduled) onNodeScheduled({ nodeId, scheduleIndex, concurrencyLimit });

    const promise = Promise.resolve()
      .then(() => runNode(nodeId))
      .catch((error) => ({
        ok: false,
        nodeId,
        error: asErrorMessage(error)
      }))
      .then((result) => ({
        nodeId,
        result:
          result && typeof result === "object"
            ? result
            : {
                ok: false,
                nodeId,
                error: "Runtime returned no result"
              }
      }));

    inFlight.set(nodeId, promise);
  };

  const startReadyNodes = () => {
    while (!stopScheduling && !shouldCancel() && inFlight.size < concurrencyLimit && readyQueue.length) {
      const nodeId = readyQueue.shift();
      queuedNodeIds.delete(nodeId);
      beginRun(nodeId);
    }
  };

  const processResult = (nodeId, result) => {
    terminalNodeIds.add(nodeId);
    if (result?.runId) runIds.push(result.runId);

    if (result?.ok) {
      completed += 1;
      for (const downstreamId of downstreamByNode.get(nodeId) ?? []) {
        if (terminalNodeIds.has(downstreamId)) continue;
        const next = (remainingDeps.get(downstreamId) ?? 0) - 1;
        remainingDeps.set(downstreamId, Math.max(0, next));
        if (next <= 0) enqueueIfReady(downstreamId);
      }
    } else {
      failed += 1;
      failedNodeIds.add(nodeId);
      skipDownstreamForFailure(nodeId);

      if (!stopScheduling && resolveFailFast(nodeId, result)) {
        stopScheduling = true;
        stopReason = "fail_fast";
        if (typeof requestCancel === "function") {
          requestCancel("fail_fast");
        }
      }
    }

    if (onNodeResult) onNodeResult({ nodeId, result, concurrencyLimit });
  };

  runnableNodeIds.forEach((nodeId) => {
    if ((remainingDeps.get(nodeId) ?? 0) === 0) enqueueIfReady(nodeId);
  });

  startReadyNodes();

  while (inFlight.size > 0 || readyQueue.length > 0) {
    if (!stopScheduling && shouldCancel()) {
      stopScheduling = true;
      stopReason = "cancelled";
      skipQueuedForReason("cancelled");
    }

    if (!inFlight.size) {
      if (!stopScheduling) startReadyNodes();
      if (!inFlight.size) break;
    }

    const settled = await Promise.race([...inFlight.values()]);
    inFlight.delete(settled.nodeId);
    processResult(settled.nodeId, settled.result ?? { ok: false, nodeId: settled.nodeId, error: "Runtime returned no result" });

    if (!stopScheduling && shouldCancel()) {
      stopScheduling = true;
      stopReason = "cancelled";
      skipQueuedForReason("cancelled");
    }

    if (!stopScheduling) startReadyNodes();
  }

  if (!stopScheduling && !shouldCancel()) {
    for (const nodeId of runnableNodeIds) {
      if (terminalNodeIds.has(nodeId) || inFlight.has(nodeId)) continue;
      scheduleIndex += 1;
      if (onNodeScheduled) onNodeScheduled({ nodeId, scheduleIndex, concurrencyLimit, fallback: true });
      let result = null;
      try {
        result = await runNode(nodeId);
      } catch (error) {
        result = { ok: false, nodeId, error: asErrorMessage(error) };
      }
      processResult(nodeId, result ?? { ok: false, nodeId, error: "Runtime returned no result" });
      if (shouldCancel()) {
        stopScheduling = true;
        stopReason = "cancelled";
        break;
      }
    }
  }

  for (const nodeId of runnableNodeIds) {
    if (terminalNodeIds.has(nodeId) || inFlight.has(nodeId)) continue;
    const upstream = upstreamByNode.get(nodeId) ?? [];
    const failedUpstream = upstream.filter((depId) => failedNodeIds.has(depId));
    const reason =
      stopReason === "cancelled" || shouldCancel()
        ? "cancelled"
        : stopReason === "fail_fast"
          ? "fail_fast"
          : failedUpstream.length
            ? "upstream_failure"
            : "unsatisfied_dependencies";
    skipNode(nodeId, {
      reason,
      upstream,
      failedUpstream
    });
  }

  return {
    completed,
    failed,
    skippedNodeIds,
    failedNodeIds: [...failedNodeIds],
    runIds,
    stopReason,
    concurrencyLimit
  };
};
