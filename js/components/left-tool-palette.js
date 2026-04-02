import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { uiStore } from "../store/ui-store.js";

const TOOL_GROUPS = [
  {
    title: "Pointer",
    tools: [
      { id: "select", label: "Select" },
      { id: "pan", label: "Pan" }
    ]
  },
  {
    title: "Add Nodes",
    tools: [
      { id: "create:note", label: "Add Note Node" },
      { id: "create:agent", label: "Add Agent Node" },
      { id: "create:data", label: "Add Data Node" },
      { id: "create:transformer", label: "Add Transformer Node" },
      { id: "create:view", label: "Add View Node" },
      { id: "create:action", label: "Add Action Node" }
    ]
  },
  {
    title: "Structure",
    tools: [
      { id: "connect", label: "Connect" },
      { id: "comment", label: "Comment" },
      { id: "frame", label: "Frame/Group" }
    ]
  }
];

class LeftToolPalette extends HTMLElement {
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

    this.#syncPressedState();
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bind() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool ?? "select";
        uiStore.setTool(tool);
        publish(EVENTS.ACTIVITY_LOG_APPENDED, {
          level: "info",
          message: `Tool changed to ${tool}`
        });
      });
    });
  }

  #syncPressedState() {
    this.querySelectorAll("[data-tool]").forEach((button) => {
      const isActive = button.dataset.tool === this.#activeTool;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  render() {
    const sections = TOOL_GROUPS.map((group) => {
      const buttons = group.tools
        .map(
          (tool) => `
            <button class="palette-tool-btn" type="button" data-tool="${tool.id}" aria-pressed="false">
              ${tool.label}
            </button>
          `
        )
        .join("");

      return `
        <section class="palette-group">
          <h4>${group.title}</h4>
          <div class="palette-tools">${buttons}</div>
        </section>
      `;
    }).join("");

    this.innerHTML = `
      <aside class="mg-panel palette-panel">
        <header>Tools</header>
        <div class="content palette-content">
          ${sections}
        </div>
      </aside>
    `;
  }
}

customElements.define("left-tool-palette", LeftToolPalette);
