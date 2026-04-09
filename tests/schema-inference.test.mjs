import assert from "node:assert/strict";
import test from "node:test";

import { inferSchema } from "../js/runtime/schema-inference.js";

test('inferSchema("hello") returns { type: "string" }', () => {
  assert.deepEqual(inferSchema("hello"), { type: "string" });
});

test("inferSchema(42) returns { type: \"number\" }", () => {
  assert.deepEqual(inferSchema(42), { type: "number" });
});

test("inferSchema(true) returns { type: \"boolean\" }", () => {
  assert.deepEqual(inferSchema(true), { type: "boolean" });
});

test("inferSchema(null) returns { type: \"null\" }", () => {
  assert.deepEqual(inferSchema(null), { type: "null" });
});

test("inferSchema([]) returns { type: \"array\", itemType: \"unknown\" }", () => {
  assert.deepEqual(inferSchema([]), { type: "array", itemType: "unknown" });
});

test("inferSchema([1, 2, 3]) returns { type: \"array\", itemType: \"number\" }", () => {
  assert.deepEqual(inferSchema([1, 2, 3]), { type: "array", itemType: "number" });
});

test('inferSchema(["a", "b"]) returns { type: "array", itemType: "string" }', () => {
  assert.deepEqual(inferSchema(["a", "b"]), { type: "array", itemType: "string" });
});

test('mixed array inferSchema([1, "a"]) returns itemType "number | string" (sorted union)', () => {
  const result = inferSchema([1, "a"]);
  assert.equal(result.type, "array");
  assert.equal(result.itemType, "number | string");
});

test("inferSchema({ name: 'Alice', age: 30 }) returns object schema with keys and properties", () => {
  const result = inferSchema({ name: "Alice", age: 30 });
  assert.equal(result.type, "object");
  assert.deepEqual(result.keys, ["name", "age"]);
  assert.deepEqual(result.properties, {
    name: { type: "string" },
    age: { type: "number" }
  });
});

test("array of objects: inferSchema([{ x: 1 }]) has itemType 'object' and shape.type === 'object'", () => {
  const result = inferSchema([{ x: 1 }]);
  assert.equal(result.type, "array");
  assert.equal(result.itemType, "object");
  assert.ok(result.shape !== undefined, "shape is missing");
  assert.equal(result.shape.type, "object");
});

test("depth limiting: object nested 5 levels deep does not expand innermost properties", () => {
  // Build a 5-level nested object: { a: { a: { a: { a: { a: "leaf" } } } } }
  const deep = { a: { a: { a: { a: { a: "leaf" } } } } };
  const result = inferSchema(deep);

  // depth=0: object with key "a"
  assert.equal(result.type, "object");
  // depth=1
  const d1 = result.properties.a;
  assert.equal(d1.type, "object");
  // depth=2
  const d2 = d1.properties.a;
  assert.equal(d2.type, "object");
  // depth=3
  const d3 = d2.properties.a;
  assert.equal(d3.type, "object");
  // depth=4: MAX_DEPTH reached — should return just { type } without properties
  const d4 = d3.properties.a;
  assert.equal(d4.type, "object");
  assert.ok(!("properties" in d4), "depth cap not enforced: innermost level has properties");
});

test("inferSchema with depth=4 passed directly returns primitive type without expansion", () => {
  // Passing depth >= MAX_DEPTH explicitly should short-circuit to { type }
  assert.deepEqual(inferSchema("x", 4), { type: "string" });
});

test("inferSchema([1..10]) samples first 6 but correctly identifies itemType as 'number'", () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const result = inferSchema(arr);
  assert.equal(result.type, "array");
  assert.equal(result.itemType, "number");
});
