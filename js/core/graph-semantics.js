// @ts-check

import { getDefaultPortsFromPresets } from "./contract-presets.js";
import { EDGE_TYPES, NODE_TYPES } from "./types.js";

/** @typedef {import("./jsdoc-types.js").GraphNode} GraphNode */
/** @typedef {import("./jsdoc-types.js").GraphEdge} GraphEdge */
/** @typedef {import("./jsdoc-types.js").PortContract} PortContract */
/** @typedef {import("./jsdoc-types.js").PayloadType} PayloadType */

const ALL_NODE_TYPES = Object.freeze(Object.values(NODE_TYPES));
export const PORT_PAYLOAD_TYPES = Object.freeze([
  "any",
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "null",
  "none"
]);

const EXECUTION_EDGE_TYPES = Object.freeze([EDGE_TYPES.DEPENDS_ON, EDGE_TYPES.TRIGGERS]);
const DATA_EDGE_TYPES = Object.freeze([
  EDGE_TYPES.FEEDS_DATA,
  EDGE_TYPES.READS_FROM,
  EDGE_TYPES.WRITES_TO,
  EDGE_TYPES.TRANSFORMS
]);
const HIERARCHY_EDGE_TYPES = Object.freeze([EDGE_TYPES.PARENT_OF]);
const INFORMATIONAL_EDGE_TYPES = Object.freeze([
  EDGE_TYPES.INFORMS,
  EDGE_TYPES.CRITIQUES,
  EDGE_TYPES.REPORTS_TO,
  EDGE_TYPES.REFERENCES
]);

const nodeTypeSpecEntries = [
  [
    NODE_TYPES.NOTE,
    {
      role: "reference",
      executable: false,
      requiredDataKeys: [],
      requiredInputSources: 0,
      outputField: null,
      description: "Human context, notes, and annotations."
    }
  ],
  [
    NODE_TYPES.DATA,
    {
      role: "data_source",
      executable: false,
      requiredDataKeys: ["sourceType", "sourcePath", "refreshMode"],
      requiredInputSources: 0,
      outputField: "cachedData",
      description: "External or embedded structured data source."
    }
  ],
  [
    NODE_TYPES.TRANSFORMER,
    {
      role: "transform",
      executable: true,
      requiredDataKeys: ["transformExpression"],
      requiredInputSources: 1,
      outputField: "lastOutput",
      description: "Deterministic transformation from upstream inputs into normalized output."
    }
  ],
  [
    NODE_TYPES.AGENT,
    {
      role: "reasoning",
      executable: true,
      requiredDataKeys: ["role", "mode"],
      requiredInputSources: 1,
      outputField: "lastOutput",
      description: "Reasoning/orchestration node that consumes context and emits structured output."
    }
  ],
  [
    NODE_TYPES.VIEW,
    {
      role: "presentation",
      executable: true,
      requiredDataKeys: ["outputTemplate"],
      requiredInputSources: 1,
      outputField: "lastOutput",
      description: "Presentation node that composes a readable artifact from upstream outputs."
    }
  ],
  [
    NODE_TYPES.ACTION,
    {
      role: "side_effect",
      executable: true,
      requiredDataKeys: ["command"],
      requiredInputSources: 1,
      outputField: "lastOutput",
      description: "Side-effect node that executes an operation using upstream context."
    }
  ]
];

export const NODE_TYPE_SPECS = Object.freeze(Object.fromEntries(nodeTypeSpecEntries));

const edgeTypeSpecEntries = [
  [
    EDGE_TYPES.DEPENDS_ON,
    {
      category: "execution",
      affectsExecution: true,
      affectsDataFlow: false,
      affectsHierarchy: false,
      informationalOnly: false,
      description: "Target cannot execute until source completes successfully.",
      validSourceTypes: ALL_NODE_TYPES,
      validTargetTypes: [NODE_TYPES.AGENT, NODE_TYPES.TRANSFORMER, NODE_TYPES.VIEW, NODE_TYPES.ACTION]
    }
  ],
  [
    EDGE_TYPES.TRIGGERS,
    {
      category: "execution",
      affectsExecution: true,
      affectsDataFlow: false,
      affectsHierarchy: false,
      informationalOnly: false,
      description: "Source completion requests target execution.",
      validSourceTypes: [NODE_TYPES.AGENT, NODE_TYPES.ACTION],
      validTargetTypes: [NODE_TYPES.AGENT, NODE_TYPES.ACTION]
    }
  ],
  [
    EDGE_TYPES.PARENT_OF,
    {
      category: "hierarchy",
      affectsExecution: false,
      affectsDataFlow: false,
      affectsHierarchy: true,
      informationalOnly: false,
      description: "Containment/scope relationship used for subtree selection.",
      validSourceTypes: [NODE_TYPES.NOTE, NODE_TYPES.AGENT, NODE_TYPES.TRANSFORMER, NODE_TYPES.VIEW, NODE_TYPES.ACTION],
      validTargetTypes: ALL_NODE_TYPES
    }
  ],
  [
    EDGE_TYPES.FEEDS_DATA,
    {
      category: "data",
      affectsExecution: false,
      affectsDataFlow: true,
      affectsHierarchy: false,
      informationalOnly: false,
      description: "Source output is available as structured input to target.",
      validSourceTypes: [NODE_TYPES.DATA, NODE_TYPES.TRANSFORMER, NODE_TYPES.AGENT, NODE_TYPES.VIEW, NODE_TYPES.ACTION],
      validTargetTypes: [NODE_TYPES.TRANSFORMER, NODE_TYPES.AGENT, NODE_TYPES.VIEW, NODE_TYPES.ACTION]
    }
  ],
  [
    EDGE_TYPES.READS_FROM,
    {
      category: "data",
      affectsExecution: false,
      affectsDataFlow: true,
      affectsHierarchy: false,
      informationalOnly: false,
      description: "Source consumes the target data source.",
      validSourceTypes: [NODE_TYPES.TRANSFORMER, NODE_TYPES.AGENT, NODE_TYPES.VIEW, NODE_TYPES.ACTION],
      validTargetTypes: [NODE_TYPES.DATA]
    }
  ],
  [
    EDGE_TYPES.WRITES_TO,
    {
      category: "data",
      affectsExecution: false,
      affectsDataFlow: true,
      affectsHierarchy: false,
      informationalOnly: false,
      description: "Source persists output to target sink.",
      validSourceTypes: [NODE_TYPES.TRANSFORMER, NODE_TYPES.AGENT, NODE_TYPES.ACTION],
      validTargetTypes: [NODE_TYPES.DATA, NODE_TYPES.VIEW]
    }
  ],
  [
    EDGE_TYPES.TRANSFORMS,
    {
      category: "data",
      affectsExecution: false,
      affectsDataFlow: true,
      affectsHierarchy: false,
      informationalOnly: false,
      description: "Source transforms target payload or context.",
      validSourceTypes: [NODE_TYPES.TRANSFORMER],
      validTargetTypes: [NODE_TYPES.DATA, NODE_TYPES.AGENT, NODE_TYPES.VIEW]
    }
  ],
  [
    EDGE_TYPES.INFORMS,
    {
      category: "informational",
      affectsExecution: false,
      affectsDataFlow: false,
      affectsHierarchy: false,
      informationalOnly: true,
      description: "Reference/context link with no execution effect.",
      validSourceTypes: ALL_NODE_TYPES,
      validTargetTypes: ALL_NODE_TYPES
    }
  ],
  [
    EDGE_TYPES.CRITIQUES,
    {
      category: "informational",
      affectsExecution: false,
      affectsDataFlow: false,
      affectsHierarchy: false,
      informationalOnly: true,
      description: "Quality review or feedback relation.",
      validSourceTypes: [NODE_TYPES.AGENT, NODE_TYPES.NOTE],
      validTargetTypes: [NODE_TYPES.AGENT, NODE_TYPES.TRANSFORMER, NODE_TYPES.VIEW, NODE_TYPES.ACTION]
    }
  ],
  [
    EDGE_TYPES.REPORTS_TO,
    {
      category: "informational",
      affectsExecution: false,
      affectsDataFlow: false,
      affectsHierarchy: false,
      informationalOnly: true,
      description: "Organizational reporting relation.",
      validSourceTypes: [NODE_TYPES.AGENT, NODE_TYPES.ACTION, NODE_TYPES.VIEW],
      validTargetTypes: [NODE_TYPES.AGENT, NODE_TYPES.NOTE]
    }
  ],
  [
    EDGE_TYPES.REFERENCES,
    {
      category: "informational",
      affectsExecution: false,
      affectsDataFlow: false,
      affectsHierarchy: false,
      informationalOnly: true,
      description: "Loose reference-only link between nodes.",
      validSourceTypes: ALL_NODE_TYPES,
      validTargetTypes: ALL_NODE_TYPES
    }
  ]
];

export const EDGE_TYPE_SPECS = Object.freeze(Object.fromEntries(edgeTypeSpecEntries));

const hasType = (value, allowed = []) => allowed.includes(value);
/**
 * @param {string} value
 * @returns {PayloadType}
 */
const sanitizePayloadType = (value) =>
  /** @type {PayloadType} */ (PORT_PAYLOAD_TYPES.includes(value) ? value : "any");

/**
 * @param {unknown} ports
 * @returns {PortContract[]}
 */
const clonePorts = (ports) =>
  (Array.isArray(ports) ? ports : [])
    .map((port, index) => {
      const id = String(port?.id ?? `port_${index + 1}`).trim();
      if (!id) return null;
      return {
        id,
        label: String(port?.label ?? id),
        payloadType: sanitizePayloadType(String(port?.payloadType ?? "any")),
        required: port?.required !== false,
        schema: typeof port?.schema === "object" && port?.schema != null ? { ...port.schema } : {}
      };
    })
    .filter(Boolean);

/**
 * @param {string} nodeType
 * @returns {{ input: PortContract[], output: PortContract[] }}
 */
export const getDefaultPortsForNodeType = (nodeType) => {
  const defaults = getDefaultPortsFromPresets(nodeType);
  return {
    input: clonePorts(defaults.input),
    output: clonePorts(defaults.output)
  };
};

/** @param {string} nodeType */
export const getNodeTypeSpec = (nodeType) => NODE_TYPE_SPECS[nodeType] ?? NODE_TYPE_SPECS[NODE_TYPES.NOTE];
/** @param {string} edgeType */
export const getEdgeTypeSpec = (edgeType) => EDGE_TYPE_SPECS[edgeType] ?? null;

/** @param {string} nodeType */
export const isExecutableNodeType = (nodeType) => Boolean(getNodeTypeSpec(nodeType)?.executable);

/**
 * @param {GraphNode | null | undefined} nodeLike
 * @param {"input" | "output"} [direction]
 * @returns {PortContract[]}
 */
export const getNodePorts = (nodeLike, direction = "input") => {
  const nodeType = nodeLike?.type ?? NODE_TYPES.NOTE;
  const fallback = getDefaultPortsForNodeType(nodeType);
  const dataPorts = direction === "output" ? nodeLike?.data?.outputPorts : nodeLike?.data?.inputPorts;
  const normalized = clonePorts(dataPorts);
  return normalized.length ? normalized : direction === "output" ? fallback.output : fallback.input;
};

const findPort = (ports, portId) => {
  if (!portId) return null;
  return ports.find((port) => port.id === portId) ?? null;
};

const payloadCompatible = (sourceType, targetType) => {
  if (!sourceType || !targetType) return true;
  if (sourceType === "any" || targetType === "any") return true;
  return sourceType === targetType;
};

const resolveContractEndpoints = (edgeType, sourceNode, targetNode) => {
  if (edgeType === EDGE_TYPES.READS_FROM) {
    return {
      providerNode: targetNode,
      consumerNode: sourceNode,
      providerDirection: "target",
      consumerDirection: "source"
    };
  }

  return {
    providerNode: sourceNode,
    consumerNode: targetNode,
    providerDirection: "source",
    consumerDirection: "target"
  };
};

/**
 * @param {{ type?: string } | null | undefined} edge
 * @param {GraphNode | null | undefined} sourceNode
 * @param {GraphNode | null | undefined} targetNode
 */
export const getEdgeContractEndpoints = (edge, sourceNode, targetNode) => {
  const { providerNode, consumerNode, providerDirection, consumerDirection } = resolveContractEndpoints(
    edge?.type,
    sourceNode,
    targetNode
  );
  const providerPorts = getNodePorts(providerNode, "output");
  const consumerPorts = getNodePorts(consumerNode, "input");

  return {
    providerNode,
    consumerNode,
    providerPorts,
    consumerPorts,
    providerDirection,
    consumerDirection
  };
};

/**
 * @param {string} edgeType
 * @param {GraphNode | null | undefined} sourceNode
 * @param {GraphNode | null | undefined} targetNode
 */
export const getDefaultEdgeContract = (edgeType, sourceNode, targetNode) => {
  const spec = getEdgeTypeSpec(edgeType);
  const { providerPorts, consumerPorts } = getEdgeContractEndpoints(
    { type: edgeType },
    sourceNode,
    targetNode
  );
  const sourcePort = providerPorts[0]?.id ?? null;
  const targetPort = consumerPorts[0]?.id ?? null;
  const sourceType = providerPorts[0]?.payloadType ?? "any";
  const targetType = consumerPorts[0]?.payloadType ?? "any";

  let payloadType = "none";
  if (spec?.affectsDataFlow) {
    payloadType = sourceType === "any" ? targetType : sourceType;
  }

  return {
    sourcePort,
    targetPort,
    payloadType: sanitizePayloadType(payloadType),
    schema: {},
    required: Boolean(spec?.affectsExecution || spec?.affectsDataFlow)
  };
};

/**
 * @param {GraphEdge | null | undefined} edge
 * @param {GraphNode | null | undefined} sourceNode
 * @param {GraphNode | null | undefined} targetNode
 */
export const applyEdgeContractDefaults = (edge, sourceNode, targetNode) => {
  if (!edge) return edge;
  const defaults = getDefaultEdgeContract(edge.type, sourceNode, targetNode);
  const current = edge.metadata?.contract ?? {};

  return {
    ...edge,
    metadata: {
      ...(edge.metadata ?? {}),
      contract: {
        ...defaults,
        ...(typeof current === "object" && current != null ? current : {}),
        payloadType: sanitizePayloadType(String(current?.payloadType ?? defaults.payloadType ?? "any")),
        schema: typeof current?.schema === "object" && current?.schema != null ? { ...current.schema } : {}
      }
    }
  };
};

const validateEdgeContract = (edge, sourceNode, targetNode) => {
  const spec = getEdgeTypeSpec(edge.type);
  const contract = edge.metadata?.contract ?? {};
  const { providerPorts, consumerPorts, providerDirection, consumerDirection } = getEdgeContractEndpoints(
    edge,
    sourceNode,
    targetNode
  );
  const errors = [];

  const formatPortRef = (port) => {
    if (!port) return "(missing)";
    return port.label && port.label !== port.id ? `${port.label} (${port.id})` : port.id;
  };

  const availablePortsText = (ports = []) =>
    ports.length ? ports.map((port) => formatPortRef(port)).join(", ") : "(none)";

  const sourcePortId = contract.sourcePort ?? null;
  const targetPortId = contract.targetPort ?? null;
  const selectedSourcePort = findPort(providerPorts, sourcePortId);
  const selectedTargetPort = findPort(consumerPorts, targetPortId);
  const sourcePort = selectedSourcePort ?? (providerPorts[0] ?? null);
  const targetPort = selectedTargetPort ?? (consumerPorts[0] ?? null);
  const payloadType = sanitizePayloadType(String(contract.payloadType ?? "any"));

  if (spec?.affectsDataFlow) {
    if (sourcePortId && !selectedSourcePort) {
      errors.push(
        `Edge ${edge.type} references unknown ${providerDirection} output port "${sourcePortId}". Available ${providerDirection} output ports: ${availablePortsText(providerPorts)}`
      );
    }
    if (targetPortId && !selectedTargetPort) {
      errors.push(
        `Edge ${edge.type} references unknown ${consumerDirection} input port "${targetPortId}". Available ${consumerDirection} input ports: ${availablePortsText(consumerPorts)}`
      );
    }

    if (!sourcePort) {
      errors.push(`Edge ${edge.type} requires a ${providerDirection} output port to provide payload data`);
    }
    if (!targetPort) {
      errors.push(`Edge ${edge.type} requires a ${consumerDirection} input port to receive payload data`);
    }

    if (sourcePort && !payloadCompatible(sourcePort.payloadType, payloadType)) {
      errors.push(
        `Edge ${edge.type} payload mismatch: ${providerDirection} port ${formatPortRef(sourcePort)} emits ${sourcePort.payloadType}, but contract declares ${payloadType}`
      );
    }

    if (targetPort && !payloadCompatible(payloadType, targetPort.payloadType)) {
      errors.push(
        `Edge ${edge.type} payload mismatch: ${consumerDirection} port ${formatPortRef(targetPort)} accepts ${targetPort.payloadType}, but contract declares ${payloadType}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * @param {string} nodeType
 * @param {Record<string, unknown>} [data]
 * @returns {Record<string, unknown>}
 */
export const normalizeNodeDataWithContract = (nodeType, data = {}) => {
  const spec = getNodeTypeSpec(nodeType);
  const next = { ...(data ?? {}) };

  for (const key of spec.requiredDataKeys ?? []) {
    if (next[key] == null || next[key] === "") {
      if (key === "sourceType") next[key] = "json";
      else if (key === "sourcePath") next[key] = "embedded:site_config";
      else if (key === "refreshMode") next[key] = "manual";
      else if (key === "transformExpression") next[key] = "identity";
      else if (key === "role") next[key] = "Agent";
      else if (key === "mode") next[key] = "orchestrate";
      else if (key === "outputTemplate") next[key] = "summary_card";
      else if (key === "command") next[key] = "noop";
      else next[key] = "";
    }
  }

  if (spec.outputField && next[spec.outputField] === undefined) {
    next[spec.outputField] = null;
  }

  if (next.lastRunAt === undefined && spec.executable) {
    next.lastRunAt = "";
  }

  if (next.lastRunSummary === undefined && spec.executable) {
    next.lastRunSummary = "";
  }

  if (next.status === undefined && spec.executable) {
    next.status = "idle";
  }

  if (spec.executable && (next.runtimePolicy == null || typeof next.runtimePolicy !== "object")) {
    next.runtimePolicy = {
      maxAttempts: 2,
      retryBackoffMs: 350,
      retryBackoffFactor: 1.7,
      failFast: false
    };
  }

  const defaultPorts = getDefaultPortsForNodeType(nodeType);
  next.inputPorts = clonePorts(next.inputPorts);
  next.outputPorts = clonePorts(next.outputPorts);
  if (!next.inputPorts.length) next.inputPorts = defaultPorts.input;
  if (!next.outputPorts.length) next.outputPorts = defaultPorts.output;

  return next;
};

/**
 * @param {GraphNode | null | undefined} node
 * @returns {{ valid: boolean, errors: string[], missingDataKeys: string[], spec?: unknown }}
 */
export const validateNodeContract = (node) => {
  if (!node) return { valid: false, errors: ["Node is missing"], missingDataKeys: [] };

  const spec = getNodeTypeSpec(node.type);
  const data = node.data ?? {};
  const missingDataKeys = (spec.requiredDataKeys ?? []).filter((key) => data[key] == null || data[key] === "");
  const errors = missingDataKeys.map((key) => `Node ${node.id} (${node.type}) missing required data field: ${key}`);

  const inputPorts = getNodePorts(node, "input");
  const outputPorts = getNodePorts(node, "output");
  const validatePorts = (ports, direction) => {
    const seen = new Set();
    for (const port of ports) {
      if (!port?.id) {
        errors.push(`Node ${node.id} has ${direction} port with missing id`);
        continue;
      }
      if (seen.has(port.id)) {
        errors.push(`Node ${node.id} has duplicate ${direction} port id: ${port.id}`);
      }
      seen.add(port.id);
      if (!PORT_PAYLOAD_TYPES.includes(port.payloadType)) {
        errors.push(`Node ${node.id} port ${port.id} has invalid payload type ${port.payloadType}`);
      }
    }
  };
  validatePorts(inputPorts, "input");
  validatePorts(outputPorts, "output");

  return {
    valid: errors.length === 0,
    errors,
    missingDataKeys,
    spec
  };
};

export const isEdgeTypeAllowedBetween = (edgeType, sourceNodeType, targetNodeType) => {
  const spec = getEdgeTypeSpec(edgeType);
  if (!spec) return false;

  return hasType(sourceNodeType, spec.validSourceTypes) && hasType(targetNodeType, spec.validTargetTypes);
};

/**
 * @param {GraphEdge | null | undefined} edge
 * @param {GraphNode | null | undefined} sourceNode
 * @param {GraphNode | null | undefined} targetNode
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateEdgeSemantics = (edge, sourceNode, targetNode) => {
  if (!edge) return { valid: false, errors: ["Edge is missing"] };
  const spec = getEdgeTypeSpec(edge.type);

  if (!spec) {
    return { valid: false, errors: [`Unknown edge type: ${edge.type}`] };
  }

  if (!sourceNode || !targetNode) {
    return { valid: false, errors: ["Edge endpoints must exist"] };
  }

  if (!isEdgeTypeAllowedBetween(edge.type, sourceNode.type, targetNode.type)) {
    return {
      valid: false,
      errors: [`Edge type ${edge.type} is invalid for ${sourceNode.type} -> ${targetNode.type}`]
    };
  }

  if (edge.source === edge.target && edge.type !== EDGE_TYPES.REFERENCES) {
    return { valid: false, errors: [`Self-edge is only allowed for ${EDGE_TYPES.REFERENCES}`] };
  }

  const normalizedEdge = applyEdgeContractDefaults(edge, sourceNode, targetNode);
  const contractValidation = validateEdgeContract(normalizedEdge, sourceNode, targetNode);
  if (!contractValidation.valid) {
    return {
      valid: false,
      errors: contractValidation.errors
    };
  }

  return { valid: true, errors: [] };
};

export const inferDefaultEdgeType = (sourceNode, targetNode) => {
  if (!sourceNode || !targetNode) return EDGE_TYPES.DEPENDS_ON;

  if (sourceNode.type === NODE_TYPES.DATA && isExecutableNodeType(targetNode.type)) {
    return EDGE_TYPES.FEEDS_DATA;
  }

  if (isExecutableNodeType(sourceNode.type) && targetNode.type === NODE_TYPES.DATA) {
    return EDGE_TYPES.READS_FROM;
  }

  if (isExecutableNodeType(sourceNode.type) && isExecutableNodeType(targetNode.type)) {
    return EDGE_TYPES.DEPENDS_ON;
  }

  if (sourceNode.type === NODE_TYPES.NOTE || targetNode.type === NODE_TYPES.NOTE) {
    return EDGE_TYPES.REFERENCES;
  }

  return EDGE_TYPES.INFORMS;
};

export const getEdgeCreationPresets = (sourceNode, targetNode) => {
  return Object.entries(EDGE_TYPE_SPECS).map(([type, spec]) => {
    const valid = sourceNode && targetNode
      ? isEdgeTypeAllowedBetween(type, sourceNode.type, targetNode.type)
      : false;

    const contract = sourceNode && targetNode ? getDefaultEdgeContract(type, sourceNode, targetNode) : null;
    const reason = valid
      ? `Valid for ${sourceNode?.type ?? "source"} -> ${targetNode?.type ?? "target"}`
      : `Not valid for ${sourceNode?.type ?? "source"} -> ${targetNode?.type ?? "target"}`;

    return {
      type,
      category: spec.category,
      description: spec.description,
      valid,
      reason,
      contract
    };
  });
};

export const edgeAffectsExecution = (edgeType) => EXECUTION_EDGE_TYPES.includes(edgeType);
export const edgeAffectsDataFlow = (edgeType) => DATA_EDGE_TYPES.includes(edgeType);
export const edgeDefinesHierarchy = (edgeType) => HIERARCHY_EDGE_TYPES.includes(edgeType);
export const edgeIsInformational = (edgeType) => INFORMATIONAL_EDGE_TYPES.includes(edgeType);

export const SEMANTIC_EDGE_GROUPS = Object.freeze({
  execution: EXECUTION_EDGE_TYPES,
  data: DATA_EDGE_TYPES,
  hierarchy: HIERARCHY_EDGE_TYPES,
  informational: INFORMATIONAL_EDGE_TYPES
});
