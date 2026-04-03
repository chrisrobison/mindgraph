import { mockAgentRuntime } from "../../runtime/mock-agent-runtime.js";
import { EVENTS } from "../../core/event-constants.js";
import { publish } from "../../core/pan.js";
import { uiStore } from "../../store/ui-store.js";
import { emitNodePatch, escapeHtml, numberValue, patchNodeData, textValue } from "./shared.js";
import { isExecutableNodeType } from "../../core/graph-semantics.js";

const toActivityEntries = (value) => (Array.isArray(value) ? value : []);

class InspectorActivity extends HTMLElement {
  #node = null;
  #running = false;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #patchData(data) {
    if (this.#node == null) return;
    emitNodePatch(this, patchNodeData(this.#node, data));
  }

  async #runNode() {
    if (!this.#node || this.#running) return;
    this.#running = true;
    this.render();

    try {
      publish(EVENTS.RUNTIME_AGENT_RUN_REQUESTED, {
        nodeId: this.#node.id,
        trigger: "inspector_run_node",
        origin: "inspector-activity"
      });
      await mockAgentRuntime.runNode(this.#node.id, { trigger: "inspector_run_node" });
    } finally {
      this.#running = false;
      this.render();
    }
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to inspect activity settings.</p>';
      return;
    }

    if (!isExecutableNodeType(node.type)) {
      this.innerHTML = `
        <section class="inspector-group">
          <h4>Activity</h4>
          <p class="inspector-help">
            Runnable nodes expose runtime status and events in this tab.
          </p>
        </section>
      `;
      return;
    }

    const status = escapeHtml(textValue(node.data?.status ?? "idle"));
    const confidence = numberValue(node.data?.confidence, 0.5);
    const fallbackActivity = uiStore
      .getRuntimeState()
      .activityItems.filter((entry) => entry?.context?.nodeId === node.id)
      .map((entry) => ({
        at: entry?.at ?? entry?.timestamp,
        level: entry?.level ?? "info",
        message: entry?.message ?? "(no message)"
      }));

    const activity = toActivityEntries(node.data?.activityHistory)
      .concat(fallbackActivity)
      .filter((entry, index, list) => {
        const key = `${entry?.at ?? "unknown"}:${entry?.level ?? "info"}:${entry?.message ?? ""}`;
        return index === list.findIndex((other) => `${other?.at ?? "unknown"}:${other?.level ?? "info"}:${other?.message ?? ""}` === key);
      })
      .slice(0, 12);
    const runHistory = toActivityEntries(node.data?.runHistory).slice(0, 8);

    const activityMarkup = activity.length
      ? `<ul class="inspector-list">${activity
          .map((entry) => {
            const at = entry?.at ? new Date(entry.at).toLocaleTimeString() : "--:--";
            const level = escapeHtml(textValue(entry?.level ?? "info"));
            const message = escapeHtml(textValue(entry?.message ?? "(no message)"));
            return `<li><strong>[${level}]</strong> ${escapeHtml(at)} - ${message}</li>`;
          })
          .join("")}</ul>`
      : '<p class="inspector-help">No runtime events for this node yet.</p>';

    const runHistoryMarkup = runHistory.length
      ? `<ul class="inspector-list">${runHistory
          .map((entry) => {
            const at = entry?.at ? new Date(entry.at).toLocaleTimeString() : "--:--";
            const runStatus = escapeHtml(textValue(entry?.status ?? "unknown"));
            const summary = escapeHtml(textValue(entry?.summary ?? "(no summary)"));
            return `<li><strong>${runStatus}</strong> ${escapeHtml(at)} - ${summary}</li>`;
          })
          .join("")}</ul>`
      : '<p class="inspector-help">No run history for this node yet.</p>';

    this.innerHTML = `
      <section class="inspector-group">
        <h4>Runtime Status</h4>
        <label class="inspector-field">
          <span>Status</span>
          <input type="text" data-field="status" value="${status}" />
        </label>
        <label class="inspector-field">
          <span>Confidence</span>
          <input type="number" min="0" max="1" step="0.01" data-field="confidence" value="${confidence}" />
        </label>
        <div class="inspector-inline-row">
          <button type="button" data-action="run-node" ${this.#running ? "disabled" : ""}>
            ${this.#running ? "Running..." : "Run Node"}
          </button>
        </div>
      </section>

      <section class="inspector-group">
        <h4>Recent Runtime Events</h4>
        ${activityMarkup}
      </section>

      <section class="inspector-group">
        <h4>Run History</h4>
        ${runHistoryMarkup}
      </section>
    `;

    this.querySelector('[data-field="status"]')?.addEventListener("change", (event) => {
      this.#patchData({ status: event.target.value.trim() || "idle" });
    });
    this.querySelector('[data-field="confidence"]')?.addEventListener("change", (event) => {
      const nextConfidence = numberValue(event.target.value, confidence);
      this.#patchData({ confidence: Math.min(1, Math.max(0, nextConfidence)) });
    });
    this.querySelector('[data-action="run-node"]')?.addEventListener("click", () => this.#runNode());
  }
}

customElements.define("inspector-activity", InspectorActivity);
