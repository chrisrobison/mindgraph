import { EVENTS } from "../core/event-constants.js";
import { isExecutableNodeType } from "../core/graph-semantics.js";
import { publish } from "../core/pan.js";
import { buildExecutionPlan } from "./execution-planner.js";
import { AgentRuntime } from "./agent-runtime.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const makeRunId = (nodeId) => `http_${nodeId}_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;
const asMessage = (error) => (error instanceof Error ? error.message : String(error));

const resolveWsUrl = (endpoint) => {
  const base = String(endpoint ?? "").trim().replace(/\/$/, "");
  if (!base) return "";

  if (base.startsWith("ws://") || base.startsWith("wss://")) {
    return `${base}/ws`;
  }

  if (typeof window !== "undefined") {
    const url = new URL(base, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
    return url.toString();
  }

  if (base.startsWith("http://")) return `ws://${base.slice("http://".length)}/ws`;
  if (base.startsWith("https://")) return `wss://${base.slice("https://".length)}/ws`;
  return "";
};

export class HttpAgentRuntime extends AgentRuntime {
  #endpoint = "/api/mindgraph/runtime";
  #socket = null;
  #socketOpenPromise = null;
  #pendingSocketRuns = new Map();
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

    const requestPayload = {
      runId,
      trigger,
      node,
      nodePlan,
      context: {
        ...(context ?? {}),
        providerSettings: {
          ...(context?.providerSettings ?? {})
        }
      }
    };

    this.publish(this.events.RUNTIME_AGENT_RUN_STARTED, { nodeId, runId, trigger, context, mode: "http" });

    try {
      const payload = await this.#executeRemoteRun(requestPayload, context?.abortSignal);
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

  async #executeRemoteRun(payload, abortSignal) {
    try {
      return await this.#runNodeViaSocket(payload, abortSignal);
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
      return this.#runNodeViaHttp(payload, abortSignal);
    }
  }

  async #runNodeViaHttp(payload, abortSignal) {
    const response = await fetch(`${this.#endpoint.replace(/\/$/, "")}/run-node`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      signal: abortSignal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async #runNodeViaSocket(payload, abortSignal) {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this browser");
    }

    const socket = await this.#ensureSocket();
    const requestId = `req_${Date.now()}_${++this.#requestSeq}`;

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.#pendingSocketRuns.delete(requestId);
        reject(new Error("WebSocket runtime request timed out"));
      }, 120_000);

      const onAbort = () => {
        this.#pendingSocketRuns.delete(requestId);
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

  async #ensureSocket() {
    if (this.#socket?.readyState === WebSocket.OPEN) return this.#socket;
    if (this.#socketOpenPromise) return this.#socketOpenPromise;

    const wsUrl = resolveWsUrl(this.#endpoint);
    if (!wsUrl) {
      throw new Error("Runtime endpoint cannot be converted to a WebSocket URL");
    }

    this.#socketOpenPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      this.#socket = socket;

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

    if (message.type === "runtime.run_node.progress") {
      publish(EVENTS.RUNTIME_TRACE_APPENDED, {
        kind: "proxy_progress",
        at: message?.at ?? new Date().toISOString(),
        nodeId: message?.nodeId,
        runId: message?.runId,
        mode: "http",
        detail: {
          stage: message?.stage,
          message: message?.message
        }
      });
      return;
    }

    const pending = this.#pendingSocketRuns.get(requestId);
    if (!pending) return;

    if (message.type === "runtime.run_node.completed") {
      this.#pendingSocketRuns.delete(requestId);
      pending.resolve(message.result ?? {});
      return;
    }

    if (message.type === "runtime.run_node.failed") {
      this.#pendingSocketRuns.delete(requestId);
      const error = new Error(String(message.error ?? "Runtime WebSocket request failed"));
      error.noHttpFallback = true;
      pending.reject(error);
    }
  }

  #handleSocketClosed() {
    const pending = [...this.#pendingSocketRuns.entries()];
    this.#pendingSocketRuns.clear();
    pending.forEach(([, entry]) => {
      clearTimeout(entry.timeoutId);
      entry.reject(new Error("Runtime WebSocket disconnected"));
    });
    this.#socket = null;
    this.#socketOpenPromise = null;
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
  }
}
