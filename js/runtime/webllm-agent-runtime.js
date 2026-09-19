// @ts-check

import { EVENTS } from "../core/event-constants.js";
import {
  edgeAffectsDataFlow,
  getEdgeContractEndpoints,
  getNodeTypeSpec,
  isExecutableNodeType
} from "../core/graph-semantics.js";
import { operationNeedsEntityId } from "../core/u2os-node-catalog.js";
import { NODE_TYPES } from "../core/types.js";
import { AgentRuntime } from "./agent-runtime.js";
import { buildExecutionPlan } from "./execution-planner.js";
import {
  initEngine as defaultInitEngine,
  isWebGpuAvailable as defaultIsWebGpuAvailable,
  resolveModelId
} from "./webllm-engine.js";

// NOTE: `u2os-bridge-client` is imported lazily inside #getBridgeClient because
// it transitively pulls in `ui-store`, which references `window`/`document` at
// module load time. Keeping the import deferred lets this runtime be unit-tested
// in Node without DOM polyfills.

const MAX_PROMPT_CHARS = 24_000;
const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_MAX_TOKENS = 800;

const toArray = (value) => (Array.isArray(value) ? value : []);
const asText = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};
const toPlainObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value) ? value : {};
const asMessage = (error) => (error instanceof Error ? error.message : String(error));
const makeRunId = (nodeId) => `webllm_${nodeId}_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;
const nowIso = () => new Date().toISOString();

const getByPath = (value, rawPath) => {
  const path = asText(rawPath);
  if (!path) return undefined;
  const normalized = path.replace(/^\$\.?/, "");
  if (!normalized) return value;
  return normalized
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((current, segment) => (current == null ? undefined : current[segment]), value);
};

const setByPath = (target, rawPath, value) => {
  const path = asText(rawPath).replace(/^\$\.?/, "");
  if (!path) return;
  const segments = path
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!segments.length) return;

  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!toPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
};

const normalizeMappings = (value) =>
  toArray(value)
    .map((entry) => ({
      from: asText(entry?.from ?? entry?.source ?? entry?.input),
      to: asText(entry?.to ?? entry?.target ?? entry?.field)
    }))
    .filter((entry) => entry.from && entry.to);

const buildPrompt = ({ node, nodePlan, context }) => {
  const providerSummary = Array.isArray(nodePlan?.dataProviderIds)
    ? nodePlan.dataProviderIds.join(", ")
    : "none";
  const dependencySummary = Array.isArray(nodePlan?.upstreamDependencies)
    ? nodePlan.upstreamDependencies.join(", ")
    : "none";

  return [
    "You are executing a MindGraph node in an AI workflow graph.",
    "Return a concise, practical result for this node.",
    "",
    `Node ID: ${node?.id ?? "unknown"}`,
    `Node Label: ${node?.label ?? "Unnamed"}`,
    `Node Type: ${node?.type ?? "unknown"}`,
    `Description: ${node?.description ?? ""}`,
    `Upstream Dependencies: ${dependencySummary}`,
    `Data Providers: ${providerSummary}`,
    `Trigger: ${context?.trigger ?? "manual"}`,
    "",
    "Node data JSON:",
    JSON.stringify(node?.data ?? {}, null, 2),
    "",
    "Provide output content suitable for downstream workflow execution."
  ].join("\n");
};

const buildResultEnvelope = ({ modelId, text }) => {
  const compact = String(text ?? "").trim();
  const summary =
    compact.split(/\n+/).slice(0, 2).join(" ").slice(0, 280) || "WebLLM response captured";
  return {
    confidence: 0.74,
    summary,
    output: {
      type: "provider_output",
      provider: "webllm",
      model: modelId,
      summary: compact.slice(0, 420) || summary,
      text: compact,
      toolCalls: [],
      generatedAt: nowIso()
    }
  };
};

/**
 * In-browser agent runtime that runs inference against a WebLLM model
 * loaded into the current page. Matches the public surface of
 * `HttpAgentRuntime` so it can plug into `RuntimeService` as a peer mode.
 */
export class WebLLMAgentRuntime extends AgentRuntime {
  #modelId = "";
  #activeAborts = new Set();
  #initEngineFn;
  #isWebGpuAvailableFn;
  #bridgeClientOverride;
  #bridgeClientCache = null;

  /**
   * @param {Object} [options]
   * @param {string} [options.modelId] Default model id to use for runs
   * @param {(modelId: string, onProgress?: Function) => Promise<{ chat: Function, modelId: string }>} [options.initEngine] Override engine factory (tests)
   * @param {() => boolean} [options.isWebGpuAvailable] Override capability probe (tests)
   * @param {{ mutateU2osEntity: Function, emitU2osEvent: Function }} [options.bridgeClient] Override U2OS bridge (tests)
   */
  constructor(options = {}) {
    super(options);
    this.#modelId = resolveModelId(options.modelId ?? "");
    this.#initEngineFn = options.initEngine ?? defaultInitEngine;
    this.#isWebGpuAvailableFn = options.isWebGpuAvailable ?? defaultIsWebGpuAvailable;
    this.#bridgeClientOverride = options.bridgeClient ?? null;
  }

  /**
   * Lazily resolve the U2OS bridge client. Tests inject `bridgeClient` in the
   * constructor and never hit the dynamic import path.
   */
  async #getBridgeClient() {
    if (this.#bridgeClientOverride) return this.#bridgeClientOverride;
    if (this.#bridgeClientCache) return this.#bridgeClientCache;
    const mod = await import("./u2os-bridge-client.js");
    this.#bridgeClientCache = mod.bridgeClient;
    return this.#bridgeClientCache;
  }

  getModelId() {
    return this.#modelId;
  }

  setModelId(modelId) {
    const next = resolveModelId(modelId);
    if (next !== this.#modelId) {
      this.#modelId = next;
    }
  }

  isAvailable() {
    return this.#isWebGpuAvailableFn();
  }

  cancelAll(reason = "cancelled") {
    for (const controller of this.#activeAborts) {
      try {
        controller.abort(reason);
      } catch {
        // noop
      }
    }
    this.#activeAborts.clear();
  }

  async runNode(nodeId, context = {}) {
    const node = this.store.getNode(nodeId);
    const runId = makeRunId(nodeId);
    const trigger = context.trigger ?? "manual";

    if (!node) {
      const message = `WebLLM runtime failed: node ${nodeId} not found`;
      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, {
        nodeId,
        runId,
        reason: message,
        trigger,
        mode: "webllm"
      });
      this.publish(this.events.RUNTIME_ERROR_APPENDED, {
        nodeId,
        nodeLabel: "Unknown node",
        runId,
        message,
        source: "webllm-runtime",
        at: nowIso()
      });
      return { ok: false, nodeId, runId, error: message, mode: "webllm" };
    }

    if (!isExecutableNodeType(node.type)) {
      return {
        ok: false,
        nodeId,
        runId,
        error: `WebLLM runtime skipped non-runnable node type ${node.type}`,
        mode: "webllm"
      };
    }

    const plan = buildExecutionPlan(this.store.getDocument());
    const nodePlan = plan.nodes?.[nodeId];
    if (!nodePlan?.ready) {
      return {
        ok: false,
        nodeId,
        runId,
        error: nodePlan?.blockedReasons?.[0] ?? "Node blocked by planner",
        blockedReasons: nodePlan?.blockedReasons ?? [],
        mode: "webllm"
      };
    }

    const providerSettings = { ...(context?.providerSettings ?? {}) };
    const requestedModelId = asText(providerSettings.model, this.#modelId);
    const temperature = Number.isFinite(Number(providerSettings.temperature))
      ? Number(providerSettings.temperature)
      : DEFAULT_TEMPERATURE;
    const maxTokens = Number.isFinite(Number(providerSettings.maxTokens))
      ? Math.max(64, Math.min(8192, Math.round(Number(providerSettings.maxTokens))))
      : DEFAULT_MAX_TOKENS;
    const systemPrompt = asText(providerSettings.systemPrompt);

    this.publish(this.events.RUNTIME_AGENT_RUN_STARTED, {
      nodeId,
      runId,
      trigger,
      context,
      mode: "webllm"
    });

    try {
      const payload =
        node.type === NODE_TYPES.U2OS_MUTATE || node.type === NODE_TYPES.U2OS_EMIT
          ? await this.#executeU2osNode(node, nodePlan)
          : await this.#executeWebLLMRun({
              node,
              nodePlan,
              context,
              runId,
              modelId: requestedModelId,
              temperature,
              maxTokens,
              systemPrompt
            });

      const output = payload?.output ?? {
        type: "webllm_runtime_output",
        summary: payload?.summary ?? `${node.label} completed via WebLLM runtime`,
        generatedAt: nowIso()
      };

      const validation = this.validateOutput(node, output);
      if (!validation.valid) {
        throw new Error(`Output validation failed: ${validation.errors.join("; ")}`);
      }

      const confidence = Number.isFinite(Number(payload?.confidence))
        ? Number(payload.confidence)
        : 0.72;
      const completedAt = nowIso();
      const latest = this.store.getNode(nodeId);

      this.publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
        nodeId,
        patch: {
          data: {
            ...(latest?.data ?? {}),
            status: "completed",
            confidence,
            lastRunAt: completedAt,
            lastRunSummary:
              output.summary ?? payload?.summary ?? "Completed via WebLLM runtime",
            lastOutput: output,
            runHistory: [
              {
                runId,
                status: "completed",
                summary:
                  output.summary ?? payload?.summary ?? "Completed via WebLLM runtime",
                confidence,
                at: completedAt
              },
              ...toArray(latest?.data?.runHistory)
            ].slice(0, 25),
            activityHistory: [
              {
                at: completedAt,
                level: "info",
                message: `Completed WebLLM run ${runId}`
              },
              ...toArray(latest?.data?.activityHistory)
            ].slice(0, 40)
          }
        },
        origin: "webllm-runtime"
      });

      this.publish(this.events.RUNTIME_AGENT_RUN_COMPLETED, {
        nodeId,
        runId,
        status: "completed",
        confidence,
        output,
        mode: "webllm"
      });
      this.publish(this.events.RUNTIME_RUN_HISTORY_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        status: "completed",
        summary: output.summary ?? payload?.summary ?? "Completed via WebLLM runtime",
        confidence,
        output,
        at: completedAt,
        mode: "webllm"
      });

      return {
        ok: true,
        nodeId,
        runId,
        status: "completed",
        confidence,
        output,
        mode: "webllm"
      };
    } catch (error) {
      const message = asMessage(error);
      const failedAt = nowIso();
      const latest = this.store.getNode(nodeId);

      this.publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
        nodeId,
        patch: {
          data: {
            ...(latest?.data ?? {}),
            status: "failed",
            lastRunAt: failedAt,
            lastRunSummary: message,
            runHistory: [
              {
                runId,
                status: "failed",
                summary: message,
                confidence: 0.2,
                at: failedAt
              },
              ...toArray(latest?.data?.runHistory)
            ].slice(0, 25),
            activityHistory: [
              {
                at: failedAt,
                level: "error",
                message: `WebLLM run failed ${runId}: ${message}`
              },
              ...toArray(latest?.data?.activityHistory)
            ].slice(0, 40)
          }
        },
        origin: "webllm-runtime"
      });

      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, {
        nodeId,
        runId,
        reason: message,
        mode: "webllm"
      });
      this.publish(this.events.RUNTIME_RUN_HISTORY_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        status: "failed",
        summary: message,
        confidence: 0.2,
        output: { type: "runtime_error", message },
        at: failedAt,
        mode: "webllm"
      });
      this.publish(this.events.RUNTIME_ERROR_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        message,
        source: "webllm-runtime",
        at: failedAt
      });

      return { ok: false, nodeId, runId, error: message, mode: "webllm" };
    }
  }

  async runSubtree(nodeId, context = {}) {
    const plan = buildExecutionPlan(this.store.getDocument(), { rootNodeId: nodeId });
    const nodeIds = plan.executionOrder.filter((entry) => plan.nodes?.[entry]?.runnable);

    let completed = 0;
    let failed = 0;

    for (const id of nodeIds) {
      const result = await this.runNode(id, context);
      if (result.ok) completed += 1;
      else failed += 1;
    }

    return { ok: failed === 0, completed, failed, nodeIds };
  }

  async runAll(context = {}) {
    const plan = buildExecutionPlan(this.store.getDocument());
    const nodeIds = plan.executionOrder.filter((entry) => plan.nodes?.[entry]?.runnable);

    let completed = 0;
    let failed = 0;

    for (const id of nodeIds) {
      const result = await this.runNode(id, context);
      if (result.ok) completed += 1;
      else failed += 1;
    }

    return { ok: failed === 0, completed, failed, total: nodeIds.length };
  }

  async #executeWebLLMRun({
    node,
    nodePlan,
    context,
    runId,
    modelId,
    temperature,
    maxTokens,
    systemPrompt
  }) {
    if (!this.#isWebGpuAvailableFn()) {
      throw new Error("WebGPU is not available in this browser");
    }

    const prompt = buildPrompt({ node, nodePlan, context });
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`Prompt exceeds max length (${MAX_PROMPT_CHARS})`);
    }

    const controller = new AbortController();
    if (context?.abortSignal && typeof context.abortSignal.addEventListener === "function") {
      context.abortSignal.addEventListener("abort", () => controller.abort("upstream_abort"), {
        once: true
      });
    }
    this.#activeAborts.add(controller);

    this.publish(this.events.RUNTIME_TRACE_APPENDED, {
      kind: "webllm_run_started",
      at: nowIso(),
      nodeId: node.id,
      runId,
      mode: "webllm",
      modelId
    });

    try {
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: "system", content: systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const onProgress = (report) => {
        this.publish(this.events.RUNTIME_TRACE_APPENDED, {
          kind: "webllm_init_progress",
          at: nowIso(),
          nodeId: node.id,
          runId,
          mode: "webllm",
          modelId,
          progress: report?.progress ?? 0,
          message: report?.text ?? ""
        });
      };

      const engine = await this.#initEngineFn(modelId, onProgress);
      this.#modelId = engine?.modelId ?? modelId;

      const completion = await engine.chat(
        messages,
        { temperature, maxTokens },
        controller.signal
      );

      return buildResultEnvelope({
        modelId: this.#modelId,
        text: completion?.text ?? ""
      });
    } finally {
      this.#activeAborts.delete(controller);
    }
  }

  #resolveNodeOutputValue(node) {
    const spec = getNodeTypeSpec(node?.type);
    if (!node) return null;
    if (spec?.outputField) return node.data?.[spec.outputField] ?? null;
    return node.data?.lastOutput ?? null;
  }

  #collectInputsByPort(nodeId) {
    const document = this.store.getDocument();
    const node = this.store.getNode(nodeId);
    if (!node || !document) return {};

    const inputsByPort = {};
    for (const edge of toArray(document.edges)) {
      if (!edgeAffectsDataFlow(edge.type)) continue;
      const sourceNode = this.store.getNode(edge.source);
      const targetNode = this.store.getNode(edge.target);
      if (!sourceNode || !targetNode) continue;

      const endpoints = getEdgeContractEndpoints(edge, sourceNode, targetNode);
      if (endpoints.consumerNode?.id !== nodeId || !endpoints.providerNode) continue;
      const payload = this.#resolveNodeOutputValue(endpoints.providerNode);
      if (payload == null) continue;

      const contractPortId = asText(edge?.metadata?.contract?.targetPort);
      const fallbackPortId = asText(endpoints.consumerPorts?.[0]?.id, "input");
      const targetPortId = contractPortId || fallbackPortId;
      if (!inputsByPort[targetPortId]) {
        inputsByPort[targetPortId] = payload;
      } else if (Array.isArray(inputsByPort[targetPortId])) {
        inputsByPort[targetPortId].push(payload);
      } else {
        inputsByPort[targetPortId] = [inputsByPort[targetPortId], payload];
      }
    }

    return inputsByPort;
  }

  #mapPayloadFromInputs(payloadInput, mappings = []) {
    const source = toPlainObject(payloadInput);
    const normalizedMappings = normalizeMappings(mappings);
    if (!normalizedMappings.length) return source;

    const mapped = {};
    normalizedMappings.forEach((entry) => {
      const sourceValue = getByPath(source, entry.from);
      if (sourceValue === undefined) return;
      const targetPath = entry.to.replace(/^[^.]+\./, "");
      setByPath(mapped, targetPath, sourceValue);
    });
    return mapped;
  }

  #extractEntityId(inputsByPort = {}) {
    const raw = inputsByPort.entityId;
    if (typeof raw === "string" || typeof raw === "number") return String(raw);
    if (Array.isArray(raw) && raw.length) {
      const first = raw[0];
      if (typeof first === "string" || typeof first === "number") return String(first);
      if (toPlainObject(first).id) return String(first.id);
      if (toPlainObject(first).entityId) return String(first.entityId);
    }
    if (toPlainObject(raw).id) return String(raw.id);
    if (toPlainObject(raw).entityId) return String(raw.entityId);
    return "";
  }

  async #executeU2osNode(node, nodePlan) {
    const inputsByPort = this.#collectInputsByPort(node.id);
    const payloadInput =
      inputsByPort.payload ?? inputsByPort.command_input ?? inputsByPort.input ?? {};
    const bridge = await this.#getBridgeClient();

    if (node.type === NODE_TYPES.U2OS_MUTATE) {
      const operation = asText(node.data?.operation, "create").toLowerCase();
      const entity = asText(node.data?.entity, "reservation").toLowerCase();
      const entityId = this.#extractEntityId(inputsByPort);
      if (operationNeedsEntityId(operation) && !entityId) {
        throw new Error(`U2OS ${operation} requires entityId input`);
      }

      const mappedPayload = this.#mapPayloadFromInputs(payloadInput, node.data?.mapInputs);
      const mutation = await bridge.mutateU2osEntity({
        entity,
        operation,
        entityId,
        payload: mappedPayload
      });

      return {
        summary: `${node.label} ${operation} completed for ${entity}.`,
        confidence: 0.86,
        output: {
          type: "u2os_mutation_result",
          summary: `${node.label} ${operation} completed for ${entity}.`,
          result: mutation.result ?? null,
          entityId: mutation.entityId ?? entityId,
          status:
            mutation.status ?? { ok: true, message: `${operation} succeeded`, entity, operation },
          planner: {
            ready: Boolean(nodePlan?.ready),
            executionOrderIndex: nodePlan?.executionOrderIndex ?? -1
          },
          generatedAt: nowIso()
        }
      };
    }

    if (node.type === NODE_TYPES.U2OS_EMIT) {
      const eventName = asText(node.data?.eventName);
      if (!eventName) throw new Error("U2OS emit requires eventName");
      const mappedPayload = this.#mapPayloadFromInputs(payloadInput, node.data?.payloadMapping);
      const confirmation = await bridge.emitU2osEvent(eventName, mappedPayload);
      return {
        summary: `${node.label} emitted ${eventName}.`,
        confidence: 0.9,
        output: {
          type: "u2os_emit_confirmation",
          summary: `${node.label} emitted ${eventName}.`,
          confirmation,
          planner: {
            ready: Boolean(nodePlan?.ready),
            executionOrderIndex: nodePlan?.executionOrderIndex ?? -1
          },
          generatedAt: nowIso()
        }
      };
    }

    throw new Error(`Unsupported U2OS node type: ${node.type}`);
  }
}
