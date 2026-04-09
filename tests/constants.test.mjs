import assert from "node:assert/strict";
import test from "node:test";

import {
  GRAPH_LIMITS,
  NODE_SIZE_BY_TYPE,
  PERSISTENCE,
  WORLD_SIZE,
  clamp,
  clampGraphPoint,
  clampZoom,
  formatEdgeLabel
} from "../js/core/constants.js";

// clamp
test("clamp(5, 0, 10) returns 5 (within range)", () => {
  assert.equal(clamp(5, 0, 10), 5);
});

test("clamp(-1, 0, 10) returns 0 (below min)", () => {
  assert.equal(clamp(-1, 0, 10), 0);
});

test("clamp(11, 0, 10) returns 10 (above max)", () => {
  assert.equal(clamp(11, 0, 10), 10);
});

test("clamp(0, 0, 10) returns 0 (at exact min)", () => {
  assert.equal(clamp(0, 0, 10), 0);
});

test("clamp(10, 0, 10) returns 10 (at exact max)", () => {
  assert.equal(clamp(10, 0, 10), 10);
});

// clampZoom
test("clampZoom(1.0) returns 1.0 (within bounds)", () => {
  assert.equal(clampZoom(1.0), 1.0);
});

test("clampZoom(0.1) returns 0.45 (minZoom)", () => {
  assert.equal(clampZoom(0.1), 0.45);
});

test("clampZoom(5.0) returns 1.8 (maxZoom)", () => {
  assert.equal(clampZoom(5.0), 1.8);
});

// clampGraphPoint
test("clampGraphPoint({ x: 100, y: 100 }) returns that point (within bounds)", () => {
  assert.deepEqual(clampGraphPoint({ x: 100, y: 100 }), { x: 100, y: 100 });
});

test("clampGraphPoint({ x: -9999, y: -9999 }) returns the min clamped point", () => {
  assert.deepEqual(clampGraphPoint({ x: -9999, y: -9999 }), { x: -150, y: -100 });
});

test("clampGraphPoint({ x: 9999, y: 9999 }) returns the max clamped point", () => {
  // max x = WORLD_SIZE.width - nodeMaxPaddingX = 3200 - 100 = 3100
  // max y = WORLD_SIZE.height - nodeMaxPaddingY = 2200 - 80 = 2120
  assert.deepEqual(clampGraphPoint({ x: 9999, y: 9999 }), { x: 3100, y: 2120 });
});

test("clampGraphPoint rounds fractional coordinates to integers", () => {
  const result = clampGraphPoint({ x: 100.7, y: 200.3 });
  assert.deepEqual(result, { x: 101, y: 200 });
});

test("clampGraphPoint(undefined) returns { x: 0, y: 0 } (defaults)", () => {
  // position is undefined → x = Number(undefined?.x ?? 0) = 0
  // clamp(0, -150, 3100) = 0; clamp(0, -100, 2120) = 0
  assert.deepEqual(clampGraphPoint(undefined), { x: 0, y: 0 });
});

test("clampGraphPoint({ x: 100.7, y: 200.3 }) rounds to { x: 101, y: 200 }", () => {
  assert.deepEqual(clampGraphPoint({ x: 100.7, y: 200.3 }), { x: 101, y: 200 });
});

// formatEdgeLabel
test('formatEdgeLabel("feeds_data") returns "Feeds Data"', () => {
  assert.equal(formatEdgeLabel("feeds_data"), "Feeds Data");
});

test('formatEdgeLabel("depends_on") returns "Depends On"', () => {
  assert.equal(formatEdgeLabel("depends_on"), "Depends On");
});

test('formatEdgeLabel("  hello  world  ") trims and collapses spaces to "Hello World"', () => {
  assert.equal(formatEdgeLabel("  hello  world  "), "Hello World");
});

test("formatEdgeLabel(null) returns empty string", () => {
  assert.equal(formatEdgeLabel(null), "");
});

test("formatEdgeLabel(undefined) returns empty string", () => {
  assert.equal(formatEdgeLabel(undefined), "");
});

// Frozen constant objects
test("WORLD_SIZE is a frozen object", () => {
  assert.ok(Object.isFrozen(WORLD_SIZE), "WORLD_SIZE is not frozen");
  assert.equal(typeof WORLD_SIZE, "object");
});

test("GRAPH_LIMITS is a frozen object", () => {
  assert.ok(Object.isFrozen(GRAPH_LIMITS), "GRAPH_LIMITS is not frozen");
  assert.equal(typeof GRAPH_LIMITS, "object");
});

test("NODE_SIZE_BY_TYPE is a frozen object", () => {
  assert.ok(Object.isFrozen(NODE_SIZE_BY_TYPE), "NODE_SIZE_BY_TYPE is not frozen");
  assert.equal(typeof NODE_SIZE_BY_TYPE, "object");
});

test("PERSISTENCE is a frozen object", () => {
  assert.ok(Object.isFrozen(PERSISTENCE), "PERSISTENCE is not frozen");
  assert.equal(typeof PERSISTENCE, "object");
});
