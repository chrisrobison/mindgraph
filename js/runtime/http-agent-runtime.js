import { EVENTS } from "../core/event-constants.js";
import { isExecutableNodeType } from "../core/graph-semantics.js";
import { publish } from "../core/pan.js";
import { buildExecutionPlan } from "./execution-planner.js";
import { AgentRuntime } from "./agent-runtime.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const makeRunId = (nodeId) => `http_${nodeId}_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;
const asMessage = (error) => (error instanceof Error ? error.message : String(error));
const asText = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};
const toObject = (value) => (value && typeof value === "object" ? value : {});
const compactText = (value, max = 420) => asText(value).replace(/\s+/g, " ").slice(0, max);

const resolveWsUrl = (endpoint, proxyToken = "") => {
  const base = String(endpoint ?? "").trim().replace(/\/$/, "");
  if (!base) return "";

  const withToken = (rawUrl) => {
    const token = asText(proxyToken);
    if (!token) return rawUrl;
    try {
      const parsed = new URL(rawUrl);
      parsed.searchParams.set("proxy_token", token);
      return parsed.toString();
    } catch {
      return rawUrl;
    }
  };

  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return withToken(`${base}/ws`);
  }

  if (typeof window !== "undefined") {
    const url = new URL(base, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
    return withToken(url.toString());
  }

  if (base.startsWith("http://")) return withToken(`ws://${base.slice("http://".length)}/ws`);
  if (base.startsWith("https://")) return withToken(`wss://${base.slice("https://".length)}/ws`);
  return "";
};

export class HttpAgentRuntime extends AgentRuntime {
  #endpoint = "/api/mindgraph/runtime";
  #socket = null;
  #socketOpenPromise = null;
  #socketProxyToken = "";
  #pendingSocketRuns = new Map();
  #streamStateByRequest = new Map();
  #requestSeq = 0;

  constructor(options = {}) {
    super(options);
    if (options.endpoint) {
      this.#endpoint = String(options.endpoint);
    }
  }

  setEndpoint(endpoint) {
    if (!endpoint) return;
    this.#endpoint = String(endpoint);
    this.#disconnectSocket();
  }

  getEndpoint() {
    return this.#endpoint;
  }

  cancelAll(reason = "cancelled") {
    if (typeof WebSocket !== "undefined" && this.#socket?.readyState === WebSocket.OPEN) {
      try {
        this.#socket.send(
          JSON.stringify({
            type: "runtime.cancel_all.request",
            reason,
            at: new Date().toISOString()
          })
        );
      } catch {
        // noop
      }
    }

    for (const [requestId, pending] of this.#pendingSocketRuns.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`Cancelled: ${reason}`));
      this.#pendingSocketRuns.delete(requestId);
      this.#streamStateByRequest.delete(requestId);
    }
  }

  async runNode(nodeId, context = {}) {
    const node = this.store.getNode(nodeId);
    const runId = makeRunId(nodeId);
    const trigger = context.trigger ?? "manual";

    if (!node) {
      const message = `HTTP runtime failed: node ${nodeId} not found`;
      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, { nodeId, runId, reason: message, trigger });
      this.publish(this.events.RUNTIME_ERROR_APPENDED, {
        nodeId,
        nodeLabel: "Unknown node",
        runId,
        message,
        source: "http-runtime",
        at: new Date().toISOString()
      });
      return { ok: false, nodeId, runId, error: message };
    }

    if (!isExecutableNodeType(node.type)) {
      return {
        ok: false,
        nodeId,
        runId,
        error: `HTTP runtime skipped non-runnable node type ${node.type}`
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
        blockedReasons: nodePlan?.blockedReasons ?? []
      };
    }

    const providerSettings = {
      ...(context?.providerSettings ?? {})
    };
    const proxyToken = asText(providerSettings?.proxyToken);
    delete providerSettings.proxyToken;
    delete providerSettings.rememberApiKey;

    const requestPayload = {
      runId,
      trigger,
      node,
      nodePlan,
      context: {
        ...(context ?? {}),
        providerSettings
      }
    };

    this.publish(this.events.RUNTIME_AGENT_RUN_STARTED, { nodeId, runId, trigger, context, mode: "http" });

    try {
      const payload = await this.#executeRemoteRun(requestPayload, context?.abortSignal, { proxyToken });
      const output = payload?.output ?? {
        type: "http_runtime_output",
        summary: payload?.summary ?? `${node.label} completed via HTTP runtime`,
        generatedAt: new Date().toISOString()
      };

      const validation = this.validateOutput(node, output);
      if (!validation.valid) {
        throw new Error(`Output validation failed: ${validation.errors.join("; ")}`);
      }

      const confidence = Number.isFinite(Number(payload?.confidence)) ? Number(payload.confidence) : 0.75;
      const completedAt = new Date().toISOString();
      const latest = this.store.getNode(nodeId);

      this.publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
        nodeId,
        patch: {
          data: {
            ...(latest?.data ?? {}),
            status: "completed",
            confidence,
            lastRunAt: completedAt,
            lastRunSummary: output.summary ?? payload?.summary ?? "Completed via HTTP runtime",
            lastOutput: output,
            runHistory: [
              {
                runId,
                status: "completed",
                summary: output.summary ?? payload?.summary ?? "Completed via HTTP runtime",
                confidence,
                at: completedAt
              },
              ...toArray(latest?.data?.runHistory)
            ].slice(0, 25),
            activityHistory: [
              {
                at: completedAt,
                level: "info",
                message: `Completed HTTP run ${runId}`
              },
              ...toArray(latest?.data?.activityHistory)
            ].slice(0, 40)
          }
        },
        origin: "http-runtime"
      });

      this.publish(this.events.RUNTIME_AGENT_RUN_COMPLETED, {
        nodeId,
        runId,
        status: "completed",
        confidence,
        output,
        mode: "http"
      });
      this.publish(this.events.RUNTIME_RUN_HISTORY_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        status: "completed",
        summary: output.summary ?? payload?.summary ?? "Completed via HTTP runtime",
        confidence,
        output,
        at: completedAt,
        mode: "http"
      });

      return {
        ok: true,
        nodeId,
        runId,
        status: "completed",
        confidence,
        output,
        mode: "http"
      };
    } catch (error) {
      const message = asMessage(error);
      const failedAt = new Date().toISOString();
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
                message: `HTTP run failed ${runId}: ${message}`
              },
              ...toArray(latest?.data?.activityHistory)
            ].slice(0, 40)
          }
        },
        origin: "http-runtime"
      });

      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, {
        nodeId,
        runId,
        reason: message,
        mode: "http"
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
        mode: "http"
      });
      this.publish(this.events.RUNTIME_ERROR_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        message,
        source: "http-runtime",
        at: failedAt
      });

      return { ok: false, nodeId, runId, error: message, mode: "http" };
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

  async #executeRemoteRun(payload, abortSignal, options = {}) {
    try {
      return await this.#runNodeViaSocket(payload, abortSignal, options);
    } catch (socketError) {
      if (socketError?.noHttpFallback) {
        throw socketError;
      }
      publish(EVENTS.RUNTIME_TRACE_APPENDED, {
        kind: "ws_fallback_http",
        at: new Date().toISOString(),
        nodeId: payload?.node?.id,
        runId: payload?.runId,
        mode: "http",
        error: asMessage(socketError)
      });
      return this.#runNodeViaHttp(payload, abortSignal, options);
    }
  }

  async #runNodeViaHttp(payload, abortSignal, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json"
    };
    const proxyToken = asText(options?.proxyToken);
    if (proxyToken) {
      headers.Authorization = `Bearer ${proxyToken}`;
    }

    const response = await fetch(`${this.#endpoint.replace(/\/$/, "")}/run-node`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async #runNodeViaSocket(payload, abortSignal, options = {}) {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this browser");
    }

    const proxyToken = asText(options?.proxyToken);
    if (this.#socket && this.#socketProxyToken !== proxyToken) {
      this.#disconnectSocket();
    }

    const socket = await this.#ensureSocket(options);
    const requestId = `req_${Date.now()}_${++this.#requestSeq}`;

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.#pendingSocketRuns.delete(requestId);
        this.#streamStateByRequest.delete(requestId);
        reject(new Error("WebSocket runtime request timed out"));
      }, 120_000);

      const onAbort = () => {
        this.#pendingSocketRuns.delete(requestId);
        this.#streamStateByRequest.delete(requestId);
        clearTimeout(timeoutId);
        try {
          socket.send(JSON.stringify({ type: "runtime.run_node.cancel", requestId }));
        } catch {
          // noop
        }
        reject(new Error("Execution cancelled"));
      };

      if (abortSignal) {
        if (abortSignal.aborted) {
          onAbort();
          return;
        }
        abortSignal.addEventListener("abort", onAbort, { once: true });
      }

      this.#pendingSocketRuns.set(requestId, {
        resolve: (result) => {
          clearTimeout(timeoutId);
          if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          if (abortSignal) abortSignal.removeEventListener("abort", onAbort);
          reject(error);
        },
        timeoutId,
        runId: payload?.runId,
        nodeId: payload?.node?.id
      });

      socket.send(
        JSON.stringify({
          type: "runtime.run_node.request",
          requestId,
          payload
        })
      );
    });
  }

  async #ensureSocket(options = {}) {
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket;
    if (this.#socketOpenPromise) return this.#socketOpenPromise;

    const wsUrl = resolveWsUrl(this.#endpoint, options?.proxyToken);
    if (!wsUrl) {
      throw new Error("Runtime endpoint cannot be converted to a WebSocket URL");
    }

    this.#socketOpenPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.#socket = socket;
      this.#socketProxyToken = asText(options?.proxyToken);

      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };

      const onOpen = () => {
        cleanup();
        this.#socketOpenPromise = null;
        resolve(socket);
      };

      const onError = () => {
        cleanup();
        this.#socketOpenPromise = null;
        reject(new Error("Unable to connect runtime WebSocket"));
      };

      socket.addEventListener("open", onOpen, { once: true });
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener("close", () => this.#handleSocketClosed());
      socket.addEventListener("message", (event) => this.#handleSocketMessage(event));
    });

    return this.#socketOpenPromise;
  }

  #handleSocketMessage(event) {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    const requestId = message?.requestId;
    if (!requestId) return;
    const pending = this.#pendingSocketRuns.get(requestId);

    if (message.type === "runtime.run_node.progress") {
      publish(EVENTS.RUNTIME_TRACE_APPENDED, {
        kind: "proxy_progress",
        at: message?.at ?? new Date().toISOString(),
        nodeId: message?.nodeId ?? pending?.nodeId,
        runId: message?.runId ?? pending?.runId,
        mode: "http",
        detail: {
          stage: message?.stage,
          message: message?.message
        }
      });
      this.#applyStreamingNodeUpdate(requestId, {
        eventType: "runtime.stream.stage",
        at: message?.at,
        stage: message?.stage,
        message: message?.message,
        nodeId: message?.nodeId ?? pending?.nodeId,
        runId: message?.runId ?? pending?.runId
      });
      return;
    }

    if (message.type === "runtime.run_node.event") {
      const trace = this.#normalizeStreamTraceEvent(requestId, message?.event, pending);
      if (trace) {
        publish(EVENTS.RUNTIME_TRACE_APPENDED, trace);
      }
      this.#applyStreamingNodeUpdate(requestId, message?.event);
      return;
    }

    if (!pending) return;

    if (message.type === "runtime.run_node.completed") {
      this.#pendingSocketRuns.delete(requestId);
      this.#streamStateByRequest.delete(requestId);
      pending.resolve(message.result ?? {});
      return;
    }

    if (message.type === "runtime.run_node.failed") {
      this.#pendingSocketRuns.delete(requestId);
      this.#streamStateByRequest.delete(requestId);
      const error = new Error(String(message.error ?? "Runtime WebSocket request failed"));
      error.noHttpFallback = true;
      pending.reject(error);
    }
  }

  #normalizeStreamTraceEvent(requestId, rawEvent, pending) {
    const event = toObject(rawEvent);
    const eventType = asText(event?.eventType);
    if (!eventType) return null;

    const at = asText(event?.at, new Date().toISOString());
    const nodeId = asText(event?.nodeId) || (pending?.nodeId ?? null);
    const runId = asText(event?.runId) || (pending?.runId ?? null);

    if (eventType === "runtime.stream.stage") {
      return {
        kind: "proxy_stage",
        at,
        nodeId,
        runId,
        mode: "http",
        detail: {
          eventType,
          requestId,
          stage: event?.stage,
          message: event?.message
        }
      };
    }

    if (eventType === "runtime.stream.text.delta") {
      const delta = String(event?.delta ?? "");
      return {
        kind: "proxy_text_delta",
        at,
        nodeId,
        runId,
        mode: "http",
        detail: {
          eventType,
          requestId,
          delta,
          deltaIndex: Number.isFinite(Number(event?.deltaIndex)) ? Number(event.deltaIndex) : null,
          deltaLength: delta.length
        }
      };
    }

    if (eventType === "runtime.stream.tool_call.started") {
      return {
        kind: "proxy_tool_call_started",
        at,
        nodeId,
        runId,
        mode: "http",
        detail: {
          eventType,
          requestId,
          toolCallId: event?.toolCallId,
          toolName: event?.toolName,
          input: event?.input ?? null
        }
      };
    }

    if (eventType === "runtime.stream.tool_call.progress") {
      return {
        kind: "proxy_tool_call_progress",
        at,
        nodeId,
        runId,
        mode: "http",
        detail: {
          eventType,
          requestId,
          toolCallId: event?.toolCallId,
          toolName: event?.toolName,
          progress: event?.progress,
          message: event?.message
        }
      };
    }

    if (eventType === "runtime.stream.tool_call.completed") {
      return {
        kind: "proxy_tool_call_completed",
        at,
        nodeId,
        runId,
        mode: "http",
        detail: {
          eventType,
          requestId,
          toolCallId: event?.toolCallId,
          toolName: event?.toolName,
          output: event?.output ?? null
        }
      };
    }

    if (eventType === "runtime.stream.output.final") {
      return {
        kind: "proxy_output_final",
        at,
        nodeId,
        runId,
        mode: "http",
        detail: {
          eventType,
          requestId,
          confidence: event?.confidence,
          summary: event?.summary,
          output: event?.output ?? null
        }
      };
    }

    return {
      kind: "proxy_stream_event",
      at,
      nodeId,
      runId,
      mode: "http",
      detail: {
        eventType,
        requestId,
        ...event
      }
    };
  }

  #applyStreamingNodeUpdate(requestId, rawEvent) {
    const pending = this.#pendingSocketRuns.get(requestId);
    if (!pending?.nodeId) return;

    const event = toObject(rawEvent);
    const eventType = asText(event?.eventType);
    const at = asText(event?.at, new Date().toISOString());

    const state =
      this.#streamStateByRequest.get(requestId) ??
      {
        nodeId: pending.nodeId,
        runId: pending.runId,
        text: "",
        stage: "",
        stageMessage: "",
        toolCalls: new Map(),
        finalOutput: null
      };

    if (eventType === "runtime.stream.stage") {
      state.stage = asText(event?.stage);
      state.stageMessage = asText(event?.message);
    } else if (eventType === "runtime.stream.text.delta") {
      const delta = String(event?.delta ?? "");
      state.text += delta;
    } else if (eventType === "runtime.stream.tool_call.started" || eventType === "runtime.stream.tool_call.progress") {
      const toolCallId = asText(event?.toolCallId) || `tool_${state.toolCalls.size + 1}`;
      const current = state.toolCalls.get(toolCallId) ?? { id: toolCallId };
      state.toolCalls.set(toolCallId, {
        ...current,
        id: toolCallId,
        name: asText(event?.toolName) || current.name || "tool",
        input: event?.input ?? current.input ?? null,
        progress: event?.progress ?? current.progress ?? null,
        message: asText(event?.message) || current.message || ""
      });
    } else if (eventType === "runtime.stream.tool_call.completed") {
      const toolCallId = asText(event?.toolCallId) || `tool_${state.toolCalls.size + 1}`;
      const current = state.toolCalls.get(toolCallId) ?? { id: toolCallId };
      state.toolCalls.set(toolCallId, {
        ...current,
        id: toolCallId,
        name: asText(event?.toolName) || current.name || "tool",
        output: event?.output ?? null
      });
    } else if (eventType === "runtime.stream.output.final") {
      state.finalOutput = event?.output && typeof event.output === "object" ? event.output : null;
    }

    this.#streamStateByRequest.set(requestId, state);

    const latest = this.store.getNode(state.nodeId);
    if (!latest) return;

    const summary =
      compactText(state.text, 280) ||
      compactText(state.stageMessage, 280) ||
      (state.stage ? `Stage: ${state.stage}` : "Streaming response...");

    const partialOutput =
      state.finalOutput ??
      {
        type: "provider_stream",
        summary: compactText(state.text, 420) || compactText(state.stageMessage, 420) || "Streaming response",
        text: state.text,
        toolCalls: [...state.toolCalls.values()],
        partial: true,
        generatedAt: at
      };

    this.publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
      nodeId: state.nodeId,
      patch: {
        data: {
          ...(latest?.data ?? {}),
          status: "running",
          lastRunAt: at,
          lastRunSummary: summary,
          lastOutput: partialOutput
        }
      },
      origin: "http-runtime"
    });
  }

  #handleSocketClosed() {
    const pending = [...this.#pendingSocketRuns.entries()];
    this.#pendingSocketRuns.clear();
    this.#streamStateByRequest.clear();
    pending.forEach(([, entry]) => {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error("Runtime WebSocket disconnected"));
    });
    this.#socket = null;
    this.#socketOpenPromise = null;
    this.#socketProxyToken = "";
  }

  #disconnectSocket() {
    if (!this.#socket) return;
    try {
      this.#socket.close();
    } catch {
      // noop
    }
    this.#socket = null;
    this.#socketOpenPromise = null;
    this.#socketProxyToken = "";
  }
}
