// @ts-check

import { EDGE_TYPE_VALUES, NODE_TYPE_VALUES } from "./types.js";
import { clone, uid } from "./utils.js";
import { normalizeNodeDataWithContract, validateEdgeSemantics, validateNodeContract } from "./graph-semantics.js";
import { CURRENT_GRAPH_SCHEMA_VERSION } from "./graph-migrations.js";

/** @typedef {import("./jsdoc-types.js").GraphDocument} GraphDocument */
/** @typedef {import("./jsdoc-types.js").GraphNode} GraphNode */
/** @typedef {import("./jsdoc-types.js").GraphEdge} GraphEdge */

/**
 * @param {Partial<GraphNode>} [partial]
 * @returns {GraphNode}
 */
export const createNode = (partial = {}) => ({
  id: partial.id ?? uid("node"),
  type: NODE_TYPE_VALUES.includes(partial.type) ? partial.type : "note",
  label: partial.label ?? "Untitled Node",
  description: partial.description ?? "",
  position: partial.position ?? { x: 0, y: 0 },
  data: normalizeNodeDataWithContract(
    NODE_TYPE_VALUES.includes(partial.type) ? partial.type : "note",
    partial.data ?? {}
  ),
  metadata: partial.metadata ?? {}
});

/**
 * @param {Partial<GraphEdge>} [partial]
 * @returns {GraphEdge}
 */
export const createEdge = (partial = {}) => ({
  id: partial.id ?? uid("edge"),
  type: EDGE_TYPE_VALUES.includes(partial.type) ? partial.type : "depends_on",
  source: partial.source ?? "",
  target: partial.target ?? "",
  label: partial.label ?? "",
  metadata: partial.metadata ?? {}
});

/**
 * @param {Partial<GraphDocument>} [options]
 * @returns {GraphDocument}
 */
export const createGraphDocument = ({
  id = uid("graph"),
  title = "Untitled MindGraph",
  version = "0.1.0",
  schemaVersion = CURRENT_GRAPH_SCHEMA_VERSION,
  nodes = [],
  edges = [],
  viewport = { x: 0, y: 0, zoom: 1 },
  metadata = {}
} = {}) => ({
  id,
  title,
  version,
  schemaVersion,
  nodes: nodes.map((node) => createNode(node)),
  edges: edges.map((edge) => createEdge(edge)),
  viewport,
  metadata
});

/**
 * @param {Partial<GraphDocument>} [rawDocument]
 * @returns {GraphDocument}
 */
export const normalizeGraphDocument = (rawDocument = {}) =>
  createGraphDocument({
    ...rawDocument,
    nodes: Array.isArray(rawDocument.nodes) ? rawDocument.nodes : [],
    edges: Array.isArray(rawDocument.edges) ? rawDocument.edges : []
  });

/**
 * @param {GraphDocument | null | undefined} document
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateGraphDocument = (document) => {
  if (!document || typeof document !== "object") {
    return { valid: false, errors: ["Document must be an object"] };
  }

  const errors = [];
  if (!Array.isArray(document.nodes)) errors.push("nodes must be an array");
  if (!Array.isArray(document.edges)) errors.push("edges must be an array");

  for (const node of document.nodes ?? []) {
    if (!NODE_TYPE_VALUES.includes(node.type)) {
      errors.push(`Invalid node type: ${node.type}`);
      continue;
    }

    const contractValidation = validateNodeContract(node);
    if (!contractValidation.valid) {
      errors.push(...contractValidation.errors);
    }
  }

  const nodeById = new Map((document.nodes ?? []).map((node) => [node.id, node]));
  for (const edge of document.edges ?? []) {
    if (!EDGE_TYPE_VALUES.includes(edge.type)) {
      errors.push(`Invalid edge type: ${edge.type}`);
      continue;
    }

    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const edgeValidation = validateEdgeSemantics(edge, source, target);
    if (!edgeValidation.valid) {
      errors.push(...edgeValidation.errors.map((message) => `${edge.id ?? "(new edge)"}: ${message}`));
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * @param {GraphDocument} document
 * @param {string} nodeId
 * @param {Partial<GraphNode>} patch
 * @returns {GraphDocument}
 */
export const updateNode = (document, nodeId, patch) => {
  const next = clone(document);
  next.nodes = next.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node));
  return next;
};

/**
 * @param {GraphDocument} document
 * @param {string} nodeId
 * @returns {GraphNode | null}
 */
export const findNodeById = (document, nodeId) =>
  (document.nodes ?? []).find((node) => node.id === nodeId) ?? null;

/**
 * @param {GraphDocument} document
 * @param {string} edgeId
 * @returns {GraphEdge | null}
 */
export const findEdgeById = (document, edgeId) =>
  (document.edges ?? []).find((edge) => edge.id === edgeId) ?? null;
