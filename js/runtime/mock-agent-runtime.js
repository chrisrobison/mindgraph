import { AgentRuntime } from "./agent-runtime.js";
import { actionExecutor } from "./action-executor.js";
import { buildExecutionPlan } from "./execution-planner.js";
import { dataConnectors } from "./data-connectors.js";
import { getNodeTypeSpec, isExecutableNodeType } from "../core/graph-semantics.js";
import { operationNeedsEntityId } from "../core/u2os-node-catalog.js";
import { NODE_TYPES } from "../core/types.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const toArray = (value) => (Array.isArray(value) ? value : []);
const asErrorMessage = (error) => (error instanceof Error ? error.message : String(error));
const asText = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};
const toObject = (value) => (value != null && typeof value === "object" && !Array.isArray(value) ? value : {});

const makeTaskId = () => `task_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
const makeRunId = (nodeId) => `run_${nodeId}_${Date.now()}_${Math.floor(Math.random() * 1_000)}`;

const friendlyNow = () => new Date().toLocaleTimeString();
const isRunnableNode = (node) => isExecutableNodeType(node?.type);

const firstValue = (value) => {
  if (value == null) return "(none)";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length ? firstValue(value[0]) : "(empty array)";
  if (typeof value === "object") {
    const firstKey = Object.keys(value)[0];
    if (!firstKey) return "(empty object)";
    return `${firstKey}: ${firstValue(value[firstKey])}`;
  }
  return String(value);
};

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
  const path = asText(rawPath);
  if (!path) return;
  const normalized = path.replace(/^\$\.?/, "");
  const segments = normalized
    .split(".")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!segments.length) return;

  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    if (!toObject(cursor[key]) || Array.isArray(cursor[key])) cursor[key] = {};
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

export class MockAgentRuntime extends AgentRuntime {
  #taskQueue = [];
  #cancelRequested = false;

  constructor(options = {}) {
    super(options);
    this.#emitTaskQueue();
  }

  async runNode(nodeId, context = {}) {
    if (!context?.inBatch) {
      this.#cancelRequested = false;
    }

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

    if (!isRunnableNode(node)) {
      const message = `Run skipped: ${node.label} is not runnable`;
      this.#appendActivity("warn", message, { nodeId, runId });
      this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, { nodeId, runId, reason: message, trigger });
      return { ok: false, nodeId, runId, error: message };
    }

    await this.#hydrateMissingDataProviders(nodeId);

    const plan = buildExecutionPlan(this.store.getDocument());
    const nodePlan = plan.nodes?.[nodeId];
    if (!nodePlan) {
      return { ok: false, nodeId, runId, error: "Planner did not return a node plan" };
    }

    if (!nodePlan.ready) {
      const reason = nodePlan.blockedReasons?.[0] ?? "Node is blocked by planner constraints";
      this.#markFailed(node, taskId, runId, reason, {
        type: "planner_blocked",
        reasons: nodePlan.blockedReasons,
        generatedAt: new Date().toISOString()
      });
      return { ok: false, nodeId, runId, error: reason, blockedReasons: nodePlan.blockedReasons };
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
    this.#appendActivity("info", `Started run for ${node.label}`, { nodeId, runId, trigger });
    this.#appendNodeActivity(nodeId, {
      at: new Date().toISOString(),
      level: "info",
      message: `Started run ${runId}`
    });

    try {
      for (const step of [
        { progress: 0.2, label: "Planning" },
        { progress: 0.45, label: "Collecting inputs" },
        { progress: 0.75, label: "Computing output" },
        { progress: 0.93, label: "Recording result" }
      ]) {
        if (this.#isCancelled(context)) {
          this.#markCancelled(node, taskId, runId, "Execution cancelled");
          return { ok: false, nodeId, runId, status: "cancelled", error: "Execution cancelled", cancelled: true };
        }
        await sleep(180);
        this.#setTask(taskId, { progress: step.progress });
        this.#appendNodeActivity(nodeId, {
          at: new Date().toISOString(),
          level: "info",
          message: `${step.label} (${Math.round(step.progress * 100)}%)`
        });
      }

      if (this.#isCancelled(context)) {
        this.#markCancelled(node, taskId, runId, "Execution cancelled");
        return { ok: false, nodeId, runId, status: "cancelled", error: "Execution cancelled", cancelled: true };
      }

      const latestNode = this.store.getNode(nodeId);
      const latestPlan = buildExecutionPlan(this.store.getDocument());
      const inputContext = this.#buildInputContext(latestNode, latestPlan.nodes?.[nodeId], latestPlan);
      const output = this.#executeNode(latestNode, inputContext);

      const outputValidation = this.validateOutput(latestNode, output);
      if (!outputValidation.valid) {
        const failureOutput = {
          type: "validation_error",
          phase: "output",
          errors: outputValidation.errors,
          generatedAt: new Date().toISOString(),
          output
        };
        this.#markFailed(latestNode, taskId, runId, "Output validation failed", failureOutput);
        return { ok: false, nodeId, runId, error: "Output validation failed", output: failureOutput };
      }

      const confidence = this.#confidenceForType(latestNode.type);
      const completedAt = new Date().toISOString();
      const runEntry = {
        runId,
        status: "completed",
        summary: output.summary,
        confidence,
        at: completedAt
      };

      this.#patchNodeData(nodeId, {
        status: "completed",
        confidence,
        lastRunAt: completedAt,
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
        completedAt
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
        nodeLabel: latestNode.label,
        runId,
        status: "completed",
        summary: output.summary,
        confidence,
        output,
        at: completedAt
      });

      this.#appendActivity("info", `Completed run for ${latestNode.label} (${latestNode.type})`, {
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
    this.#cancelRequested = false;
    const root = this.store.getNode(nodeId);
    const document = this.store.getDocument();

    if (!root || !document) {
      this.#appendActivity("error", "Subtree run failed: missing node/document", { nodeId });
      return { ok: false, nodeIds: [], completed: 0, failed: 0 };
    }

    const plan = buildExecutionPlan(document, { rootNodeId: nodeId });
    const runnableIds = plan.executionOrder.filter((id) => plan.scopeNodeIds.includes(id));

    if (!runnableIds.length) {
      this.#appendActivity("warn", `No runnable nodes found in subtree for ${root.label}`, { nodeId });
      return { ok: false, nodeIds: [], completed: 0, failed: 0 };
    }

    if (plan.cycles.length) {
      this.#appendActivity("warn", `Subtree contains cycle(s): ${plan.cycles.map((cycle) => cycle.join(" -> ")).join(" | ")}`, {
        nodeId
      });
    }

    const runMode = context.partial === "stale" ? "stale" : "all";
    const ids =
      runMode === "stale"
        ? runnableIds.filter((id) => {
            const nodePlan = plan.nodes?.[id];
            const node = this.store.getNode(id);
            return nodePlan?.needsRerun || !(node?.data?.lastRunAt ?? "");
          })
        : runnableIds;

    this.#appendActivity("info", `Subtree run started for ${root.label} (${ids.length} node(s), mode=${runMode})`, { nodeId });

    let completed = 0;
    let failed = 0;

    for (const id of ids) {
      const result = await this.runNode(id, {
        ...context,
        trigger: context.trigger ?? "manual_subtree",
        inBatch: true
      });
      if (result?.status === "cancelled") {
        failed += 1;
        break;
      }
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
    this.#cancelRequested = false;
    const plan = buildExecutionPlan(this.store.getDocument());
    const nodeIds = plan.executionOrder.filter((id) => plan.nodes?.[id]?.runnable);

    this.#appendActivity("info", `Run all started for ${nodeIds.length} runnable node(s)`, {
      trigger: context.trigger ?? "manual_all"
    });

    let completed = 0;
    let failed = 0;

    for (const nodeId of nodeIds) {
      const result = await this.runNode(nodeId, {
        ...context,
        trigger: context.trigger ?? "manual_all",
        inBatch: true
      });
      if (result?.status === "cancelled") {
        failed += 1;
        break;
      }
      if (result.ok) completed += 1;
      else failed += 1;
    }

    this.#appendActivity(
      failed ? "warn" : "info",
      `Run all finished at ${friendlyNow()}: ${completed} completed, ${failed} failed`
    );

    return { ok: failed === 0, total: nodeIds.length, completed, failed };
  }

  cancelAll(reason = "cancelled") {
    this.#cancelRequested = true;
    this.#appendActivity("warn", `Run cancellation requested (${reason})`, { reason });
  }

  async #hydrateMissingDataProviders(nodeId) {
    const document = this.store.getDocument();
    const plan = buildExecutionPlan(document);
    const nodePlan = plan.nodes?.[nodeId];
    if (!nodePlan) return;

    const missing = (nodePlan.dataProviderIds ?? [])
      .map((providerId) => this.store.getNode(providerId))
      .filter(
        (provider) =>
          (provider?.type === NODE_TYPES.DATA || provider?.type === NODE_TYPES.U2OS_QUERY) &&
          provider?.data?.cachedData == null
      );

    for (const provider of missing) {
      try {
        await dataConnectors.refresh(provider.id, { reason: "runtime", force: false });
      } catch {
        // data connector already publishes detailed errors
      }
    }
  }

  #buildInputContext(node, nodePlan, plan) {
    const providers = toArray(nodePlan?.dataProviderIds)
      .map((providerId) => this.store.getNode(providerId))
      .filter(Boolean)
      .map((provider) => {
        const outputField = getNodeTypeSpec(provider.type)?.outputField;
        const payload = outputField ? provider.data?.[outputField] ?? null : provider.data?.lastOutput ?? null;
        return {
          id: provider.id,
          label: provider.label,
          type: provider.type,
          payload
        };
      });

    const dependencies = toArray(nodePlan?.upstreamDependencies)
      .map((depId) => this.store.getNode(depId))
      .filter(Boolean)
      .map((depNode) => ({
        id: depNode.id,
        label: depNode.label,
        status: depNode.data?.status ?? "idle",
        output: depNode.data?.lastOutput ?? null
      }));

    return {
      requestedAt: new Date().toISOString(),
      nodeId: node.id,
      label: node.label,
      nodeType: node.type,
      providers,
      dependencies,
      planner: {
        blocked: nodePlan?.blocked ?? false,
        needsRerun: nodePlan?.needsRerun ?? false,
        executionOrderIndex: nodePlan?.executionOrderIndex ?? -1,
        cycleCount: toArray(plan?.cycles).length
      }
    };
  }

  #executeNode(node, inputContext) {
    if (node.type === "transformer") {
      const fields = inputContext.providers
        .map((provider) => firstValue(provider.payload))
        .filter(Boolean)
        .slice(0, 3);
      const transformExpression = String(node.data?.transformExpression ?? "identity");

      return {
        type: "transformer_output",
        summary: `${node.label} transformed ${inputContext.providers.length} provider payload(s) using ${transformExpression}.`,
        fields,
        providerIds: inputContext.providers.map((entry) => entry.id),
        generatedAt: inputContext.requestedAt
      };
    }

    if (node.type === "view") {
      const lines = inputContext.providers.map((provider) => `${provider.label}: ${firstValue(provider.payload)}`).slice(0, 8);

      return {
        type: "view_output",
        summary: `${node.label} rendered ${lines.length} line(s) from upstream context.`,
        template: node.data?.outputTemplate ?? "summary_card",
        lines,
        generatedAt: inputContext.requestedAt
      };
    }

    if (node.type === NODE_TYPES.U2OS_MUTATE) {
      return this.#executeU2osMutateNode(node, inputContext);
    }

    if (node.type === NODE_TYPES.U2OS_EMIT) {
      return this.#executeU2osEmitNode(node, inputContext);
    }

    if (node.type === "action") {
      const actionExecution = actionExecutor.execute(node, {
        requestedAt: inputContext.requestedAt,
        providers: inputContext.providers,
        dependencies: inputContext.dependencies,
        planner: inputContext.planner
      });
      return {
        type: "action_result",
        summary: actionExecution.summary,
        command: actionExecution.command,
        commandResult: actionExecution.commandResult,
        preparedPayload: actionExecution.commandInput,
        generatedAt: inputContext.requestedAt
      };
    }

    const role = node.data?.role ?? "Agent";
    const mode = node.data?.mode ?? "orchestrate";
    const objective = node.data?.objective ?? "";
    const sources = inputContext.providers;

    return {
      type: "agent_output",
      summary: `${node.label} completed ${mode} mode using ${sources.length} provider source(s).`,
      highlights: [
        `${role} objective: ${objective || "(no objective set)"}`,
        `Dependencies resolved: ${inputContext.dependencies.length}`,
        `Planner index: ${inputContext.planner.executionOrderIndex}`
      ],
      nextActions: [
        "Review structured output in inspector",
        "Rerun stale downstream nodes if dependencies changed"
      ],
      metrics: {
        sourceCount: sources.length,
        mode,
        mockRuntime: true
      },
      generatedAt: inputContext.requestedAt
    };
  }

  #resolveMappedPayload(basePayload, mappings) {
    const source = toObject(basePayload);
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

  #executeU2osMutateNode(node, inputContext) {
    const operation = asText(node.data?.operation, "create").toLowerCase();
    const entity = asText(node.data?.entity, "reservation").toLowerCase();
    const primaryProviderPayload = toObject(inputContext.providers[0]?.payload);
    const mappedPayload = this.#resolveMappedPayload(primaryProviderPayload, node.data?.mapInputs);
    const fallbackEntityId = asText(
      primaryProviderPayload.entityId ?? primaryProviderPayload.id ?? primaryProviderPayload.public_id
    );
    const requiredEntityId = operationNeedsEntityId(operation);
    const entityId = requiredEntityId
      ? fallbackEntityId || `${entity.slice(0, 3)}_${Date.now().toString(36)}`
      : fallbackEntityId || `${entity.slice(0, 3)}_${Date.now().toString(36)}`;
    const publicId = `${entity.slice(0, 3).toUpperCase()}-${Math.floor(10_000 + Math.random() * 90_000)}`;
    const mutatedRecord =
      operation === "delete"
        ? {
            id: entityId,
            public_id: publicId,
            entity,
            deleted: true,
            deletedAt: inputContext.requestedAt
          }
        : {
            id: entityId,
            public_id: publicId,
            entity,
            ...mappedPayload,
            updatedAt: inputContext.requestedAt
          };

    return {
      type: "u2os_mutation_result",
      summary: `${node.label} ${operation} operation completed for ${entity}.`,
      result: mutatedRecord,
      entityId,
      status: {
        ok: true,
        message: `${operation} succeeded`,
        operation,
        entity
      },
      generatedAt: inputContext.requestedAt
    };
  }

  #executeU2osEmitNode(node, inputContext) {
    const eventName = asText(node.data?.eventName, "event.created");
    const primaryProviderPayload = toObject(inputContext.providers[0]?.payload);
    const mappedPayload = this.#resolveMappedPayload(primaryProviderPayload, node.data?.payloadMapping);
    const traceId = `trace_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;
    const confirmation = {
      eventName,
      traceId,
      tenantId: "mock-tenant",
      publishedAt: inputContext.requestedAt,
      payload: mappedPayload
    };

    return {
      type: "u2os_emit_confirmation",
      summary: `${node.label} emitted ${eventName}.`,
      confirmation,
      generatedAt: inputContext.requestedAt
    };
  }

  #confidenceForType(type) {
    if (type === "transformer") return 0.92;
    if (type === "action") return 0.8;
    if (type === NODE_TYPES.U2OS_MUTATE) return 0.84;
    if (type === NODE_TYPES.U2OS_EMIT) return 0.88;
    if (type === "view") return 0.86;
    return 0.74;
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
      lastRunAt: failedAt,
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

  #markCancelled(node, taskId, runId, reason) {
    const cancelledAt = new Date().toISOString();
    const latestNode = this.store.getNode(node.id);
    const summary = reason || "Execution cancelled";

    this.#patchNodeData(node.id, {
      status: "cancelled",
      lastRunSummary: summary,
      lastRunAt: cancelledAt,
      runHistory: [
        {
          runId,
          status: "cancelled",
          summary,
          confidence: Number(latestNode?.data?.confidence ?? 0),
          at: cancelledAt
        },
        ...toArray(latestNode?.data?.runHistory)
      ].slice(0, 25),
      activityHistory: [
        {
          at: cancelledAt,
          level: "warn",
          message: `Cancelled run ${runId}: ${summary}`
        },
        ...toArray(latestNode?.data?.activityHistory)
      ].slice(0, 40)
    });

    this.#setTask(taskId, {
      status: "cancelled",
      progress: 1,
      completedAt: cancelledAt
    });

    this.publish(this.events.RUNTIME_AGENT_RUN_FAILED, {
      nodeId: node.id,
      runId,
      reason: summary,
      status: "cancelled"
    });
    this.publish(this.events.RUNTIME_RUN_HISTORY_APPENDED, {
      nodeId: node.id,
      nodeLabel: node.label,
      runId,
      status: "cancelled",
      summary,
      confidence: Number(latestNode?.data?.confidence ?? 0),
      output: { type: "cancelled", message: summary },
      at: cancelledAt
    });
    this.#appendActivity("warn", `Run cancelled for ${node.label}: ${summary}`, {
      nodeId: node.id,
      runId
    });
  }

  #isCancelled(context = {}) {
    if (this.#cancelRequested) return true;
    if (context?.abortSignal?.aborted) return true;
    if (typeof context?.cancelSignal === "function" && context.cancelSignal()) return true;
    return false;
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
    if (!node || !isRunnableNode(node)) return;

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
