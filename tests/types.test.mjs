import assert from "node:assert/strict";
import test from "node:test";

import {
  EDGE_TYPES,
  EDGE_TYPE_VALUES,
  NODE_TYPES,
  NODE_TYPE_VALUES
} from "../js/core/types.js";

test("NODE_TYPE_VALUES contains exactly 6 items", () => {
  assert.equal(NODE_TYPE_VALUES.length, 6);
});

test("NODE_TYPE_VALUES includes all expected values", () => {
  const expected = ["note", "agent", "data", "transformer", "view", "action"];
  for (const val of expected) {
    assert.ok(NODE_TYPE_VALUES.includes(val), `missing "${val}" in NODE_TYPE_VALUES`);
  }
});

test("EDGE_TYPE_VALUES contains exactly 11 items", () => {
  assert.equal(EDGE_TYPE_VALUES.length, 11);
});

test("EDGE_TYPE_VALUES includes all expected values", () => {
  const expected = [
    "parent_of",
    "depends_on",
    "feeds_data",
    "informs",
    "reads_from",
    "writes_to",
    "transforms",
    "critiques",
    "reports_to",
    "triggers",
    "references"
  ];
  for (const val of expected) {
    assert.ok(EDGE_TYPE_VALUES.includes(val), `missing "${val}" in EDGE_TYPE_VALUES`);
  }
});

test("NODE_TYPE_VALUES has no duplicate values", () => {
  const unique = new Set(NODE_TYPE_VALUES);
  assert.equal(unique.size, NODE_TYPE_VALUES.length);
});

test("EDGE_TYPE_VALUES has no duplicate values", () => {
  const unique = new Set(EDGE_TYPE_VALUES);
  assert.equal(unique.size, EDGE_TYPE_VALUES.length);
});

test("NODE_TYPES is frozen", () => {
  assert.ok(Object.isFrozen(NODE_TYPES));
});

test("EDGE_TYPES is frozen", () => {
  assert.ok(Object.isFrozen(EDGE_TYPES));
});
