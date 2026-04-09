/**
 * Shared JSDoc-only types for IDE intelligence.
 * This file is intentionally runtime-empty.
 */

/**
 * @typedef {"note" | "data" | "u2os_trigger" | "transformer" | "agent" | "view" | "action"} NodeType
 */

/**
 * @typedef {(
 *   "depends_on" |
 *   "triggers" |
 *   "feeds_data" |
 *   "reads_from" |
 *   "writes_to" |
 *   "transforms" |
 *   "parent_of" |
 *   "informs" |
 *   "critiques" |
 *   "reports_to" |
 *   "references"
 * )} EdgeType
 */

/**
 * @typedef {(
 *   "any" |
 *   "object" |
 *   "array" |
 *   "string" |
 *   "number" |
 *   "boolean" |
 *   "null" |
 *   "none"
 * )} PayloadType
 */

/**
 * @typedef {Object} PortContract
 * @property {string} id
 * @property {string} label
 * @property {PayloadType} payloadType
 * @property {boolean} required
 * @property {Record<string, unknown>} schema
 */

/**
 * @typedef {Object} RuntimePolicy
 * @property {number} [maxAttempts]
 * @property {number} [retryBackoffMs]
 * @property {number} [retryBackoffFactor]
 * @property {boolean} [failFast]
 * @property {number} [batchConcurrencyLimit]
 * @property {number} [concurrencyLimit]
 */

/**
 * @typedef {Object<string, unknown> & {
 *   inputPorts?: PortContract[],
 *   outputPorts?: PortContract[],
 *   status?: string,
 *   lastRunAt?: string,
 *   lastRunSummary?: string,
 *   lastOutput?: unknown,
 *   runHistory?: Array<{ at?: string, runId?: string, status?: string, summary?: string, confidence?: number }>,
 *   cachedData?: unknown,
 *   runtimePolicy?: RuntimePolicy
 * }} NodeData
 */

/**
 * @typedef {Object} GraphNode
 * @property {string} id
 * @property {NodeType} type
 * @property {string} label
 * @property {string} [description]
 * @property {{ x: number, y: number }} position
 * @property {NodeData} data
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} EdgeContract
 * @property {string | null} [sourcePort]
 * @property {string | null} [targetPort]
 * @property {PayloadType} [payloadType]
 * @property {boolean} [required]
 * @property {Record<string, unknown>} [schema]
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} id
 * @property {EdgeType} type
 * @property {string} source
 * @property {string} target
 * @property {string} [label]
 * @property {{ contract?: EdgeContract } & Record<string, unknown>} [metadata]
 */

/**
 * @typedef {Object} GraphDocument
 * @property {string} id
 * @property {string} title
 * @property {string} [version]
 * @property {number} [schemaVersion]
 * @property {GraphNode[]} nodes
 * @property {GraphEdge[]} edges
 * @property {{ x: number, y: number, zoom: number }} [viewport]
 * @property {Record<string, unknown> & {
 *   runtimePolicy?: RuntimePolicy,
 *   selection?: string[],
 *   selectedNodeId?: string | null,
 *   selectedEdgeId?: string | null
 * }} [metadata]
 */

/**
 * @typedef {Object} NodeExecutionPlan
 * @property {string} nodeId
 * @property {string} type
 * @property {string} role
 * @property {boolean} runnable
 * @property {boolean} ready
 * @property {boolean} blocked
 * @property {string[]} blockedReasons
 * @property {string[]} contractMissingFields
 * @property {string[]} missingRequiredPorts
 * @property {string[]} upstreamDependencies
 * @property {string[]} dataProviderIds
 * @property {string[]} staleDependencies
 * @property {boolean} needsRerun
 * @property {boolean} isInCycle
 * @property {number} executionOrderIndex
 */

/**
 * @typedef {Object} ExecutionPlan
 * @property {string | null} rootNodeId
 * @property {string[]} scopeNodeIds
 * @property {string[]} runnableNodeIds
 * @property {string[]} readyNodeIds
 * @property {string[]} blockedNodeIds
 * @property {string[][]} cycles
 * @property {string[]} executionOrder
 * @property {Record<string, NodeExecutionPlan>} nodes
 * @property {Record<string, string[]>} [edgeGroups]
 */

/**
 * @typedef {Object} RuntimeResult
 * @property {boolean} ok
 * @property {string} nodeId
 * @property {string} [runId]
 * @property {string} [status]
 * @property {string} [error]
 * @property {unknown} [output]
 */

export {};
