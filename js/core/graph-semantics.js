import { EDGE_TYPES, NODE_TYPES } from "./types.js";

const ALL_NODE_TYPES = Object.freeze(Object.values(NODE_TYPES));

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

export const getNodeTypeSpec = (nodeType) => NODE_TYPE_SPECS[nodeType] ?? NODE_TYPE_SPECS[NODE_TYPES.NOTE];
export const getEdgeTypeSpec = (edgeType) => EDGE_TYPE_SPECS[edgeType] ?? null;

export const isExecutableNodeType = (nodeType) => Boolean(getNodeTypeSpec(nodeType)?.executable);

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

  return next;
};

export const validateNodeContract = (node) => {
  if (!node) return { valid: false, errors: ["Node is missing"], missingDataKeys: [] };

  const spec = getNodeTypeSpec(node.type);
  const data = node.data ?? {};
  const missingDataKeys = (spec.requiredDataKeys ?? []).filter((key) => data[key] == null || data[key] === "");
  const errors = missingDataKeys.map((key) => `Node ${node.id} (${node.type}) missing required data field: ${key}`);

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
      errors: [
        `Edge type ${edge.type} is invalid for ${sourceNode.type} -> ${targetNode.type}`
      ]
    };
  }

  if (edge.source === edge.target && edge.type !== EDGE_TYPES.REFERENCES) {
    return { valid: false, errors: [`Self-edge is only allowed for ${EDGE_TYPES.REFERENCES}`] };
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
