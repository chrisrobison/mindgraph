import { EVENTS } from "../core/event-constants.js";
import { isExecutableNodeType } from "../core/graph-semantics.js";
import { publish } from "../core/pan.js";
import { buildExecutionPlan } from "./execution-planner.js";
import { AgentRuntime } from "./agent-runtime.js";

const toArray = (value) => (Array.isArray(value) ? value : []);
const makeRunId = (nodeId) => `http_${nodeId}_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;
const asMessage = (error) => (error instanceof Error ? error.message : String(error));

export class HttpAgentRuntime extends AgentRuntime {
  #endpoint = "/api/mindgraph/runtime";

  constructor(options = {}) {
    super(options);
    if (options.endpoint) {
      this.#endpoint = String(options.endpoint);
    }
  }

  setEndpoint(endpoint) {
    if (!endpoint) return;
    this.#endpoint = String(endpoint);
  }

  getEndpoint() {
    return this.#endpoint;
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

    this.publish(this.events.RUNTIME_AGENT_RUN_STARTED, { nodeId, runId, trigger, context, mode: "http" });

    try {
      const response = await fetch(`${this.#endpoint.replace(/\/$/, "")}/run-node`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          runId,
          trigger,
          node,
          nodePlan,
          context
        }),
        signal: context.abortSignal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
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
}
