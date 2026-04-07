import assert from "node:assert/strict";
import test from "node:test";

import { EVENTS } from "../js/core/event-constants.js";
import { validateEventPayload } from "../js/core/event-contracts.js";

test("accepts valid node update request payload", () => {
  const result = validateEventPayload(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
    nodeId: "node_1",
    patch: { label: "Next" }
  });
  assert.equal(result.ok, true);
});

test("rejects invalid node update request payload", () => {
  const result = validateEventPayload(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
    nodeId: "node_1",
    patch: null
  });
  assert.equal(result.ok, false);
});

test("accepts valid runtime run request payload", () => {
  const result = validateEventPayload(EVENTS.RUNTIME_AGENT_RUN_REQUESTED, {
    nodeId: "node_2",
    trigger: "manual"
  });
  assert.equal(result.ok, true);
});

test("unknown events are treated as valid", () => {
  const result = validateEventPayload("custom.event", { anything: true });
  assert.equal(result.ok, true);
});
