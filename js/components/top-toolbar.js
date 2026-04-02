import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";

const clampZoom = (value) => Math.min(1.8, Math.max(0.45, value));

class TopToolbar extends HTMLElement {
  #dispose = [];
  #activeTool = "select";
  #zoom = 1;

  connectedCallback() {
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

    this.#syncPressedState();
    this.#syncZoom();
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

    this.querySelector("[data-action='run-all']")?.addEventListener("click", () => {
      publish(EVENTS.RUNTIME_AGENT_RUN_STARTED, { scope: "graph" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: "Run all requested from toolbar"
      });
    });

    this.querySelector("[data-action='summarize-subtree']")?.addEventListener("click", () => {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: "Summarize subtree requested"
      });
    });

    this.querySelector("[data-action='save']")?.addEventListener("click", () => this.#onSave());
    this.querySelector("[data-action='load']")?.addEventListener("click", () => this.#onLoadRequest());

    this.querySelector("[data-action='zoom-in']")?.addEventListener("click", () =>
      this.#changeZoom(1.1)
    );
    this.querySelector("[data-action='zoom-out']")?.addEventListener("click", () =>
      this.#changeZoom(0.9)
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

  #onSave() {
    const snapshot = graphStore.save();
    if (!snapshot) return;

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
      graphStore.load(parsed);
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
              <span>Browser-native orchestration map</span>
            </div>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-action="run-all" type="button">Run All</button>
            <button data-action="summarize-subtree" type="button">Summarize Subtree</button>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-tool="create:note" type="button" aria-pressed="false">Add Node</button>
            <button data-tool="connect" type="button" aria-pressed="false">Add Edge</button>
          </div>

          <div class="toolbar-actions toolbar-action-group">
            <button data-action="save" type="button">Save</button>
            <button data-action="load" type="button">Load</button>
            <input data-role="load-input" type="file" accept="application/json,.json" hidden />
          </div>

          <div class="toolbar-actions toolbar-action-group toolbar-zoom">
            <button data-action="zoom-out" type="button" aria-label="Zoom out">-</button>
            <button data-action="zoom-reset" type="button" data-role="zoom-label">100%</button>
            <button data-action="zoom-in" type="button" aria-label="Zoom in">+</button>
          </div>

          <div class="toolbar-search">
            <input type="search" placeholder="Search nodes, edges, or notes..." aria-label="Search graph" />
          </div>
        </div>
      </section>
    `;
  }
}

customElements.define("top-toolbar", TopToolbar);
