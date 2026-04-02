import "./components/app-shell.js";
import "./components/top-toolbar.js";
import "./components/left-tool-palette.js";
import "./components/graph-canvas.js";
import "./components/inspector-panel.js";
import "./components/bottom-activity-panel.js";
import "./components/pan-event-console.js";

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
import "./components/inspector/inspector-activity.js";
import "./components/inspector/inspector-output.js";
import "./components/inspector/inspector-automation.js";
import "./components/inspector/inspector-permissions.js";
import "./runtime/data-connectors.js";

import { EVENTS } from "./core/event-constants.js";
import { publish } from "./core/pan.js";
import { graphStore } from "./store/graph-store.js";
import { uiStore } from "./store/ui-store.js";

const bootstrap = () => {
  graphStore.loadSeededGraph();
  uiStore.setTool("select");
  uiStore.setInspectorTab("overview");
  uiStore.setBottomTab("activity");

  publish(EVENTS.ACTIVITY_LOG_APPENDED, {
    level: "info",
    message: "MindGraph AI initialized"
  });

  publish(EVENTS.TASK_QUEUE_UPDATED, {
    tasks: [
      { id: "task-1", label: "Analyze Competitor Pricing", status: "in_progress" },
      { id: "task-2", label: "Review Market Report", status: "queued" },
      { id: "task-3", label: "Send Summary to Coordinator", status: "queued" }
    ]
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
