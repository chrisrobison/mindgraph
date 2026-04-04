import { EVENTS } from "../core/event-constants.js";
import { PERSISTENCE } from "../core/constants.js";
import { publish, subscribe } from "../core/pan.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const nowIso = () => new Date().toISOString();
const cap = (items, max = 80) => items.slice(0, max);
const readRuntimeMode = () => {
  try {
    const raw = window.localStorage.getItem(PERSISTENCE.storage.runtimeMode);
    return raw === "http" ? "http" : "mock";
  } catch {
    return "mock";
  }
};

class UiStore {
  #state = {
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedTool: "select",
    viewportZoom: 1,
    inspectorTab: "overview",
    bottomTab: "messages",
    devConsoleVisible: true,
    runtimeMode: readRuntimeMode(),
    activityItems: [],
    taskQueue: [],
    runHistory: [],
    traces: [],
    errors: []
  };

  constructor() {
    subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
      const nodeIds = toArray(payload?.nodeIds);
      this.#state.selectedNodeIds = nodeIds.length ? nodeIds : payload?.nodeId ? [payload.nodeId] : [];
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
      this.#state.bottomTab = payload?.tab ?? "messages";
    });

    subscribe(EVENTS.PANEL_DEV_CONSOLE_TOGGLED, ({ payload }) => {
      this.#state.devConsoleVisible = Boolean(payload?.visible ?? false);
      this.#emitRuntimeState();
    });

    subscribe(EVENTS.RUNTIME_MODE_CHANGED, ({ payload }) => {
      this.#state.runtimeMode = payload?.mode ?? "mock";
      this.#emitRuntimeState();
    });

    subscribe(EVENTS.ACTIVITY_LOG_APPENDED, ({ payload, timestamp }) => {
      const entry = {
        level: payload?.level ?? "info",
        message: payload?.message ?? "(empty log message)",
        context: payload?.context ?? {},
        timestamp: timestamp ?? Date.now(),
        at: payload?.at ?? nowIso()
      };

      this.#state.activityItems = cap([entry, ...this.#state.activityItems], 120);
      this.#emitRuntimeState();
    });

    subscribe(EVENTS.TASK_QUEUE_UPDATED, ({ payload }) => {
      this.#state.taskQueue = cap(toArray(payload?.tasks).map((task) => ({ ...task })), 120);
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
        mode: payload?.mode ?? this.#state.runtimeMode
      };

      this.#state.runHistory = cap([entry, ...this.#state.runHistory], 120);
      this.#emitRuntimeState();
    });

    subscribe(EVENTS.RUNTIME_TRACE_APPENDED, ({ payload }) => {
      if (!payload) return;
      const entry = {
        at: payload?.at ?? nowIso(),
        kind: payload?.kind ?? "trace",
        nodeId: payload?.nodeId ?? null,
        runId: payload?.runId ?? null,
        attempt: payload?.attempt,
        mode: payload?.mode ?? this.#state.runtimeMode,
        detail: payload
      };
      this.#state.traces = cap([entry, ...this.#state.traces], 250);
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
        outputType: payload?.output?.type
      };

      this.#state.errors = cap([entry, ...this.#state.errors], 120);
      this.#emitRuntimeState();
    });
  }

  #emitRuntimeState() {
    publish(EVENTS.UI_RUNTIME_STATE_CHANGED, {
      runtime: this.getRuntimeState(),
      bottomTab: this.#state.bottomTab,
      devConsoleVisible: this.#state.devConsoleVisible
    });
  }

  getState() {
    return {
      ...this.#state,
      selectedNodeIds: [...this.#state.selectedNodeIds],
      activityItems: [...this.#state.activityItems],
      taskQueue: [...this.#state.taskQueue],
      runHistory: [...this.#state.runHistory],
      traces: [...this.#state.traces],
      errors: [...this.#state.errors]
    };
  }

  getRuntimeState() {
    return {
      activityItems: this.#state.activityItems.map((entry) => ({ ...entry })),
      taskQueue: this.#state.taskQueue.map((entry) => ({ ...entry })),
      runHistory: this.#state.runHistory.map((entry) => ({ ...entry })),
      traces: this.#state.traces.map((entry) => ({ ...entry })),
      errors: this.#state.errors.map((entry) => ({ ...entry })),
      runtimeMode: this.#state.runtimeMode,
      devConsoleVisible: this.#state.devConsoleVisible
    };
  }

  selectNode(nodeId, options = {}) {
    publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
      nodeId,
      additive: Boolean(options?.additive),
      toggle: Boolean(options?.toggle)
    });
  }

  setSelection(nodeIds = []) {
    publish(EVENTS.GRAPH_SELECTION_SET_REQUESTED, { nodeIds: toArray(nodeIds) });
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
}

export const uiStore = new UiStore();
