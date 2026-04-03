import { EVENTS } from "../core/event-constants.js";
import { subscribe } from "../core/pan.js";
import { uiStore } from "../store/ui-store.js";

const tabs = [
	{ key: "retrieval-log", label: "Retrieval Log" },
	{ key: "consolidation", label: "Consolidation" },
	{ key: "contradictions", label: "Contradictions" },
	{ key: "questions", label: "Questions" },
	{ key: "metamemory", label: "Metamemory" },
];

const tabByKey = Object.fromEntries(tabs.map((tab) => [tab.key, tab]));
const normalizeTab = (value) => (tabByKey[value] ? value : "retrieval-log");

const escapeHtml = (value) =>
	String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");

const formatTime = (iso) => {
	if (!iso) return "";
	try {
		return new Date(iso).toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return "";
	}
};

/* ── Tab content renderers ── */

const renderRetrievalLog = (runtime) => {
	const log = runtime?.retrievalLog ?? [];
	if (!log.length) {
		return '<p class="panel-empty">No queries yet. Ask the brain a question to see the retrieval process.</p>';
	}

	const result = runtime.retrievalResult;
	const rows = log
		.map(
			(entry) => `
      <div class="log-row">
        <span class="log-step">${entry.step ?? "?"}</span>
        <span class="log-message">${escapeHtml(entry.name)}</span>
        <span class="log-detail">${entry.status === "done" ? "done" : "..."}</span>
        <span class="log-timestamp">${formatTime(entry.at)}</span>
      </div>
    `,
		)
		.join("");

	const resultHtml = result
		? result.error
			? `<div style="padding:var(--space-2) 0;color:var(--color-contradiction);font-family:var(--font-mono);font-size:var(--font-size-sm)">${escapeHtml(result.error)}</div>`
			: result.answer
				? `
        <div style="padding:var(--space-2) 0">
          <div style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--text-primary);line-height:1.5">${escapeHtml(result.answer)}</div>
          ${result.confidence != null ? `<span class="log-confidence ${result.confidence >= 0.7 ? "confidence-high" : result.confidence >= 0.4 ? "confidence-medium" : "confidence-low"}">Confidence: ${(result.confidence * 100).toFixed(0)}%</span>` : ""}
        </div>
      `
				: ""
		: "";

	return `
    ${runtime.retrievalQuery ? `<div style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--color-question);padding:var(--space-1) 0;margin-bottom:var(--space-2)">Q: ${escapeHtml(runtime.retrievalQuery)}</div>` : ""}
    ${rows}
    ${resultHtml}
  `;
};

const renderConsolidation = (runtime) => {
	const log = runtime?.consolidationLog ?? [];
	if (!log.length) {
		return '<p class="panel-empty">No consolidation activity. Add more memories to trigger tier promotion.</p>';
	}

	return log
		.map(
			(entry) => `
      <div class="log-row">
        <span class="log-timestamp">${formatTime(entry.at)}</span>
        <span class="log-message">${escapeHtml(entry.fromTier ? `T${entry.fromTier} → T${entry.toTier}` : "Promoted")}</span>
        <span class="log-detail">${escapeHtml(entry.nodeId ?? "")}</span>
      </div>
    `,
		)
		.join("");
};

const renderContradictions = (runtime) => {
	const items = runtime?.contradictions ?? [];
	if (!items.length) {
		return '<p class="panel-empty">No contradictions detected. Conflicting memories will appear here.</p>';
	}

	return items
		.map(
			(item) => `
      <div class="log-row">
        <span class="log-timestamp">${formatTime(item.at)}</span>
        <span class="log-message" style="color:var(--color-contradiction)">${escapeHtml(item.description ?? "Contradiction")}</span>
        <span class="log-detail">${escapeHtml(item.nodeA ?? "")} vs ${escapeHtml(item.nodeB ?? "")}</span>
      </div>
    `,
		)
		.join("");
};

const renderQuestions = (runtime) => {
	const items = runtime?.unansweredQuestions ?? [];
	if (!items.length) {
		return '<p class="panel-empty">No unanswered questions. The self-questioning engine activates as memories accumulate.</p>';
	}

	return items
		.map(
			(item) => `
      <div class="log-row">
        <span class="log-step" style="color:var(--color-question)">L${item.level ?? "?"}</span>
        <span class="log-message" style="color:var(--color-question)">${escapeHtml(item.question_text ?? item.text ?? "")}</span>
      </div>
    `,
		)
		.join("");
};

const renderMetamemory = (runtime) => {
	const meta = runtime?.metamemory;
	if (!meta) {
		return '<p class="panel-empty">Knowledge inventory empty. The brain builds its self-model as you add memories.</p>';
	}

	const topics = meta.topics ?? {};
	const rows = Object.entries(topics)
		.map(
			([topic, data]) => `
      <div class="log-row">
        <span class="log-message">${escapeHtml(topic)}</span>
        <span class="log-detail">${data.count ?? 0} chunks</span>
        <span class="log-confidence ${(data.confidence ?? 0) >= 0.7 ? "confidence-high" : (data.confidence ?? 0) >= 0.4 ? "confidence-medium" : "confidence-low"}">${((data.confidence ?? 0) * 100).toFixed(0)}%</span>
      </div>
    `,
		)
		.join("");

	return rows || '<p class="panel-empty">No topic data yet.</p>';
};

const renderTabContent = (tab, runtime) => {
	switch (tab) {
		case "retrieval-log":
			return renderRetrievalLog(runtime);
		case "consolidation":
			return renderConsolidation(runtime);
		case "contradictions":
			return renderContradictions(runtime);
		case "questions":
			return renderQuestions(runtime);
		case "metamemory":
			return renderMetamemory(runtime);
		default:
			return renderRetrievalLog(runtime);
	}
};

/* ── Component ── */

class BottomActivityPanel extends HTMLElement {
	#dispose = [];
	#tab = "retrieval-log";
	#runtime = uiStore.getRuntimeState();

	connectedCallback() {
		const state = uiStore.getState();
		this.#tab = normalizeTab(state.bottomTab);
		this.#runtime = uiStore.getRuntimeState();

		this.render();
		this.#bind();

		this.#dispose.push(
			subscribe(EVENTS.PANEL_BOTTOM_TAB_CHANGED, ({ payload }) => {
				this.#tab = normalizeTab(payload?.tab);
				this.render();
				this.#bind();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.UI_RUNTIME_STATE_CHANGED, () => {
				this.#runtime = uiStore.getRuntimeState();
				this.#renderView();
			}),
		);
	}

	disconnectedCallback() {
		this.#dispose.forEach((run) => run());
		this.#dispose = [];
	}

	#bind() {
		this.querySelectorAll("[data-bottom-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				uiStore.setBottomTab(button.dataset.bottomTab);
			});
		});
	}

	#renderView() {
		const panel = this.querySelector("[data-role='bottom-tab-content']");
		if (!panel) return;
		panel.innerHTML = renderTabContent(this.#tab, this.#runtime);
	}

	#getTabBadge(tabKey) {
		if (tabKey === "contradictions") {
			const count = this.#runtime?.contradictions?.length ?? 0;
			return count > 0 ? `<span class="tab-badge">${count}</span>` : "";
		}
		if (tabKey === "questions") {
			const count = this.#runtime?.unansweredQuestions?.length ?? 0;
			return count > 0
				? `<span class="tab-badge" style="background:var(--color-question);color:#000">${count}</span>`
				: "";
		}
		return "";
	}

	render() {
		this.innerHTML = `
      <section class="mg-panel">
        <header>Activity</header>
        <div class="content bottom-panel-content">
          <div class="bottom-panel-toolbar">
            <div class="bottom-tabs" role="tablist" aria-label="Bottom panel tabs">
              ${tabs
								.map(
									(tab) => `
                  <button type="button" role="tab" data-bottom-tab="${tab.key}"
                    aria-pressed="${this.#tab === tab.key}" style="position:relative">
                    ${tab.label}${this.#getTabBadge(tab.key)}
                  </button>
                `,
								)
								.join("")}
            </div>
          </div>
          <section class="bottom-panel-tab-content" data-role="bottom-tab-content"></section>
        </div>
      </section>
    `;

		this.#renderView();
	}
}

customElements.define("bottom-activity-panel", BottomActivityPanel);
