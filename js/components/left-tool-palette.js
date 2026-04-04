import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { uiStore } from "../store/ui-store.js";

const ICON_BY_TOOL = {
  select: "assets/toolbar/select.svg",
  pan: "assets/toolbar/pan.svg",
  "create:note": "assets/toolbar/note2.svg",
  "create:agent": "assets/toolbar/agent.svg",
  "create:data": "assets/toolbar/data.svg",
  "create:transformer": "assets/toolbar/transform.svg",
  "create:view": "assets/toolbar/view.svg",
  "create:action": "assets/toolbar/action.svg",
  connect: "assets/toolbar/connect.svg"
};

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
      { id: "create:note", label: "Note Node" },
      { id: "create:agent", label: "Agent Node" },
      { id: "create:data", label: "Data Node" },
      { id: "create:transformer", label: "Transformer Node" },
      { id: "create:view", label: "View Node" },
      { id: "create:action", label: "Action Node" }
    ]
  },
  {
    title: "Structure",
    tools: [{ id: "connect", label: "Connect Edge" }]
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
            <button class="palette-tool-btn" type="button" data-tool="${tool.id}" aria-pressed="false" title="${tool.label}" aria-label="${tool.label}">
              <img class="palette-tool-icon" src="${ICON_BY_TOOL[tool.id] ?? ""}" alt="" aria-hidden="true" />
              <span class="palette-tool-label">${tool.label}</span>
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
          <section class="palette-shortcuts">
            <h4>Shortcuts</h4>
            <p><kbd>Delete</kbd> remove selected node</p>
            <p><kbd>Cmd/Ctrl+D</kbd> duplicate selected node</p>
            <p><kbd>Cmd/Ctrl+Z</kbd> / <kbd>Shift+Cmd/Ctrl+Z</kbd> undo/redo</p>
            <p><kbd>Shift+Click</kbd> add/remove node in selection</p>
            <p>Drag empty canvas to marquee-select nodes</p>
            <p><kbd>Esc</kbd> reset tool or clear selection</p>
          </section>
        </div>
      </aside>
    `;
  }
}

customElements.define("left-tool-palette", LeftToolPalette);
