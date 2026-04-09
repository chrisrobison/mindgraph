// @ts-check

import { EVENTS } from "./event-constants.js";

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const isString = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * @param {unknown} payload
 * @returns {boolean}
 */
const hasPatchObject = (payload) => isObject(payload) && isObject(payload.patch);

/** @type {Record<string, (payload: unknown) => boolean>} */
const validators = Object.freeze({
  [EVENTS.GRAPH_NODE_UPDATE_REQUESTED]: (payload) =>
    isObject(payload) && isString(payload.nodeId) && isObject(payload.patch),
  [EVENTS.GRAPH_NODE_MOVE_REQUESTED]: (payload) =>
    isObject(payload) &&
    isString(payload.nodeId) &&
    isObject(payload.position) &&
    Number.isFinite(Number(payload.position.x)) &&
    Number.isFinite(Number(payload.position.y)),
  [EVENTS.GRAPH_NODE_CREATE_REQUESTED]: (payload) =>
    payload == null || isObject(payload),
  [EVENTS.GRAPH_NODE_DELETE_REQUESTED]: (payload) =>
    isObject(payload) &&
    (isString(payload.nodeId) ||
      (Array.isArray(payload.nodeIds) && payload.nodeIds.every((id) => isString(id)))),
  [EVENTS.GRAPH_EDGE_CREATE_REQUESTED]: (payload) => isObject(payload),
  [EVENTS.GRAPH_EDGE_UPDATE_REQUESTED]: (payload) =>
    isObject(payload) && isString(payload.edgeId) && isObject(payload.patch),
  [EVENTS.GRAPH_EDGE_DELETE_REQUESTED]: (payload) =>
    isObject(payload) && isString(payload.edgeId),
  [EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED]: (payload) =>
    isObject(payload) && payload.document != null && isObject(payload.document),
  [EVENTS.GRAPH_DOCUMENT_DETAILS_UPDATE_REQUESTED]: hasPatchObject,
  [EVENTS.GRAPH_METADATA_UPDATE_REQUESTED]: hasPatchObject,
  [EVENTS.RUNTIME_AGENT_RUN_REQUESTED]: (payload) =>
    isObject(payload) && isString(payload.nodeId),
  [EVENTS.RUNTIME_SUBTREE_RUN_REQUESTED]: (payload) =>
    isObject(payload) && isString(payload.nodeId),
  [EVENTS.RUNTIME_PROVIDER_SETTINGS_UPDATE_REQUESTED]: hasPatchObject,
  [EVENTS.UI_SETTINGS_UPDATE_REQUESTED]: hasPatchObject
});

/**
 * @param {string} eventName
 * @param {unknown} payload
 * @returns {{ ok: boolean, reason?: string }}
 */
export const validateEventPayload = (eventName, payload) => {
  const validator = validators[eventName];
  if (!validator) return { ok: true };
  return validator(payload)
    ? { ok: true }
    : { ok: false, reason: `Payload shape mismatch for ${eventName}` };
};

