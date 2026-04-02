import { AgentRuntime } from "./agent-runtime.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clamp01 = (value) => Math.max(0, Math.min(1, value));

const toArray = (value) => (Array.isArray(value) ? value : []);

const asErrorMessage = (error) => (error instanceof Error ? error.message : String(error));

const makeTaskId = () => `task_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
const makeRunId = (nodeId) => `run_${nodeId}_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;

const friendlyNow = () => new Date().toLocaleTimeString();

const isAgentNode = (node) => node?.type === "agent";

const gatherSubtreeIds = (document, nodeId) => {
  const queue = [nodeId];
  const visited = new Set();
  const result = [];
  const edges = toArray(document?.edges);
  const nodesById = new Map(toArray(document?.nodes).map((node) => [node.id, node]));

  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId || visited.has(currentId)) continue;

    visited.add(currentId);
    const currentNode = nodesById.get(currentId);
    if (isAgentNode(currentNode)) result.push(currentId);

    for (const edge of edges) {
      if (edge.source !== currentId) continue;
      if (edge.type !== "parent_of") continue;
      if (visited.has(edge.target)) continue;
      queue.push(edge.target);
    }
  }

  return result;
};

export class MockAgentRuntime extends AgentRuntime {
  #taskQueue = [];

  constructor(options = {}) {
    super(options);
    this.#emitTaskQueue();
  }

  async runNode(nodeId, context = {}) {
    const node = this.store.getNode(nodeId);
    const taskId = makeTaskId();
    const runId = makeRunId(nodeId);
    const trigger = context.trigger ?? "manual";

    if (!node) {
      const message = `Run failed: node ${nodeId} not found`;
      this.#appendActivity("error", message, { nodeId, runId });
      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, { nodeId, runId, reason: message, trigger });
      this.publish(this.events.RUNTIME_ERROR_APPENDED, {
        nodeId,
        nodeLabel: "Unknown node",
        runId,
        message,
        source: "mock-agent-runtime",
        at: new Date().toISOString()
      });
      return { ok: false, nodeId, runId, error: message };
    }

    if (!isAgentNode(node)) {
      const message = `Run skipped: ${node.label} is not an agent node`;
      this.#appendActivity("warn", message, { nodeId, runId });
      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, { nodeId, runId, reason: message, trigger });
      this.publish(this.events.RUNTIME_ERROR_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        message,
        source: "mock-agent-runtime",
        at: new Date().toISOString()
      });
      return { ok: false, nodeId, runId, error: message };
    }

    this.#setTask(taskId, {
      id: taskId,
      nodeId,
      label: `Run ${node.label}`,
      status: "in_progress",
      progress: 0,
      runId,
      startedAt: new Date().toISOString()
    });

    this.#patchNodeData(nodeId, {
      status: "running",
      confidence: clamp01(Number(node.data?.confidence ?? 0.5)),
      lastRunSummary: "Run started..."
    });

    this.publish(this.events.RUNTIME_AGENT_RUN_STARTED, { nodeId, runId, trigger, context });
    this.#appendActivity("info", `Started run for ${node.label}`, {
      nodeId,
      runId,
      trigger
    });
    this.#appendNodeActivity(nodeId, {
      at: new Date().toISOString(),
      level: "info",
      message: `Started run ${runId}`
    });

    const input = this.#buildInput(node);
    const inputValidation = this.validateInput(node, input);

    if (!inputValidation.valid) {
      const output = {
        type: "validation_error",
        phase: "input",
        errors: inputValidation.errors,
        generatedAt: new Date().toISOString()
      };

      this.#markFailed(node, taskId, runId, "Input validation failed", output);
      return { ok: false, nodeId, runId, error: "Input validation failed", output };
    }

    try {
      for (const step of [
        { progress: 0.3, label: "Collecting context" },
        { progress: 0.65, label: "Generating summary" },
        { progress: 0.9, label: "Preparing structured output" }
      ]) {
        await sleep(260 + Math.floor(Math.random() * 420));
        this.#setTask(taskId, { progress: step.progress });
        this.#appendActivity("info", `${node.label}: ${step.label} (${Math.round(step.progress * 100)}%)`, {
          nodeId,
          runId,
          progress: step.progress
        });
        this.#appendNodeActivity(nodeId, {
          at: new Date().toISOString(),
          level: "info",
          message: `${step.label} (${Math.round(step.progress * 100)}%)`
        });
      }

      const shouldFail = Math.random() < 0.12;
      if (shouldFail) {
        throw new Error("Mock runtime transient failure while drafting response");
      }

      const output = this.#buildOutput(node, input);
      const outputValidation = this.validateOutput(node, output);

      if (!outputValidation.valid) {
        const failureOutput = {
          type: "validation_error",
          phase: "output",
          errors: outputValidation.errors,
          generatedAt: new Date().toISOString(),
          output
        };
        this.#markFailed(node, taskId, runId, "Output validation failed", failureOutput);
        return { ok: false, nodeId, runId, error: "Output validation failed", output: failureOutput };
      }

      const confidence = clamp01(0.64 + Math.random() * 0.32);
      const latestNode = this.store.getNode(nodeId);
      const runEntry = {
        runId,
        status: "completed",
        summary: output.summary,
        confidence,
        at: new Date().toISOString()
      };

      this.#patchNodeData(nodeId, {
        status: "completed",
        confidence,
        lastRunSummary: output.summary,
        lastOutput: output,
        runHistory: [runEntry, ...toArray(latestNode?.data?.runHistory)].slice(0, 25),
        activityHistory: [
          {
            at: runEntry.at,
            level: "info",
            message: `Completed run ${runId}`
          },
          ...toArray(latestNode?.data?.activityHistory)
        ].slice(0, 40)
      });

      this.#setTask(taskId, {
        status: "completed",
        progress: 1,
        completedAt: runEntry.at
      });

      this.publish(this.events.RUNTIME_AGENT_RUN_COMPLETED, {
        nodeId,
        runId,
        status: "completed",
        confidence,
        output
      });
      this.publish(this.events.RUNTIME_RUN_HISTORY_APPENDED, {
        nodeId,
        nodeLabel: node.label,
        runId,
        status: "completed",
        summary: output.summary,
        confidence,
        output,
        at: runEntry.at
      });

      this.#appendActivity("info", `Completed run for ${node.label} (confidence ${confidence.toFixed(2)})`, {
        nodeId,
        runId,
        confidence
      });

      return {
        ok: true,
        nodeId,
        runId,
        status: "completed",
        confidence,
        output
      };
    } catch (error) {
      const output = {
        type: "runtime_error",
        message: asErrorMessage(error),
        generatedAt: new Date().toISOString()
      };
      this.#markFailed(node, taskId, runId, output.message, output);

      return {
        ok: false,
        nodeId,
        runId,
        error: output.message,
        output
      };
    }
  }

  async runSubtree(nodeId, context = {}) {
    const root = this.store.getNode(nodeId);
    const document = this.store.getDocument();

    if (!root || !document) {
      this.#appendActivity("error", "Subtree run failed: missing node/document", { nodeId });
      return { ok: false, nodeIds: [], completed: 0, failed: 0 };
    }

    const ids = gatherSubtreeIds(document, nodeId);
    if (!ids.length) {
      this.#appendActivity("warn", `No agent nodes found in subtree for ${root.label}`, { nodeId });
      return { ok: false, nodeIds: [], completed: 0, failed: 0 };
    }

    this.#appendActivity("info", `Subtree run started for ${root.label} (${ids.length} node(s))`, { nodeId });

    let completed = 0;
    let failed = 0;

    for (const id of ids) {
      const result = await this.runNode(id, { ...context, trigger: context.trigger ?? "manual_subtree" });
      if (result.ok) completed += 1;
      else failed += 1;
    }

    this.#appendActivity(
      failed ? "warn" : "info",
      `Subtree run finished for ${root.label}: ${completed} completed, ${failed} failed`,
      { nodeId }
    );

    return { ok: failed === 0, nodeIds: ids, completed, failed };
  }

  async runAll(context = {}) {
    const nodes = this.store
      .getNodes()
      .filter((node) => isAgentNode(node));

    this.#appendActivity("info", `Run all started for ${nodes.length} agent node(s)`, {
      trigger: context.trigger ?? "manual_all"
    });

    let completed = 0;
    let failed = 0;

    for (const node of nodes) {
      const result = await this.runNode(node.id, { ...context, trigger: context.trigger ?? "manual_all" });
      if (result.ok) completed += 1;
      else failed += 1;
    }

    this.#appendActivity(
      failed ? "warn" : "info",
      `Run all finished at ${friendlyNow()}: ${completed} completed, ${failed} failed`
    );

    return { ok: failed === 0, total: nodes.length, completed, failed };
  }

  #buildInput(node) {
    return {
      nodeId: node.id,
      label: node.label,
      role: node.data?.role ?? "Agent",
      mode: node.data?.mode ?? "orchestrate",
      objective: node.data?.objective ?? "",
      allowedDataSources: toArray(node.data?.allowedDataSources),
      requestedAt: new Date().toISOString()
    };
  }

  #buildOutput(node, input) {
    const sources = toArray(input.allowedDataSources);
    const sourcePhrase = sources.length
      ? `${sources.length} linked data source${sources.length === 1 ? "" : "s"}`
      : "no linked data sources";

    return {
      summary: `${node.label} produced a ${input.mode} update using ${sourcePhrase}.`,
      highlights: [
        `${node.data?.role ?? "Agent"} aligned to objective: ${input.objective || "(no objective set)"}`,
        `Mode ${input.mode} completed without external provider calls`,
        `Execution timestamp ${input.requestedAt}`
      ],
      nextActions: [
        "Review output quality in the inspector",
        "Adjust schemas if stricter structure is needed",
        "Trigger follow-up subtree summary if required"
      ],
      metrics: {
        sourceCount: sources.length,
        mode: input.mode,
        mockRuntime: true
      },
      generatedAt: new Date().toISOString()
    };
  }

  #markFailed(node, taskId, runId, reason, output) {
    const confidence = clamp01(0.18 + Math.random() * 0.26);
    const failedAt = new Date().toISOString();
    const latestNode = this.store.getNode(node.id);

    this.#patchNodeData(node.id, {
      status: "failed",
      confidence,
      lastRunSummary: reason,
      lastOutput: output,
      runHistory: [
        {
          runId,
          status: "failed",
          summary: reason,
          confidence,
          at: failedAt
        },
        ...toArray(latestNode?.data?.runHistory)
      ].slice(0, 25),
      activityHistory: [
        {
          at: failedAt,
          level: "error",
          message: `Failed run ${runId}: ${reason}`
        },
        ...toArray(latestNode?.data?.activityHistory)
      ].slice(0, 40)
    });

    this.#setTask(taskId, {
      status: "failed",
      progress: 1,
      completedAt: failedAt
    });

    this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, {
      nodeId: node.id,
      runId,
      reason,
      output
    });
    this.publish(this.events.RUNTIME_RUN_HISTORY_APPENDED, {
      nodeId: node.id,
      nodeLabel: node.label,
      runId,
      status: "failed",
      summary: reason,
      confidence,
      output,
      at: failedAt
    });
    this.publish(this.events.RUNTIME_ERROR_APPENDED, {
      nodeId: node.id,
      nodeLabel: node.label,
      runId,
      message: reason,
      source: "mock-agent-runtime",
      output,
      at: failedAt
    });

    this.#appendActivity("error", `Run failed for ${node.label}: ${reason}`, {
      nodeId: node.id,
      runId
    });
  }

  #patchNodeData(nodeId, dataPatch) {
    const node = this.store.getNode(nodeId);
    const mergedData = {
      ...(node?.data ?? {}),
      ...dataPatch
    };

    this.publish(this.events.GRAPH_NODE_UPDATE_REQUESTED, {
      nodeId,
      patch: {
        data: mergedData
      },
      origin: "mock-agent-runtime"
    });
  }

  #appendActivity(level, message, context = {}) {
    this.publish(this.events.ACTIVITY_LOG_APPENDED, {
      level,
      message,
      context
    });
  }

  #appendNodeActivity(nodeId, entry) {
    const node = this.store.getNode(nodeId);
    if (!node || !isAgentNode(node)) return;

    this.#patchNodeData(nodeId, {
      activityHistory: [entry, ...toArray(node.data?.activityHistory)].slice(0, 40)
    });
  }

  #setTask(taskId, patch) {
    const nowIso = new Date().toISOString();
    const index = this.#taskQueue.findIndex((task) => task.id === taskId);

    if (index < 0) {
      this.#taskQueue = [{ ...patch, id: taskId, updatedAt: nowIso }, ...this.#taskQueue].slice(0, 80);
    } else {
      const existing = this.#taskQueue[index];
      const next = { ...existing, ...patch, updatedAt: nowIso };
      this.#taskQueue = [
        ...this.#taskQueue.slice(0, index),
        next,
        ...this.#taskQueue.slice(index + 1)
      ];
    }

    this.#emitTaskQueue();
  }

  #emitTaskQueue() {
    this.publish(this.events.TASK_QUEUE_UPDATED, {
      tasks: this.#taskQueue.map((task) => ({ ...task }))
    });
  }
}

export const mockAgentRuntime = new MockAgentRuntime();
