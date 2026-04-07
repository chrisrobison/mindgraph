// @ts-check

import { PERSISTENCE } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";
import { buildExecutionPlan } from "./execution-planner.js";
import { HttpAgentRuntime } from "./http-agent-runtime.js";
import { mockAgentRuntime } from "./mock-agent-runtime.js";
import { resolveBatchConcurrencyLimit, runPlanWithBranchParallelism } from "./plan-batch-runner.js";
import {
  buildPlannerSnapshotTrace,
  clampInt,
  clampNum,
  defaultBatchConcurrencyLimit,
  defaultPolicy,
  isNonRetryable,
  nowIso,
  sleep,
  unique
} from "./runtime-service-helpers.js";

class RuntimeService {
  #mode = "mock";
  #adapters = {
    mock: mockAgentRuntime,
    http: new HttpAgentRuntime()
  };
  #activeControllers = new Set();
  #cancelRequested = false;
  #planCacheRevision = -1;
  #planCacheByRoot = new Map();

  constructor() {
    this.#mode = this.#readMode();
    const endpoint = this.#readEndpoint();
    if (endpoint) this.#adapters.http.setEndpoint(endpoint);

    subscribe(EVENTS.RUNTIME_AGENT_RUN_REQUESTED, ({ payload }) => {
      const nodeId = payload?.nodeId;
      if (!nodeId) return;
      this.runNode(nodeId, {
        trigger: payload?.trigger ?? "runtime_request",
        origin: payload?.origin ?? "runtime-service"
      }).catch(() => {
        // adapter-level errors are surfaced through runtime/error events
      });
    });

    subscribe(EVENTS.RUNTIME_SUBTREE_RUN_REQUESTED, ({ payload }) => {
      const nodeId = payload?.nodeId;
      if (!nodeId) return;
      this.runSubtree(nodeId, {
        trigger: payload?.trigger ?? "runtime_subtree_request",
        origin: payload?.origin ?? "runtime-service"
      }).catch(() => {
        // adapter-level errors are surfaced through runtime/error events
      });
    });

    subscribe(EVENTS.RUNTIME_ALL_RUN_REQUESTED, ({ payload }) => {
      this.runAll({
        trigger: payload?.trigger ?? "runtime_all_request",
        origin: payload?.origin ?? "runtime-service"
      }).catch(() => {
        // adapter-level errors are surfaced through runtime/error events
      });
    });

    subscribe(EVENTS.RUNTIME_RUN_CANCEL_REQUESTED, ({ payload }) => {
      this.cancelAllRuns(payload?.reason ?? "requested");
    });
  }

  getMode() {
    return this.#mode;
  }

  getAvailableModes() {
    return ["mock", "http"];
  }

  setMode(mode) {
    if (!this.getAvailableModes().includes(mode)) return;
    this.#mode = mode;
    this.#writeMode(mode);
    publish(EVENTS.RUNTIME_MODE_CHANGED, { mode, origin: "runtime-service" });
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Runtime mode set to ${mode}`,
      context: { mode }
    });
  }

  getEndpoint() {
    return this.#adapters.http.getEndpoint();
  }

  setEndpoint(endpoint) {
    this.#adapters.http.setEndpoint(endpoint);
    this.#writeEndpoint(endpoint);
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `HTTP runtime endpoint updated to ${endpoint}`,
      context: { endpoint }
    });
  }

  cancelAllRuns(reason = "cancel_all") {
    this.#cancelRequested = true;
    for (const controller of this.#activeControllers) {
      try {
        controller.abort();
      } catch {
        // noop
      }
    }
    this.#activeControllers.clear();

    for (const adapter of Object.values(this.#adapters)) {
      if (typeof adapter?.cancelAll === "function") {
        adapter.cancelAll(reason);
      }
    }

    publish(EVENTS.RUNTIME_RUN_CANCELLED, {
      reason,
      at: nowIso(),
      origin: "runtime-service"
    });
  }

  async runNode(nodeId, context = {}) {
    if (!context?.inBatch) {
      this.#cancelRequested = false;
    }

    const adapter = this.#getAdapter();
    const node = graphStore.getNode(nodeId);
    const policy = this.#resolvePolicy(node, context);
    const providerSettings = uiStore.getRuntimeState().providerSettings ?? {};

    let lastResult = null;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      if (this.#cancelRequested) {
        return {
          ok: false,
          status: "cancelled",
          nodeId,
          error: "Execution cancelled",
          cancelled: true
        };
      }

      const controller = new AbortController();
      this.#activeControllers.add(controller);
      publish(EVENTS.RUNTIME_TRACE_APPENDED, {
        kind: "attempt_started",
        at: nowIso(),
        nodeId,
        attempt,
        maxAttempts: policy.maxAttempts,
        mode: this.#mode
      });

      try {
        const result = await adapter.runNode(nodeId, {
          ...context,
          providerSettings,
          attempt,
          maxAttempts: policy.maxAttempts,
          abortSignal: controller.signal,
          cancelSignal: () => this.#cancelRequested
        });

        this.#activeControllers.delete(controller);
        lastResult = result;

        if (result?.ok) {
          publish(EVENTS.RUNTIME_TRACE_APPENDED, {
            kind: "attempt_succeeded",
            at: nowIso(),
            nodeId,
            runId: result?.runId,
            attempt,
            maxAttempts: policy.maxAttempts,
            mode: this.#mode,
            status: result?.status ?? "completed"
          });
          return result;
        }

        publish(EVENTS.RUNTIME_TRACE_APPENDED, {
          kind: "attempt_failed",
          at: nowIso(),
          nodeId,
          runId: result?.runId,
          attempt,
          maxAttempts: policy.maxAttempts,
          mode: this.#mode,
          error: result?.error ?? "unknown"
        });

        if (attempt >= policy.maxAttempts || isNonRetryable(result)) {
          return result;
        }

        const backoffMs = Math.round(policy.retryBackoffMs * Math.pow(policy.retryBackoffFactor, attempt - 1));
        publish(EVENTS.RUNTIME_TRACE_APPENDED, {
          kind: "attempt_backoff",
          at: nowIso(),
          nodeId,
          attempt,
          backoffMs,
          mode: this.#mode
        });
        await sleep(backoffMs);
      } catch (error) {
        this.#activeControllers.delete(controller);
        const cancelled =
          this.#cancelRequested ||
          Boolean(context?.abortSignal?.aborted) ||
          (typeof context?.cancelSignal === "function" && context.cancelSignal()) ||
          error?.name === "AbortError";

        if (cancelled) {
          const result = {
            ok: false,
            status: "cancelled",
            nodeId,
            runId: lastResult?.runId ?? `cancel_${nodeId}_${Date.now()}`,
            error: "Execution cancelled",
            cancelled: true,
            mode: this.#mode
          };
          publish(EVENTS.RUNTIME_TRACE_APPENDED, {
            kind: "attempt_cancelled",
            at: nowIso(),
            nodeId,
            attempt,
            maxAttempts: policy.maxAttempts,
            mode: this.#mode
          });
          return result;
        }

        lastResult = {
          ok: false,
          nodeId,
          error: error instanceof Error ? error.message : String(error)
        };
        publish(EVENTS.RUNTIME_TRACE_APPENDED, {
          kind: "attempt_failed",
          at: nowIso(),
          nodeId,
          attempt,
          maxAttempts: policy.maxAttempts,
          mode: this.#mode,
          error: lastResult.error
        });
        if (attempt >= policy.maxAttempts) return lastResult;
      }
    }

    return lastResult ?? { ok: false, nodeId, error: "Unknown runtime failure" };
  }

  async runSubtree(rootNodeId, context = {}) {
    const plan = this.#getPlan(rootNodeId);
    return this.#runPlan(plan, {
      ...context,
      trigger: context.trigger ?? "runtime_subtree"
    });
  }

  async runAll(context = {}) {
    const plan = this.#getPlan(null);
    return this.#runPlan(plan, {
      ...context,
      trigger: context.trigger ?? "runtime_all"
    });
  }

  async #runPlan(plan, context = {}) {
    this.#cancelRequested = false;
    const startedAt = nowIso();
    const concurrencyLimit = this.#resolveBatchConcurrencyLimit(context);

    publish(EVENTS.RUNTIME_TRACE_APPENDED, buildPlannerSnapshotTrace(plan, { at: startedAt, mode: this.#mode }));
    publish(EVENTS.RUNTIME_TRACE_APPENDED, {
      kind: "plan_parallel_started",
      at: startedAt,
      mode: this.#mode,
      concurrencyLimit
    });

    const batchResult = await runPlanWithBranchParallelism(plan, {
      concurrencyLimit,
      shouldCancel: () => this.#cancelRequested,
      runNode: (nodeId) => this.runNode(nodeId, { ...context, inBatch: true }),
      resolveFailFast: (nodeId, result) => {
        if (result?.ok) return false;
        return this.#resolvePolicy(graphStore.getNode(nodeId), context).failFast;
      },
      onNodeScheduled: ({ nodeId, scheduleIndex, fallback }) => {
        publish(EVENTS.RUNTIME_TRACE_APPENDED, {
          kind: "batch_node_scheduled",
          at: nowIso(),
          nodeId,
          scheduleIndex,
          fallback: Boolean(fallback),
          mode: this.#mode
        });
      },
      onNodeSkipped: ({ nodeId, reason, upstream, failedUpstream }) => {
        if (reason === "upstream_failure") {
          this.#emitUpstreamFailureSkip(nodeId, upstream, failedUpstream);
          return;
        }

        publish(EVENTS.RUNTIME_TRACE_APPENDED, {
          kind: "skipped",
          at: nowIso(),
          nodeId,
          mode: this.#mode,
          reason,
          upstream: unique(upstream),
          failedUpstream: unique(failedUpstream)
        });
      },
      onNodeResult: ({ nodeId, result }) => {
        if (!result?.ok && this.#resolvePolicy(graphStore.getNode(nodeId), context).failFast) {
          publish(EVENTS.RUNTIME_TRACE_APPENDED, {
            kind: "fail_fast_stop",
            at: nowIso(),
            nodeId,
            mode: this.#mode
          });
        }
      }
    });

    const summary = {
      ok: batchResult.failed === 0,
      mode: this.#mode,
      rootNodeId: plan.rootNodeId ?? null,
      completed: batchResult.completed,
      failed: batchResult.failed,
      skipped: batchResult.skippedNodeIds.length,
      runIds: batchResult.runIds,
      cancelled: this.#cancelRequested
    };

    publish(EVENTS.RUNTIME_TRACE_APPENDED, {
      kind: "plan_completed",
      at: nowIso(),
      ...summary
    });

    this.#cancelRequested = false;
    return summary;
  }

  #resolvePolicy(node, context = {}) {
    const nodePolicy = node?.data?.runtimePolicy ?? {};
    const overridePolicy = context?.runtimePolicy ?? {};
    return {
      maxAttempts: clampInt(overridePolicy.maxAttempts ?? nodePolicy.maxAttempts, defaultPolicy.maxAttempts),
      retryBackoffMs: clampNum(overridePolicy.retryBackoffMs ?? nodePolicy.retryBackoffMs, defaultPolicy.retryBackoffMs, 50, 5_000),
      retryBackoffFactor: clampNum(
        overridePolicy.retryBackoffFactor ?? nodePolicy.retryBackoffFactor,
        defaultPolicy.retryBackoffFactor,
        1,
        5
      ),
      failFast: Boolean(overridePolicy.failFast ?? nodePolicy.failFast ?? defaultPolicy.failFast)
    };
  }

  #resolveBatchConcurrencyLimit(context = {}) {
    const document = graphStore.getDocument();
    const metadataPolicy = document?.metadata?.runtimePolicy ?? {};
    const overridePolicy = context?.runtimePolicy ?? {};
    const requestedLimit =
      overridePolicy.batchConcurrencyLimit ??
      overridePolicy.concurrencyLimit ??
      metadataPolicy.batchConcurrencyLimit ??
      metadataPolicy.concurrencyLimit;
    return resolveBatchConcurrencyLimit(requestedLimit, defaultBatchConcurrencyLimit);
  }

  #emitUpstreamFailureSkip(nodeId, upstream = [], failedUpstream = []) {
    publish(EVENTS.RUNTIME_RUN_HISTORY_APPENDED, {
      nodeId,
      nodeLabel: graphStore.getNode(nodeId)?.label ?? nodeId,
      runId: `skip_${nodeId}_${Date.now()}`,
      status: "blocked_by_upstream_failure",
      summary: `Skipped ${nodeId}: upstream dependency failed`,
      confidence: 0,
      output: {
        type: "upstream_failure_propagation"
      },
      at: nowIso(),
      mode: this.#mode
    });
    publish(EVENTS.RUNTIME_TRACE_APPENDED, {
      kind: "skipped_upstream_failure",
      at: nowIso(),
      nodeId,
      mode: this.#mode,
      upstream: unique(upstream),
      failedUpstream: unique(failedUpstream)
    });
  }

  #getAdapter() {
    return this.#adapters[this.#mode] ?? this.#adapters.mock;
  }

  #getPlan(rootNodeId = null) {
    const revision =
      typeof graphStore.getRevision === "function" ? Number(graphStore.getRevision()) : Number.NaN;
    const normalizedRevision = Number.isFinite(revision) ? revision : -1;

    if (normalizedRevision !== this.#planCacheRevision) {
      this.#planCacheByRoot.clear();
      this.#planCacheRevision = normalizedRevision;
    }

    const scopeKey = rootNodeId ?? "__all__";
    const cached = this.#planCacheByRoot.get(scopeKey);
    if (cached) return cached;

    const document = graphStore.getDocument();
    const plan = rootNodeId
      ? buildExecutionPlan(document, { rootNodeId })
      : buildExecutionPlan(document);
    this.#planCacheByRoot.set(scopeKey, plan);

    if (this.#planCacheByRoot.size > 16) {
      const firstKey = this.#planCacheByRoot.keys().next().value;
      if (firstKey != null) this.#planCacheByRoot.delete(firstKey);
    }

    return plan;
  }

  #storage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }

  #readMode() {
    const storage = this.#storage();
    if (!storage) return "mock";

    const raw = storage.getItem(PERSISTENCE.storage.runtimeMode);
    if (!raw) return "mock";
    return this.getAvailableModes().includes(raw) ? raw : "mock";
  }

  #writeMode(mode) {
    const storage = this.#storage();
    if (!storage) return;
    storage.setItem(PERSISTENCE.storage.runtimeMode, mode);
  }

  #writeEndpoint(endpoint) {
    const storage = this.#storage();
    if (!storage) return;
    storage.setItem(PERSISTENCE.storage.runtimeEndpoint, String(endpoint));
  }

  #readEndpoint() {
    const storage = this.#storage();
    if (!storage) return "";
    return String(storage.getItem(PERSISTENCE.storage.runtimeEndpoint) ?? "").trim();
  }
}

export const runtimeService = new RuntimeService();
