export const EVENTS = Object.freeze({
	/* ── Graph: node lifecycle ── */
	GRAPH_NODE_SELECT_REQUESTED: "graph.node.select.requested",
	GRAPH_NODE_UPDATE_REQUESTED: "graph.node.update.requested",
	GRAPH_NODE_MOVE_REQUESTED: "graph.node.move.requested",
	GRAPH_NODE_CREATE_REQUESTED: "graph.node.create.requested",
	GRAPH_NODE_DELETE_REQUESTED: "graph.node.delete.requested",

	/* ── Graph: edge lifecycle ── */
	GRAPH_EDGE_CREATE_REQUESTED: "graph.edge.create.requested",
	GRAPH_EDGE_SELECT_REQUESTED: "graph.edge.select.requested",
	GRAPH_EDGE_SELECTION_CLEAR_REQUESTED: "graph.edge.selection.clear.requested",
	GRAPH_EDGE_UPDATE_REQUESTED: "graph.edge.update.requested",
	GRAPH_EDGE_DELETE_REQUESTED: "graph.edge.delete.requested",

	/* ── Graph: selection ── */
	GRAPH_SELECTION_CLEAR_REQUESTED: "graph.selection.clear.requested",
	GRAPH_SELECTION_SET_REQUESTED: "graph.selection.set.requested",

	/* ── Graph: viewport ── */
	GRAPH_VIEWPORT_UPDATE_REQUESTED: "graph.viewport.update.requested",

	/* ── Graph: document ── */
	GRAPH_DOCUMENT_LOAD_REQUESTED: "graph.document.load.requested",
	GRAPH_DOCUMENT_SAVE_REQUESTED: "graph.document.save.requested",
	GRAPH_DOCUMENT_UNDO_REQUESTED: "graph.document.undo.requested",
	GRAPH_DOCUMENT_REDO_REQUESTED: "graph.document.redo.requested",

	/* ── Graph: published state changes ── */
	GRAPH_NODE_SELECTED: "graph.node.selected",
	GRAPH_NODE_UPDATED: "graph.node.updated",
	GRAPH_NODE_CREATED: "graph.node.created",
	GRAPH_NODE_DELETED: "graph.node.deleted",
	GRAPH_EDGE_CREATED: "graph.edge.created",
	GRAPH_EDGE_SELECTED: "graph.edge.selected",
	GRAPH_EDGE_SELECTION_CLEARED: "graph.edge.selection.cleared",
	GRAPH_EDGE_UPDATED: "graph.edge.updated",
	GRAPH_EDGE_DELETED: "graph.edge.deleted",
	GRAPH_SELECTION_CLEARED: "graph.selection.cleared",
	GRAPH_SELECTION_SET: "graph.selection.set",
	GRAPH_VIEWPORT_CHANGED: "graph.viewport.changed",
	GRAPH_HISTORY_CHANGED: "graph.history.changed",
	GRAPH_AUTOSAVE_STATE_CHANGED: "graph.autosave.state.changed",
	GRAPH_DOCUMENT_LOADED: "graph.document.loaded",
	GRAPH_DOCUMENT_SAVED: "graph.document.saved",
	GRAPH_DOCUMENT_AUTOSAVED: "graph.document.autosaved",
	GRAPH_DOCUMENT_CHANGED: "graph.document.changed",

	/* ── UI: toolbar / panel ── */
	TOOLBAR_TOOL_CHANGED: "toolbar.tool.changed",
	INSPECTOR_TAB_CHANGED: "inspector.tab.changed",
	PANEL_BOTTOM_TAB_CHANGED: "panel.bottom.tab.changed",
	PANEL_DEV_CONSOLE_TOGGLED: "panel.dev.console.toggled",
	ACTIVITY_LOG_APPENDED: "activity.log.appended",
	TASK_QUEUE_UPDATED: "task.queue.updated",
	UI_RUNTIME_STATE_CHANGED: "ui.runtime.state.changed",

	/* ── CAR: memory input ── */
	CAR_MEMORY_SUBMIT_REQUESTED: "car.memory.submit.requested",
	CAR_MEMORY_CREATED: "car.memory.created",
	CAR_MEMORY_PROCESSING: "car.memory.processing",

	/* ── CAR: query / retrieval ── */
	CAR_QUERY_SUBMIT_REQUESTED: "car.query.submit.requested",
	CAR_RETRIEVAL_STARTED: "car.retrieval.started",
	CAR_RETRIEVAL_STEP_STARTED: "car.retrieval.step.started",
	CAR_RETRIEVAL_STEP_COMPLETED: "car.retrieval.step.completed",
	CAR_RETRIEVAL_COMPLETED: "car.retrieval.completed",
	CAR_RETRIEVAL_FAILED: "car.retrieval.failed",
	CAR_RETRIEVAL_RESET: "car.retrieval.reset",

	/* ── CAR: consolidation ── */
	CAR_CONSOLIDATION_STARTED: "car.consolidation.started",
	CAR_CONSOLIDATION_PROMOTED: "car.consolidation.promoted",
	CAR_CONSOLIDATION_COMPLETED: "car.consolidation.completed",

	/* ── CAR: contradiction ── */
	CAR_CONTRADICTION_DETECTED: "car.contradiction.detected",
	CAR_CONTRADICTION_RESOLVED: "car.contradiction.resolved",

	/* ── CAR: questions ── */
	CAR_QUESTIONS_GENERATED: "car.questions.generated",
	CAR_QUESTION_ANSWERED: "car.question.answered",

	/* ── CAR: clusters ── */
	CAR_CLUSTER_FORMED: "car.cluster.formed",
	CAR_CLUSTER_EXPANDED: "car.cluster.expanded",
	CAR_CLUSTER_DISSOLVED: "car.cluster.dissolved",

	/* ── CAR: triggers ── */
	CAR_TRIGGER_CREATED: "car.trigger.created",
	CAR_TRIGGER_FIRED: "car.trigger.fired",

	/* ── CAR: scoring / metamemory ── */
	CAR_RELEVANCE_RECALCULATED: "car.relevance.recalculated",
	CAR_METAMEMORY_UPDATED: "car.metamemory.updated",

	/* ── CAR: 3D canvas ── */
	CAR_CANVAS_NODE_HOVERED: "car.canvas.node.hovered",
	CAR_CANVAS_NODE_UNHOVERED: "car.canvas.node.unhovered",
	CAR_CANVAS_CAMERA_FOCUS: "car.canvas.camera.focus",
	CAR_CANVAS_CAMERA_HOME: "car.canvas.camera.home",

	/* ── Legacy runtime (kept for compatibility) ── */
	RUNTIME_AGENT_RUN_REQUESTED: "runtime.agent.run.requested",
	RUNTIME_SUBTREE_RUN_REQUESTED: "runtime.subtree.run.requested",
	RUNTIME_ALL_RUN_REQUESTED: "runtime.all.run.requested",
	RUNTIME_AGENT_RUN_STARTED: "runtime.agent.run.started",
	RUNTIME_AGENT_RUN_COMPLETED: "runtime.agent.run.completed",
	RUNTIME_AGENT_RUN_FAILED: "runtime.agent.run.failed",
	RUNTIME_RUN_HISTORY_APPENDED: "runtime.run.history.appended",
	RUNTIME_ERROR_APPENDED: "runtime.error.appended",
	RUNTIME_DATA_REFRESHED: "runtime.data.refreshed",
});
