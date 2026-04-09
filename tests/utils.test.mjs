import assert from "node:assert/strict";
import test from "node:test";

import { clone, nowIso, uid } from "../js/core/utils.js";

test("nowIso returns a valid ISO 8601 string", () => {
  const result = nowIso();
  assert.equal(typeof result, "string");
  const parsed = new Date(result);
  assert.ok(!Number.isNaN(parsed.getTime()), "parsed date is NaN");
});

test("nowIso timestamps are chronologically ordered on consecutive calls", async () => {
  const first = nowIso();
  // Ensure at least 1ms passes between calls
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = nowIso();
  assert.ok(
    new Date(first).getTime() <= new Date(second).getTime(),
    "first timestamp is later than second"
  );
});

test('uid("node") starts with "node_"', () => {
  const result = uid("node");
  assert.ok(result.startsWith("node_"), `expected "node_" prefix, got "${result}"`);
});

test('uid() defaults prefix to "id" (result starts with "id_")', () => {
  const result = uid();
  assert.ok(result.startsWith("id_"), `expected "id_" prefix, got "${result}"`);
});

test("two consecutive calls to uid() produce different values", () => {
  const a = uid();
  const b = uid();
  assert.notEqual(a, b);
});

test("uid() result has exactly 3 underscore-separated segments", () => {
  const result = uid();
  const segments = result.split("_");
  assert.equal(segments.length, 3, `expected 3 segments, got ${segments.length} in "${result}"`);
});

test("clone returns a deep copy (not the same reference)", () => {
  const original = { a: 1, b: { c: 2 } };
  const copy = clone(original);
  assert.notEqual(copy, original);
  assert.deepEqual(copy, original);
});

test("clone deep-copies nested objects (mutating clone does not affect original)", () => {
  const original = { a: { b: { c: 42 } } };
  const copy = clone(original);
  copy.a.b.c = 999;
  assert.equal(original.a.b.c, 42);
});

test("clone handles arrays correctly", () => {
  const original = [1, [2, 3], { x: 4 }];
  const copy = clone(original);
  assert.deepEqual(copy, original);
  assert.notEqual(copy, original);
  copy[1].push(99);
  assert.equal(original[1].length, 2, "mutating nested array in clone affected original");
});
