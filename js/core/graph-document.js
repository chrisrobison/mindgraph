import { EDGE_TYPE_VALUES, NODE_TYPE_VALUES } from "./types.js";
import { clone, nowIso, uid } from "./utils.js";

/* ── Default metadata factories per node type ── */

const defaultChunkData = () => ({
	content: "",
	tier: 1,
	session_id: "",
	source: "user_stated",
	source_reliability: "high",
	participants: [],
	emotional_tone: "neutral",
	emotional_intensity: 0,
	stakes_level: "low",
	topic_tags: [],
	entity_tags: [],
	decision_made: false,
	action_items: [],
	status: "open",
	preceding_context_id: null,
	following_context_id: null,
	access_count: 1,
	last_accessed: nowIso(),
	retrieval_cues: [],
	amendments: [],
	linked_chunks: [],
	generated_questions: [],
});

const defaultQuestionData = () => ({
	level: 1,
	question_text: "",
	answer_text: null,
	answered: false,
	parent_question_id: null,
	linked_chunk_ids: [],
	confidence: null,
});

const defaultPatternData = () => ({
	pattern: "",
	evidence: [],
	confidence: 0,
	implication: "",
	pattern_type: "causal_recurring",
	exceptions: [],
});

const defaultTriggerData = () => ({
	content: "",
	trigger_conditions: [],
	expires: null,
	fired: false,
	fire_count: 0,
});

const defaultClusterData = () => ({
	member_ids: [],
	cluster_strength: 0,
	shared_tags: [],
	shared_entities: [],
	color: 0xffffff,
});

const DATA_FACTORY_BY_TYPE = {
	chunk: defaultChunkData,
	question: defaultQuestionData,
	pattern: defaultPatternData,
	trigger: defaultTriggerData,
	cluster: defaultClusterData,
};

/* ── Node / Edge factories ── */

export const createNode = (partial = {}) => {
	const type = partial.type ?? "chunk";
	const factory = DATA_FACTORY_BY_TYPE[type] ?? defaultChunkData;
	const defaults = factory();
	return {
		id: partial.id ?? uid("node"),
		type,
		label: partial.label ?? "Untitled",
		description: partial.description ?? "",
		position: {
			x: Number(partial.position?.x ?? 0),
			y: Number(partial.position?.y ?? 0),
			z: Number(partial.position?.z ?? 0),
		},
		data: { ...defaults, ...(partial.data ?? {}) },
		metadata: { createdAt: nowIso(), ...(partial.metadata ?? {}) },
	};
};

export const createEdge = (partial = {}) => ({
	id: partial.id ?? uid("edge"),
	type: partial.type ?? "linked_to",
	source: partial.source ?? "",
	target: partial.target ?? "",
	label: partial.label ?? "",
	metadata: partial.metadata ?? {},
});

/* ── Graph document ── */

export const createGraphDocument = ({
	id = uid("brain"),
	title = "CAR Brain",
	version = "1.0.0",
	project = null,
	runner = "claude-code",
	nodes = [],
	edges = [],
	clusters = [],
	viewport = { x: 0, y: 0, z: 0, zoom: 1, rotationX: 0, rotationY: 0 },
	metadata = {},
} = {}) => ({
	id,
	title,
	version,
	project,
	runner,
	nodes: nodes.map((node) => createNode(node)),
	edges: edges.map((edge) => createEdge(edge)),
	clusters,
	viewport,
	metadata: {
		createdBy: "car-brain",
		description: "",
		selection: [],
		lastSession: nowIso(),
		totalChunks: 0,
		totalQueries: 0,
		...metadata,
	},
});

export const normalizeGraphDocument = (rawDocument = {}) =>
	createGraphDocument({
		...rawDocument,
		nodes: Array.isArray(rawDocument.nodes) ? rawDocument.nodes : [],
		edges: Array.isArray(rawDocument.edges) ? rawDocument.edges : [],
		clusters: Array.isArray(rawDocument.clusters) ? rawDocument.clusters : [],
	});

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
		}
	}

	for (const edge of document.edges ?? []) {
		if (!EDGE_TYPE_VALUES.includes(edge.type)) {
			errors.push(`Invalid edge type: ${edge.type}`);
		}
	}

	return { valid: errors.length === 0, errors };
};

export const updateNode = (document, nodeId, patch) => {
	const next = clone(document);
	next.nodes = next.nodes.map((node) =>
		node.id === nodeId ? { ...node, ...patch } : node,
	);
	return next;
};

export const findNodeById = (document, nodeId) =>
	(document.nodes ?? []).find((node) => node.id === nodeId) ?? null;

export const findEdgeById = (document, edgeId) =>
	(document.edges ?? []).find((edge) => edge.id === edgeId) ?? null;

export const findNodesByType = (document, type) =>
	(document.nodes ?? []).filter((node) => node.type === type);

export const findEdgesByType = (document, type) =>
	(document.edges ?? []).filter((edge) => edge.type === type);

export const getConnectedNodes = (document, nodeId) => {
	const edges = document.edges ?? [];
	const connectedIds = new Set();
	for (const edge of edges) {
		if (edge.source === nodeId) connectedIds.add(edge.target);
		if (edge.target === nodeId) connectedIds.add(edge.source);
	}
	return (document.nodes ?? []).filter((node) => connectedIds.has(node.id));
};

export const getChunksByTier = (document, tier) =>
	(document.nodes ?? []).filter(
		(node) => node.type === "chunk" && node.data?.tier === tier,
	);
