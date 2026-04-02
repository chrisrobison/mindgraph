import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";

class TopToolbar extends HTMLElement {
  #dispose = [];
  #activeTool = "select";

  connectedCallback() {
    this.render();
    this.#bind();

    this.#dispose.push(
      subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
        this.#activeTool = payload?.tool ?? "select";
        this.#syncPressedState();
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bind() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        publish(EVENTS.TOOLBAR_TOOL_CHANGED, { tool: button.dataset.tool });
      });
    });

    this.querySelector("[data-action='run-all']")?.addEventListener("click", () => {
      publish(EVENTS.RUNTIME_AGENT_RUN_STARTED, { scope: "graph" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: "Run all requested from toolbar"
      });
    });

    this.querySelector("[data-action='save']")?.addEventListener("click", () => {
      publish(EVENTS.GRAPH_DOCUMENT_SAVED, { reason: "toolbar_save" });
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: "Graph save requested"
      });
    });
  }

  #syncPressedState() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      const pressed = button.dataset.tool === this.#activeTool;
      button.setAttribute("aria-pressed", pressed ? "true" : "false");
    });
  }

  render() {
    this.innerHTML = `
      <section class="mg-panel">
        <header>MindGraph AI</header>
        <div class="content toolbar-actions">
          <button data-action="run-all" type="button">Run All</button>
          <button data-action="save" type="button">Save</button>
          <button data-tool="select" type="button" aria-pressed="true">Select</button>
          <button data-tool="link" type="button" aria-pressed="false">Link</button>
          <button data-tool="pan" type="button" aria-pressed="false">Pan</button>
        </div>
      </section>
    `;
  }
}

customElements.define("top-toolbar", TopToolbar);
