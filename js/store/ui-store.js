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

const providerModels = Object.freeze({
  openai: Object.freeze(["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]),
  anthropic: Object.freeze(["claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest"]),
  gemini: Object.freeze(["gemini-2.0-flash", "gemini-2.5-pro-preview"])
});

const defaultModelForProvider = (provider) => {
  const key = String(provider ?? "openai");
  return providerModels[key]?.[0] ?? providerModels.openai[0];
};

const sanitizeProvider = (value) => {
  const key = String(value ?? "openai").trim().toLowerCase();
  if (key === "anthropic" || key === "gemini") return key;
  return "openai";
};

const sanitizeProviderSettings = (raw = {}) => {
  const provider = sanitizeProvider(raw?.provider);
  const model = String(raw?.model ?? defaultModelForProvider(provider)).trim() || defaultModelForProvider(provider);
  const apiKey = String(raw?.apiKey ?? "").trim();
  const temperatureValue = Number(raw?.temperature);
  const maxTokensValue = Number(raw?.maxTokens);
  return {
    provider,
    model,
    apiKey,
    temperature: Number.isFinite(temperatureValue) ? Math.min(2, Math.max(0, temperatureValue)) : 0.3,
    maxTokens: Number.isFinite(maxTokensValue) ? Math.min(8192, Math.max(64, Math.round(maxTokensValue))) : 800,
    systemPrompt: String(raw?.systemPrompt ?? "").trim()
  };
};

const readProviderSettings = () => {
  try {
    const raw = window.localStorage.getItem(PERSISTENCE.storage.runtimeProviderSettings);
    if (!raw) return sanitizeProviderSettings();
    return sanitizeProviderSettings(JSON.parse(raw));
  } catch {
    return sanitizeProviderSettings();
  }
};

const sanitizeThemePreference = (value) => {
  const next = String(value ?? "system").trim().toLowerCase();
  if (next === "light" || next === "dark") return next;
  return "system";
};

const sanitizeToolbarDisplay = (value) => {
  const next = String(value ?? "icons").trim().toLowerCase();
  if (next === "icons+text" || next === "text") return next;
  return "icons";
};

const sanitizeUiSettings = (raw = {}) => ({
  theme: sanitizeThemePreference(raw?.theme),
  toolbarDisplay: sanitizeToolbarDisplay(raw?.toolbarDisplay)
});

const readUiSettings = () => {
  try {
    return sanitizeUiSettings({
      theme: window.localStorage.getItem(PERSISTENCE.storage.uiTheme),
      toolbarDisplay: window.localStorage.getItem(PERSISTENCE.storage.uiToolbarDisplay)
    });
  } catch {
    return sanitizeUiSettings();
  }
};

class UiStore {
  #systemThemeMedia = null;
  #systemThemeListener = null;
  #state = {
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedTool: "select",
    viewportZoom: 1,
    inspectorTab: "overview",
    bottomTab: "messages",
    devConsoleVisible: true,
    runtimeMode: readRuntimeMode(),
    runtimeProviderSettings: readProviderSettings(),
    uiSettings: readUiSettings(),
    activityItems: [],
    taskQueue: [],
    runHistory: [],
    traces: [],
    errors: []
  };

  constructor() {
    this.#applyUiSettings(this.#state.uiSettings);

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

    subscribe(EVENTS.RUNTIME_PROVIDER_SETTINGS_UPDATE_REQUESTED, ({ payload }) => {
      const patch = payload?.patch ?? {};
      const next = sanitizeProviderSettings({
        ...(this.#state.runtimeProviderSettings ?? {}),
        ...(patch ?? {})
      });
      this.#state.runtimeProviderSettings = next;
      this.#persistProviderSettings(next);
      publish(EVENTS.RUNTIME_PROVIDER_SETTINGS_CHANGED, {
        settings: { ...next },
        origin: payload?.origin ?? "ui-store"
      });
      this.#emitRuntimeState();
    });

    subscribe(EVENTS.UI_SETTINGS_UPDATE_REQUESTED, ({ payload }) => {
      const patch = payload?.patch ?? {};
      const next = sanitizeUiSettings({
        ...(this.#state.uiSettings ?? {}),
        ...(patch ?? {})
      });

      this.#state.uiSettings = next;
      this.#persistUiSettings(next);
      this.#applyUiSettings(next);

      publish(EVENTS.UI_SETTINGS_CHANGED, {
        settings: { ...next },
        origin: payload?.origin ?? "ui-store"
      });

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
      const detail =
        payload?.kind === "planner_snapshot"
          ? {
              kind: payload.kind,
              snapshotId: payload.snapshotId ?? null,
              at: payload.at ?? nowIso(),
              mode: payload.mode ?? this.#state.runtimeMode,
              rootNodeId: payload.rootNodeId ?? null,
              executionOrder: toArray(payload.executionOrder),
              readyNodeIds: toArray(payload.readyNodeIds),
              blockedNodeIds: toArray(payload.blockedNodeIds),
              cycles: toArray(payload.cycles),
              nodeCount: Object.keys(payload?.nodes ?? {}).length
            }
          : payload;
      const entry = {
        at: payload?.at ?? nowIso(),
        kind: payload?.kind ?? "trace",
        nodeId: payload?.nodeId ?? null,
        runId: payload?.runId ?? null,
        attempt: payload?.attempt,
        mode: payload?.mode ?? this.#state.runtimeMode,
        detail
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
      devConsoleVisible: this.#state.devConsoleVisible,
      providerSettings: { ...(this.#state.runtimeProviderSettings ?? {}) },
      uiSettings: { ...(this.#state.uiSettings ?? {}) }
    });
  }

  #persistProviderSettings(settings) {
    try {
      window.localStorage.setItem(PERSISTENCE.storage.runtimeProviderSettings, JSON.stringify(settings));
    } catch {
      // noop
    }
  }

  #persistUiSettings(settings) {
    try {
      window.localStorage.setItem(PERSISTENCE.storage.uiTheme, settings.theme);
      window.localStorage.setItem(PERSISTENCE.storage.uiToolbarDisplay, settings.toolbarDisplay);
    } catch {
      // noop
    }
  }

  #resolveTheme(themePreference) {
    if (themePreference === "light" || themePreference === "dark") return themePreference;
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  #syncSystemThemeListener(themePreference) {
    if (this.#systemThemeMedia && this.#systemThemeListener) {
      if (typeof this.#systemThemeMedia.removeEventListener === "function") {
        this.#systemThemeMedia.removeEventListener("change", this.#systemThemeListener);
      } else if (typeof this.#systemThemeMedia.removeListener === "function") {
        this.#systemThemeMedia.removeListener(this.#systemThemeListener);
      }
      this.#systemThemeMedia = null;
      this.#systemThemeListener = null;
    }

    if (themePreference !== "system") return;

    try {
      this.#systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
      this.#systemThemeListener = () => {
        const root = document.documentElement;
        if (!root) return;
        root.dataset.theme = this.#resolveTheme("system");
      };
      if (typeof this.#systemThemeMedia.addEventListener === "function") {
        this.#systemThemeMedia.addEventListener("change", this.#systemThemeListener);
      } else if (typeof this.#systemThemeMedia.addListener === "function") {
        this.#systemThemeMedia.addListener(this.#systemThemeListener);
      }
    } catch {
      // noop
    }
  }

  #applyUiSettings(settings) {
    const root = document.documentElement;
    if (!root) return;

    const nextSettings = sanitizeUiSettings(settings ?? {});
    root.dataset.themePreference = nextSettings.theme;
    root.dataset.theme = this.#resolveTheme(nextSettings.theme);
    root.dataset.toolbarDisplay = nextSettings.toolbarDisplay;
    this.#syncSystemThemeListener(nextSettings.theme);
  }

  getState() {
    return {
      ...this.#state,
      selectedNodeIds: [...this.#state.selectedNodeIds],
      activityItems: [...this.#state.activityItems],
      taskQueue: [...this.#state.taskQueue],
      runHistory: [...this.#state.runHistory],
      traces: [...this.#state.traces],
      errors: [...this.#state.errors],
      runtimeProviderSettings: { ...(this.#state.runtimeProviderSettings ?? {}) },
      uiSettings: { ...(this.#state.uiSettings ?? {}) }
    };
  }

  getRuntimeState() {
    return {
      activityItems: this.#state.activityItems.map((entry) => ({ ...entry })),
      taskQueue: this.#state.taskQueue.map((entry) => ({ ...entry })),
      runHistory: this.#state.runHistory.map((entry) => ({ ...entry })),
      traces: this.#state.traces.map((entry) => ({ ...entry })),
      errors: this.#state.errors.map((entry) => ({ ...entry })),
      providerSettings: { ...(this.#state.runtimeProviderSettings ?? {}) },
      runtimeMode: this.#state.runtimeMode,
      devConsoleVisible: this.#state.devConsoleVisible,
      uiSettings: { ...(this.#state.uiSettings ?? {}) }
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

  updateRuntimeProviderSettings(patch = {}, origin = "ui-store") {
    publish(EVENTS.RUNTIME_PROVIDER_SETTINGS_UPDATE_REQUESTED, {
      patch: { ...(patch ?? {}) },
      origin
    });
  }

  updateUiSettings(patch = {}, origin = "ui-store") {
    publish(EVENTS.UI_SETTINGS_UPDATE_REQUESTED, {
      patch: { ...(patch ?? {}) },
      origin
    });
  }

  updateDocumentDetails(patch = {}, origin = "ui-store") {
    publish(EVENTS.GRAPH_DOCUMENT_DETAILS_UPDATE_REQUESTED, {
      patch: { ...(patch ?? {}) },
      origin
    });
  }
}

export const uiStore = new UiStore();
