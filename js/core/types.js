export const NODE_TYPES = Object.freeze({
	CHUNK: "chunk",
	CLUSTER: "cluster",
	QUESTION: "question",
	PATTERN: "pattern",
	TRIGGER: "trigger",
});

export const EDGE_TYPES = Object.freeze({
	LINKED_TO: "linked_to",
	AMENDS: "amends",
	CONTRADICTS: "contradicts",
	PROMOTES_TO: "promotes_to",
	ANSWERS: "answers",
	DECOMPOSES_TO: "decomposes_to",
	CLUSTERS_WITH: "clusters_with",
	PRECEDED_BY: "preceded_by",
	TRIGGERS: "triggers",
});

export const CHUNK_TIERS = Object.freeze({
	T1: 1,
	T2: 2,
	T3: 3,
});

export const QUESTION_LEVELS = Object.freeze({
	L1_BARE_FACT: 1,
	L2_EXPLANATION: 2,
	L3_IMPLICATION: 3,
	L4_COUNTERFACTUAL: 4,
	L5_CONDITIONAL: 5,
});

export const NODE_TYPE_VALUES = Object.freeze(Object.values(NODE_TYPES));
export const EDGE_TYPE_VALUES = Object.freeze(Object.values(EDGE_TYPES));
