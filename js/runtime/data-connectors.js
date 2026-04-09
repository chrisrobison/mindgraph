import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { NODE_TYPES } from "../core/types.js";
import { graphStore } from "../store/graph-store.js";
import { inferSchema } from "./schema-inference.js";

const DEFAULT_JSON_PATH = "/data/sample/site_config.json";
const MIN_PERIODIC_INTERVAL_MS = 5_000;
const DEFAULT_PERIODIC_INTERVAL_MS = 60_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const TRIGGER_ENVELOPE_STALE_MS = 10_000;

const embeddedSamples = Object.freeze({
  site_config: {
    site: {
      name: "MindGraph AI",
      theme: "launch",
      locale: "en-US"
    },
    pages: ["home", "pricing", "docs"],
    features: {
      realtimeGraph: true,
      agentBinding: true,
      dataPreview: true
    }
  },
  market_data: {
    snapshot: {
      market: "AI orchestration",
      demandIndex: 78,
      momentum: "up",
      capturedAt: "2026-04-02T00:00:00.000Z"
    },
    competitors: [
      { name: "OrcaFlow", growth: 14.2 },
      { name: "AtlasNode", growth: 11.8 }
    ]
  },
  support_db: {
    tickets: [
      { id: "SUP-104", status: "open", category: "onboarding" },
      { id: "SUP-105", status: "in_progress", category: "permissions" }
    ],
    summary: {
      open: 11,
      highPriority: 2
    }
  },
  ads_api_mock: {
    campaign: {
      id: "cmp_launch_01",
      spend: 1820.45,
      conversions: 244,
      cpa: 7.46
    },
    channels: [
      { name: "Search", roas: 3.1 },
      { name: "Social", roas: 2.3 }
    ]
  }
});

const deepClone = (value) => {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

const normalizeJsonPath = (value) => String(value ?? "").trim();

const getByPathSegment = (value, segment) => {
  if (value == null) return undefined;
  const arrayMatch = segment.match(/^(.*)\[(\d+)\]$/);
  if (!arrayMatch) {
    return value[segment];
  }

  const objectKey = arrayMatch[1];
  const index = Number(arrayMatch[2]);
  const target = objectKey ? value?.[objectKey] : value;
  return Array.isArray(target) ? target[index] : undefined;
};

const applyJsonPath = (value, rawPath) => {
  const path = normalizeJsonPath(rawPath);
  if (!path) return value;

  const normalizedPath = path.startsWith("$.") ? path.slice(2) : path.startsWith("$") ? path.slice(1) : path;
  if (!normalizedPath) return value;

  return normalizedPath
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((current, segment) => getByPathSegment(current, segment), value);
};

const normalizeSourceType = (value) => {
  const raw = String(value ?? "json").trim().toLowerCase();
  if (raw === "local" || raw === "file") return "json";
  if (raw === "mock") return "mock";
  if (raw === "api") return "api";
  return "json";
};

const normalizeFilterExpression = (value) => String(value ?? "").trim();

const parseFilterValue = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && raw !== "") return asNumber;
  return raw;
};

const valueLooksPresent = (value) => {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
};

const matchesTriggerFilter = (payload, filterExpression) => {
  const filter = normalizeFilterExpression(filterExpression);
  if (!filter) return true;

  const separatorIndex = filter.indexOf("=");
  if (separatorIndex >= 0) {
    const keyPath = filter.slice(0, separatorIndex).trim();
    const expectedRaw = filter.slice(separatorIndex + 1).trim();
    const actual = applyJsonPath(payload, keyPath);
    const expected = parseFilterValue(expectedRaw);

    if (actual === expected) return true;
    if (actual == null || expected == null) return actual === expected;
    return String(actual).trim() === String(expected).trim();
  }

  return valueLooksPresent(applyJsonPath(payload, filter));
};

const buildPayloadPreview = (payload, maxLength = 80) => {
  if (payload == null) return "(none)";
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return String(text ?? "").slice(0, maxLength);
};

const normalizeIso = (value, fallback = "") => {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString();
};

const toIntervalMs = (secondsValue) => {
  const seconds = Number(secondsValue);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_PERIODIC_INTERVAL_MS;
  return Math.max(MIN_PERIODIC_INTERVAL_MS, seconds * 1000);
};

const formatRefreshMessage = ({ label, sourceType, fromCache, reason }) => {
  const source = sourceType.toUpperCase();
  const cacheNote = fromCache ? "cache hit" : "fresh fetch";
  return `Data refreshed: ${label} (${source}, ${cacheNote}, ${reason})`;
};

class DataConnectors {
  #cache = new Map();
  #timers = new Map();
  #triggerEventSubscriptions = new Map();
  #latestTriggerEnvelopeByEvent = new Map();
  #dispose = [];

  constructor() {
    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, ({ payload }) => {
        this.#syncPeriodicRefresh(payload?.document?.nodes ?? []);
        this.#syncAgentLinkedDataCounts();
        this.#syncU2osTriggerSubscriptions(payload?.document?.nodes ?? []);
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
        const node = payload?.node ?? (payload?.nodeId ? graphStore.getNode(payload.nodeId) : null);
        if (!node) return;
        if (node.type === NODE_TYPES.DATA) this.#syncPeriodicRefresh();
        this.#syncU2osTriggerSubscriptions();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_CREATED, ({ payload }) => {
        const nodeType = payload?.node?.type;
        if (nodeType === NODE_TYPES.DATA) this.#syncPeriodicRefresh();
        this.#syncU2osTriggerSubscriptions();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
        const node = graphStore.getNode(payload?.nodeId);
        if (!node || node.type !== "data") return;

        const refreshMode = String(node.data?.refreshMode ?? "manual").toLowerCase();
        if (refreshMode === "onopen") {
          this.refresh(node.id, { reason: "onOpen" }).catch(() => {});
        }
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_CHANGED, () => {
        this.#syncAgentLinkedDataCounts();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_DELETED, ({ payload }) => {
        if (!payload?.nodeId) return;
        this.#clearTimer(payload.nodeId);
        this.#cache.delete(payload.nodeId);
        this.#syncPeriodicRefresh();
        this.#syncU2osTriggerSubscriptions();
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.U2OS_BRIDGE_EVENT_RECEIVED, ({ payload, timestamp }) => {
        const eventName = String(payload?.eventName ?? "").trim();
        if (!eventName) return;

        const fallbackIso = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
        const receivedAt = normalizeIso(payload?.at, fallbackIso) || fallbackIso;
        this.#latestTriggerEnvelopeByEvent.set(eventName, {
          tenantId: String(payload?.tenantId ?? ""),
          receivedAt,
          traceId: String(payload?.traceId ?? ""),
          sourceChannel: String(payload?.sourceChannel ?? "u2os_bridge"),
          capturedAtMs: Date.now()
        });
      })
    );
  }

  async refresh(sourceId, options = {}) {
    const reason = String(options.reason ?? "manual");
    const force = options.force === true || reason === "manual";

    const node = graphStore.getNode(sourceId);
    if (!node || node.type !== "data") {
      throw new Error(`Data node not found: ${sourceId}`);
    }

    try {
      const { refreshedAt, data, fromCache, sourceType } = await this.#loadNodeData(node, { force });
      const schema = inferSchema(data);

      const patch = {
        data: {
          ...(node.data ?? {}),
          sourceType,
          source: sourceType,
          cachedData: data,
          cachedSchema: schema,
          lastUpdated: refreshedAt
        }
      };

      publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
        nodeId: node.id,
        patch,
        origin: "data-connectors"
      });

      const refreshedPayload = {
        sourceId: node.id,
        nodeId: node.id,
        label: node.label,
        sourceType,
        sourcePath: node.data?.sourcePath ?? "",
        sourceUrl: node.data?.sourceUrl ?? "",
        refreshedAt,
        fromCache,
        reason
      };

      publish(EVENTS.RUNTIME_DATA_REFRESHED, refreshedPayload);
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: formatRefreshMessage({
          label: node.label,
          sourceType,
          fromCache,
          reason
        })
      });

      return refreshedPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "error",
        message: `Data refresh failed: ${node.label} (${message})`
      });
      throw error;
    }
  }

  #syncPeriodicRefresh(nodes = null) {
    const allNodes = Array.isArray(nodes) ? nodes : graphStore.getNodes();
    const dataNodes = allNodes.filter((node) => node.type === "data");

    const periodicIds = new Set();

    dataNodes.forEach((node) => {
      const refreshMode = String(node.data?.refreshMode ?? "manual").toLowerCase();
      if (refreshMode !== "periodic") return;

      periodicIds.add(node.id);
      const nextInterval = toIntervalMs(node.data?.refreshInterval);
      const existing = this.#timers.get(node.id);

      if (existing && existing.intervalMs === nextInterval) return;

      this.#clearTimer(node.id);
      const timerId = window.setInterval(() => {
        this.refresh(node.id, { reason: "periodic", force: false }).catch(() => {});
      }, nextInterval);

      this.#timers.set(node.id, { timerId, intervalMs: nextInterval });
    });

    [...this.#timers.keys()].forEach((nodeId) => {
      if (!periodicIds.has(nodeId)) this.#clearTimer(nodeId);
    });
  }

  #clearTimer(nodeId) {
    const entry = this.#timers.get(nodeId);
    if (!entry) return;
    clearInterval(entry.timerId);
    this.#timers.delete(nodeId);
  }

  #syncAgentLinkedDataCounts() {
    const nodes = graphStore.getNodes();
    const dataNodeIds = new Set(nodes.filter((node) => node.type === "data").map((node) => node.id));

    nodes.forEach((node) => {
      if (node.type !== "agent") return;

      const allowed = Array.isArray(node.data?.allowedDataSources) ? node.data.allowedDataSources : [];
      const validIds = [...new Set(allowed)].filter((id) => dataNodeIds.has(id));
      const nextCount = validIds.length;
      const currentCount = Number(node.data?.linkedDataCount ?? 0);

      if (currentCount === nextCount && validIds.length === allowed.length) return;

      publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
        nodeId: node.id,
        patch: {
          data: {
            ...(node.data ?? {}),
            allowedDataSources: validIds,
            linkedDataCount: nextCount
          }
        },
        origin: "data-connectors"
      });
    });
  }

  #syncU2osTriggerSubscriptions(nodes = null) {
    const allNodes = Array.isArray(nodes) ? nodes : graphStore.getNodes();
    const triggerNodes = allNodes.filter((node) => node.type === NODE_TYPES.U2OS_TRIGGER);
    const eventNames = new Set(
      triggerNodes
        .map((node) => String(node.data?.eventName ?? "").trim())
        .filter(Boolean)
    );

    for (const eventName of eventNames) {
      if (this.#triggerEventSubscriptions.has(eventName)) continue;
      const unsubscribe = subscribe(eventName, (detail) => this.#handleU2osTriggerEvent(eventName, detail));
      this.#triggerEventSubscriptions.set(eventName, unsubscribe);
    }

    for (const [eventName, unsubscribe] of this.#triggerEventSubscriptions.entries()) {
      if (eventNames.has(eventName)) continue;
      unsubscribe();
      this.#triggerEventSubscriptions.delete(eventName);
      this.#latestTriggerEnvelopeByEvent.delete(eventName);
    }
  }

  #normalizeTriggerEnvelope(eventName, detail = {}) {
    const fromBridge = this.#latestTriggerEnvelopeByEvent.get(eventName);
    const timestamp = Number(detail?.timestamp);
    const receivedAtFallback = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
    const fromBridgeFresh = fromBridge && Date.now() - Number(fromBridge.capturedAtMs ?? 0) <= TRIGGER_ENVELOPE_STALE_MS;
    return {
      tenantId: String(fromBridgeFresh ? fromBridge?.tenantId : ""),
      receivedAt: String(fromBridgeFresh ? fromBridge?.receivedAt : receivedAtFallback),
      traceId: String(fromBridgeFresh ? fromBridge?.traceId : ""),
      sourceChannel: String(fromBridgeFresh ? fromBridge?.sourceChannel : "pan")
    };
  }

  #handleU2osTriggerEvent(eventName, detail = {}) {
    const payload = detail?.payload;
    const nowIso = new Date().toISOString();
    const envelopeMetadata = this.#normalizeTriggerEnvelope(eventName, detail);

    const triggerNodes = graphStore
      .getNodes()
      .filter(
        (node) =>
          node.type === NODE_TYPES.U2OS_TRIGGER &&
          String(node.data?.eventName ?? "").trim() === eventName
      );

    triggerNodes.forEach((node) => {
      const filterExpression = normalizeFilterExpression(node.data?.filterExpression);
      if (!matchesTriggerFilter(payload, filterExpression)) return;

      publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
        nodeId: node.id,
        patch: {
          data: {
            ...(node.data ?? {}),
            cachedData: deepClone(payload ?? {}),
            cachedSchema: inferSchema(payload ?? {}),
            lastUpdated: envelopeMetadata.receivedAt || nowIso,
            lastReceivedAt: envelopeMetadata.receivedAt || nowIso,
            lastReceivedPayloadPreview: buildPayloadPreview(payload ?? {}),
            lastReceivedMetadata: envelopeMetadata
          }
        },
        origin: "data-connectors"
      });
    });
  }

  async #loadNodeData(node, { force }) {
    const sourceType = normalizeSourceType(node.data?.sourceType ?? node.data?.source ?? "json");
    const sourcePath = String(node.data?.sourcePath ?? "").trim();
    const sourceUrl = String(node.data?.sourceUrl ?? "").trim();
    const jsonPath = normalizeJsonPath(node.data?.jsonPath);
    const refreshIntervalMs = toIntervalMs(node.data?.refreshInterval);
    const cacheTtl = Math.max(DEFAULT_CACHE_TTL_MS, refreshIntervalMs);

    const cacheKey = [sourceType, sourcePath, sourceUrl, jsonPath].join("|");
    const cacheEntry = this.#cache.get(node.id);
    const ageMs = cacheEntry ? Date.now() - cacheEntry.timestamp : Number.POSITIVE_INFINITY;

    if (!force && cacheEntry && cacheEntry.key === cacheKey && ageMs < cacheTtl) {
      return {
        sourceType,
        data: deepClone(cacheEntry.data),
        refreshedAt: cacheEntry.refreshedAt,
        fromCache: true
      };
    }

    const loaded = await this.#loadFromSource({ sourceType, sourcePath, sourceUrl });
    const selected = applyJsonPath(loaded, jsonPath);
    const normalizedData = selected === undefined ? null : selected;
    const refreshedAt = new Date().toISOString();

    this.#cache.set(node.id, {
      key: cacheKey,
      data: deepClone(normalizedData),
      refreshedAt,
      timestamp: Date.now()
    });

    return {
      sourceType,
      data: normalizedData,
      refreshedAt,
      fromCache: false
    };
  }

  async #loadFromSource({ sourceType, sourcePath, sourceUrl }) {
    if (sourceType === "mock") {
      return this.#loadMockSource({ sourcePath, sourceUrl });
    }

    if (sourceType === "api") {
      const url = sourceUrl || sourcePath;
      if (!url) {
        throw new Error("API source requires sourceUrl or sourcePath");
      }
      return this.#fetchJson(url);
    }

    return this.#loadJsonSource(sourcePath);
  }

  async #loadJsonSource(sourcePath) {
    const rawPath = String(sourcePath ?? "").trim();
    const embeddedMatch = rawPath.match(/^embedded:(.+)$/i);

    if (embeddedMatch) {
      const embeddedKey = embeddedMatch[1].trim();
      const embedded = embeddedSamples[embeddedKey];
      if (!embedded) {
        throw new Error(`Embedded sample not found: ${embeddedKey}`);
      }
      return deepClone(embedded);
    }

    if (rawPath && embeddedSamples[rawPath]) {
      return deepClone(embeddedSamples[rawPath]);
    }

    const isAbsolutePath = rawPath.startsWith("/");
    const isExplicitJsonFile = rawPath.endsWith(".json");

    const url = rawPath
      ? isAbsolutePath
        ? rawPath
        : isExplicitJsonFile
          ? `/data/sample/${rawPath}`
          : `/data/sample/${rawPath}.json`
      : DEFAULT_JSON_PATH;

    return this.#fetchJson(url);
  }

  async #loadMockSource({ sourcePath, sourceUrl }) {
    const basePayload = sourceUrl
      ? await this.#fetchJson(sourceUrl)
      : sourcePath
        ? await this.#loadJsonSource(sourcePath)
        : deepClone(embeddedSamples.ads_api_mock);

    return {
      mock: true,
      generatedAt: new Date().toISOString(),
      payload: basePayload
    };
  }

  async #fetchJson(url) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }
}

export const dataConnectors = new DataConnectors();
