import {
  emitNodePatch,
  escapeHtml,
  patchNodeData,
  textToList,
  textValue
} from "./shared.js";
import { inferPortPresetId, listPortPresetsForNodeType } from "../../core/contract-presets.js";
import { getNodePorts, getNodeTypeSpec, PORT_PAYLOAD_TYPES } from "../../core/graph-semantics.js";
import { getNodePlan } from "../../runtime/execution-planner.js";
import { graphStore } from "../../store/graph-store.js";

const clonePort = (port = {}, index = 0) => ({
  id: String(port?.id ?? `port_${index + 1}`),
  label: String(port?.label ?? port?.id ?? `Port ${index + 1}`),
  payloadType: String(port?.payloadType ?? "any"),
  required: port?.required !== false,
  schema: port?.schema && typeof port.schema === "object" ? { ...port.schema } : {}
});

const schemaToText = (value) => {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
};

const parseSchemaText = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch {
    return { raw };
  }
};

const nextUniquePortId = (seedId, ports = []) => {
  const base = String(seedId ?? "port").trim() || "port";
  const seen = new Set(ports.map((port) => String(port?.id ?? "")).filter(Boolean));
  if (!seen.has(base)) return base;

  let index = 2;
  while (seen.has(`${base}_${index}`)) {
    index += 1;
  }
  return `${base}_${index}`;
};

class InspectorOverview extends HTMLElement {
  #node = null;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #applyPatch(patch) {
    if (this.#node == null) return;
    const next = { ...this.#node, ...patch };
    if (patch.data) {
      next.data = { ...(this.#node.data ?? {}), ...patch.data };
    }
    this.#node = next;
    emitNodePatch(this, patch);
  }

  #patchPorts(direction, updater) {
    const node = this.#node;
    if (!node) return;

    const currentPorts = getNodePorts(node, direction).map((port, index) => clonePort(port, index));
    const updatedPorts = updater(currentPorts);
    if (!Array.isArray(updatedPorts)) return;

    const key = direction === "output" ? "outputPorts" : "inputPorts";
    this.#applyPatch(patchNodeData(node, { [key]: updatedPorts.map((port, index) => clonePort(port, index)) }));
  }

  #renderPortRows(nodeType, direction, ports) {
    const presets = listPortPresetsForNodeType(nodeType, direction);

    if (!ports.length) {
      return `<p class="inspector-help">No ${direction} ports configured.</p>`;
    }

    return ports
      .map((port, index) => {
        const selectedPreset = inferPortPresetId(nodeType, direction, port) ?? "custom";
        const presetOptions = presets
          .map((preset) => {
            const selected = selectedPreset === preset.id ? "selected" : "";
            return `<option value="${escapeHtml(preset.id)}" ${selected}>${escapeHtml(
              preset.label
            )} (${escapeHtml(preset.port.payloadType)})</option>`;
          })
          .join("");

        return `
          <div class="inspector-port-card">
            <div class="inspector-inline-row">
              <strong>${direction === "input" ? "Input" : "Output"} Port ${index + 1}</strong>
              <button type="button" data-action="port-remove" data-port-direction="${direction}" data-port-index="${index}">Remove</button>
            </div>
            <label class="inspector-field">
              <span>Port Preset</span>
              <select data-port-direction="${direction}" data-port-index="${index}" data-port-field="preset">
                <option value="custom" ${selectedPreset === "custom" ? "selected" : ""}>Custom / Manual</option>
                ${presetOptions}
              </select>
            </label>
            <label class="inspector-field">
              <span>Port ID</span>
              <input type="text" data-port-direction="${direction}" data-port-index="${index}" data-port-field="id" value="${escapeHtml(
                port.id
              )}" />
            </label>
            <label class="inspector-field">
              <span>Label</span>
              <input type="text" data-port-direction="${direction}" data-port-index="${index}" data-port-field="label" value="${escapeHtml(
                port.label
              )}" />
            </label>
            <label class="inspector-field">
              <span>Payload Type</span>
              <select data-port-direction="${direction}" data-port-index="${index}" data-port-field="payloadType">
                ${PORT_PAYLOAD_TYPES.map(
                  (payloadType) =>
                    `<option value="${payloadType}" ${port.payloadType === payloadType ? "selected" : ""}>${payloadType}</option>`
                ).join("")}
              </select>
            </label>
            <label class="inspector-field checkbox">
              <input type="checkbox" data-port-direction="${direction}" data-port-index="${index}" data-port-field="required" ${
                port.required !== false ? "checked" : ""
              } />
              <span>Required</span>
            </label>
            <label class="inspector-field">
              <span>Schema (JSON)</span>
              <textarea rows="4" data-port-direction="${direction}" data-port-index="${index}" data-port-field="schema">${escapeHtml(
                schemaToText(port.schema)
              )}</textarea>
            </label>
          </div>
        `;
      })
      .join("");
  }

  #bindPortEditors(nodeType) {
    this.querySelectorAll('[data-action="port-add"]').forEach((button) => {
      button.addEventListener("click", () => {
        const direction = button.dataset.portDirection === "output" ? "output" : "input";
        const presets = listPortPresetsForNodeType(nodeType, direction);
        this.#patchPorts(direction, (ports) => {
          const template = presets[0]?.port ?? {
            id: direction === "output" ? "output" : "input",
            label: direction === "output" ? "Output" : "Input",
            payloadType: "object",
            required: direction === "input",
            schema: {}
          };
          const next = [...ports];
          const port = clonePort(template, next.length);
          port.id = nextUniquePortId(port.id, next);
          if (!port.label) port.label = port.id;
          next.push(port);
          return next;
        });
      });
    });

    this.querySelectorAll('[data-action="port-remove"]').forEach((button) => {
      button.addEventListener("click", () => {
        const direction = button.dataset.portDirection === "output" ? "output" : "input";
        const index = Number(button.dataset.portIndex);
        if (!Number.isInteger(index) || index < 0) return;

        this.#patchPorts(direction, (ports) => ports.filter((_, portIndex) => portIndex !== index));
      });
    });

    this.querySelectorAll("[data-port-field]").forEach((field) => {
      field.addEventListener("change", (event) => {
        const target = event.currentTarget;
        const direction = target.dataset.portDirection === "output" ? "output" : "input";
        const index = Number(target.dataset.portIndex);
        const key = target.dataset.portField;
        if (!Number.isInteger(index) || index < 0 || !key) return;

        if (key === "preset") {
          const selectedPresetId = String(target.value ?? "");
          if (!selectedPresetId || selectedPresetId === "custom") return;

          const preset = listPortPresetsForNodeType(nodeType, direction).find((entry) => entry.id === selectedPresetId);
          if (!preset?.port) return;

          this.#patchPorts(direction, (ports) => {
            if (!ports[index]) return ports;
            const next = [...ports];
            next[index] = clonePort(preset.port, index);
            return next;
          });
          return;
        }

        this.#patchPorts(direction, (ports) => {
          if (!ports[index]) return ports;
          const next = [...ports];
          const port = clonePort(next[index], index);

          if (key === "id") {
            const requestedId = String(target.value ?? "").trim();
            if (requestedId) {
              const peers = next.filter((_, peerIndex) => peerIndex !== index);
              port.id = nextUniquePortId(requestedId, peers);
            }
          } else if (key === "label") {
            port.label = String(target.value ?? "").trim() || port.id;
          } else if (key === "payloadType") {
            const value = String(target.value ?? "any");
            port.payloadType = PORT_PAYLOAD_TYPES.includes(value) ? value : "any";
          } else if (key === "required") {
            port.required = Boolean(target.checked);
          } else if (key === "schema") {
            port.schema = parseSchemaText(target.value);
          }

          next[index] = port;
          return next;
        });
      });
    });
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a node to edit overview fields.</p>';
      return;
    }

    const type = node.type ?? "note";
    const title = escapeHtml(textValue(node.label));
    const description = escapeHtml(textValue(node.description));
    const spec = getNodeTypeSpec(type);
    const nodePlan = getNodePlan(graphStore.getDocument(), node.id);

    if (type === "note") {
      const color = escapeHtml(textValue(node.data?.color ?? "#fff9b1"));
      const tags = escapeHtml(
        Array.isArray(node.data?.tags) ? node.data.tags.join("\n") : textValue(node.data?.tags)
      );

      this.innerHTML = `
        <section class="inspector-group">
          <h4>Note</h4>
          <label class="inspector-field">
            <span>Title</span>
            <input type="text" data-field="title" value="${title}" />
          </label>
          <label class="inspector-field">
            <span>Body</span>
            <textarea data-field="body" rows="6">${description}</textarea>
          </label>
        </section>
        <section class="inspector-group">
          <h4>Appearance</h4>
          <label class="inspector-field">
            <span>Color</span>
            <input type="color" data-field="color" value="${color || "#fff9b1"}" />
          </label>
          <label class="inspector-field">
            <span>Tags (comma or newline)</span>
            <textarea data-field="tags" rows="3">${tags}</textarea>
          </label>
        </section>
      `;

      this.querySelector('[data-field="title"]')?.addEventListener("change", (event) => {
        this.#applyPatch({ label: event.target.value.trim() || "Untitled Note" });
      });
      this.querySelector('[data-field="body"]')?.addEventListener("change", (event) => {
        this.#applyPatch({ description: event.target.value });
      });
      this.querySelector('[data-field="color"]')?.addEventListener("change", (event) => {
        this.#applyPatch(patchNodeData(node, { color: event.target.value }));
      });
      this.querySelector('[data-field="tags"]')?.addEventListener("change", (event) => {
        this.#applyPatch(patchNodeData(node, { tags: textToList(event.target.value) }));
      });
      return;
    }

    const inputPorts = getNodePorts(node, "input");
    const outputPorts = getNodePorts(node, "output");

    this.innerHTML = `
      <section class="inspector-group">
        <h4>General</h4>
        <label class="inspector-field">
          <span>Title</span>
          <input type="text" data-field="title" value="${title}" />
        </label>
        <label class="inspector-field">
          <span>Description</span>
          <textarea data-field="description" rows="5">${description}</textarea>
        </label>
      </section>
      <section class="inspector-group">
        <h4>Node Semantics</h4>
        <p class="inspector-help">${escapeHtml(spec.description)}</p>
        <p class="inspector-help">
          Role: <strong>${escapeHtml(spec.role)}</strong> |
          Runnable: <strong>${spec.executable ? "yes" : "no"}</strong> |
          Required inputs: <strong>${spec.requiredInputSources ?? 0}</strong>
        </p>
        ${
          nodePlan
            ? `<p class="inspector-help">
                Planner: <strong>${nodePlan.runnable ? (nodePlan.ready ? "Ready" : "Blocked") : "Not Runnable"}</strong>
                ${
                  nodePlan.blockedReasons?.length
                    ? ` - ${escapeHtml(nodePlan.blockedReasons[0])}`
                    : ""
                }
              </p>`
            : ""
        }
      </section>
      <section class="inspector-group">
        <h4>Port Contracts</h4>
        <div class="inspector-inline-row">
          <strong>Input Ports</strong>
          <button type="button" data-action="port-add" data-port-direction="input">Add Input Port</button>
        </div>
        ${this.#renderPortRows(type, "input", inputPorts)}
        <div class="inspector-inline-row">
          <strong>Output Ports</strong>
          <button type="button" data-action="port-add" data-port-direction="output">Add Output Port</button>
        </div>
        ${this.#renderPortRows(type, "output", outputPorts)}
        <p class="inspector-help">Port presets are role-aware. You can still edit any field or schema JSON manually.</p>
      </section>
    `;

    this.querySelector('[data-field="title"]')?.addEventListener("change", (event) => {
      this.#applyPatch({ label: event.target.value.trim() || "Untitled Node" });
    });
    this.querySelector('[data-field="description"]')?.addEventListener("change", (event) => {
      this.#applyPatch({ description: event.target.value });
    });

    this.#bindPortEditors(type);
  }
}

customElements.define("inspector-overview", InspectorOverview);
