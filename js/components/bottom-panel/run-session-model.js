import { compactPreview, toArray } from "./shared.js";

export const TIMELINE_FILTERS = Object.freeze({
  all: "all",
  current: "current",
  selectedNode: "selected-node"
});

const MAX_SOURCE_EVENTS = 2_000;
const MAX_EVENTS_PER_SESSION = 320;

const toFiniteNumber = (value) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

const asTimestamp = (value, fallback = Date.now()) => {
  if (!value) return fallback;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? fallback : timestamp;
};

const toIso = (timestamp) => {
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return new Date().toISOString();
  }
};

const sanitizeText = (value, fallback = "") => {
  const next = String(value ?? "").trim();
  return next || fallback;
};

const normalizeNodeCatalog = (nodeCatalog, runHistory) => {
  const index = new Map();

  toArray(nodeCatalog).forEach((node) => {
    const nodeId = sanitizeText(node?.id);
    if (!nodeId) return;
    index.set(nodeId, sanitizeText(node?.label, nodeId));
  });

  toArray(runHistory).forEach((entry) => {
    const nodeId = sanitizeText(entry?.nodeId);
    if (!nodeId || index.has(nodeId)) return;
    index.set(nodeId, sanitizeText(entry?.nodeLabel, nodeId));
  });

  return index;
};

const classifyPlanCompletion = (trace) => {
  if (trace?.cancelled) {
    return {
      type: "cancelled",
      title: "Run cancelled"
    };
  }

  const failed = toFiniteNumber(trace?.failed) ?? 0;
  if (failed > 0) {
    return {
      type: "run_failed",
      title: "Run completed with failures"
    };
  }

  return {
    type: "run_completed",
    title: "Run completed"
  };
};

const createBaseEvent = ({ source, rawKind, type, title, detail, at, timestamp, order, nodeId, nodeLabel, runId, mode, attempt, maxAttempts }) => ({
  id: `${source}_${rawKind ?? type}_${runId ?? "run"}_${nodeId ?? "global"}_${timestamp}_${order}`,
  source,
  rawKind,
  type,
  title,
  detail,
  at,
  timestamp,
  order,
  nodeId: nodeId ?? null,
  nodeLabel: nodeLabel ?? null,
  runId: runId ?? null,
  mode: mode ?? null,
  attempt: Number.isFinite(attempt) ? attempt : null,
  maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : null
});

const normalizeTraceEvent = (entry, order, nodeLabels) => {
  if (!entry) return null;

  const raw = entry?.detail && typeof entry.detail === "object" ? entry.detail : entry;
  const rawKind = sanitizeText(raw?.kind ?? entry?.kind, "trace");
  const timestamp = asTimestamp(raw?.at ?? entry?.at, Date.now() + order);
  const at = sanitizeText(raw?.at ?? entry?.at, toIso(timestamp));

  const nodeId = sanitizeText(raw?.nodeId ?? entry?.nodeId) || null;
  const nodeLabel = nodeId ? nodeLabels.get(nodeId) ?? nodeId : null;
  const runId = sanitizeText(raw?.runId ?? entry?.runId) || null;
  const mode = sanitizeText(raw?.mode ?? entry?.mode) || null;
  const attempt = toFiniteNumber(raw?.attempt ?? entry?.attempt);
  const maxAttempts = toFiniteNumber(raw?.maxAttempts ?? entry?.maxAttempts);

  if (rawKind === "plan_parallel_started") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "run_requested",
      title: "Run requested",
      detail: `Parallel run started${Number.isFinite(raw?.concurrencyLimit) ? ` (concurrency ${raw.concurrencyLimit})` : ""}`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "attempt_started") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "node_started",
      title: "Node started",
      detail: Number.isFinite(attempt) && Number.isFinite(maxAttempts) ? `Attempt ${attempt} of ${maxAttempts}` : "Execution attempt started",
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_progress") {
    const stage = sanitizeText(raw?.detail?.stage ?? raw?.stage);
    const message = sanitizeText(raw?.detail?.message ?? raw?.message);
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "progress",
      title: "Progress update",
      detail: [stage, message].filter(Boolean).join(" - ") || "Progress update",
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_stage") {
    const stage = sanitizeText(raw?.detail?.stage ?? raw?.stage);
    const message = sanitizeText(raw?.detail?.message ?? raw?.message);
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "progress",
      title: "Stage update",
      detail: [stage, message].filter(Boolean).join(" - ") || "Stage update",
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_text_delta") {
    const delta = sanitizeText(raw?.detail?.delta ?? raw?.delta);
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "stream",
      title: "Output chunk",
      detail: delta || "Streamed text delta",
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_tool_call_started") {
    const toolName = sanitizeText(raw?.detail?.toolName ?? raw?.toolName, "tool");
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "tool_call",
      title: "Tool call started",
      detail: toolName,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_tool_call_progress") {
    const toolName = sanitizeText(raw?.detail?.toolName ?? raw?.toolName, "tool");
    const message = sanitizeText(raw?.detail?.message ?? raw?.message);
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "tool_progress",
      title: "Tool call progress",
      detail: [toolName, message].filter(Boolean).join(" - ") || toolName,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_tool_call_completed") {
    const toolName = sanitizeText(raw?.detail?.toolName ?? raw?.toolName, "tool");
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "tool_completed",
      title: "Tool call completed",
      detail: toolName,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "proxy_output_final") {
    const summary = sanitizeText(raw?.detail?.summary ?? raw?.summary, "Final structured output ready");
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "output",
      title: "Structured output",
      detail: summary,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "attempt_backoff") {
    const backoffMs = toFiniteNumber(raw?.backoffMs);
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "retry",
      title: "Retry scheduled",
      detail:
        Number.isFinite(backoffMs) && Number.isFinite(attempt)
          ? `Attempt ${attempt} failed; retrying in ${Math.round(backoffMs)}ms`
          : "Retry scheduled",
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "attempt_failed") {
    const hasRetryRemaining = Number.isFinite(attempt) && Number.isFinite(maxAttempts) && attempt < maxAttempts;
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: hasRetryRemaining ? "retry" : "failed",
      title: hasRetryRemaining ? "Attempt failed" : "Node failed",
      detail: sanitizeText(raw?.error, hasRetryRemaining ? "Retrying" : "Execution failed"),
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "attempt_succeeded") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "completed",
      title: "Node completed",
      detail: sanitizeText(raw?.status, "Execution completed"),
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "attempt_cancelled") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "cancelled",
      title: "Node cancelled",
      detail: "Execution cancelled",
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "skipped_upstream_failure") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "skipped_upstream_failure",
      title: "Skipped by upstream failure",
      detail: `Failed upstream: ${toArray(raw?.failedUpstream).join(", ") || "unknown"}`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "skipped") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "skipped",
      title: "Node skipped",
      detail: sanitizeText(raw?.reason, "Skipped by planner"),
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "plan_completed") {
    const completion = classifyPlanCompletion(raw);
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: completion.type,
      title: completion.title,
      detail: `${toFiniteNumber(raw?.completed) ?? 0} completed • ${toFiniteNumber(raw?.failed) ?? 0} failed • ${toFiniteNumber(raw?.skipped) ?? 0} skipped`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  if (rawKind === "planner_snapshot") {
    return createBaseEvent({
      source: "trace",
      rawKind,
      type: "planner_snapshot",
      title: "Planner snapshot",
      detail: `${toArray(raw?.executionOrder).length || 0} planned node(s)`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode,
      attempt,
      maxAttempts
    });
  }

  return createBaseEvent({
    source: "trace",
    rawKind,
    type: "info",
    title: rawKind.replaceAll("_", " "),
    detail: compactPreview(raw, 200),
    at,
    timestamp,
    order,
    nodeId,
    nodeLabel,
    runId,
    mode,
    attempt,
    maxAttempts
  });
};

const normalizeRunHistoryEvent = (entry, order, nodeLabels) => {
  if (!entry) return null;

  const rawStatus = sanitizeText(entry?.status, "unknown");
  const timestamp = asTimestamp(entry?.at, Date.now() + order);
  const at = sanitizeText(entry?.at, toIso(timestamp));
  const nodeId = sanitizeText(entry?.nodeId) || null;
  const runId = sanitizeText(entry?.runId) || null;
  const nodeLabel = nodeId ? nodeLabels.get(nodeId) ?? sanitizeText(entry?.nodeLabel, nodeId) : null;

  const confidenceValue = Number(entry?.confidence);
  const confidence = Number.isFinite(confidenceValue) ? ` • confidence ${confidenceValue.toFixed(2)}` : "";
  const summary = sanitizeText(entry?.summary, "Run update");

  if (rawStatus === "completed") {
    return createBaseEvent({
      source: "run_history",
      rawKind: rawStatus,
      type: "completed",
      title: "Node completed",
      detail: `${summary}${confidence}`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode: sanitizeText(entry?.mode),
      attempt: null,
      maxAttempts: null
    });
  }

  if (rawStatus === "failed") {
    return createBaseEvent({
      source: "run_history",
      rawKind: rawStatus,
      type: "failed",
      title: "Node failed",
      detail: `${summary}${confidence}`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode: sanitizeText(entry?.mode),
      attempt: null,
      maxAttempts: null
    });
  }

  if (rawStatus === "cancelled") {
    return createBaseEvent({
      source: "run_history",
      rawKind: rawStatus,
      type: "cancelled",
      title: "Node cancelled",
      detail: `${summary}${confidence}`,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode: sanitizeText(entry?.mode),
      attempt: null,
      maxAttempts: null
    });
  }

  if (rawStatus === "blocked_by_upstream_failure") {
    return createBaseEvent({
      source: "run_history",
      rawKind: rawStatus,
      type: "skipped_upstream_failure",
      title: "Skipped by upstream failure",
      detail: summary,
      at,
      timestamp,
      order,
      nodeId,
      nodeLabel,
      runId,
      mode: sanitizeText(entry?.mode),
      attempt: null,
      maxAttempts: null
    });
  }

  return createBaseEvent({
    source: "run_history",
    rawKind: rawStatus,
    type: "info",
    title: `Run ${rawStatus}`,
    detail: `${summary}${confidence}`,
    at,
    timestamp,
    order,
    nodeId,
    nodeLabel,
    runId,
    mode: sanitizeText(entry?.mode),
    attempt: null,
    maxAttempts: null
  });
};

const makeSession = (sessionId, seedEvent) => ({
  id: sessionId,
  startedAt: seedEvent.at,
  startedTimestamp: seedEvent.timestamp,
  endedAt: seedEvent.at,
  endedTimestamp: seedEvent.timestamp,
  events: [],
  nodeIds: new Set(),
  runIds: new Set(),
  droppedEvents: 0
});

const addEventToSession = (session, event) => {
  session.events.push(event);
  if (event.nodeId) session.nodeIds.add(event.nodeId);
  if (event.runId) session.runIds.add(event.runId);
  if (event.timestamp < session.startedTimestamp) {
    session.startedTimestamp = event.timestamp;
    session.startedAt = event.at;
  }
  if (event.timestamp > session.endedTimestamp) {
    session.endedTimestamp = event.timestamp;
    session.endedAt = event.at;
  }
};

const summarizeCounts = (events) => {
  const counts = {
    total: events.length,
    completed: 0,
    failed: 0,
    retries: 0,
    cancelled: 0,
    skipped: 0
  };

  events.forEach((event) => {
    if (event.type === "completed" || event.type === "run_completed") counts.completed += 1;
    if (event.type === "failed" || event.type === "run_failed") counts.failed += 1;
    if (event.type === "retry") counts.retries += 1;
    if (event.type === "cancelled") counts.cancelled += 1;
    if (event.type === "skipped" || event.type === "skipped_upstream_failure") counts.skipped += 1;
  });

  return counts;
};

const resolveSessionStatus = (events) => {
  const types = new Set(events.map((event) => event.type));
  if (types.has("cancelled")) return "cancelled";
  if (types.has("run_failed") || types.has("failed")) return "failed";
  if (types.has("run_completed") || types.has("completed")) return "completed";
  return "running";
};

const buildNodeGroups = (events) => {
  const runLevelEvents = [];
  const grouped = new Map();

  events.forEach((event) => {
    if (!event.nodeId) {
      runLevelEvents.push(event);
      return;
    }

    if (!grouped.has(event.nodeId)) {
      grouped.set(event.nodeId, {
        nodeId: event.nodeId,
        nodeLabel: event.nodeLabel ?? event.nodeId,
        events: []
      });
    }

    grouped.get(event.nodeId).events.push(event);
  });

  const nodeGroups = [...grouped.values()].sort((left, right) => {
    const leftTime = left.events[0]?.timestamp ?? 0;
    const rightTime = right.events[0]?.timestamp ?? 0;
    return leftTime - rightTime;
  });

  return {
    runLevelEvents,
    nodeGroups
  };
};

const projectSession = (session) => {
  const orderedEvents = [...session.events].sort((left, right) => {
    if (left.timestamp === right.timestamp) return left.order - right.order;
    return left.timestamp - right.timestamp;
  });

  let events = orderedEvents;
  let droppedEvents = session.droppedEvents;
  if (events.length > MAX_EVENTS_PER_SESSION) {
    const keepTail = events.slice(-(MAX_EVENTS_PER_SESSION - 1));
    events = [events[0], ...keepTail];
    droppedEvents += orderedEvents.length - events.length;
  }

  const counts = summarizeCounts(events);
  const grouping = buildNodeGroups(events);

  return {
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    status: resolveSessionStatus(events),
    events,
    counts,
    nodeCount: session.nodeIds.size,
    runIds: [...session.runIds],
    droppedEvents,
    runLevelEvents: grouping.runLevelEvents,
    nodeGroups: grouping.nodeGroups
  };
};

const buildSessions = (events) => {
  const sessions = [];
  const sessionById = new Map();
  const runToSession = new Map();

  let activeSessionId = null;
  let sessionCounter = 0;

  const createSession = (seedEvent) => {
    sessionCounter += 1;
    const sessionId = `session_${sessionCounter}`;
    const session = makeSession(sessionId, seedEvent);
    sessions.push(session);
    sessionById.set(sessionId, session);
    return session;
  };

  events.forEach((event) => {
    let session = null;

    if (event.type === "run_requested") {
      session = createSession(event);
      activeSessionId = session.id;
    } else {
      if (event.runId) {
        const sessionId = runToSession.get(event.runId);
        if (sessionId) {
          session = sessionById.get(sessionId) ?? null;
        }
      }

      if (!session && activeSessionId) {
        session = sessionById.get(activeSessionId) ?? null;
      }

      if (!session) {
        session = createSession(event);

        const syntheticRunRequested = createBaseEvent({
          source: "synthetic",
          rawKind: "run_requested",
          type: "run_requested",
          title: "Run requested",
          detail: event.nodeLabel ? `Execution requested for ${event.nodeLabel}` : "Execution requested",
          at: event.at,
          timestamp: event.timestamp,
          order: event.order - 0.5,
          nodeId: null,
          nodeLabel: null,
          runId: event.runId,
          mode: event.mode,
          attempt: null,
          maxAttempts: null
        });

        addEventToSession(session, syntheticRunRequested);
      }
    }

    addEventToSession(session, event);

    if (event.runId) {
      runToSession.set(event.runId, session.id);
    }

    if (["run_completed", "run_failed", "cancelled"].includes(event.type) && activeSessionId === session.id) {
      activeSessionId = null;
    }
  });

  return sessions.map((session) => projectSession(session)).sort((left, right) => asTimestamp(right.startedAt) - asTimestamp(left.startedAt));
};

const sortByTimestamp = (events) =>
  [...events].sort((left, right) => {
    if (left.timestamp === right.timestamp) return left.order - right.order;
    return left.timestamp - right.timestamp;
  });

export const buildRunSessionTimelineModel = ({ traces = [], runHistory = [], nodeCatalog = [] } = {}) => {
  const nodeLabels = normalizeNodeCatalog(nodeCatalog, runHistory);

  const normalizedTraceEvents = toArray(traces)
    .map((entry, index) => normalizeTraceEvent(entry, index, nodeLabels))
    .filter(Boolean);

  const normalizedRunHistoryEvents = toArray(runHistory)
    .map((entry, index) => normalizeRunHistoryEvent(entry, normalizedTraceEvents.length + index, nodeLabels))
    .filter(Boolean);

  const combined = sortByTimestamp([...normalizedTraceEvents, ...normalizedRunHistoryEvents]);
  const droppedSourceEvents = Math.max(0, combined.length - MAX_SOURCE_EVENTS);
  const sourceEvents = droppedSourceEvents ? combined.slice(-MAX_SOURCE_EVENTS) : combined;

  const sessions = buildSessions(sourceEvents);

  return {
    sessions,
    totalEvents: sourceEvents.length,
    droppedSourceEvents,
    latestSessionId: sessions[0]?.id ?? null,
    generatedAt: new Date().toISOString()
  };
};

const filterBySelectedNode = (session, selectedNodeId) => {
  const filteredEvents = session.events.filter((event) => !event.nodeId || event.nodeId === selectedNodeId);
  if (!filteredEvents.some((event) => event.nodeId === selectedNodeId)) return null;

  return projectSession({
    id: session.id,
    startedAt: session.startedAt,
    startedTimestamp: asTimestamp(session.startedAt),
    endedAt: session.endedAt,
    endedTimestamp: asTimestamp(session.endedAt),
    events: filteredEvents,
    nodeIds: new Set(filteredEvents.map((event) => event.nodeId).filter(Boolean)),
    runIds: new Set(filteredEvents.map((event) => event.runId).filter(Boolean)),
    droppedEvents: session.droppedEvents
  });
};

export const filterRunSessionTimelineModel = (model, filter, selectedNodeId = null) => {
  const sessionList = toArray(model?.sessions);

  if (filter === TIMELINE_FILTERS.current) {
    if (!model?.latestSessionId) return [];
    return sessionList.filter((session) => session.id === model.latestSessionId);
  }

  if (filter === TIMELINE_FILTERS.selectedNode) {
    if (!selectedNodeId) return [];
    return sessionList.map((session) => filterBySelectedNode(session, selectedNodeId)).filter(Boolean);
  }

  return sessionList;
};
