import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const nowIso = () => new Date().toISOString();
const cap = (items, max = 80) => items.slice(0, max);

class UiStore {
  #state = {
    selectedNodeId: null,
    selectedTool: "select",
    viewportZoom: 1,
    inspectorTab: "overview",
    bottomTab: "messages",
    devConsoleVisible: true,
    activityItems: [],
    taskQueue: [],
    runHistory: [],
    errors: []
  };

  constructor() {
    subscribe(EVENTS.GRAPH_NODE_SELECTED, ({ payload }) => {
      this.#state.selectedNodeId = payload?.nodeId ?? null;
    });

    subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
      this.#state.selectedNodeId = null;
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
        at: payload?.at ?? nowIso()
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
    return { ...this.#state };
  }

  getRuntimeState() {
    return {
      activityItems: this.#state.activityItems.map((entry) => ({ ...entry })),
      taskQueue: this.#state.taskQueue.map((entry) => ({ ...entry })),
      runHistory: this.#state.runHistory.map((entry) => ({ ...entry })),
      errors: this.#state.errors.map((entry) => ({ ...entry })),
      devConsoleVisible: this.#state.devConsoleVisible
    };
  }

  selectNode(nodeId) {
    publish(EVENTS.GRAPH_NODE_SELECTED, { nodeId });
  }

  clearSelection() {
    publish(EVENTS.GRAPH_SELECTION_CLEARED, {});
  }

  setTool(tool) {
    publish(EVENTS.TOOLBAR_TOOL_CHANGED, { tool });
  }

  setViewportZoom(zoom) {
    publish(EVENTS.GRAPH_VIEWPORT_CHANGED, { zoom });
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
