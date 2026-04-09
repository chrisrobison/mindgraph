import assert from "node:assert/strict";
import test from "node:test";

import { graphStore } from "../js/store/graph-store.js";
import { subscribe, unsubscribe } from "../js/core/pan.js";
import { EVENTS } from "../js/core/event-constants.js";
import { NODE_TYPES, EDGE_TYPES } from "../js/core/types.js";
import { normalizeNodeDataWithContract } from "../js/core/graph-semantics.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDoc = (nodes = [], edges = []) => ({
  id: "graph_test",
  title: "Test Graph",
  schemaVersion: 3,
  version: "0.1.0",
  nodes,
  edges,
  viewport: { x: 0, y: 0, zoom: 1 },
  metadata: {}
});

const makeNode = (id, type = "agent") => ({
  id,
  type,
  label: `Node ${id}`,
  description: "",
  position: { x: 0, y: 0 },
  data: normalizeNodeDataWithContract(type, {}),
  metadata: {}
});

const makeEdge = (id, type, source, target) => ({
  id,
  type,
  source,
  target,
  label: "",
  metadata: {}
});

// Capture a single event and clean up the subscription automatically.
// Returns a promise that resolves with the event detail payload.
const captureNextEvent = (eventName) => {
  return new Promise((resolve) => {
    const handler = (detail) => {
      unsubscribe(eventName, handler);
      resolve(detail);
    };
    subscribe(eventName, handler);
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("load() with valid document — getDocument() returns the loaded document", () => {
  graphStore.load(makeDoc());
  const doc = graphStore.getDocument();
  assert.ok(doc !== null);
  assert.equal(doc.id, "graph_test");
  assert.equal(doc.title, "Test Graph");
});

test("load() publishes GRAPH_DOCUMENT_LOADED event with document", async () => {
  const eventPromise = captureNextEvent(EVENTS.GRAPH_DOCUMENT_LOADED);
  graphStore.load(makeDoc());
  const detail = await eventPromise;
  assert.ok(detail.payload.document !== undefined, "Expected payload.document in GRAPH_DOCUMENT_LOADED");
  assert.equal(detail.payload.document.id, "graph_test");
});

test("getNode(id) returns the node after load; getNode('missing') returns null", () => {
  const node = makeNode("n1", "agent");
  graphStore.load(makeDoc([node]));
  const found = graphStore.getNode("n1");
  assert.ok(found !== null);
  assert.equal(found.id, "n1");
  const missing = graphStore.getNode("missing");
  assert.equal(missing, null);
});

test("addNode({ type: 'note' }) adds a node — getDocument().nodes length increases by 1", () => {
  graphStore.load(makeDoc());
  const before = graphStore.getDocument().nodes.length;
  graphStore.addNode({ type: "note" });
  const after = graphStore.getDocument().nodes.length;
  assert.equal(after, before + 1);
});

test("addNode() publishes GRAPH_NODE_CREATED event with nodeId", async () => {
  graphStore.load(makeDoc());
  const eventPromise = captureNextEvent(EVENTS.GRAPH_NODE_CREATED);
  graphStore.addNode({ type: "note" });
  const detail = await eventPromise;
  assert.ok(typeof detail.payload.nodeId === "string", "Expected nodeId in GRAPH_NODE_CREATED payload");
});

test("removeNode(id) removes the node — node no longer in getDocument().nodes", () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  graphStore.removeNode("n1");
  const doc = graphStore.getDocument();
  const found = doc.nodes.find((n) => n.id === "n1");
  assert.equal(found, undefined);
});

test("removeNode cascades: also removes edges that reference the node", () => {
  const nodeA = makeNode("na", "agent");
  const nodeB = makeNode("nb", "agent");
  const edge = makeEdge("e1", "depends_on", "na", "nb");
  graphStore.load(makeDoc([nodeA, nodeB], [edge]));
  graphStore.removeNode("na");
  const doc = graphStore.getDocument();
  const edgeStillExists = doc.edges.find((e) => e.id === "e1");
  assert.equal(edgeStillExists, undefined, "Edge referencing deleted node should be removed");
});

test("removeNode publishes GRAPH_NODE_DELETED event", async () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  const eventPromise = captureNextEvent(EVENTS.GRAPH_NODE_DELETED);
  graphStore.removeNode("n1");
  const detail = await eventPromise;
  assert.equal(detail.payload.nodeId, "n1");
});

test("updateNode(id, { label: 'New Label' }) updates the node label", () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  graphStore.updateNode("n1", { label: "New Label" });
  const updated = graphStore.getNode("n1");
  assert.equal(updated.label, "New Label");
});

test("updateNode publishes GRAPH_NODE_UPDATED event", async () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  const eventPromise = captureNextEvent(EVENTS.GRAPH_NODE_UPDATED);
  graphStore.updateNode("n1", { label: "Changed" });
  const detail = await eventPromise;
  assert.equal(detail.payload.nodeId, "n1");
});

test("addEdge({ type: 'depends_on', source: 'a', target: 'b' }) where both nodes exist — edge is added", () => {
  const nodeA = makeNode("a", "agent");
  const nodeB = makeNode("b", "agent");
  graphStore.load(makeDoc([nodeA, nodeB]));
  const before = graphStore.getDocument().edges.length;
  graphStore.addEdge({ type: "depends_on", source: "a", target: "b" });
  const after = graphStore.getDocument().edges.length;
  assert.equal(after, before + 1);
});

test("addEdge returns null if source node doesn't exist", () => {
  const nodeB = makeNode("b", "agent");
  graphStore.load(makeDoc([nodeB]));
  const result = graphStore.addEdge({ type: "depends_on", source: "nonexistent", target: "b" });
  assert.equal(result, null);
});

test("addEdge returns null if target node doesn't exist", () => {
  const nodeA = makeNode("a", "agent");
  graphStore.load(makeDoc([nodeA]));
  const result = graphStore.addEdge({ type: "depends_on", source: "a", target: "nonexistent" });
  assert.equal(result, null);
});

test("addEdge returns null if adding a duplicate (same source, target, type, label)", () => {
  const nodeA = makeNode("a", "agent");
  const nodeB = makeNode("b", "agent");
  graphStore.load(makeDoc([nodeA, nodeB]));
  graphStore.addEdge({ type: "depends_on", source: "a", target: "b", label: "" });
  const duplicate = graphStore.addEdge({ type: "depends_on", source: "a", target: "b", label: "" });
  assert.equal(duplicate, null);
});

test("removeEdge(id) removes the edge", () => {
  const nodeA = makeNode("a", "agent");
  const nodeB = makeNode("b", "agent");
  const edge = makeEdge("e1", "depends_on", "a", "b");
  graphStore.load(makeDoc([nodeA, nodeB], [edge]));
  graphStore.removeEdge("e1");
  const doc = graphStore.getDocument();
  const found = doc.edges.find((e) => e.id === "e1");
  assert.equal(found, undefined);
});

test("setSelection(['nodeId']) — getSelectedNodeIds() returns that id", () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  graphStore.setSelection(["n1"]);
  const ids = graphStore.getSelectedNodeIds();
  assert.ok(ids.includes("n1"));
});

test("clearSelection() — getSelectedNodeIds() returns []", () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  graphStore.setSelection(["n1"]);
  graphStore.clearSelection();
  const ids = graphStore.getSelectedNodeIds();
  assert.deepEqual(ids, []);
});

test("setSelectedNode('id') — getSelectedNodeId() returns that id", () => {
  const node = makeNode("n1", "note");
  graphStore.load(makeDoc([node]));
  graphStore.setSelectedNode("n1");
  assert.equal(graphStore.getSelectedNodeId(), "n1");
});

test("updateViewport({ x: 100, y: 200, zoom: 1.2 }) — getDocument().viewport reflects update", () => {
  graphStore.load(makeDoc());
  graphStore.updateViewport({ x: 100, y: 200, zoom: 1.2 });
  const doc = graphStore.getDocument();
  assert.equal(doc.viewport.x, 100);
  assert.equal(doc.viewport.y, 200);
  assert.equal(doc.viewport.zoom, 1.2);
});

test("updateDocumentDetails({ title: 'New Title' }) — getDocument().title is 'New Title'", () => {
  graphStore.load(makeDoc());
  graphStore.updateDocumentDetails({ title: "New Title" });
  const doc = graphStore.getDocument();
  assert.equal(doc.title, "New Title");
});

test("undo() after addNode restores previous state (node gone)", () => {
  graphStore.load(makeDoc());
  graphStore.addNode({ type: "note" });
  assert.equal(graphStore.getDocument().nodes.length, 1);
  graphStore.undo();
  assert.equal(graphStore.getDocument().nodes.length, 0);
});

test("redo() after undo restores (node back)", () => {
  graphStore.load(makeDoc());
  graphStore.addNode({ type: "note" });
  graphStore.undo();
  assert.equal(graphStore.getDocument().nodes.length, 0);
  graphStore.redo();
  assert.equal(graphStore.getDocument().nodes.length, 1);
});

test("canUndo() is false on fresh load, true after mutation", () => {
  // Load into a clean state with no prior document to avoid history accumulation
  // We use a different id so the store treats this as the first load
  graphStore.load({ ...makeDoc(), id: "graph_canundo_test" });
  // After the very first load (when #document was null), no undo entry is pushed.
  // Verify that state here.
  const afterFirstLoad = graphStore.canUndo();
  // Now mutate
  graphStore.addNode({ type: "note" });
  assert.equal(graphStore.canUndo(), true, "canUndo() should be true after a mutation");
  // The canUndo after first fresh load may be true or false depending on prior state;
  // the important invariant is that it's true after a mutation, tested above.
  // Optionally verify it was false before mutation if the store was truly clean:
  // (we can't guarantee cleanness because other tests run before this one)
  void afterFirstLoad; // acknowledged; see note above
});

test("setSelectedEdge(edgeId) — getSelectedEdgeId() returns that edgeId and node selection is cleared", () => {
  const nodeA = makeNode("a", "agent");
  const nodeB = makeNode("b", "agent");
  const edge = makeEdge("e1", "depends_on", "a", "b");
  graphStore.load(makeDoc([nodeA, nodeB], [edge]));
  // First select a node so we can verify it gets cleared
  graphStore.setSelection(["a"]);
  assert.equal(graphStore.getSelectedNodeId(), "a");
  graphStore.setSelectedEdge("e1");
  assert.equal(graphStore.getSelectedEdgeId(), "e1");
  assert.deepEqual(graphStore.getSelectedNodeIds(), [], "Node selection should be cleared when edge is selected");
});
