import { RETRIEVAL_STEPS } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";

class TopToolbar extends HTMLElement {
	#dispose = [];
	#retrievalRunning = false;
	#retrievalStep = 0;
	#canUndo = false;
	#canRedo = false;

	connectedCallback() {
		const history = graphStore.getHistoryState();
		this.#canUndo = history.canUndo;
		this.#canRedo = history.canRedo;

		this.render();
		this.#bind();

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_HISTORY_CHANGED, ({ payload }) => {
				this.#canUndo = Boolean(payload?.canUndo);
				this.#canRedo = Boolean(payload?.canRedo);
				this.#syncHistoryButtons();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.UI_RUNTIME_STATE_CHANGED, ({ payload }) => {
				const rt = payload?.runtime;
				if (!rt) return;
				this.#retrievalRunning = Boolean(rt.retrievalRunning);
				this.#retrievalStep = rt.retrievalStep ?? 0;
				this.#syncRetrievalState();
			}),
		);

		this.#syncHistoryButtons();
	}

	disconnectedCallback() {
		this.#dispose.forEach((run) => run());
		this.#dispose = [];
	}

	#bind() {
		// Memory input
		const memoryInput = this.querySelector('[data-role="memory-input"]');
		memoryInput?.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || !memoryInput.value.trim()) return;
			event.preventDefault();
			const content = memoryInput.value.trim();
			memoryInput.value = "";
			publish(EVENTS.CAR_MEMORY_SUBMIT_REQUESTED, {
				content,
				origin: "top-toolbar",
			});
			publish(EVENTS.ACTIVITY_LOG_APPENDED, {
				level: "info",
				message: `Memory submitted: ${content.slice(0, 40)}...`,
			});
		});

		// Query input
		const queryInput = this.querySelector('[data-role="query-input"]');
		queryInput?.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" || !queryInput.value.trim()) return;
			event.preventDefault();
			const query = queryInput.value.trim();
			publish(EVENTS.CAR_QUERY_SUBMIT_REQUESTED, {
				query,
				origin: "top-toolbar",
			});
			publish(EVENTS.ACTIVITY_LOG_APPENDED, {
				level: "info",
				message: `Query submitted: ${query.slice(0, 40)}...`,
			});
		});

		// Play / Step / Reset
		this.querySelector('[data-action="play"]')?.addEventListener(
			"click",
			() => {
				if (this.#retrievalRunning) return;
				const query = this.querySelector(
					'[data-role="query-input"]',
				)?.value?.trim();
				if (!query) return;
				uiStore.setRetrievalMode("play");
				publish(EVENTS.CAR_QUERY_SUBMIT_REQUESTED, {
					query,
					mode: "play",
					origin: "top-toolbar",
				});
			},
		);

		this.querySelector('[data-action="step"]')?.addEventListener(
			"click",
			() => {
				uiStore.setRetrievalMode("step");
				const query = this.querySelector(
					'[data-role="query-input"]',
				)?.value?.trim();
				if (!query) return;
				if (!this.#retrievalRunning) {
					publish(EVENTS.CAR_QUERY_SUBMIT_REQUESTED, {
						query,
						mode: "step",
						origin: "top-toolbar",
					});
				}
			},
		);

		this.querySelector('[data-action="reset"]')?.addEventListener(
			"click",
			() => {
				publish(EVENTS.CAR_RETRIEVAL_RESET, { origin: "top-toolbar" });
			},
		);

		// Undo / Redo
		this.querySelector('[data-action="undo"]')?.addEventListener(
			"click",
			() => {
				if (!this.#canUndo) return;
				publish(EVENTS.GRAPH_DOCUMENT_UNDO_REQUESTED, {
					origin: "top-toolbar",
				});
			},
		);

		this.querySelector('[data-action="redo"]')?.addEventListener(
			"click",
			() => {
				if (!this.#canRedo) return;
				publish(EVENTS.GRAPH_DOCUMENT_REDO_REQUESTED, {
					origin: "top-toolbar",
				});
			},
		);

		// Save / Load
		this.querySelector('[data-action="save"]')?.addEventListener("click", () =>
			this.#onSave(),
		);
		this.querySelector('[data-action="load"]')?.addEventListener("click", () =>
			this.#onLoadRequest(),
		);
		this.querySelector('[data-role="load-input"]')?.addEventListener(
			"change",
			(e) => this.#onLoadFile(e),
		);

		// Global keyboard shortcuts
		document.addEventListener("keydown", (event) => {
			if (
				event.key === "m" &&
				!event.ctrlKey &&
				!event.metaKey &&
				document.activeElement?.tagName !== "INPUT"
			) {
				event.preventDefault();
				memoryInput?.focus();
			}
		});
	}

	#syncHistoryButtons() {
		const undoBtn = this.querySelector('[data-action="undo"]');
		const redoBtn = this.querySelector('[data-action="redo"]');
		if (undoBtn) undoBtn.disabled = !this.#canUndo;
		if (redoBtn) redoBtn.disabled = !this.#canRedo;
	}

	#syncRetrievalState() {
		const playBtn = this.querySelector('[data-action="play"]');
		const stepBtn = this.querySelector('[data-action="step"]');
		const resetBtn = this.querySelector('[data-action="reset"]');
		if (playBtn) playBtn.disabled = this.#retrievalRunning;
		if (stepBtn) stepBtn.disabled = false;
		if (resetBtn)
			resetBtn.disabled = !this.#retrievalRunning && this.#retrievalStep === 0;

		// Update step dots
		const dots = this.querySelectorAll(".step-dot");
		dots.forEach((dot, i) => {
			const step = i + 1;
			dot.classList.toggle("done", step < this.#retrievalStep);
			dot.classList.toggle("active", step === this.#retrievalStep);
		});
	}

	#onSave() {
		const snapshot = graphStore.getDocument();
		if (!snapshot) return;

		publish(EVENTS.GRAPH_DOCUMENT_SAVE_REQUESTED, { origin: "top-toolbar" });

		const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		const safeTitle = String(snapshot.title ?? "car-brain")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");

		anchor.href = url;
		anchor.download = `${safeTitle || "car-brain"}-${Date.now()}.json`;
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		URL.revokeObjectURL(url);

		publish(EVENTS.ACTIVITY_LOG_APPENDED, {
			level: "info",
			message: "Brain exported as JSON",
		});
	}

	#onLoadRequest() {
		const input = this.querySelector('[data-role="load-input"]');
		if (!input) return;
		input.value = "";
		input.click();
	}

	async #onLoadFile(event) {
		const file = event.target?.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			const parsed = JSON.parse(text);
			publish(EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED, {
				document: parsed,
				reason: "toolbar_load_file",
				origin: "top-toolbar",
			});
			publish(EVENTS.ACTIVITY_LOG_APPENDED, {
				level: "info",
				message: `Loaded brain from ${file.name}`,
			});
		} catch (error) {
			publish(EVENTS.ACTIVITY_LOG_APPENDED, {
				level: "error",
				message: `Failed to load: ${error?.message ?? "Unknown error"}`,
			});
		}
	}

	render() {
		const stepDots = RETRIEVAL_STEPS.map(
			(_, i) =>
				`<div class="step-dot" title="Step ${i + 1}: ${RETRIEVAL_STEPS[i].name}"></div>`,
		).join("");

		this.innerHTML = `
      <section class="mg-panel top-toolbar-panel">
        <div class="top-toolbar-content">
          <div class="toolbar-section" style="border-left:0">
            <div class="toolbar-brand">
              <div class="brand-glyph" aria-hidden="true">CB</div>
              <div class="brand-text">
                <strong>CAR Brain</strong>
                <span>Memory Simulator</span>
              </div>
            </div>
          </div>

          <div class="toolbar-section">
            <input class="toolbar-input memory-input" type="text" data-role="memory-input"
              placeholder="Add a new memory chunk..." aria-label="Memory input" />
          </div>

          <div class="toolbar-section">
            <input class="toolbar-input query-input" type="text" data-role="query-input"
              placeholder="Ask the brain a question..." aria-label="Query input" />
          </div>

          <div class="toolbar-section">
            <button class="toolbar-btn" data-action="play" type="button" title="Play retrieval">Play</button>
            <button class="toolbar-btn" data-action="step" type="button" title="Step through retrieval">Step</button>
            <button class="toolbar-btn" data-action="reset" type="button" title="Reset retrieval" disabled>Reset</button>
            <div class="step-dots">${stepDots}</div>
          </div>

          <div class="toolbar-section">
            <button class="toolbar-btn" data-action="undo" type="button" title="Undo (Cmd+Z)">Undo</button>
            <button class="toolbar-btn" data-action="redo" type="button" title="Redo (Shift+Cmd+Z)">Redo</button>
          </div>

          <div class="toolbar-section">
            <button class="toolbar-btn" data-action="save" type="button">Export</button>
            <button class="toolbar-btn" data-action="load" type="button">Import</button>
            <input data-role="load-input" type="file" accept="application/json,.json" hidden />
          </div>
        </div>
      </section>
    `;
	}
}

customElements.define("top-toolbar", TopToolbar);
