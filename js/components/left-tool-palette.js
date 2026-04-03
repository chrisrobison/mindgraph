import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { uiStore } from "../store/ui-store.js";

const TOOLS = [
	{ id: "select", label: "Select", shortcut: "V", icon: "SEL" },
	{ id: "pan", label: "Pan / Orbit", shortcut: "H", icon: "ORB" },
	{ id: "create:chunk", label: "Add Chunk", shortcut: "C", icon: "CHK" },
	{ id: "connect", label: "Add Link", shortcut: "L", icon: "LNK" },
	{ id: "create:question", label: "Add Question", shortcut: "Q", icon: "Q?" },
	{ id: "create:trigger", label: "Add Trigger", shortcut: "T", icon: "TRG" },
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
			}),
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
					message: `Tool: ${tool}`,
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
		const buttons = TOOLS.map(
			(tool) => `
        <button class="palette-tool-btn" type="button" data-tool="${tool.id}"
          aria-pressed="false" title="${tool.label} (${tool.shortcut})"
          aria-label="${tool.label}">
          <span>${tool.icon}</span>
        </button>
      `,
		).join("");

		const shortcuts = TOOLS.map(
			(tool) => `<span><kbd>${tool.shortcut}</kbd> ${tool.label}</span>`,
		).join("");

		this.innerHTML = `
      <aside class="mg-panel palette-panel">
        <header>Tools</header>
        <div class="content palette-content">
          <div style="display:flex;flex-direction:column;gap:var(--space-1)">
            ${buttons}
          </div>
          <div class="palette-shortcut-hint">
            ${shortcuts}
          </div>
        </div>
      </aside>
    `;
	}
}

customElements.define("left-tool-palette", LeftToolPalette);
