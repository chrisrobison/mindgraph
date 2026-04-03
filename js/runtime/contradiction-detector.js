import { uid } from "../core/utils.js";

/**
 * Simple contradiction detection between two chunks.
 * Checks for opposing signals in the data.
 * A real AI runner would do semantic analysis.
 */
const hasContradictionSignals = (a, b) => {
	const aData = a.data ?? {};
	const bData = b.data ?? {};

	// Same topic tags but different decisions
	const aTags = new Set(aData.topic_tags ?? []);
	const sharedTags = (bData.topic_tags ?? []).filter((t) => aTags.has(t));
	if (sharedTags.length === 0) return false;

	// Both have content with conflicting indicators
	const aContent = (aData.content ?? a.description ?? "").toLowerCase();
	const bContent = (bData.content ?? b.description ?? "").toLowerCase();

	// Check for explicit contradiction markers
	const contradictionPairs = [
		["increase", "decrease"],
		["higher", "lower"],
		["grew", "dropped"],
		["up", "down"],
		["yes", "no"],
		["true", "false"],
		["approved", "rejected"],
		["confirmed", "denied"],
	];

	for (const [wordA, wordB] of contradictionPairs) {
		if (
			(aContent.includes(wordA) && bContent.includes(wordB)) ||
			(aContent.includes(wordB) && bContent.includes(wordA))
		) {
			return true;
		}
	}

	// Check if both are about the same entity but have different statuses
	const aEntities = new Set(aData.entity_tags ?? []);
	const sharedEntities = (bData.entity_tags ?? []).filter((e) =>
		aEntities.has(e),
	);
	if (sharedEntities.length > 0 && aData.status !== bData.status) {
		// Only flag if one is decided and other is open
		if (
			(aData.decision_made && !bData.decision_made) ||
			(!aData.decision_made && bData.decision_made)
		) {
			return true;
		}
	}

	return false;
};

/**
 * Scan all chunks for contradictions.
 * Returns array of { nodeA, nodeB, description, sharedTags } objects.
 */
export const detectContradictions = (chunks) => {
	const contradictions = [];
	const seen = new Set();

	for (let i = 0; i < chunks.length; i++) {
		for (let j = i + 1; j < chunks.length; j++) {
			const a = chunks[i];
			const b = chunks[j];

			if (hasContradictionSignals(a, b)) {
				const key = [a.id, b.id].sort().join(",");
				if (!seen.has(key)) {
					seen.add(key);

					const aTags = new Set(a.data?.topic_tags ?? []);
					const sharedTags = (b.data?.topic_tags ?? []).filter((t) =>
						aTags.has(t),
					);

					contradictions.push({
						id: uid("contra"),
						nodeA: a.id,
						nodeB: b.id,
						labelA: a.label,
						labelB: b.label,
						description: `Conflicting information between "${a.label}" and "${b.label}" on ${sharedTags.join(", ") || "related topics"}`,
						sharedTags,
						resolved: false,
					});
				}
			}
		}
	}

	return contradictions;
};

/**
 * Create a contradiction edge between two nodes.
 */
export const createContradictionEdge = (contradiction) => ({
	id: uid("cedge"),
	type: "contradicts",
	source: contradiction.nodeA,
	target: contradiction.nodeB,
	label: "contradicts",
	metadata: {
		contradictionId: contradiction.id,
		description: contradiction.description,
	},
});
