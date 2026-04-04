import "./components/app-shell.js";
import "./components/top-toolbar.js";
import "./components/left-tool-palette.js";
import "./components/graph-canvas.js";
import "./components/inspector-panel.js";
import "./components/bottom-activity-panel.js";
import "./components/pan-event-console.js";
import "./components/bottom-panel/messages-view.js";
import "./components/bottom-panel/activity-log-view.js";
import "./components/bottom-panel/task-queue-view.js";
import "./components/bottom-panel/run-history-view.js";
import "./components/bottom-panel/trace-view.js";
import "./components/bottom-panel/planner-diff-view.js";
import "./components/bottom-panel/runtime-settings-view.js";
import "./components/bottom-panel/error-view.js";

import "./components/nodes/note-node.js";
import "./components/nodes/agent-node.js";
import "./components/nodes/data-node.js";
import "./components/nodes/transformer-node.js";
import "./components/nodes/view-node.js";
import "./components/nodes/action-node.js";

import "./components/inspector/inspector-overview.js";
import "./components/inspector/inspector-prompt.js";
import "./components/inspector/inspector-data.js";
import "./components/inspector/inspector-tools.js";
import "./components/inspector/inspector-diagnostics.js";
import "./components/inspector/inspector-activity.js";
import "./components/inspector/inspector-output.js";
import "./components/inspector/inspector-automation.js";
import "./components/inspector/inspector-permissions.js";
import "./runtime/data-connectors.js";
import "./runtime/runtime-service.js";
import "./runtime/runtime-audit-store.js";

import { EVENTS } from "./core/event-constants.js";
import { publish } from "./core/pan.js";
import { graphStore } from "./store/graph-store.js";
import { persistenceStore } from "./store/persistence-store.js";
import { uiStore } from "./store/ui-store.js";

const bootstrap = () => {
  persistenceStore.initialize();

  const restored = persistenceStore.restoreLastSession();
  if (!restored) {
    graphStore.loadSeededGraph();
  }

  uiStore.setTool("select");
  uiStore.setInspectorTab("overview");
  uiStore.setBottomTab("messages");
  uiStore.setDevConsoleVisible(true);

  publish(EVENTS.ACTIVITY_LOG_APPENDED, {
    level: "info",
    message: restored ? "MindGraph AI restored from last session" : "MindGraph AI initialized"
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
