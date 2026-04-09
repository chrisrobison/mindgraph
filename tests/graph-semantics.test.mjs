import assert from "node:assert/strict";
import test from "node:test";

import {
  NODE_TYPE_SPECS,
  EDGE_TYPE_SPECS,
  PORT_PAYLOAD_TYPES,
  SEMANTIC_EDGE_GROUPS,
  isExecutableNodeType,
  edgeAffectsExecution,
  edgeAffectsDataFlow,
  edgeDefinesHierarchy,
  edgeIsInformational,
  validateNodeContract,
  validateEdgeSemantics,
  inferDefaultEdgeType,
  getEdgeContractEndpoints,
  normalizeNodeDataWithContract,
  getDefaultPortsForNodeType
} from "../js/core/graph-semantics.js";
import { NODE_TYPES, EDGE_TYPES } from "../js/core/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeNode = (type, extraData = {}) => ({
  id: `${type}_1`,
  type,
  label: type,
  data: normalizeNodeDataWithContract(type, extraData),
  metadata: {}
});

const makeEdge = (type, source, target) => ({
  id: "edge_1",
  type,
  source,
  target,
  label: "",
  metadata: {}
});

// ---------------------------------------------------------------------------
// NODE_TYPE_SPECS
// ---------------------------------------------------------------------------

test("NODE_TYPE_SPECS has keys for all six node types", () => {
  const expected = ["note", "data", "transformer", "agent", "view", "action"];
  for (const key of expected) {
    assert.ok(key in NODE_TYPE_SPECS, `Expected NODE_TYPE_SPECS to have key "${key}"`);
  }
});

test("NODE_TYPE_SPECS.agent.executable is true", () => {
  assert.equal(NODE_TYPE_SPECS.agent.executable, true);
});

test("NODE_TYPE_SPECS.note.executable is false", () => {
  assert.equal(NODE_TYPE_SPECS.note.executable, false);
});

test("NODE_TYPE_SPECS.data.executable is false", () => {
  assert.equal(NODE_TYPE_SPECS.data.executable, false);
});

// ---------------------------------------------------------------------------
// isExecutableNodeType
// ---------------------------------------------------------------------------

test("isExecutableNodeType('agent') returns true", () => {
  assert.equal(isExecutableNodeType("agent"), true);
});

test("isExecutableNodeType('note') returns false", () => {
  assert.equal(isExecutableNodeType("note"), false);
});

test("isExecutableNodeType('data') returns false", () => {
  assert.equal(isExecutableNodeType("data"), false);
});

test("isExecutableNodeType('transformer') returns true", () => {
  assert.equal(isExecutableNodeType("transformer"), true);
});

// ---------------------------------------------------------------------------
// EDGE_TYPE_SPECS
// ---------------------------------------------------------------------------

test("EDGE_TYPE_SPECS has keys for all 11 edge types", () => {
  const expected = [
    "parent_of", "depends_on", "feeds_data", "informs", "reads_from",
    "writes_to", "transforms", "critiques", "reports_to", "triggers", "references"
  ];
  for (const key of expected) {
    assert.ok(key in EDGE_TYPE_SPECS, `Expected EDGE_TYPE_SPECS to have key "${key}"`);
  }
});

// ---------------------------------------------------------------------------
// edgeAffectsExecution
// ---------------------------------------------------------------------------

test("edgeAffectsExecution('depends_on') is true", () => {
  assert.equal(edgeAffectsExecution("depends_on"), true);
});

test("edgeAffectsExecution('feeds_data') is false", () => {
  assert.equal(edgeAffectsExecution("feeds_data"), false);
});

test("edgeAffectsExecution('triggers') is true", () => {
  assert.equal(edgeAffectsExecution("triggers"), true);
});

test("edgeAffectsExecution('informs') is false", () => {
  assert.equal(edgeAffectsExecution("informs"), false);
});

// ---------------------------------------------------------------------------
// edgeAffectsDataFlow
// ---------------------------------------------------------------------------

test("edgeAffectsDataFlow('feeds_data') is true", () => {
  assert.equal(edgeAffectsDataFlow("feeds_data"), true);
});

test("edgeAffectsDataFlow('depends_on') is false", () => {
  assert.equal(edgeAffectsDataFlow("depends_on"), false);
});

test("edgeAffectsDataFlow('reads_from') is true", () => {
  assert.equal(edgeAffectsDataFlow("reads_from"), true);
});

test("edgeAffectsDataFlow('writes_to') is true", () => {
  assert.equal(edgeAffectsDataFlow("writes_to"), true);
});

test("edgeAffectsDataFlow('transforms') is true", () => {
  assert.equal(edgeAffectsDataFlow("transforms"), true);
});

// ---------------------------------------------------------------------------
// edgeDefinesHierarchy
// ---------------------------------------------------------------------------

test("edgeDefinesHierarchy('parent_of') is true", () => {
  assert.equal(edgeDefinesHierarchy("parent_of"), true);
});

test("edgeDefinesHierarchy('depends_on') is false", () => {
  assert.equal(edgeDefinesHierarchy("depends_on"), false);
});

// ---------------------------------------------------------------------------
// edgeIsInformational
// ---------------------------------------------------------------------------

test("edgeIsInformational('informs') is true", () => {
  assert.equal(edgeIsInformational("informs"), true);
});

test("edgeIsInformational('critiques') is true", () => {
  assert.equal(edgeIsInformational("critiques"), true);
});

test("edgeIsInformational('depends_on') is false", () => {
  assert.equal(edgeIsInformational("depends_on"), false);
});

// ---------------------------------------------------------------------------
// PORT_PAYLOAD_TYPES
// ---------------------------------------------------------------------------

test("PORT_PAYLOAD_TYPES contains all expected payload type strings", () => {
  const expected = ["any", "object", "array", "string", "number", "boolean", "null", "none"];
  for (const type of expected) {
    assert.ok(PORT_PAYLOAD_TYPES.includes(type), `Expected PORT_PAYLOAD_TYPES to include "${type}"`);
  }
});

// ---------------------------------------------------------------------------
// validateNodeContract
// ---------------------------------------------------------------------------

test("validateNodeContract(null) returns { valid: false }", () => {
  const result = validateNodeContract(null);
  assert.equal(result.valid, false);
});

test("validateNodeContract on a valid agent node returns { valid: true, errors: [] }", () => {
  const node = makeNode("agent");
  const result = validateNodeContract(node);
  assert.equal(result.valid, true, `Unexpected errors: ${result.errors.join(", ")}`);
  assert.deepEqual(result.errors, []);
});

test("validateNodeContract on an agent node missing 'role' returns { valid: false } with missingDataKeys including 'role'", () => {
  const node = makeNode("agent");
  // Remove the role field from data to simulate a missing required key
  node.data = { ...node.data, role: "" };
  const result = validateNodeContract(node);
  assert.equal(result.valid, false);
  assert.ok(result.missingDataKeys.includes("role"), `Expected missingDataKeys to include "role", got ${JSON.stringify(result.missingDataKeys)}`);
});

// ---------------------------------------------------------------------------
// normalizeNodeDataWithContract
// ---------------------------------------------------------------------------

test("normalizeNodeDataWithContract('agent', {}) fills in 'role' and 'mode' defaults", () => {
  const data = normalizeNodeDataWithContract("agent", {});
  assert.ok(data.role !== undefined && data.role !== "", `Expected data.role to be filled, got "${data.role}"`);
  assert.ok(data.mode !== undefined && data.mode !== "", `Expected data.mode to be filled, got "${data.mode}"`);
});

test("normalizeNodeDataWithContract('action', {}) fills in command: 'noop'", () => {
  const data = normalizeNodeDataWithContract("action", {});
  assert.equal(data.command, "noop");
});

test("normalizeNodeDataWithContract('data', {}) fills in sourceType, sourcePath, refreshMode defaults", () => {
  const data = normalizeNodeDataWithContract("data", {});
  assert.ok(data.sourceType !== undefined && data.sourceType !== "", "Expected sourceType to be filled");
  assert.ok(data.sourcePath !== undefined && data.sourcePath !== "", "Expected sourcePath to be filled");
  assert.ok(data.refreshMode !== undefined && data.refreshMode !== "", "Expected refreshMode to be filled");
});

test("normalizeNodeDataWithContract('agent', {}) adds runtimePolicy with maxAttempts/retryBackoffMs", () => {
  const data = normalizeNodeDataWithContract("agent", {});
  assert.ok(typeof data.runtimePolicy === "object" && data.runtimePolicy !== null, "Expected runtimePolicy to be an object");
  assert.ok(typeof data.runtimePolicy.maxAttempts === "number", "Expected runtimePolicy.maxAttempts to be a number");
  assert.ok(typeof data.runtimePolicy.retryBackoffMs === "number", "Expected runtimePolicy.retryBackoffMs to be a number");
});

// ---------------------------------------------------------------------------
// getDefaultPortsForNodeType
// ---------------------------------------------------------------------------

test("getDefaultPortsForNodeType('data') returns no input ports and at least 1 output port", () => {
  const ports = getDefaultPortsForNodeType("data");
  assert.ok(Array.isArray(ports.input), "Expected input to be an array");
  assert.equal(ports.input.length, 0, "Data node should have no input ports");
  assert.ok(ports.output.length >= 1, "Data node should have at least 1 output port");
  // The first output port for data is "dataset"
  assert.equal(ports.output[0].id, "dataset");
});

test("getDefaultPortsForNodeType('agent') returns input ports and output ports", () => {
  const ports = getDefaultPortsForNodeType("agent");
  assert.ok(ports.input.length >= 1, "Agent should have at least 1 input port");
  assert.ok(ports.output.length >= 1, "Agent should have at least 1 output port");
});

// ---------------------------------------------------------------------------
// validateEdgeSemantics
// ---------------------------------------------------------------------------

test("validateEdgeSemantics(null, ...) returns { valid: false }", () => {
  const result = validateEdgeSemantics(null, null, null);
  assert.equal(result.valid, false);
});

test("validateEdgeSemantics(edge, null, null) returns { valid: false } (missing endpoints)", () => {
  const edge = makeEdge("depends_on", "agent_1", "agent_2");
  const result = validateEdgeSemantics(edge, null, null);
  assert.equal(result.valid, false);
});

test("a valid depends_on edge from agent to agent validates successfully", () => {
  const agentA = makeNode("agent");
  const agentB = { ...makeNode("agent"), id: "agent_2" };
  const edge = makeEdge("depends_on", agentA.id, agentB.id);
  const result = validateEdgeSemantics(edge, agentA, agentB);
  assert.equal(result.valid, true, `Unexpected errors: ${result.errors.join(", ")}`);
});

test("an invalid edge type between incompatible node types returns { valid: false }", () => {
  // "triggers" only allows source: agent|action -> target: agent|action
  // data -> data is not valid for "triggers"
  const dataA = makeNode("data");
  const dataB = { ...makeNode("data"), id: "data_2" };
  const edge = makeEdge("triggers", dataA.id, dataB.id);
  const result = validateEdgeSemantics(edge, dataA, dataB);
  assert.equal(result.valid, false);
});

test("a self-edge with type 'depends_on' (source === target) returns { valid: false }", () => {
  const agent = makeNode("agent");
  const edge = makeEdge("depends_on", agent.id, agent.id);
  const result = validateEdgeSemantics(edge, agent, agent);
  assert.equal(result.valid, false);
});

// ---------------------------------------------------------------------------
// inferDefaultEdgeType
// ---------------------------------------------------------------------------

test("inferDefaultEdgeType(dataNode, agentNode) returns 'feeds_data'", () => {
  const dataNode = makeNode("data");
  const agentNode = makeNode("agent");
  assert.equal(inferDefaultEdgeType(dataNode, agentNode), "feeds_data");
});

test("inferDefaultEdgeType(agentNode, dataNode) returns 'reads_from'", () => {
  const agentNode = makeNode("agent");
  const dataNode = makeNode("data");
  assert.equal(inferDefaultEdgeType(agentNode, dataNode), "reads_from");
});

test("inferDefaultEdgeType(agentNode, agentNode) returns 'depends_on'", () => {
  const agentA = makeNode("agent");
  const agentB = { ...makeNode("agent"), id: "agent_2" };
  assert.equal(inferDefaultEdgeType(agentA, agentB), "depends_on");
});

test("inferDefaultEdgeType(noteNode, agentNode) returns 'references'", () => {
  const noteNode = makeNode("note");
  const agentNode = makeNode("agent");
  assert.equal(inferDefaultEdgeType(noteNode, agentNode), "references");
});

// ---------------------------------------------------------------------------
// getEdgeContractEndpoints
// ---------------------------------------------------------------------------

test("for READS_FROM edge, getEdgeContractEndpoints reverses: providerNode is the target (data node)", () => {
  const agentNode = makeNode("agent");
  const dataNode = { ...makeNode("data"), id: "data_1" };
  // source=agent reads_from target=data => provider is data (target), consumer is agent (source)
  const edge = makeEdge("reads_from", agentNode.id, dataNode.id);
  const endpoints = getEdgeContractEndpoints(edge, agentNode, dataNode);
  assert.equal(endpoints.providerNode, dataNode, "For reads_from, providerNode should be the target (data) node");
  assert.equal(endpoints.consumerNode, agentNode, "For reads_from, consumerNode should be the source (agent) node");
});

test("for FEEDS_DATA edge, getEdgeContractEndpoints normal: providerNode is source, consumerNode is target", () => {
  const dataNode = makeNode("data");
  const agentNode = { ...makeNode("agent"), id: "agent_2" };
  // source=data feeds_data target=agent => provider is data (source), consumer is agent (target)
  const edge = makeEdge("feeds_data", dataNode.id, agentNode.id);
  const endpoints = getEdgeContractEndpoints(edge, dataNode, agentNode);
  assert.equal(endpoints.providerNode, dataNode, "For feeds_data, providerNode should be the source (data) node");
  assert.equal(endpoints.consumerNode, agentNode, "For feeds_data, consumerNode should be the target (agent) node");
});
