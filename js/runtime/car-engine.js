import { RETRIEVAL_STEPS } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";
import { nowIso } from "../core/utils.js";
import { graphStore } from "../store/graph-store.js";
import {
	computeClusters,
	createClusterEdges,
	createClusterNode,
	findClusterNeighbors,
} from "./cluster-manager.js";
import {
	createT2Summary,
	findPromotionCandidates,
} from "./consolidation-engine.js";
import {
	createContradictionEdge,
	detectContradictions,
} from "./contradiction-detector.js";
import { decomposeQuery, generateQuestions } from "./question-generator.js";
import { rankChunksByRelevance } from "./relevance-scorer.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * CAR Engine — orchestrates the 13-step retrieval sequence.
 */
class CAREngine {
	#running = false;
	#stepMode = false;
	#resolveStep = null;

	get isRunning() {
		return this.#running;
	}

	/**
	 * Submit a new memory chunk.
	 */
	async ingestMemory(content) {
		const position = {
			x: (Math.random() - 0.5) * 200,
			y: (Math.random() - 0.5) * 100,
			z: -200,
		};

		publish(EVENTS.CAR_MEMORY_PROCESSING, { content, origin: "car-engine" });

		// Create the chunk node
		const node = graphStore.addNode({
			type: "chunk",
			label: content.slice(0, 50) + (content.length > 50 ? "..." : ""),
			description: content,
			position,
			data: {
				content,
				tier: 1,
				session_id: `session_${Date.now().toString(36)}`,
				source: "user_stated",
				source_reliability: "high",
				participants: [],
				emotional_tone: "neutral",
				emotional_intensity: 0,
				stakes_level: "low",
				topic_tags: extractTags(content),
				entity_tags: extractEntities(content),
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
			},
		});

		if (!node) return null;

		publish(EVENTS.CAR_MEMORY_CREATED, {
			nodeId: node.id,
			node,
			origin: "car-engine",
		});

		// Generate questions
		const questions = generateQuestions(node);
		const questionIds = [];
		for (const q of questions) {
			const qNode = graphStore.addNode(q);
			if (qNode) {
				questionIds.push(qNode.id);
				graphStore.addEdge({
					type: "answers",
					source: qNode.id,
					target: node.id,
					label: "answers",
				});
			}
		}

		publish(EVENTS.CAR_QUESTIONS_GENERATED, {
			chunkId: node.id,
			questions: questions.map((q) => q.data),
			origin: "car-engine",
		});

		// Auto-link to existing chunks with shared tags
		this.#autoLink(node);

		// Check for contradictions
		this.#checkContradictions();

		// Auto-cluster
		this.#autoCluster();

		// Select the new node
		graphStore.setSelection([node.id]);

		publish(EVENTS.ACTIVITY_LOG_APPENDED, {
			level: "info",
			message: `Chunk created: "${node.label}" with ${questionIds.length} questions`,
		});

		return node;
	}

	/**
	 * Run the 13-step retrieval sequence for a query.
	 */
	async runRetrieval(query, { mode = "play" } = {}) {
		if (this.#running) return null;

		this.#running = true;
		this.#stepMode = mode === "step";

		publish(EVENTS.CAR_RETRIEVAL_STARTED, {
			query,
			mode,
			origin: "car-engine",
		});

		const doc = graphStore.getDocument();
		const allChunks = (doc?.nodes ?? []).filter((n) => n.type === "chunk");
		let activatedChunks = [];
		let subQuestions = [];
		let clusters = [];
		let confidence = 0;
		let answer = "";

		try {
			for (const step of RETRIEVAL_STEPS) {
				publish(EVENTS.CAR_RETRIEVAL_STEP_STARTED, {
					step: step.id,
					name: step.name,
					origin: "car-engine",
				});

				if (this.#stepMode) {
					await this.#waitForNextStep();
				} else {
					await sleep(step.duration * 1000);
				}

				// Execute step logic
				switch (step.id) {
					case 1: // Session Primer
						// Touch recent chunks to boost recency
						for (const chunk of allChunks.slice(0, 5)) {
							graphStore.recordAccess(chunk.id);
						}
						break;

					case 2: // Context Construction
						// Create query node
						break;

					case 3: // Question Decomposition
						subQuestions = decomposeQuery(query);
						break;

					case 4: // Metamemory Check
						// Inventory check (simplified)
						break;

					case 5: {
						// Multi-Query Retrieval R1
						const ranked = rankChunksByRelevance(allChunks);
						// Simple keyword matching for retrieval
						const queryWords = query.toLowerCase().split(/\s+/);
						activatedChunks = ranked
							.filter(({ node }) => {
								const content = (
									(node.data?.content ?? "") +
									" " +
									(node.data?.topic_tags ?? []).join(" ") +
									" " +
									(node.data?.entity_tags ?? []).join(" ") +
									" " +
									(node.label ?? "")
								).toLowerCase();
								return queryWords.some((w) => content.includes(w));
							})
							.slice(0, 9); // Top 3 per sub-question (3 sub-Qs)

						// Record access on activated chunks
						for (const { nodeId } of activatedChunks) {
							graphStore.recordAccess(nodeId);
						}
						break;
					}

					case 6: // Cluster Formation
						clusters = computeClusters(activatedChunks.map((a) => a.node));
						break;

					case 7: {
						// Cluster Expansion R2
						const expandedDoc = graphStore.getDocument();
						const allNodes = expandedDoc?.nodes ?? [];
						const allEdges = expandedDoc?.edges ?? [];
						for (const cluster of clusters) {
							const neighbors = findClusterNeighbors(
								cluster,
								allNodes,
								allEdges,
							);
							for (const nId of neighbors.slice(0, 3)) {
								if (!activatedChunks.find((a) => a.nodeId === nId)) {
									const node = graphStore.getNode(nId);
									if (node) {
										activatedChunks.push({
											nodeId: nId,
											node,
											relevance: 0.5,
										});
									}
								}
							}
						}
						break;
					}

					case 8: // Tiered Retrieval
						// Camera would pull back here (handled by animator)
						break;

					case 9: {
						// Interference Check
						const activeNodes = activatedChunks.map((a) => a.node);
						const contradictions = detectContradictions(activeNodes);
						for (const c of contradictions) {
							publish(EVENTS.CAR_CONTRADICTION_DETECTED, {
								...c,
								origin: "car-engine",
							});
						}
						break;
					}

					case 10: {
						// Confidence Grading
						const totalChunks = allChunks.length;
						const foundCount = activatedChunks.length;
						confidence =
							totalChunks > 0
								? Math.min(1.0, foundCount / Math.max(totalChunks * 0.3, 1))
								: 0;
						// Adjust confidence based on sub-question coverage
						if (subQuestions.length > 0) {
							const covered = subQuestions.filter((sq) =>
								activatedChunks.some((a) => {
									const content = (a.node.data?.content ?? "").toLowerCase();
									return sq
										.toLowerCase()
										.split(/\s+/)
										.some((w) => content.includes(w));
								}),
							).length;
							confidence = (confidence + covered / subQuestions.length) / 2;
						}
						break;
					}

					case 11: // Thinking Profile
						break;

					case 12: {
						// Synthesis + Response
						if (activatedChunks.length === 0) {
							answer =
								"No relevant memories found. Try adding more context, or rephrase.";
							confidence = 0;
						} else {
							const sources = activatedChunks
								.slice(0, 5)
								.map((a) => a.node.data?.content ?? a.node.label)
								.filter(Boolean);
							answer = `Based on ${activatedChunks.length} retrieved memories:\n\n${sources.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
						}
						break;
					}

					case 13: // Post-Retrieval Update
						// Access counts already updated in step 5
						break;
				}

				publish(EVENTS.CAR_RETRIEVAL_STEP_COMPLETED, {
					step: step.id,
					name: step.name,
					detail: getStepDetail(step.id, {
						activatedChunks,
						subQuestions,
						confidence,
					}),
					origin: "car-engine",
				});
			}

			const result = {
				query,
				answer,
				confidence,
				sources: activatedChunks.map((a) => ({
					nodeId: a.nodeId,
					label: a.node.label,
					relevance: a.relevance,
				})),
				subQuestions,
				at: nowIso(),
			};

			publish(EVENTS.CAR_RETRIEVAL_COMPLETED, { result, origin: "car-engine" });
			return result;
		} catch (error) {
			publish(EVENTS.CAR_RETRIEVAL_FAILED, {
				message: error?.message ?? "Unknown error",
				origin: "car-engine",
			});
			return null;
		} finally {
			this.#running = false;
			this.#stepMode = false;
		}
	}

	/**
	 * Advance one step in step mode.
	 */
	advanceStep() {
		if (this.#resolveStep) {
			this.#resolveStep();
			this.#resolveStep = null;
		}
	}

	/* ── Private helpers ── */

	async #waitForNextStep() {
		return new Promise((resolve) => {
			this.#resolveStep = resolve;
		});
	}

	#autoLink(newNode) {
		const doc = graphStore.getDocument();
		const allChunks = (doc?.nodes ?? []).filter(
			(n) => n.type === "chunk" && n.id !== newNode.id,
		);

		const newTags = new Set([
			...(newNode.data?.topic_tags ?? []),
			...(newNode.data?.entity_tags ?? []),
		]);

		for (const chunk of allChunks) {
			const chunkTags = [
				...(chunk.data?.topic_tags ?? []),
				...(chunk.data?.entity_tags ?? []),
			];
			const shared = chunkTags.filter((t) => newTags.has(t));

			if (shared.length >= 1) {
				graphStore.addEdge({
					type: "linked_to",
					source: newNode.id,
					target: chunk.id,
					label: "linked_to",
				});

				// Update linked_chunks on both nodes
				const existingLinks = chunk.data?.linked_chunks ?? [];
				if (!existingLinks.includes(newNode.id)) {
					graphStore.updateNode(chunk.id, {
						data: {
							...chunk.data,
							linked_chunks: [...existingLinks, newNode.id],
						},
					});
				}
			}
		}
	}

	#checkContradictions() {
		const doc = graphStore.getDocument();
		const allChunks = (doc?.nodes ?? []).filter((n) => n.type === "chunk");
		const existingEdges = (doc?.edges ?? []).filter(
			(e) => e.type === "contradicts",
		);
		const existingPairs = new Set(
			existingEdges.map((e) => [e.source, e.target].sort().join(",")),
		);

		const contradictions = detectContradictions(allChunks);
		for (const c of contradictions) {
			const key = [c.nodeA, c.nodeB].sort().join(",");
			if (!existingPairs.has(key)) {
				const edge = createContradictionEdge(c);
				graphStore.addEdge(edge);
				publish(EVENTS.CAR_CONTRADICTION_DETECTED, {
					...c,
					origin: "car-engine",
				});
			}
		}
	}

	#autoCluster() {
		const doc = graphStore.getDocument();
		const allChunks = (doc?.nodes ?? []).filter(
			(n) => n.type === "chunk" && n.data?.tier === 1,
		);

		const clusters = computeClusters(allChunks);
		for (const cluster of clusters) {
			// Check if a similar cluster already exists
			const existingClusters = graphStore.getClusters();
			const exists = existingClusters.some((ec) => {
				const overlap = (ec.member_ids ?? []).filter((id) =>
					cluster.member_ids.includes(id),
				);
				return overlap.length >= cluster.member_ids.length * 0.5;
			});

			if (!exists && cluster.member_ids.length >= 2) {
				const clusterNode = createClusterNode(cluster);
				graphStore.addNode(clusterNode);
				graphStore.addCluster(cluster);

				const edges = createClusterEdges(cluster);
				for (const edge of edges) {
					graphStore.addEdge(edge);
				}

				publish(EVENTS.CAR_CLUSTER_FORMED, {
					cluster,
					origin: "car-engine",
				});
			}
		}
	}

	/**
	 * Run consolidation pass (can be triggered manually or on timer).
	 */
	async runConsolidation() {
		publish(EVENTS.CAR_CONSOLIDATION_STARTED, { origin: "car-engine" });

		const doc = graphStore.getDocument();
		const t1Chunks = (doc?.nodes ?? []).filter(
			(n) => n.type === "chunk" && n.data?.tier === 1,
		);

		const candidates = findPromotionCandidates(t1Chunks);
		for (const candidate of candidates) {
			const summary = createT2Summary(candidate.chunks, candidate.sharedTags);
			const node = graphStore.addNode(summary);

			if (node) {
				// Create promotes_to edges
				for (const chunk of candidate.chunks) {
					graphStore.addEdge({
						type: "promotes_to",
						source: chunk.id,
						target: node.id,
						label: "promotes_to",
					});
				}

				publish(EVENTS.CAR_CONSOLIDATION_PROMOTED, {
					nodeId: node.id,
					fromTier: 1,
					toTier: 2,
					sourceCount: candidate.chunks.length,
					origin: "car-engine",
				});
			}
		}

		publish(EVENTS.CAR_CONSOLIDATION_COMPLETED, { origin: "car-engine" });
	}
}

/* ── Simple tag/entity extraction (heuristic, AI would do better) ── */

function extractTags(content) {
	const words = content.toLowerCase().split(/\s+/);
	const stopWords = new Set([
		"the",
		"a",
		"an",
		"is",
		"are",
		"was",
		"were",
		"be",
		"been",
		"being",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"shall",
		"would",
		"should",
		"may",
		"might",
		"must",
		"can",
		"could",
		"to",
		"of",
		"in",
		"for",
		"on",
		"with",
		"at",
		"by",
		"from",
		"as",
		"into",
		"through",
		"during",
		"before",
		"after",
		"and",
		"but",
		"or",
		"nor",
		"not",
		"no",
		"so",
		"if",
		"than",
		"that",
		"this",
		"it",
		"its",
		"i",
		"we",
		"you",
		"he",
		"she",
		"they",
		"them",
		"my",
		"your",
		"his",
		"her",
		"our",
		"their",
	]);

	return [
		...new Set(
			words
				.filter((w) => w.length > 3 && !stopWords.has(w))
				.map((w) => w.replace(/[^a-z0-9]/g, ""))
				.filter((w) => w.length > 3),
		),
	].slice(0, 5);
}

function extractEntities(content) {
	// Simple: find capitalized words (proper nouns)
	const matches = content.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
	return [...new Set(matches)].slice(0, 5);
}

/* ── Step detail helper ── */

function getStepDetail(stepId, { activatedChunks, subQuestions, confidence }) {
	switch (stepId) {
		case 3:
			return `${subQuestions.length} sub-questions`;
		case 5:
			return `${activatedChunks.length} chunks retrieved`;
		case 10:
			return `confidence: ${(confidence * 100).toFixed(0)}%`;
		default:
			return "";
	}
}

export const carEngine = new CAREngine();
