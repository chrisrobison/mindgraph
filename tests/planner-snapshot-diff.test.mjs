import assert from "node:assert/strict";
import test from "node:test";

import {
  diffPlannerSnapshots,
  normalizePlannerSnapshot,
  plannerStatusLabel
} from "../js/runtime/planner-snapshot-diff.js";

test("normalizePlannerSnapshot supports legacy summary-only snapshots", () => {
  const normalized = normalizePlannerSnapshot(
    {
      at: "2026-04-04T00:00:00.000Z",
      mode: "mock",
      executionOrder: ["a", "b"],
      readyNodeIds: ["a"],
      blockedNodeIds: ["b"]
    },
    "legacy_0"
  );

  assert.equal(normalized.snapshotId, "legacy_0");
  assert.equal(normalized.nodes.a.ready, true);
  assert.equal(normalized.nodes.b.blocked, true);
  assert.equal(normalized.nodes.a.executionOrderIndex, 0);
  assert.equal(normalized.nodes.b.executionOrderIndex, 1);
});

test("diffPlannerSnapshots returns summary and per-node changes", () => {
  const before = {
    snapshotId: "before",
    at: "2026-04-04T00:00:00.000Z",
    executionOrder: ["node_a", "node_b"],
    nodes: {
      node_a: {
        nodeId: "node_a",
        runnable: true,
        ready: true,
        blocked: false,
        blockedReasons: [],
        upstreamDependencies: [],
        missingRequiredPorts: [],
        staleDependencies: [],
        needsRerun: false,
        executionOrderIndex: 0
      },
      node_b: {
        nodeId: "node_b",
        runnable: true,
        ready: false,
        blocked: true,
        blockedReasons: ["Waiting for dependencies: node_a"],
        upstreamDependencies: ["node_a"],
        missingRequiredPorts: ["input_context"],
        staleDependencies: [],
        needsRerun: false,
        executionOrderIndex: 1
      }
    }
  };

  const after = {
    snapshotId: "after",
    at: "2026-04-04T00:05:00.000Z",
    executionOrder: ["node_b", "node_a"],
    nodes: {
      node_a: {
        nodeId: "node_a",
        runnable: true,
        ready: false,
        blocked: true,
        blockedReasons: ["Missing required fields: prompt"],
        upstreamDependencies: [],
        missingRequiredPorts: [],
        staleDependencies: ["node_b"],
        needsRerun: true,
        executionOrderIndex: 1
      },
      node_b: {
        nodeId: "node_b",
        runnable: true,
        ready: true,
        blocked: false,
        blockedReasons: [],
        upstreamDependencies: ["node_a", "node_c"],
        missingRequiredPorts: [],
        staleDependencies: [],
        needsRerun: false,
        executionOrderIndex: 0
      }
    }
  };

  const diff = diffPlannerSnapshots(before, after);

  assert.equal(diff.summary.changedNodeCount, 2);
  assert.equal(diff.summary.statusChangedCount, 2);
  assert.equal(diff.summary.newlyBlockedCount, 1);
  assert.equal(diff.summary.newlyReadyCount, 1);

  const nodeA = diff.nodeChanges.find((entry) => entry.nodeId === "node_a");
  const nodeB = diff.nodeChanges.find((entry) => entry.nodeId === "node_b");

  assert.ok(nodeA);
  assert.ok(nodeB);
  assert.equal(nodeA.statusBefore, "ready");
  assert.equal(nodeA.statusAfter, "blocked");
  assert.equal(nodeA.blockedReasons.added[0], "Missing required fields: prompt");
  assert.equal(nodeA.stale.changed, true);

  assert.equal(nodeB.statusBefore, "blocked");
  assert.equal(nodeB.statusAfter, "ready");
  assert.deepEqual(nodeB.upstreamDependencies.added, ["node_c"]);
  assert.equal(nodeB.missingRequiredPorts.removed[0], "input_context");
  assert.equal(nodeB.executionOrder.changed, true);
});

test("plannerStatusLabel formats known statuses", () => {
  assert.equal(plannerStatusLabel("ready"), "Ready");
  assert.equal(plannerStatusLabel("blocked"), "Blocked");
  assert.equal(plannerStatusLabel("reference"), "Reference");
});
