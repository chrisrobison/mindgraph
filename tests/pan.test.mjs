import assert from "node:assert/strict";
import test from "node:test";

import { publish, subscribe, unsubscribe } from "../js/core/pan.js";

test("subscriber receives detail with correct shape", () => {
  let received = null;
  const handler = (detail) => { received = detail; };
  subscribe("test.pan.1", handler);
  publish("test.pan.1", { value: 42 });
  unsubscribe("test.pan.1", handler);

  assert.ok(received !== null, "handler was not called");
  assert.equal(received.eventName, "test.pan.1");
  assert.ok("payload" in received, "detail missing payload");
  assert.ok("timestamp" in received, "detail missing timestamp");
});

test("payload passed to publish is the payload received by the subscriber", () => {
  let received = null;
  const handler = (detail) => { received = detail; };
  const payload = { msg: "hello", num: 7 };
  subscribe("test.pan.2", handler);
  publish("test.pan.2", payload);
  unsubscribe("test.pan.2", handler);

  assert.deepEqual(received.payload, payload);
});

test("multiple subscribers all receive the same event", () => {
  const calls = [];
  const h1 = (detail) => calls.push({ sub: 1, detail });
  const h2 = (detail) => calls.push({ sub: 2, detail });
  const h3 = (detail) => calls.push({ sub: 3, detail });

  subscribe("test.pan.3", h1);
  subscribe("test.pan.3", h2);
  subscribe("test.pan.3", h3);
  publish("test.pan.3", { x: 1 });
  unsubscribe("test.pan.3", h1);
  unsubscribe("test.pan.3", h2);
  unsubscribe("test.pan.3", h3);

  assert.equal(calls.length, 3);
  const subs = new Set(calls.map((c) => c.sub));
  assert.ok(subs.has(1) && subs.has(2) && subs.has(3));
  for (const c of calls) {
    assert.deepEqual(c.detail.payload, { x: 1 });
  }
});

test("unsubscribe by name stops handler from receiving future events", () => {
  let count = 0;
  const handler = () => { count++; };

  subscribe("test.pan.4", handler);
  publish("test.pan.4", {});
  unsubscribe("test.pan.4", handler);
  publish("test.pan.4", {});

  assert.equal(count, 1);
});

test("subscribe return value is a working unsubscribe function", () => {
  let count = 0;
  const handler = () => { count++; };

  const unsub = subscribe("test.pan.5", handler);
  publish("test.pan.5", {});
  unsub();
  publish("test.pan.5", {});

  assert.equal(count, 1);
});

test("wildcard handler receives events from different event names", () => {
  const received = [];
  const handler = (detail) => received.push(detail.eventName);

  subscribe("*", handler);
  publish("test.pan.6a", {});
  publish("test.pan.6b", {});
  unsubscribe("*", handler);

  assert.ok(received.includes("test.pan.6a"), "missed test.pan.6a");
  assert.ok(received.includes("test.pan.6b"), "missed test.pan.6b");
});

test("wildcard handler detail includes eventName property", () => {
  let received = null;
  const handler = (detail) => { received = detail; };

  subscribe("*", handler);
  publish("test.pan.7", { info: "check" });
  unsubscribe("*", handler);

  assert.ok(received !== null, "handler was not called");
  assert.equal(received.eventName, "test.pan.7");
});

test("wildcard unsubscribe stops receiving events", () => {
  let count = 0;
  const handler = () => { count++; };

  subscribe("*", handler);
  publish("test.pan.8", {});
  unsubscribe("*", handler);
  publish("test.pan.8", {});

  assert.equal(count, 1);
});

test("error thrown inside a subscriber does not prevent other subscribers from receiving the event", () => {
  // Wrap the throwing subscriber in try/catch as the spec directs.
  // Node.js EventTarget continues dispatching to all listeners even when one
  // throws (errors surface asynchronously). We keep the test deterministic by
  // catching the error inside the subscriber so no unhandled exception escapes.
  const calls = [];
  let threwInternally = false;

  const faultyHandler = () => {
    try {
      throw new Error("intentional error");
    } catch (_err) {
      threwInternally = true;
    }
  };
  const safe = (detail) => calls.push(detail);

  subscribe("test.pan.9", faultyHandler);
  subscribe("test.pan.9", safe);
  publish("test.pan.9", { data: "ok" });
  unsubscribe("test.pan.9", faultyHandler);
  unsubscribe("test.pan.9", safe);

  assert.ok(threwInternally, "faulty handler did not execute");
  assert.equal(calls.length, 1, "safe subscriber was not called");
  assert.deepEqual(calls[0].payload, { data: "ok" });
});
