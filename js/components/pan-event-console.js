import { subscribe } from "../core/pan.js";

class PanEventConsole extends HTMLElement {
  #dispose = [];
  #events = [];

  connectedCallback() {
    this.render();

    this.#dispose.push(
      subscribe("*", (event) => {
        this.#events = [event, ...this.#events].slice(0, 30);
        this.render();
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  render() {
    const lines = this.#events
      .map(
        (entry) =>
          `<li class="log-item">${new Date(entry.timestamp).toLocaleTimeString()} ${entry.eventName}</li>`
      )
      .join("");

    this.innerHTML = lines ? `<ul class="log-list">${lines}</ul>` : "<p>No PAN events captured yet.</p>";
  }
}

customElements.define("pan-event-console", PanEventConsole);
