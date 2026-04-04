import assert from "node:assert/strict";
import test from "node:test";

import { buildRunSessionTimelineModel, filterRunSessionTimelineModel, TIMELINE_FILTERS } from "../js/components/bottom-panel/run-session-model.js";

const nodeCatalog = [
  { id: "node_a", label: "Node A" },
  { id: "node_b", label: "Node B" }
];

test("buildRunSessionTimelineModel maps run traces into timeline events", () => {
  const traces = [
    { kind: "plan_parallel_started", at: "2026-04-04T10:00:00.000Z", concurrencyLimit: 2 },
    { kind: "attempt_started", at: "2026-04-04T10:00:01.000Z", nodeId: "node_a", runId: "run_a", attempt: 1, maxAttempts: 2 },
    {
      kind: "proxy_stage",
      at: "2026-04-04T10:00:02.000Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { stage: "planning", message: "collecting context" }
    },
    {
      kind: "proxy_text_delta",
      at: "2026-04-04T10:00:02.200Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { delta: "partial output chunk" }
    },
    {
      kind: "proxy_tool_call_started",
      at: "2026-04-04T10:00:02.300Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { toolName: "search" }
    },
    {
      kind: "proxy_tool_call_progress",
      at: "2026-04-04T10:00:02.400Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { toolName: "search", message: "querying index" }
    },
    {
      kind: "proxy_tool_call_completed",
      at: "2026-04-04T10:00:02.500Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { toolName: "search" }
    },
    {
      kind: "proxy_output_final",
      at: "2026-04-04T10:00:02.600Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { summary: "structured output ready" }
    },
    {
      kind: "attempt_failed",
      at: "2026-04-04T10:00:03.000Z",
      nodeId: "node_a",
      runId: "run_a",
      attempt: 1,
      maxAttempts: 2,
      error: "temporary outage"
    },
    {
      kind: "attempt_backoff",
      at: "2026-04-04T10:00:04.000Z",
      nodeId: "node_a",
      runId: "run_a",
      attempt: 1,
      backoffMs: 350
    },
    { kind: "attempt_started", at: "2026-04-04T10:00:05.000Z", nodeId: "node_a", runId: "run_a", attempt: 2, maxAttempts: 2 },
    { kind: "attempt_succeeded", at: "2026-04-04T10:00:06.000Z", nodeId: "node_a", runId: "run_a", status: "completed" },
    {
      kind: "skipped_upstream_failure",
      at: "2026-04-04T10:00:07.000Z",
      nodeId: "node_b",
      failedUpstream: ["node_a"]
    },
    { kind: "plan_completed", at: "2026-04-04T10:00:08.000Z", completed: 1, failed: 0, skipped: 1, cancelled: false }
  ];

  const runHistory = [
    {
      nodeId: "node_a",
      nodeLabel: "Node A",
      runId: "run_a",
      status: "completed",
      summary: "Node A completed",
      confidence: 0.81,
      at: "2026-04-04T10:00:06.100Z",
      mode: "mock"
    }
  ];

  const model = buildRunSessionTimelineModel({ traces, runHistory, nodeCatalog });

  assert.equal(model.sessions.length, 1);
  const types = new Set(model.sessions[0].events.map((event) => event.type));

  assert.equal(types.has("run_requested"), true);
  assert.equal(types.has("node_started"), true);
  assert.equal(types.has("progress"), true);
  assert.equal(types.has("stream"), true);
  assert.equal(types.has("tool_call"), true);
  assert.equal(types.has("tool_progress"), true);
  assert.equal(types.has("tool_completed"), true);
  assert.equal(types.has("output"), true);
  assert.equal(types.has("retry"), true);
  assert.equal(types.has("completed"), true);
  assert.equal(types.has("skipped_upstream_failure"), true);
  assert.equal(types.has("run_completed"), true);
});

test("buildRunSessionTimelineModel keeps legacy proxy_progress traces compatible", () => {
  const traces = [
    { kind: "plan_parallel_started", at: "2026-04-04T09:00:00.000Z", concurrencyLimit: 1 },
    {
      kind: "proxy_progress",
      at: "2026-04-04T09:00:01.000Z",
      nodeId: "node_a",
      runId: "run_a",
      detail: { stage: "provider", message: "calling model" }
    },
    { kind: "plan_completed", at: "2026-04-04T09:00:02.000Z", completed: 1, failed: 0, skipped: 0 }
  ];

  const model = buildRunSessionTimelineModel({ traces, runHistory: [], nodeCatalog });
  const types = new Set(model.sessions[0].events.map((event) => event.type));
  assert.equal(types.has("progress"), true);
  assert.equal(types.has("run_completed"), true);
});

test("filterRunSessionTimelineModel returns only the latest session for current filter", () => {
  const traces = [
    { kind: "plan_parallel_started", at: "2026-04-04T10:00:00.000Z" },
    { kind: "plan_completed", at: "2026-04-04T10:00:01.000Z", completed: 0, failed: 0, skipped: 0 },
    { kind: "plan_parallel_started", at: "2026-04-04T10:10:00.000Z" },
    { kind: "plan_completed", at: "2026-04-04T10:10:01.000Z", completed: 1, failed: 0, skipped: 0 }
  ];

  const model = buildRunSessionTimelineModel({ traces, runHistory: [], nodeCatalog });
  const current = filterRunSessionTimelineModel(model, TIMELINE_FILTERS.current);

  assert.equal(current.length, 1);
  assert.equal(current[0].startedAt, "2026-04-04T10:10:00.000Z");
});

test("filterRunSessionTimelineModel selected-node keeps run-level context and matching node events", () => {
  const traces = [
    { kind: "plan_parallel_started", at: "2026-04-04T11:00:00.000Z" },
    { kind: "attempt_started", at: "2026-04-04T11:00:01.000Z", nodeId: "node_a", runId: "run_a" },
    { kind: "attempt_started", at: "2026-04-04T11:00:02.000Z", nodeId: "node_b", runId: "run_b" },
    { kind: "plan_completed", at: "2026-04-04T11:00:03.000Z", completed: 1, failed: 1, skipped: 0 }
  ];

  const model = buildRunSessionTimelineModel({ traces, runHistory: [], nodeCatalog });
  const selectedNodeSessions = filterRunSessionTimelineModel(model, TIMELINE_FILTERS.selectedNode, "node_a");

  assert.equal(selectedNodeSessions.length, 1);
  const nodeEvents = selectedNodeSessions[0].events.filter((event) => event.nodeId);
  assert.equal(nodeEvents.every((event) => event.nodeId === "node_a"), true);
  assert.equal(selectedNodeSessions[0].events.some((event) => event.type === "run_requested"), true);
});

test("buildRunSessionTimelineModel synthesizes run_requested for direct node runs", () => {
  const traces = [
    { kind: "attempt_started", at: "2026-04-04T12:00:01.000Z", nodeId: "node_a", runId: "run_a", attempt: 1, maxAttempts: 1 },
    { kind: "attempt_succeeded", at: "2026-04-04T12:00:02.000Z", nodeId: "node_a", runId: "run_a", status: "completed" }
  ];

  const model = buildRunSessionTimelineModel({ traces, runHistory: [], nodeCatalog });
  assert.equal(model.sessions.length, 1);
  assert.equal(model.sessions[0].events[0].type, "run_requested");
});
