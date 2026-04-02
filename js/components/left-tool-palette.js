import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { NODE_TYPE_VALUES } from "../core/types.js";

class LeftToolPalette extends HTMLElement {
  #dispose = [];
  #active = "select";

  connectedCallback() {
    this.render();
    this.#bind();

    this.#dispose.push(
      subscribe(EVENTS.TOOLBAR_TOOL_CHANGED, ({ payload }) => {
        this.#active = payload?.tool ?? "select";
        this.#sync();
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  #bind() {
    this.querySelectorAll("button[data-node-type]").forEach((button) => {
      button.addEventListener("click", () => {
        const tool = `create:${button.dataset.nodeType}`;
        publish(EVENTS.TOOLBAR_TOOL_CHANGED, { tool });
        publish(EVENTS.ACTIVITY_LOG_APPENDED, {
          level: "info",
          message: `Tool changed to ${tool}`
        });
      });
    });
  }

  #sync() {
    this.querySelectorAll("button[data-node-type]").forEach((button) => {
      const tool = `create:${button.dataset.nodeType}`;
      button.setAttribute("aria-pressed", this.#active === tool ? "true" : "false");
    });
  }

  render() {
    const buttons = NODE_TYPE_VALUES
      .map(
        (type) => `<button type="button" data-node-type="${type}" aria-pressed="false">${type}</button>`
      )
      .join("");

    this.innerHTML = `
      <aside class="mg-panel">
        <header>Tool Palette</header>
        <div class="content">
          <p>Node creation tools:</p>
          <div class="palette-tools">${buttons}</div>
        </div>
      </aside>
    `;
  }
}

customElements.define("left-tool-palette", LeftToolPalette);
