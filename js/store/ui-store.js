import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";

class UiStore {
  #state = {
    selectedNodeId: null,
    selectedTool: "select",
    viewportZoom: 1,
    inspectorTab: "overview",
    bottomTab: "activity"
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
      this.#state.bottomTab = payload?.tab ?? "activity";
    });
  }

  getState() {
    return { ...this.#state };
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
}

export const uiStore = new UiStore();
