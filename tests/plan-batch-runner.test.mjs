import assert from "node:assert/strict";
import test from "node:test";

import { runPlanWithBranchParallelism } from "../js/runtime/plan-batch-runner.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createDeferred = () => {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
};

const waitFor = async (predicate, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test condition");
    }
    await sleep(5);
  }
};

const createPlan = (executionOrder, upstreamByNode = {}) => ({
  executionOrder: [...executionOrder],
  nodes: Object.fromEntries(
    executionOrder.map((nodeId) => [
      nodeId,
      {
        runnable: true,
        upstreamDependencies: [...(upstreamByNode[nodeId] ?? [])]
      }
    ])
  )
});

test("runs independent branches in parallel", async () => {
  const plan = createPlan(["left", "right"]);
  const started = [];
  let active = 0;
  let maxActive = 0;

  const result = await runPlanWithBranchParallelism(plan, {
    concurrencyLimit: 2,
    runNode: async (nodeId) => {
      started.push(nodeId);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(30);
      active -= 1;
      return { ok: true, nodeId, runId: `run_${nodeId}` };
    }
  });

  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.skippedNodeIds.length, 0);
  assert.deepEqual(started, ["left", "right"]);
  assert.equal(maxActive, 2);
});

test("supports fan-out and fan-in dependency gating", async () => {
  const plan = createPlan(["root", "left", "right", "join"], {
    left: ["root"],
    right: ["root"],
    join: ["left", "right"]
  });

  const started = [];
  const deferredByNode = new Map();
  const runPromise = runPlanWithBranchParallelism(plan, {
    concurrencyLimit: 2,
    runNode: (nodeId) => {
      started.push(nodeId);
      const deferred = createDeferred();
      deferredByNode.set(nodeId, deferred);
      return deferred.promise;
    }
  });

  await waitFor(() => started.includes("root"));
  assert.deepEqual(started, ["root"]);

  deferredByNode.get("root").resolve({ ok: true, nodeId: "root", runId: "run_root" });

  await waitFor(() => started.includes("left") && started.includes("right"));
  assert.deepEqual(started.slice(0, 3), ["root", "left", "right"]);
  assert.equal(started.includes("join"), false);

  deferredByNode.get("left").resolve({ ok: true, nodeId: "left", runId: "run_left" });
  await sleep(20);
  assert.equal(started.includes("join"), false);

  deferredByNode.get("right").resolve({ ok: true, nodeId: "right", runId: "run_right" });
  await waitFor(() => started.includes("join"));
  deferredByNode.get("join").resolve({ ok: true, nodeId: "join", runId: "run_join" });

  const result = await runPromise;
  assert.equal(result.completed, 4);
  assert.equal(result.failed, 0);
  assert.equal(result.skippedNodeIds.length, 0);
});

test("branch failure propagates only to dependent nodes while independent branch continues", async () => {
  const plan = createPlan(["a", "c", "b", "d"], {
    b: ["a"],
    d: ["c"]
  });

  const started = [];
  const result = await runPlanWithBranchParallelism(plan, {
    concurrencyLimit: 2,
    runNode: async (nodeId) => {
      started.push(nodeId);
      if (nodeId === "a") {
        return { ok: false, nodeId, runId: "run_a", error: "branch-a failed" };
      }
      if (nodeId === "c") {
        await sleep(25);
        return { ok: true, nodeId, runId: "run_c" };
      }
      if (nodeId === "d") {
        return { ok: true, nodeId, runId: "run_d" };
      }
      throw new Error(`Node ${nodeId} should have been skipped`);
    }
  });

  assert.deepEqual(started, ["a", "c", "d"]);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.skippedNodeIds, ["b"]);
});

test("upstream failure propagation cascades through downstream chain", async () => {
  const plan = createPlan(["a", "b", "c"], {
    b: ["a"],
    c: ["b"]
  });

  const started = [];
  const result = await runPlanWithBranchParallelism(plan, {
    concurrencyLimit: 2,
    runNode: async (nodeId) => {
      started.push(nodeId);
      if (nodeId === "a") {
        return { ok: false, nodeId, runId: "run_a", error: "failed" };
      }
      throw new Error(`Node ${nodeId} should have been skipped`);
    }
  });

  assert.deepEqual(started, ["a"]);
  assert.equal(result.failed, 1);
  assert.deepEqual(result.skippedNodeIds, ["b", "c"]);
});

test("cancellation stops scheduling new nodes while in-flight work settles", async () => {
  const plan = createPlan(["a", "b", "c"]);
  const started = [];
  const deferredByNode = new Map();
  let cancelled = false;

  const runPromise = runPlanWithBranchParallelism(plan, {
    concurrencyLimit: 2,
    shouldCancel: () => cancelled,
    runNode: (nodeId) => {
      started.push(nodeId);
      const deferred = createDeferred();
      deferredByNode.set(nodeId, deferred);
      return deferred.promise;
    }
  });

  await waitFor(() => started.length === 2);
  assert.deepEqual(started, ["a", "b"]);

  cancelled = true;
  deferredByNode.get("a").resolve({ ok: false, nodeId: "a", runId: "run_a", status: "cancelled", cancelled: true });
  deferredByNode.get("b").resolve({ ok: false, nodeId: "b", runId: "run_b", status: "cancelled", cancelled: true });

  const result = await runPromise;
  assert.deepEqual(started, ["a", "b"]);
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 2);
  assert.deepEqual(result.skippedNodeIds, ["c"]);
  assert.equal(result.stopReason, "cancelled");
});
