/* ── CAR Brain Simulator — Application Bootstrap ── */

/* Components */
import "./components/app-shell.js";
import "./components/top-toolbar.js";
import "./components/left-tool-palette.js";
import "./components/graph-canvas.js";
import "./components/inspector-panel.js";
import "./components/bottom-activity-panel.js";
import "./components/pan-event-console.js";

/* Core */
import { EVENTS } from "./core/event-constants.js";
import { publish, subscribe } from "./core/pan.js";
/* Runtime */
import { carEngine } from "./runtime/car-engine.js";
import { retrievalAnimator } from "./runtime/retrieval-animator.js";
import { graphStore } from "./store/graph-store.js";
import { persistenceStore } from "./store/persistence-store.js";
import { uiStore } from "./store/ui-store.js";

const bootstrap = async () => {
	persistenceStore.initialize();
	retrievalAnimator.initialize();

	const restored = await persistenceStore.restoreLastSession();
	if (!restored) {
		graphStore.loadSeededGraph();
	}

	uiStore.setTool("select");
	uiStore.setInspectorTab("overview");
	uiStore.setBottomTab("retrieval-log");
	uiStore.setDevConsoleVisible(false);

	/* ── Wire CAR events to engine ── */

	subscribe(EVENTS.CAR_MEMORY_SUBMIT_REQUESTED, ({ payload }) => {
		const content = payload?.content;
		if (!content) return;
		carEngine.ingestMemory(content);
	});

	subscribe(EVENTS.CAR_QUERY_SUBMIT_REQUESTED, ({ payload }) => {
		const query = payload?.query;
		if (!query) return;
		const mode = payload?.mode ?? "play";
		carEngine.runRetrieval(query, { mode });
	});

	publish(EVENTS.ACTIVITY_LOG_APPENDED, {
		level: "info",
		message: restored
			? "CAR Brain restored from last session"
			: "CAR Brain initialized with Spain margins demo",
	});
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", bootstrap);
} else {
	bootstrap();
}
