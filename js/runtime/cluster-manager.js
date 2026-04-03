import { nowIso, uid } from "../core/utils.js";

/**
 * Auto-cluster chunks by shared topic_tags and entity_tags.
 * Returns array of cluster definitions: { id, member_ids, shared_tags, shared_entities }.
 */
export const computeClusters = (chunks) => {
	if (chunks.length < 2) return [];

	// Build tag index: tag → chunk IDs
	const tagIndex = new Map();
	for (const chunk of chunks) {
		const tags = [
			...(chunk.data?.topic_tags ?? []),
			...(chunk.data?.entity_tags ?? []),
		];
		for (const tag of tags) {
			if (!tagIndex.has(tag)) tagIndex.set(tag, new Set());
			tagIndex.get(tag).add(chunk.id);
		}
	}

	// Find groups with 2+ members sharing a tag
	const clusterCandidates = [];
	const assignedChunks = new Set();

	// Sort tags by group size (largest first) for greedy clustering
	const sortedTags = [...tagIndex.entries()]
		.filter(([, ids]) => ids.size >= 2)
		.sort((a, b) => b[1].size - a[1].size);

	for (const [tag, chunkIds] of sortedTags) {
		// Only include chunks not yet assigned to a cluster
		const unassigned = [...chunkIds].filter((id) => !assignedChunks.has(id));
		if (unassigned.length < 2) continue;

		// Check for shared secondary tags among this group
		const chunkMap = new Map(chunks.map((c) => [c.id, c]));
		const memberChunks = unassigned
			.map((id) => chunkMap.get(id))
			.filter(Boolean);

		const topicTags = new Set();
		const entityTags = new Set();
		for (const c of memberChunks) {
			for (const t of c.data?.topic_tags ?? []) topicTags.add(t);
			for (const e of c.data?.entity_tags ?? []) entityTags.add(e);
		}

		// Only create cluster if chunks share real content
		const sharedTopicTags = [...topicTags].filter((t) =>
			memberChunks.every((c) => (c.data?.topic_tags ?? []).includes(t)),
		);
		const sharedEntityTags = [...entityTags].filter((e) =>
			memberChunks.every((c) => (c.data?.entity_tags ?? []).includes(e)),
		);

		const cluster = {
			id: uid("cluster"),
			label: `Cluster: ${tag}`,
			member_ids: unassigned,
			shared_tags: sharedTopicTags.length > 0 ? sharedTopicTags : [tag],
			shared_entities: sharedEntityTags,
			cluster_strength: unassigned.length / chunks.length,
			color: 0xffffff,
			createdAt: nowIso(),
		};

		clusterCandidates.push(cluster);
		for (const id of unassigned) {
			assignedChunks.add(id);
		}
	}

	return clusterCandidates;
};

/**
 * Create a cluster node for the graph from a cluster definition.
 */
export const createClusterNode = (cluster) => ({
	id: cluster.id,
	type: "cluster",
	label: cluster.label,
	description: `${cluster.member_ids.length} members`,
	position: { x: 0, y: 0, z: -400 },
	data: {
		member_ids: cluster.member_ids,
		cluster_strength: cluster.cluster_strength,
		shared_tags: cluster.shared_tags,
		shared_entities: cluster.shared_entities,
		color: cluster.color,
	},
	metadata: {
		createdAt: cluster.createdAt ?? nowIso(),
	},
});

/**
 * Create clusters_with edges from a cluster to its members.
 */
export const createClusterEdges = (cluster) =>
	cluster.member_ids.map((memberId) => ({
		id: uid("cledge"),
		type: "clusters_with",
		source: cluster.id,
		target: memberId,
		label: "clusters_with",
		metadata: {},
	}));

/**
 * Expand a cluster by finding neighbor chunks (temporal, entity, topic).
 * Returns array of chunk IDs that should be added.
 */
export const findClusterNeighbors = (cluster, allChunks, allEdges) => {
	const memberSet = new Set(cluster.member_ids);
	const neighbors = new Set();

	// Find chunks connected by edges to cluster members
	for (const edge of allEdges) {
		if (edge.type === "clusters_with") continue;
		if (memberSet.has(edge.source) && !memberSet.has(edge.target)) {
			neighbors.add(edge.target);
		}
		if (memberSet.has(edge.target) && !memberSet.has(edge.source)) {
			neighbors.add(edge.source);
		}
	}

	// Find chunks with overlapping entity tags
	const memberEntities = new Set();
	for (const chunk of allChunks) {
		if (memberSet.has(chunk.id)) {
			for (const e of chunk.data?.entity_tags ?? []) {
				memberEntities.add(e);
			}
		}
	}

	for (const chunk of allChunks) {
		if (memberSet.has(chunk.id) || neighbors.has(chunk.id)) continue;
		if (chunk.type !== "chunk") continue;
		const chunkEntities = chunk.data?.entity_tags ?? [];
		if (chunkEntities.some((e) => memberEntities.has(e))) {
			neighbors.add(chunk.id);
		}
	}

	return [...neighbors].filter((id) => {
		const chunk = allChunks.find((c) => c.id === id);
		return chunk && chunk.type === "chunk";
	});
};
