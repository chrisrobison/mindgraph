import { EVENTS as APP_EVENTS } from "../../core/event-constants.js";
import { EVENTS as U2OS_EVENT_DOMAINS } from "../../core/u2os-event-registry.js";
import { publish } from "../../core/pan.js";
import { emitNodePatch, escapeHtml, patchNodeData, textValue } from "./shared.js";

const asObject = (value) => (value != null && typeof value === "object" && !Array.isArray(value) ? value : null);

const toTitle = (value) =>
  String(value ?? "")
    .trim()
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());

const formatLastReceived = (value) => {
  if (!value) return "Never";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString();
};

const buildPayloadPreview = (node) => {
  const explicit = String(node?.data?.lastReceivedPayloadPreview ?? "").trim();
  if (explicit) return explicit;

  const payload = node?.data?.cachedData;
  if (payload == null) return "(none)";
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return String(text ?? "").slice(0, 80);
};

const collectEventsByDomain = (registryNode, path = [], bucket = []) => {
  const node = asObject(registryNode);
  if (!node) return bucket;

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      const domain = path.length ? path.join(" / ") : "General";
      bucket.push({ domain, eventName: value, action: toTitle(key) });
      continue;
    }

    if (asObject(value)) {
      collectEventsByDomain(value, [...path, toTitle(key)], bucket);
    }
  }

  return bucket;
};

const EVENT_CHOICES = (() => {
  const events = collectEventsByDomain(U2OS_EVENT_DOMAINS)
    .sort((a, b) => {
      if (a.domain === b.domain) return a.eventName.localeCompare(b.eventName);
      return a.domain.localeCompare(b.domain);
    })
    .filter((entry, index, rows) => {
      if (index === 0) return true;
      return rows[index - 1].eventName !== entry.eventName;
    });

  const grouped = new Map();
  for (const entry of events) {
    if (!grouped.has(entry.domain)) grouped.set(entry.domain, []);
    grouped.get(entry.domain).push(entry);
  }

  return grouped;
})();

const randomTraceId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
};

class InspectorU2osTrigger extends HTMLElement {
  #node = null;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #patchData(dataPatch) {
    if (!this.#node) return;
    emitNodePatch(this, patchNodeData(this.#node, dataPatch));
  }

  #bind() {
    this.querySelector('[data-field="eventName"]')?.addEventListener("change", (event) => {
      const nextEventName = String(event.target.value ?? "").trim();
      const previousEventName = String(this.#node?.data?.eventName ?? "").trim();
      const eventChanged = nextEventName !== previousEventName;
      this.#patchData({
        eventName: nextEventName,
        ...(eventChanged
          ? {
              cachedData: null,
              lastUpdated: "",
              lastReceivedAt: "",
              lastReceivedPayloadPreview: "",
              lastReceivedMetadata: null
            }
          : {})
      });
    });

    this.querySelector('[data-field="filterExpression"]')?.addEventListener("change", (event) => {
      this.#patchData({ filterExpression: event.target.value });
    });

    this.querySelector('[data-action="test-fire"]')?.addEventListener("click", () => {
      const node = this.#node;
      if (!node) return;

      const eventName = String(node.data?.eventName ?? "").trim();
      if (!eventName) {
        publish(APP_EVENTS.ACTIVITY_LOG_APPENDED, {
          level: "warn",
          message: "U2OS trigger test fire skipped: choose an event name first"
        });
        return;
      }

      const firedAt = new Date().toISOString();
      const traceId = randomTraceId();
      const payload = {
        mock: true,
        firedAt,
        source: "mindgraph_test_fire",
        eventName,
        sample: {
          id: `sample_${Date.now().toString(36)}`,
          status: "ok"
        }
      };

      publish(APP_EVENTS.U2OS_BRIDGE_EVENT_RECEIVED, {
        eventName,
        tenantId: "local-test",
        traceId,
        sourceChannel: "mindgraph_test_fire",
        at: firedAt
      });
      publish(eventName, payload);

      publish(APP_EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `U2OS trigger test fire published ${eventName}`,
        context: {
          nodeId: node.id,
          traceId
        }
      });
    });
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a trigger node to configure U2OS event settings.</p>';
      return;
    }

    if (node.type !== "u2os_trigger") {
      this.innerHTML = '<p class="inspector-empty">U2OS trigger settings are only available for trigger nodes.</p>';
      return;
    }

    const selectedEventName = String(node.data?.eventName ?? "").trim();
    const filterExpression = textValue(node.data?.filterExpression);
    const lastReceivedAt = textValue(node.data?.lastReceivedAt ?? node.data?.lastUpdated);
    const payloadPreview = buildPayloadPreview(node);

    const optionsMarkup = [...EVENT_CHOICES.entries()]
      .map(([domain, entries]) => {
        const options = entries
          .map(
            (entry) =>
              `<option value="${escapeHtml(entry.eventName)}" ${
                entry.eventName === selectedEventName ? "selected" : ""
              }>${escapeHtml(entry.eventName)} (${escapeHtml(entry.action)})</option>`
          )
          .join("");

        return `<optgroup label="${escapeHtml(domain)}">${options}</optgroup>`;
      })
      .join("");

    this.innerHTML = `
      <section class="inspector-group">
        <h4>U2OS Trigger</h4>
        <label class="inspector-field">
          <span>Event Name</span>
          <select data-field="eventName">
            <option value="">Select U2OS event...</option>
            ${optionsMarkup}
          </select>
        </label>
        <label class="inspector-field">
          <span>Filter Expression</span>
          <input
            type="text"
            data-field="filterExpression"
            value="${escapeHtml(filterExpression)}"
            placeholder="Optional JSONPath or key=value filter"
          />
        </label>
      </section>

      <section class="inspector-group">
        <h4>Last Received</h4>
        <label class="inspector-field">
          <span>Timestamp</span>
          <input type="text" value="${escapeHtml(formatLastReceived(lastReceivedAt))}" disabled />
        </label>
        <label class="inspector-field">
          <span>Payload Preview</span>
          <textarea rows="3" disabled>${escapeHtml(payloadPreview)}</textarea>
        </label>
      </section>

      <section class="inspector-group">
        <h4>Test Fire</h4>
        <p class="inspector-help">Publish a mock payload onto PAN so downstream nodes can be tested without U2OS bridge traffic.</p>
        <div class="inspector-inline-row">
          <button type="button" data-action="test-fire">Test Fire</button>
        </div>
      </section>
    `;

    this.#bind();
  }
}

customElements.define("inspector-u2os-trigger", InspectorU2osTrigger);
