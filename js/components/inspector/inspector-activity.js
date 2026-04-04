import { EVENTS } from "../../core/event-constants.js";
import { publish } from "../../core/pan.js";
import { uiStore } from "../../store/ui-store.js";
import { emitNodePatch, escapeHtml, numberValue, patchNodeData, textValue } from "./shared.js";
import { isExecutableNodeType } from "../../core/graph-semantics.js";

const toActivityEntries = (value) => (Array.isArray(value) ? value : []);

class InspectorActivity extends HTMLElement {
  #node = null;

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
    if (!this.#node) return;
    publish(EVENTS.RUNTIME_AGENT_RUN_REQUESTED, {
      nodeId: this.#node.id,
      trigger: "inspector_run_node",
      origin: "inspector-activity"
    });
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
    const running = String(node.data?.status ?? "idle") === "running";
    const confidence = numberValue(node.data?.confidence, 0.5);
    const runtimePolicy = node.data?.runtimePolicy ?? {};
    const maxAttempts = numberValue(runtimePolicy.maxAttempts, 2);
    const retryBackoffMs = numberValue(runtimePolicy.retryBackoffMs, 350);
    const retryBackoffFactor = numberValue(runtimePolicy.retryBackoffFactor, 1.7);
    const failFast = Boolean(runtimePolicy.failFast);
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
        <label class="inspector-field">
          <span>Max Attempts</span>
          <input type="number" min="1" max="6" step="1" data-field="maxAttempts" value="${maxAttempts}" />
        </label>
        <label class="inspector-field">
          <span>Retry Backoff (ms)</span>
          <input type="number" min="50" max="5000" step="10" data-field="retryBackoffMs" value="${retryBackoffMs}" />
        </label>
        <label class="inspector-field">
          <span>Retry Backoff Factor</span>
          <input type="number" min="1" max="5" step="0.1" data-field="retryBackoffFactor" value="${retryBackoffFactor}" />
        </label>
        <label class="inspector-field checkbox">
          <input type="checkbox" data-field="failFast" ${failFast ? "checked" : ""} />
          <span>Fail Fast in batch runs</span>
        </label>
        <div class="inspector-inline-row">
          <button type="button" data-action="run-node" ${running ? "disabled" : ""}>
            ${running ? "Running..." : "Run Node"}
          </button>
          <button type="button" data-action="cancel-runs">Cancel Runs</button>
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
    this.querySelector('[data-field="maxAttempts"]')?.addEventListener("change", (event) => {
      const next = Math.max(1, Math.min(6, Math.round(numberValue(event.target.value, maxAttempts))));
      this.#patchData({
        runtimePolicy: {
          ...(runtimePolicy ?? {}),
          maxAttempts: next
        }
      });
    });
    this.querySelector('[data-field="retryBackoffMs"]')?.addEventListener("change", (event) => {
      const next = Math.max(50, Math.min(5000, Math.round(numberValue(event.target.value, retryBackoffMs))));
      this.#patchData({
        runtimePolicy: {
          ...(runtimePolicy ?? {}),
          retryBackoffMs: next
        }
      });
    });
    this.querySelector('[data-field="retryBackoffFactor"]')?.addEventListener("change", (event) => {
      const next = Math.max(1, Math.min(5, numberValue(event.target.value, retryBackoffFactor)));
      this.#patchData({
        runtimePolicy: {
          ...(runtimePolicy ?? {}),
          retryBackoffFactor: next
        }
      });
    });
    this.querySelector('[data-field="failFast"]')?.addEventListener("change", (event) => {
      this.#patchData({
        runtimePolicy: {
          ...(runtimePolicy ?? {}),
          failFast: Boolean(event.target.checked)
        }
      });
    });
    this.querySelector('[data-action="run-node"]')?.addEventListener("click", () => this.#runNode());
    this.querySelector('[data-action="cancel-runs"]')?.addEventListener("click", () => {
      publish(EVENTS.RUNTIME_RUN_CANCEL_REQUESTED, {
        reason: "inspector_cancel_runs",
        origin: "inspector-activity"
      });
    });
  }
}

customElements.define("inspector-activity", InspectorActivity);
