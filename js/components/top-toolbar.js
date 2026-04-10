import { clampZoom, GRAPH_LIMITS } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { runtimeService } from "../runtime/runtime-service.js";
import { graphStore } from "../store/graph-store.js";
import { persistenceStore } from "../store/persistence-store.js";
import { uiStore } from "../store/ui-store.js";
import { isExecutableNodeType } from "../core/graph-semantics.js";
import { DEMO_TEMPLATES, getDemoTemplateById, loadDemoTemplateDocument } from "../core/demo-templates.js";

class TopToolbar extends HTMLElement {
  #dispose = [];
  #activeTool = "select";
  #zoom = 1;
  #activeRuns = 0;
  #canUndo = false;
  #canRedo = false;
  #autosaveEnabled = true;
  #runtimeMode = "mock";
  #runtimeEndpoint = "";
  #selectedTemplateId = DEMO_TEMPLATES[0]?.id ?? "";

  connectedCallback() {
    const history = graphStore.getHistoryState();
    this.#canUndo = history.canUndo;
    this.#canRedo = history.canRedo;
    this.#autosaveEnabled = persistenceStore.isAutosaveEnabled();
    this.#runtimeMode = runtimeService.getMode();
    this.#runtimeEndpoint = runtimeService.getEndpoint();
    if (!getDemoTemplateById(this.#selectedTemplateId) && DEMO_TEMPLATES.length) {
      this.#selectedTemplateId = DEMO_TEMPLATES[0].id;
    }

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

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_MODE_CHANGED, ({ payload }) => {
        this.#runtimeMode = payload?.mode ?? runtimeService.getMode();
        this.#syncRuntimeFields();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_AGENT_RUN_STARTED, () => {
        this.#activeRuns += 1;
        this.#syncRunButtons();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_AGENT_RUN_COMPLETED, () => {
        this.#activeRuns = Math.max(0, this.#activeRuns - 1);
        this.#syncRunButtons();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_AGENT_RUN_FAILED, () => {
        this.#activeRuns = Math.max(0, this.#activeRuns - 1);
        this.#syncRunButtons();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_RUN_CANCELLED, () => {
        this.#activeRuns = 0;
        this.#syncRunButtons();
      })
    );

    this.#syncPressedState();
    this.#syncZoom();
    this.#syncRunButtons();
    this.#syncHistoryButtons();
    this.#syncAutosaveToggle();
    this.#syncRuntimeFields();
    this.#syncTemplatePicker();
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

    this.querySelector("[data-action='run-all']")?.addEventListener("click", () => this.#requestRunAll());

    this.querySelector("[data-action='summarize-subtree']")?.addEventListener("click", () =>
      this.#requestSelectedSubtree()
    );

    this.querySelector("[data-action='save']")?.addEventListener("click", () => this.#onSave());
    this.querySelector("[data-action='load']")?.addEventListener("click", () => this.#onLoadRequest());
    this.querySelector("[data-action='load-template']")?.addEventListener("click", () => void this.#onLoadTemplate());

    this.querySelector("[data-action='undo']")?.addEventListener("click", () => this.#undo());
    this.querySelector("[data-action='redo']")?.addEventListener("click", () => this.#redo());

    this.querySelector("[data-action='toggle-autosave']")?.addEventListener("click", () => {
      persistenceStore.setAutosaveEnabled(!this.#autosaveEnabled);
    });

    this.querySelector("[data-action='open-runtime-settings']")?.addEventListener("click", () => {
      uiStore.setBottomTab("settings");
    });

    this.querySelector("[data-action='cancel-runs']")?.addEventListener("click", () => {
      publish(EVENTS.RUNTIME_RUN_CANCEL_REQUESTED, {
        reason: "toolbar_cancel_runs",
        origin: "top-toolbar"
      });
    });

    this.querySelector('[data-field="runtime-mode"]')?.addEventListener("change", (event) => {
      const value = String(event.target.value ?? "mock");
      runtimeService.setMode(value);
      this.#runtimeMode = runtimeService.getMode();
      this.#syncRuntimeFields();
    });

    this.querySelector('[data-field="runtime-endpoint"]')?.addEventListener("change", (event) => {
      const endpoint = String(event.target.value ?? "").trim();
      if (!endpoint) return;
      runtimeService.setEndpoint(endpoint);
      this.#runtimeEndpoint = runtimeService.getEndpoint();
      this.#syncRuntimeFields();
    });

    this.querySelector('[data-field="template-picker"]')?.addEventListener("change", (event) => {
      this.#selectedTemplateId = String(event.target.value ?? "");
      this.#syncTemplatePicker();
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

  #requestRunAll() {
    if (this.#activeRuns > 0) return;
    publish(EVENTS.RUNTIME_ALL_RUN_REQUESTED, {
      trigger: "toolbar_run_all",
      origin: "top-toolbar"
    });
  }

  #requestSelectedSubtree() {
    if (this.#activeRuns > 0) return;
    const selectedNodeId = graphStore.getSelectedNodeId();
    if (!selectedNodeId) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "warn",
        message: "Select an agent node to run subtree summary"
      });
      return;
    }

    const selectedNode = graphStore.getNode(selectedNodeId);
    if (!selectedNode || !isExecutableNodeType(selectedNode.type)) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "warn",
        message: "Subtree run is available for runnable nodes only"
      });
      return;
    }

    publish(EVENTS.RUNTIME_SUBTREE_RUN_REQUESTED, {
      nodeId: selectedNodeId,
      trigger: "toolbar_subtree",
      origin: "top-toolbar"
    });
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
      button.disabled = this.#activeRuns > 0;
    });
    const cancel = this.querySelector("[data-action='cancel-runs']");
    if (cancel) cancel.disabled = this.#activeRuns === 0;
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

  #syncRuntimeFields() {
    const modeField = this.querySelector('[data-field="runtime-mode"]');
    const endpointField = this.querySelector('[data-field="runtime-endpoint"]');
    if (modeField) modeField.value = this.#runtimeMode;
    if (endpointField) endpointField.value = this.#runtimeEndpoint;
    if (endpointField) endpointField.disabled = this.#runtimeMode !== "http";
  }

  #syncTemplatePicker() {
    const picker = this.querySelector('[data-field="template-picker"]');
    if (picker) picker.value = this.#selectedTemplateId;
    const description = this.querySelector('[data-role="template-description"]');
    const selected = getDemoTemplateById(this.#selectedTemplateId);
    if (description) {
      description.textContent = selected?.description ?? "Select a demo template to import.";
    }
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

  async #onLoadTemplate() {
    const selected = getDemoTemplateById(this.#selectedTemplateId);
    if (!selected) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "warn",
        message: "Select a template before importing"
      });
      return;
    }

    try {
      const document = await loadDemoTemplateDocument(selected.id);
      publish(EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED, {
        document,
        reason: `toolbar_load_template:${selected.id}`,
        origin: "top-toolbar"
      });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Loaded demo template: ${selected.title}`
      });
    } catch (error) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "error",
        message: `Failed to load template: ${error?.message ?? "Unknown error"}`
      });
    }
  }

  render() {
    const templateOptions = DEMO_TEMPLATES.map(
      (template) =>
        `<option value="${template.id}" ${
          template.id === this.#selectedTemplateId ? "selected" : ""
        }>${template.title}</option>`
    ).join("");
    const selectedTemplate = getDemoTemplateById(this.#selectedTemplateId);
    const templateDescription = selectedTemplate?.description ?? "Select a demo template to import.";
    const templatesDisabled = DEMO_TEMPLATES.length ? "" : "disabled";
    const graphName = graphStore.getDocument()?.title ?? "MindGraph";

    this.innerHTML = `
      <section class="top-toolbar-panel">
        <div class="mg-toolbar-bar">
          <div class="toolbar-logo">
            <div class="toolbar-logo-box" aria-hidden="true">⬡</div>
            <span class="toolbar-logo-name">MindGraph</span>
            <span class="toolbar-caret" aria-hidden="true">▾</span>
          </div>
          <div class="toolbar-separator" aria-hidden="true"></div>
          <span class="toolbar-graph-name">${graphName}</span>
          <div class="toolbar-spacer"></div>
          <div class="toolbar-actions toolbar-actions-inline">
            <button data-action="run-all" type="button">▷ Run All</button>
            <button data-action="summarize-subtree" type="button">⊙ Summarize</button>
            <button data-tool="create:note" type="button" class="primary" aria-pressed="false">+ Add Node</button>
            <button data-action="cancel-runs" type="button" class="icon-btn" title="Cancel runs" aria-label="Cancel runs" disabled>×</button>
            <button data-action="open-runtime-settings" type="button" class="icon-btn" title="Runtime settings" aria-label="Runtime settings">⚙</button>
          </div>
        </div>
        <div class="top-toolbar-content">
          <div class="toolbar-actions toolbar-action-group">
            <button data-action="undo" type="button" title="Undo (Cmd/Ctrl+Z)">Undo</button>
            <button data-action="redo" type="button" title="Redo (Shift+Cmd/Ctrl+Z)">Redo</button>
            <button data-tool="connect" type="button" aria-pressed="false">Add Edge</button>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-action="save" type="button">Save JSON</button>
            <button data-action="load" type="button">Load JSON</button>
            <button data-action="toggle-autosave" type="button" aria-pressed="true">Autosave On</button>
            <input data-role="load-input" name="graph-load-file" type="file" accept="application/json,.json" hidden />
          </div>

          <div class="toolbar-actions toolbar-action-group toolbar-template-group">
            <select data-field="template-picker" aria-label="Demo templates" ${templatesDisabled}>
              ${templateOptions}
            </select>
            <button data-action="load-template" type="button" ${templatesDisabled}>Import Template</button>
            <span data-role="template-description" class="toolbar-template-description">${templateDescription}</span>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <select data-field="runtime-mode" aria-label="Runtime mode">
              <option value="mock" ${this.#runtimeMode === "mock" ? "selected" : ""}>Mock Runtime</option>
              <option value="http" ${this.#runtimeMode === "http" ? "selected" : ""}>HTTP Runtime</option>
            </select>
            <input data-field="runtime-endpoint" type="text" value="${this.#runtimeEndpoint}" placeholder="/api/mindgraph/runtime" />
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
