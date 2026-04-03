import { nowIso, uid } from "../core/utils.js";

/**
 * Determine if a set of T1 chunks should be promoted to T2.
 * Promotion criteria: 3+ chunks sharing 2+ topic tags.
 */
export const findPromotionCandidates = (t1Chunks) => {
	const tagGroups = new Map();

	for (const chunk of t1Chunks) {
		const tags = chunk.data?.topic_tags ?? [];
		for (const tag of tags) {
			if (!tagGroups.has(tag)) tagGroups.set(tag, []);
			tagGroups.get(tag).push(chunk);
		}
	}

	const candidates = [];
	const seen = new Set();

	for (const [tag, chunks] of tagGroups) {
		if (chunks.length < 3) continue;

		// Find chunks that share at least 2 tags with each other
		const group = chunks.filter((chunk) => {
			const chunkTags = new Set(chunk.data?.topic_tags ?? []);
			const sharedCount = chunks.filter(
				(other) =>
					other.id !== chunk.id &&
					(other.data?.topic_tags ?? []).some((t) => chunkTags.has(t)),
			).length;
			return sharedCount >= 2;
		});

		if (group.length >= 3) {
			const groupKey = group
				.map((c) => c.id)
				.sort()
				.join(",");
			if (!seen.has(groupKey)) {
				seen.add(groupKey);
				candidates.push({
					tag,
					chunks: group,
					sharedTags: [tag],
				});
			}
		}
	}

	return candidates;
};

/**
 * Create a T2 summary node from a group of T1 chunks.
 * Returns a new node object (not yet persisted).
 */
export const createT2Summary = (chunkGroup, sharedTags) => {
	const labels = chunkGroup.map((c) => c.label).join(", ");
	const contentParts = chunkGroup.map(
		(c) => c.data?.content ?? c.description ?? c.label,
	);

	// Compute center position of group
	const cx =
		chunkGroup.reduce((sum, c) => sum + (c.position?.x ?? 0), 0) /
		chunkGroup.length;
	const cy =
		chunkGroup.reduce((sum, c) => sum + (c.position?.y ?? 0), 0) /
		chunkGroup.length;

	return {
		id: uid("t2"),
		type: "chunk",
		label: `Summary: ${sharedTags.join(", ")}`,
		description: `Consolidated from ${chunkGroup.length} chunks: ${labels.slice(0, 100)}`,
		position: { x: cx, y: cy, z: -400 },
		data: {
			content: `Summary of ${chunkGroup.length} related memories:\n${contentParts.map((c) => `- ${c}`).join("\n")}`,
			tier: 2,
			session_id: "",
			source: "agent_generated",
			source_reliability: "high",
			participants: [
				...new Set(chunkGroup.flatMap((c) => c.data?.participants ?? [])),
			],
			emotional_tone: "neutral",
			emotional_intensity:
				chunkGroup.reduce(
					(sum, c) => sum + (c.data?.emotional_intensity ?? 0),
					0,
				) / chunkGroup.length,
			stakes_level: chunkGroup.some((c) => c.data?.stakes_level === "high")
				? "high"
				: "medium",
			topic_tags: [
				...new Set(chunkGroup.flatMap((c) => c.data?.topic_tags ?? [])),
			],
			entity_tags: [
				...new Set(chunkGroup.flatMap((c) => c.data?.entity_tags ?? [])),
			],
			decision_made: chunkGroup.some((c) => c.data?.decision_made),
			action_items: chunkGroup.flatMap((c) => c.data?.action_items ?? []),
			status: chunkGroup.every((c) => c.data?.status === "resolved")
				? "resolved"
				: "open",
			preceding_context_id: null,
			following_context_id: null,
			access_count: 1,
			last_accessed: nowIso(),
			retrieval_cues: chunkGroup
				.flatMap((c) => c.data?.retrieval_cues ?? [])
				.slice(0, 10),
			amendments: [],
			linked_chunks: chunkGroup.map((c) => c.id),
			generated_questions: [],
		},
		metadata: {
			createdAt: nowIso(),
			consolidatedFrom: chunkGroup.map((c) => c.id),
		},
	};
};

/**
 * Determine if T2 summaries should be promoted to T3 pattern.
 * Criteria: 2+ T2 summaries with overlapping entity_tags.
 */
export const findPatternCandidates = (t2Chunks) => {
	if (t2Chunks.length < 2) return [];

	const candidates = [];
	const seen = new Set();

	for (let i = 0; i < t2Chunks.length; i++) {
		for (let j = i + 1; j < t2Chunks.length; j++) {
			const a = t2Chunks[i];
			const b = t2Chunks[j];
			const aEntities = new Set(a.data?.entity_tags ?? []);
			const shared = (b.data?.entity_tags ?? []).filter((e) =>
				aEntities.has(e),
			);

			if (shared.length >= 1) {
				const key = [a.id, b.id].sort().join(",");
				if (!seen.has(key)) {
					seen.add(key);
					candidates.push({ chunks: [a, b], sharedEntities: shared });
				}
			}
		}
	}

	return candidates;
};

/**
 * Create a T3 pattern/schema node from T2 summaries.
 */
export const createT3Pattern = (summaryGroup, sharedEntities) => {
	const cx =
		summaryGroup.reduce((sum, c) => sum + (c.position?.x ?? 0), 0) /
		summaryGroup.length;
	const cy =
		summaryGroup.reduce((sum, c) => sum + (c.position?.y ?? 0), 0) /
		summaryGroup.length;

	return {
		id: uid("pat"),
		type: "pattern",
		label: `Pattern: ${sharedEntities.join(", ")}`,
		description: `Cross-domain pattern across ${summaryGroup.length} summaries`,
		position: { x: cx, y: cy, z: -600 },
		data: {
			pattern: `Recurring pattern involving ${sharedEntities.join(", ")}`,
			evidence: summaryGroup.map((c) => c.id),
			confidence: 0.6,
			implication: `This pattern suggests a relationship between ${sharedEntities.join(" and ")}`,
			pattern_type: "causal_recurring",
			exceptions: [],
		},
		metadata: {
			createdAt: nowIso(),
		},
	};
};
