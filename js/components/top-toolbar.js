import { clampZoom, GRAPH_LIMITS } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { mockAgentRuntime } from "../runtime/mock-agent-runtime.js";
import { graphStore } from "../store/graph-store.js";
import { persistenceStore } from "../store/persistence-store.js";
import { uiStore } from "../store/ui-store.js";

class TopToolbar extends HTMLElement {
  #dispose = [];
  #activeTool = "select";
  #zoom = 1;
  #running = false;
  #canUndo = false;
  #canRedo = false;
  #autosaveEnabled = true;

  connectedCallback() {
    const history = graphStore.getHistoryState();
    this.#canUndo = history.canUndo;
    this.#canRedo = history.canRedo;
    this.#autosaveEnabled = persistenceStore.isAutosaveEnabled();

    this.render();
    this.#bind();

    this.#dispose.push(
      subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
        this.#activeTool = payload?.tool ?? "select";
        this.#syncPressedState();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_VIEWPORT_CHANGED, ({ payload }) => {
        const nextZoom = Number(payload?.zoom ?? this.#zoom);
        if (!Number.isFinite(nextZoom)) return;
        this.#zoom = clampZoom(nextZoom);
        this.#syncZoom();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_HISTORY_CHANGED, ({ payload }) => {
        this.#canUndo = Boolean(payload?.canUndo);
        this.#canRedo = Boolean(payload?.canRedo);
        this.#syncHistoryButtons();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_AUTOSAVE_STATE_CHANGED, ({ payload }) => {
        this.#autosaveEnabled = Boolean(payload?.enabled);
        this.#syncAutosaveToggle();
      })
    );

    this.#syncPressedState();
    this.#syncZoom();
    this.#syncRunButtons();
    this.#syncHistoryButtons();
    this.#syncAutosaveToggle();
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bind() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        uiStore.setTool(button.dataset.tool ?? "select");
      });
    });

    this.querySelector("[data-action='run-all']")?.addEventListener("click", () =>
      this.#runRuntimeAction(() => {
        publish(EVENTS.RUNTIME_ALL_RUN_REQUESTED, {
          trigger: "toolbar_run_all",
          origin: "top-toolbar"
        });
        return mockAgentRuntime.runAll({ trigger: "toolbar_run_all" });
      })
    );

    this.querySelector("[data-action='summarize-subtree']")?.addEventListener("click", () =>
      this.#runRuntimeAction(() => this.#summarizeSelectedSubtree())
    );

    this.querySelector("[data-action='save']")?.addEventListener("click", () => this.#onSave());
    this.querySelector("[data-action='load']")?.addEventListener("click", () => this.#onLoadRequest());

    this.querySelector("[data-action='undo']")?.addEventListener("click", () => this.#undo());
    this.querySelector("[data-action='redo']")?.addEventListener("click", () => this.#redo());

    this.querySelector("[data-action='toggle-autosave']")?.addEventListener("click", () => {
      persistenceStore.setAutosaveEnabled(!this.#autosaveEnabled);
    });

    this.querySelector("[data-action='zoom-in']")?.addEventListener("click", () =>
      this.#changeZoom(GRAPH_LIMITS.zoomInFactor)
    );
    this.querySelector("[data-action='zoom-out']")?.addEventListener("click", () =>
      this.#changeZoom(GRAPH_LIMITS.zoomOutFactor)
    );
    this.querySelector("[data-action='zoom-reset']")?.addEventListener("click", () =>
      uiStore.setViewportZoom(1)
    );

    this.querySelector("[data-role='load-input']")?.addEventListener("change", (event) =>
      this.#onLoadFile(event)
    );
  }

  #changeZoom(factor) {
    const nextZoom = clampZoom(this.#zoom * factor);
    uiStore.setViewportZoom(nextZoom);
  }

  #undo() {
    if (!this.#canUndo) return;
    publish(EVENTS.GRAPH_DOCUMENT_UNDO_REQUESTED, { origin: "top-toolbar" });
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: "Undo applied"
    });
  }

  #redo() {
    if (!this.#canRedo) return;
    publish(EVENTS.GRAPH_DOCUMENT_REDO_REQUESTED, { origin: "top-toolbar" });
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: "Redo applied"
    });
  }

  async #runRuntimeAction(run) {
    if (this.#running) return;

    this.#running = true;
    this.#syncRunButtons();

    try {
      await run();
    } catch (error) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "error",
        message: `Runtime action failed: ${error?.message ?? "Unknown error"}`
      });
    } finally {
      this.#running = false;
      this.#syncRunButtons();
    }
  }

  async #summarizeSelectedSubtree() {
    const selectedNodeId = graphStore.getSelectedNodeId();
    if (!selectedNodeId) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "warn",
        message: "Select an agent node to run subtree summary"
      });
      return;
    }

    const selectedNode = graphStore.getNode(selectedNodeId);
    if (!selectedNode || selectedNode.type !== "agent") {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "warn",
        message: "Subtree summary is available for agent nodes only"
      });
      return;
    }

    publish(EVENTS.RUNTIME_SUBTREE_RUN_REQUESTED, {
      nodeId: selectedNodeId,
      trigger: "toolbar_subtree",
      origin: "top-toolbar"
    });
    await mockAgentRuntime.runSubtree(selectedNodeId, { trigger: "toolbar_subtree" });
  }

  #syncPressedState() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      const pressed = button.dataset.tool === this.#activeTool;
      button.setAttribute("aria-pressed", pressed ? "true" : "false");
    });
  }

  #syncZoom() {
    const zoomLabel = this.querySelector("[data-role='zoom-label']");
    if (!zoomLabel) return;
    zoomLabel.textContent = `${Math.round(this.#zoom * 100)}%`;
  }

  #syncRunButtons() {
    this.querySelectorAll("[data-action='run-all'], [data-action='summarize-subtree']").forEach((button) => {
      button.disabled = this.#running;
    });
  }

  #syncHistoryButtons() {
    const undoButton = this.querySelector("[data-action='undo']");
    const redoButton = this.querySelector("[data-action='redo']");
    if (undoButton) undoButton.disabled = !this.#canUndo;
    if (redoButton) redoButton.disabled = !this.#canRedo;
  }

  #syncAutosaveToggle() {
    const toggle = this.querySelector("[data-action='toggle-autosave']");
    if (!toggle) return;
    toggle.setAttribute("aria-pressed", this.#autosaveEnabled ? "true" : "false");
    toggle.textContent = this.#autosaveEnabled ? "Autosave On" : "Autosave Off";
  }

  #onSave() {
    const snapshot = graphStore.getDocument();
    if (!snapshot) return;

    publish(EVENTS.GRAPH_DOCUMENT_SAVE_REQUESTED, { origin: "top-toolbar" });

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeTitle = String(snapshot.title ?? "mindgraph")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    anchor.href = url;
    anchor.download = `${safeTitle || "mindgraph"}-${Date.now()}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: "Graph exported as JSON"
    });
  }

  #onLoadRequest() {
    const input = this.querySelector("[data-role='load-input']");
    if (!input) return;
    input.value = "";
    input.click();
  }

  async #onLoadFile(event) {
    const fileInput = event.target;
    const file = fileInput?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      publish(EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED, {
        document: parsed,
        reason: "toolbar_load_file",
        origin: "top-toolbar"
      });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Loaded graph from ${file.name}`
      });
    } catch (error) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "error",
        message: `Failed to load document: ${error?.message ?? "Unknown error"}`
      });
    }
  }

  render() {
    this.innerHTML = `
      <section class="mg-panel top-toolbar-panel">
        <div class="top-toolbar-content">
          <div class="toolbar-brand">
            <div class="brand-glyph" aria-hidden="true">MG</div>
            <div class="brand-text">
              <strong>MindGraph AI</strong>
              <span>Visual Agent Graph Workbench</span>
            </div>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-action="run-all" type="button">Run All</button>
            <button data-action="summarize-subtree" type="button">Run Subtree</button>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-action="undo" type="button" title="Undo (Cmd/Ctrl+Z)">Undo</button>
            <button data-action="redo" type="button" title="Redo (Shift+Cmd/Ctrl+Z)">Redo</button>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-tool="create:note" type="button" aria-pressed="false">Add Node</button>
            <button data-tool="connect" type="button" aria-pressed="false">Add Edge</button>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-action="save" type="button">Save JSON</button>
            <button data-action="load" type="button">Load JSON</button>
            <button data-action="toggle-autosave" type="button" aria-pressed="true">Autosave On</button>
            <input data-role="load-input" name="graph-load-file" type="file" accept="application/json,.json" hidden />
          </div>

          <div class="toolbar-actions toolbar-action-group toolbar-zoom">
            <button data-action="zoom-out" type="button" aria-label="Zoom out">-</button>
            <button data-action="zoom-reset" type="button" data-role="zoom-label">100%</button>
            <button data-action="zoom-in" type="button" aria-label="Zoom in">+</button>
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define("top-toolbar", TopToolbar);
