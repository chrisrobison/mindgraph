import { subscribe } from "../core/pan.js";

const escapeHtml = (value) =>
	String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

const formatTime = (ts) => {
	if (!ts) return "";
	try {
		return new Date(ts).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return "";
	}
};

const compactPreview = (value, maxLen = 180) => {
	try {
		const text = JSON.stringify(value);
		return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
	} catch {
		return String(value);
	}
};

const hasAttr = (element, name) => element.hasAttribute(name);

class PanEventConsole extends HTMLElement {
	#dispose = [];
	#events = [];
	#filter = "";
	#maxEvents = 80;

	connectedCallback() {
		const configuredMax = Number(this.getAttribute("max-events"));
		if (Number.isFinite(configuredMax) && configuredMax > 0) {
			this.#maxEvents = Math.min(200, Math.max(10, Math.floor(configuredMax)));
		}

		this.render();
		this.#bind();

		this.#dispose.push(
			subscribe("*", (event) => {
				this.#events = [event, ...this.#events].slice(0, this.#maxEvents);
				this.renderList();
			}),
		);
	}

	disconnectedCallback() {
		this.#dispose.forEach((run) => run());
		this.#dispose = [];
	}

	#bind() {
		this.querySelector("[data-action='clear-events']")?.addEventListener(
			"click",
			() => {
				this.#events = [];
				this.renderList();
			},
		);

		this.querySelector("[data-role='event-filter']")?.addEventListener(
			"input",
			(event) => {
				this.#filter = String(event.target?.value ?? "")
					.trim()
					.toLowerCase();
				this.renderList();
			},
		);
	}

	#isVisible(entry) {
		if (!this.#filter) return true;
		const payloadText = compactPreview(entry?.payload ?? {}, 220).toLowerCase();
		const eventName = String(entry?.eventName ?? "").toLowerCase();
		return (
			eventName.includes(this.#filter) || payloadText.includes(this.#filter)
		);
	}

	renderList() {
		const list = this.querySelector("[data-role='events-list']");
		if (!list) return;

		const visibleItems = this.#events.filter((entry) => this.#isVisible(entry));
		if (!visibleItems.length) {
			list.innerHTML =
				'<p class="panel-empty">No PAN events captured for this filter.</p>';
			return;
		}

		list.innerHTML = `
      <ul class="log-list">
        ${visibleItems
					.map((entry) => {
						const timestamp = escapeHtml(formatTime(entry?.timestamp));
						const name = escapeHtml(entry?.eventName ?? "unknown.event");
						const preview = escapeHtml(
							compactPreview(entry?.payload ?? {}, 180),
						);
						return `<li class="log-item pan-event-row"><span class="row-meta">${timestamp}</span> <strong>${name}</strong><code>${preview}</code></li>`;
					})
					.join("")}
      </ul>
    `;
	}

	render() {
		const showFilter = !hasAttr(this, "disable-filter");
		const showClear = !hasAttr(this, "disable-clear");

		this.innerHTML = `
      <section class="pan-console">
        <div class="pan-console-toolbar">
          ${showFilter ? '<input type="search" name="pan-event-filter" data-role="event-filter" placeholder="Filter events or payload..." aria-label="Filter PAN events" />' : ""}
          ${showClear ? '<button type="button" data-action="clear-events">Clear</button>' : ""}
        </div>
        <div data-role="events-list"></div>
      </section>
    `;

		this.renderList();
	}
}

customElements.define("pan-event-console", PanEventConsole);
