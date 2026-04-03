import { EBBINGHAUS_DECAY } from "../core/constants.js";

/**
 * Ebbinghaus decay curve: returns weight based on days since last access.
 * Interpolates linearly between defined curve points.
 */
const recencyWeight = (daysSinceAccess) => {
	if (daysSinceAccess <= 0) return 1.0;

	const curve = EBBINGHAUS_DECAY;
	for (let i = 0; i < curve.length - 1; i++) {
		if (daysSinceAccess <= curve[i + 1].days) {
			const t =
				(daysSinceAccess - curve[i].days) / (curve[i + 1].days - curve[i].days);
			return curve[i].weight + t * (curve[i + 1].weight - curve[i].weight);
		}
	}

	return curve[curve.length - 1].weight;
};

const frequencyWeight = (accessCount) => {
	if (accessCount <= 0) return 0.5;
	return Math.min(1.0, 0.5 + Math.log2(accessCount) * 0.15);
};

const emotionalWeight = (intensity) => {
	return 1.0 + (intensity ?? 0) * 0.5;
};

const consequenceWeight = (decisionMade) => {
	return decisionMade ? 1.3 : 1.0;
};

const connectionWeight = (linkedCount) => {
	return 1.0 + Math.min(linkedCount ?? 0, 10) * 0.05;
};

const zeigarnikWeight = (status) => {
	return status === "open" ? 1.5 : 1.0;
};

/**
 * Compute relevance score for a chunk node.
 * Score is a product of six weighted factors.
 * Returns a normalized value in [0, 1] range (clamped).
 */
export const computeRelevance = (node) => {
	if (!node || node.type !== "chunk") return 0;

	const data = node.data ?? {};

	// Days since last access
	const lastAccessed = data.last_accessed
		? new Date(data.last_accessed)
		: new Date();
	const now = new Date();
	const daysSince = Math.max(0, (now - lastAccessed) / (1000 * 60 * 60 * 24));

	const raw =
		recencyWeight(daysSince) *
		frequencyWeight(data.access_count ?? 1) *
		emotionalWeight(data.emotional_intensity) *
		consequenceWeight(data.decision_made) *
		connectionWeight((data.linked_chunks ?? []).length) *
		zeigarnikWeight(data.status);

	// Normalize: the theoretical max is about 1.0 * 1.0 * 1.5 * 1.3 * 1.5 * 1.5 ≈ 4.4
	return Math.min(1.0, raw / 4.4);
};

/**
 * Score all chunks and return sorted by relevance (highest first).
 */
export const rankChunksByRelevance = (chunks) => {
	return chunks
		.map((chunk) => ({
			nodeId: chunk.id,
			node: chunk,
			relevance: computeRelevance(chunk),
		}))
		.sort((a, b) => b.relevance - a.relevance);
};

/**
 * Get the relevance breakdown for display in the inspector scoring tab.
 */
export const getRelevanceBreakdown = (node) => {
	if (!node || node.type !== "chunk") return null;

	const data = node.data ?? {};
	const lastAccessed = data.last_accessed
		? new Date(data.last_accessed)
		: new Date();
	const now = new Date();
	const daysSince = Math.max(0, (now - lastAccessed) / (1000 * 60 * 60 * 24));

	return {
		recency: recencyWeight(daysSince),
		frequency: frequencyWeight(data.access_count ?? 1),
		emotional: emotionalWeight(data.emotional_intensity),
		consequence: consequenceWeight(data.decision_made),
		connections: connectionWeight((data.linked_chunks ?? []).length),
		zeigarnik: zeigarnikWeight(data.status),
		total: computeRelevance(node),
		daysSinceAccess: daysSince,
	};
};
