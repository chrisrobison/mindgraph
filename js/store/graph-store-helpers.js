// @ts-check

import { normalizeNodeDataWithContract } from "../core/graph-semantics.js";

/** @typedef {import("../core/jsdoc-types.js").GraphDocument} GraphDocument */
/** @typedef {import("../core/jsdoc-types.js").GraphNode} GraphNode */
/** @typedef {import("../core/jsdoc-types.js").GraphEdge} GraphEdge */

/**
 * @param {unknown} items
 * @returns {string[]}
 */
export const uniqueIds = (items) =>
  [...new Set((Array.isArray(items) ? items : []).filter((value) => typeof value === "string" && value.trim().length > 0))];

/**
 * @param {GraphDocument} document
 * @param {string} edgeId
 * @returns {GraphEdge | null}
 */
export const findEdgeByIdCompat = (document, edgeId) =>
  (document?.edges ?? []).find((edge) => edge.id === edgeId) ?? null;

/**
 * @param {GraphNode} existing
 * @param {Record<string, unknown>} patch
 * @returns {Record<string, unknown>}
 */
export const normalizeNodePatch = (existing, patch) => {
  const normalizedPatch = { ...patch };
  if (normalizedPatch.type && normalizedPatch.type !== existing.type) {
    normalizedPatch.data = normalizeNodeDataWithContract(String(normalizedPatch.type), normalizedPatch.data ?? {});
  }
  if (normalizedPatch.position) {
    normalizedPatch.position = {
      x: Number(normalizedPatch.position.x ?? existing.position?.x ?? 0),
      y: Number(normalizedPatch.position.y ?? existing.position?.y ?? 0)
    };
  }
  if (normalizedPatch.data) {
    const nextType = String(normalizedPatch.type ?? existing.type);
    normalizedPatch.data = normalizeNodeDataWithContract(nextType, {
      ...(existing.data ?? {}),
      ...(normalizedPatch.data ?? {})
    });
  }
  return normalizedPatch;
};

/**
 * @param {GraphEdge[]} edges
 * @param {GraphEdge} edge
 * @returns {boolean}
 */
export const isDuplicateEdge = (edges, edge) =>
  edges.some(
    (entry) =>
      entry.id === edge.id ||
      (entry.source === edge.source &&
        entry.target === edge.target &&
        entry.type === edge.type &&
        String(entry.label ?? "") === String(edge.label ?? ""))
  );
