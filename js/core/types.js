export const NODE_TYPES = Object.freeze({
  NOTE: "note",
  AGENT: "agent",
  DATA: "data",
  U2OS_TRIGGER: "u2os_trigger",
  U2OS_QUERY: "u2os_query",
  U2OS_MUTATE: "u2os_mutate",
  U2OS_EMIT: "u2os_emit",
  TRANSFORMER: "transformer",
  VIEW: "view",
  ACTION: "action"
});

export const EDGE_TYPES = Object.freeze({
  PARENT_OF: "parent_of",
  DEPENDS_ON: "depends_on",
  FEEDS_DATA: "feeds_data",
  INFORMS: "informs",
  READS_FROM: "reads_from",
  WRITES_TO: "writes_to",
  TRANSFORMS: "transforms",
  CRITIQUES: "critiques",
  REPORTS_TO: "reports_to",
  TRIGGERS: "triggers",
  REFERENCES: "references"
});

export const NODE_TYPE_VALUES = Object.freeze(Object.values(NODE_TYPES));
export const EDGE_TYPE_VALUES = Object.freeze(Object.values(EDGE_TYPES));
