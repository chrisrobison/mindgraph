import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const nowIso = () => new Date().toISOString();
const cap = (items, max = 80) => items.slice(0, max);

class UiStore {
	#state = {
		selectedNodeId: null,
		selectedNodeIds: [],
		selectedTool: "select",
		viewportZoom: 1,
		inspectorTab: "overview",
		bottomTab: "retrieval-log",
		devConsoleVisible: false,
		activityItems: [],
		taskQueue: [],
		runHistory: [],
		errors: [],

		/* ── CAR retrieval state ── */
		retrievalRunning: false,
		retrievalStep: 0,
		retrievalStepName: "",
		retrievalMode: "play", // "play" | "step"
		retrievalQuery: "",
		retrievalResult: null,
		retrievalLog: [],

		/* ── CAR panel data ── */
		contradictions: [],
		unansweredQuestions: [],
		consolidationLog: [],
		metamemory: null,
	};

	constructor() {
		subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
			const nodeIds = toArray(payload?.nodeIds);
			this.#state.selectedNodeIds = nodeIds.length
				? nodeIds
				: payload?.nodeId
					? [payload.nodeId]
					: [];
			this.#state.selectedNodeId = this.#state.selectedNodeIds[0] ?? null;
		});

		subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
			const nodeIds = toArray(payload?.nodeIds);
			this.#state.selectedNodeIds = nodeIds;
			this.#state.selectedNodeId = nodeIds[0] ?? null;
		});

		subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
			this.#state.selectedNodeId = null;
			this.#state.selectedNodeIds = [];
		});

		subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
			this.#state.selectedTool = payload?.tool ?? "select";
		});

		subscribe(EVENTS.GRAPH_VIEWPORT_CHANGED, ({ payload }) => {
			const nextZoom = Number(payload?.zoom ?? this.#state.viewportZoom);
			if (Number.isFinite(nextZoom)) {
				this.#state.viewportZoom = nextZoom;
			}
		});

		subscribe(EVENTS.INSPECTOR_TAB_CHANGED, ({ payload }) => {
			this.#state.inspectorTab = payload?.tab ?? "overview";
		});

		subscribe(EVENTS.PANEL_BOTTOM_TAB_CHANGED, ({ payload }) => {
			this.#state.bottomTab = payload?.tab ?? "retrieval-log";
		});

		subscribe(EVENTS.PANEL_DEV_CONSOLE_TOGGLED, ({ payload }) => {
			this.#state.devConsoleVisible = Boolean(payload?.visible ?? false);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.ACTIVITY_LOG_APPENDED, ({ payload, timestamp }) => {
			const entry = {
				level: payload?.level ?? "info",
				message: payload?.message ?? "(empty log message)",
				context: payload?.context ?? {},
				timestamp: timestamp ?? Date.now(),
				at: payload?.at ?? nowIso(),
			};

			this.#state.activityItems = cap(
				[entry, ...this.#state.activityItems],
				120,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.TASK_QUEUE_UPDATED, ({ payload }) => {
			this.#state.taskQueue = cap(
				toArray(payload?.tasks).map((task) => ({ ...task })),
				120,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.RUNTIME_RUN_HISTORY_APPENDED, ({ payload }) => {
			const entry = {
				nodeId: payload?.nodeId ?? null,
				nodeLabel: payload?.nodeLabel ?? "Unknown node",
				runId: payload?.runId ?? "run_unknown",
				status: payload?.status ?? "unknown",
				summary: payload?.summary ?? "",
				confidence: payload?.confidence,
				outputType: payload?.output?.type,
				at: payload?.at ?? nowIso(),
			};

			this.#state.runHistory = cap([entry, ...this.#state.runHistory], 120);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.RUNTIME_ERROR_APPENDED, ({ payload }) => {
			const entry = {
				nodeId: payload?.nodeId ?? null,
				nodeLabel: payload?.nodeLabel ?? "Unknown node",
				runId: payload?.runId ?? "run_unknown",
				message: payload?.message ?? "Unknown runtime error",
				source: payload?.source ?? "runtime",
				at: payload?.at ?? nowIso(),
				outputType: payload?.output?.type,
			};

			this.#state.errors = cap([entry, ...this.#state.errors], 120);
			this.#emitRuntimeState();
		});

		/* ── CAR retrieval event listeners ── */

		subscribe(EVENTS.CAR_RETRIEVAL_STARTED, ({ payload }) => {
			this.#state.retrievalRunning = true;
			this.#state.retrievalStep = 0;
			this.#state.retrievalStepName = "";
			this.#state.retrievalQuery = payload?.query ?? "";
			this.#state.retrievalResult = null;
			this.#state.retrievalLog = [];
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_RETRIEVAL_STEP_STARTED, ({ payload }) => {
			this.#state.retrievalStep = payload?.step ?? 0;
			this.#state.retrievalStepName = payload?.name ?? "";
			this.#state.retrievalLog = cap(
				[
					...this.#state.retrievalLog,
					{
						step: payload?.step,
						name: payload?.name,
						status: "running",
						at: nowIso(),
					},
				],
				20,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_RETRIEVAL_STEP_COMPLETED, ({ payload }) => {
			this.#state.retrievalLog = this.#state.retrievalLog.map((entry) =>
				entry.step === payload?.step
					? { ...entry, status: "done", detail: payload?.detail }
					: entry,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_RETRIEVAL_COMPLETED, ({ payload }) => {
			this.#state.retrievalRunning = false;
			this.#state.retrievalResult = payload?.result ?? null;
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_RETRIEVAL_FAILED, ({ payload }) => {
			this.#state.retrievalRunning = false;
			this.#state.retrievalResult = {
				error: payload?.message ?? "Retrieval failed",
			};
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_RETRIEVAL_RESET, () => {
			this.#state.retrievalRunning = false;
			this.#state.retrievalStep = 0;
			this.#state.retrievalStepName = "";
			this.#state.retrievalQuery = "";
			this.#state.retrievalResult = null;
			this.#state.retrievalLog = [];
			this.#emitRuntimeState();
		});

		/* ── CAR data listeners ── */

		subscribe(EVENTS.CAR_CONTRADICTION_DETECTED, ({ payload }) => {
			this.#state.contradictions = cap(
				[...this.#state.contradictions, { ...payload, at: nowIso() }],
				50,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_QUESTIONS_GENERATED, ({ payload }) => {
			const questions = toArray(payload?.questions).filter((q) => !q.answered);
			this.#state.unansweredQuestions = cap(
				[...questions, ...this.#state.unansweredQuestions],
				100,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_CONSOLIDATION_PROMOTED, ({ payload }) => {
			this.#state.consolidationLog = cap(
				[{ ...payload, at: nowIso() }, ...this.#state.consolidationLog],
				50,
			);
			this.#emitRuntimeState();
		});

		subscribe(EVENTS.CAR_METAMEMORY_UPDATED, ({ payload }) => {
			this.#state.metamemory = payload?.metamemory ?? null;
			this.#emitRuntimeState();
		});
	}

	#emitRuntimeState() {
		publish(EVENTS.UI_RUNTIME_STATE_CHANGED, {
			runtime: this.getRuntimeState(),
			bottomTab: this.#state.bottomTab,
			devConsoleVisible: this.#state.devConsoleVisible,
		});
	}

	getState() {
		return {
			...this.#state,
			selectedNodeIds: [...this.#state.selectedNodeIds],
			activityItems: [...this.#state.activityItems],
			taskQueue: [...this.#state.taskQueue],
			runHistory: [...this.#state.runHistory],
			errors: [...this.#state.errors],
			retrievalLog: [...this.#state.retrievalLog],
			contradictions: [...this.#state.contradictions],
			unansweredQuestions: [...this.#state.unansweredQuestions],
			consolidationLog: [...this.#state.consolidationLog],
		};
	}

	getRuntimeState() {
		return {
			activityItems: this.#state.activityItems.map((entry) => ({ ...entry })),
			taskQueue: this.#state.taskQueue.map((entry) => ({ ...entry })),
			runHistory: this.#state.runHistory.map((entry) => ({ ...entry })),
			errors: this.#state.errors.map((entry) => ({ ...entry })),
			devConsoleVisible: this.#state.devConsoleVisible,
			retrievalRunning: this.#state.retrievalRunning,
			retrievalStep: this.#state.retrievalStep,
			retrievalStepName: this.#state.retrievalStepName,
			retrievalMode: this.#state.retrievalMode,
			retrievalQuery: this.#state.retrievalQuery,
			retrievalResult: this.#state.retrievalResult,
			retrievalLog: this.#state.retrievalLog.map((entry) => ({ ...entry })),
			contradictions: this.#state.contradictions.map((entry) => ({ ...entry })),
			unansweredQuestions: this.#state.unansweredQuestions.map((entry) => ({
				...entry,
			})),
			consolidationLog: this.#state.consolidationLog.map((entry) => ({
				...entry,
			})),
			metamemory: this.#state.metamemory,
		};
	}

	/* ── Actions ── */

	selectNode(nodeId, options = {}) {
		publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
			nodeId,
			additive: Boolean(options?.additive),
			toggle: Boolean(options?.toggle),
		});
	}

	setSelection(nodeIds = []) {
		publish(EVENTS.GRAPH_SELECTION_SET_REQUESTED, {
			nodeIds: toArray(nodeIds),
		});
	}

	clearSelection() {
		publish(EVENTS.GRAPH_SELECTION_CLEAR_REQUESTED, {});
	}

	setTool(tool) {
		publish(EVENTS.TOOLBAR_TOOL_CHANGED, { tool });
	}

	setViewportZoom(zoom) {
		publish(EVENTS.GRAPH_VIEWPORT_UPDATE_REQUESTED, { zoom });
	}

	setInspectorTab(tab) {
		publish(EVENTS.INSPECTOR_TAB_CHANGED, { tab });
	}

	setBottomTab(tab) {
		publish(EVENTS.PANEL_BOTTOM_TAB_CHANGED, { tab });
	}

	setDevConsoleVisible(visible) {
		publish(EVENTS.PANEL_DEV_CONSOLE_TOGGLED, { visible: Boolean(visible) });
	}

	setRetrievalMode(mode) {
		this.#state.retrievalMode = mode === "step" ? "step" : "play";
	}
}

export const uiStore = new UiStore();
