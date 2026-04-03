import { uid } from "../core/utils.js";

/**
 * Question templates per level (L1-L5) from CAR Protocol S4.
 * Templates use {content} and {label} as placeholders.
 */
const TEMPLATES = {
	1: [
		"What is the key fact stated in: {label}?",
		"What exactly was said about {label}?",
		"When did {label} happen?",
	],
	2: [
		"Why did {label} occur?",
		"What caused the situation described in {label}?",
		"What is the reasoning behind {label}?",
	],
	3: [
		"What are the implications of {label}?",
		"How does {label} affect the broader context?",
		"What consequences follow from {label}?",
	],
	4: [
		"What if {label} had not happened?",
		"What would change if the opposite of {label} were true?",
		"How would things differ without {label}?",
	],
	5: [
		"Under what conditions would {label} no longer hold?",
		"When would {label} become irrelevant?",
		"What would need to change for {label} to be false?",
	],
};

/**
 * Generate questions at all 5 levels for a chunk node.
 * Returns an array of question node data objects (not yet persisted).
 */
export const generateQuestions = (chunkNode) => {
	if (!chunkNode || chunkNode.type !== "chunk") return [];

	const label = chunkNode.label ?? "this memory";
	const questions = [];

	for (let level = 1; level <= 5; level++) {
		const templates = TEMPLATES[level];
		const template = templates[Math.floor(Math.random() * templates.length)];
		const questionText = template
			.replace("{label}", label)
			.replace("{content}", (chunkNode.data?.content ?? label).slice(0, 60));

		questions.push({
			id: uid("qnode"),
			type: "question",
			label: `L${level}: ${questionText.slice(0, 40)}...`,
			description: questionText,
			position: {
				x: (chunkNode.position?.x ?? 0) + (Math.random() - 0.5) * 40,
				y: (chunkNode.position?.y ?? 0) + (Math.random() - 0.5) * 30,
				z: -100,
			},
			data: {
				level,
				question_text: questionText,
				answer_text: null,
				answered: false,
				parent_question_id: null,
				linked_chunk_ids: [chunkNode.id],
				confidence: null,
			},
		});
	}

	return questions;
};

/**
 * Generate sub-questions for a query (decomposition step in retrieval).
 * Returns 3-5 sub-question strings.
 */
export const decomposeQuery = (queryText) => {
	if (!queryText) return [];

	// Simple heuristic decomposition (AI runner would do this properly)
	const subQuestions = [
		`What are the key facts related to: ${queryText}`,
		`What is the timeline of events around: ${queryText}`,
		`Who are the participants involved in: ${queryText}`,
	];

	// Add conditional questions for complex queries
	if (queryText.length > 30) {
		subQuestions.push(`What are the implications of: ${queryText}`);
		subQuestions.push(`Are there contradictions related to: ${queryText}`);
	}

	return subQuestions;
};
