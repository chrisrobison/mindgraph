import { EVENTS } from "../core/event-constants.js";
import { subscribe, publish } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";

const cap = (items, max) => items.slice(0, max);

const clone = (value) => {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

const updateExecutionAudit = (updater) => {
  const document = graphStore.getDocument();
  if (!document) return;

  const existing = document.metadata?.executionAudit ?? {
    plannerSnapshots: [],
    runTraces: []
  };

  const next = updater({
    plannerSnapshots: Array.isArray(existing.plannerSnapshots) ? [...existing.plannerSnapshots] : [],
    runTraces: Array.isArray(existing.runTraces) ? [...existing.runTraces] : []
  });

  publish(EVENTS.GRAPH_METADATA_UPDATE_REQUESTED, {
    patch: {
      executionAudit: {
        plannerSnapshots: cap(next.plannerSnapshots ?? [], 50),
        runTraces: cap(next.runTraces ?? [], 300)
      }
    },
    reason: "execution_audit",
    recordHistory: false,
    origin: "runtime-audit-store"
  });
};

subscribe(EVENTS.RUNTIME_TRACE_APPENDED, ({ payload }) => {
  if (!payload) return;

  updateExecutionAudit((existing) => {
    if (payload.kind === "planner_snapshot") {
      return {
        ...existing,
        plannerSnapshots: [clone(payload), ...existing.plannerSnapshots]
      };
    }

    return {
      ...existing,
      runTraces: [clone(payload), ...existing.runTraces]
    };
  });
});

subscribe(EVENTS.RUNTIME_RUN_HISTORY_APPENDED, ({ payload }) => {
  if (!payload) return;
  updateExecutionAudit((existing) => ({
    ...existing,
    runTraces: [
      {
        kind: "run_history",
        at: payload?.at,
        nodeId: payload?.nodeId,
        nodeLabel: payload?.nodeLabel,
        runId: payload?.runId,
        status: payload?.status,
        summary: payload?.summary,
        confidence: payload?.confidence,
        mode: payload?.mode ?? "unknown"
      },
      ...existing.runTraces
    ]
  }));
});
