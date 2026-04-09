// @ts-check

import { EVENTS } from "../core/event-constants.js";
import { getU2osEntityResource } from "../core/u2os-node-catalog.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { uiStore } from "../store/ui-store.js";

const BRIDGE_ENVELOPE_VERSION = "1.0";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const SESSION_TENANT_STORAGE_KEY = "mindgraph.u2os.bridge.tenant";

const DEFAULT_FORWARD_EVENT_NAMES = Object.freeze([
  EVENTS.RUNTIME_AGENT_RUN_COMPLETED,
  EVENTS.RUNTIME_AGENT_RUN_FAILED,
  EVENTS.RUNTIME_RUN_CANCELLED,
  EVENTS.RUNTIME_RUN_HISTORY_APPENDED,
  EVENTS.RUNTIME_DATA_REFRESHED,
  EVENTS.RUNTIME_ERROR_APPENDED
]);

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const asText = (value) => String(value ?? "").trim();
const toObject = (value) => (isObject(value) ? value : {});
const nowIso = () => new Date().toISOString();

const normalizeIso = (value) => {
  const raw = asText(value);
  if (!raw) return nowIso();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? nowIso() : parsed.toISOString();
};

const randomTraceId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `trace_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
};

const parseEventData = async (data) => {
  if (typeof data === "string") {
    return JSON.parse(data);
  }

  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    return JSON.parse(new TextDecoder().decode(data));
  }

  if (data && typeof data === "object" && typeof data.text === "function") {
    return JSON.parse(await data.text());
  }

  return JSON.parse(String(data ?? ""));
};

const toWsBaseUrl = (endpoint) => {
  const raw = asText(endpoint);
  if (!raw) return null;

  try {
    if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
      return new URL(raw);
    }

    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const parsed = new URL(raw);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return parsed;
    }

    if (typeof window !== "undefined") {
      const parsed = new URL(raw, window.location.origin);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
};

const toHttpBaseUrl = (endpoint) => {
  const raw = asText(endpoint);
  if (!raw) return null;

  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const parsed = new URL(raw);
      parsed.pathname = parsed.pathname.replace(/\/ws\/?$/i, "");
      return parsed.toString().replace(/\/$/, "");
    }

    if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
      const parsed = new URL(raw);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      parsed.pathname = parsed.pathname.replace(/\/ws\/?$/i, "");
      return parsed.toString().replace(/\/$/, "");
    }

    if (typeof window !== "undefined") {
      const parsed = new URL(raw, window.location.origin);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : parsed.protocol === "ws:" ? "http:" : parsed.protocol;
      parsed.pathname = parsed.pathname.replace(/\/ws\/?$/i, "");
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return null;
  }

  return null;
};

const resolveSessionTenantId = () => {
  try {
    if (typeof window !== "undefined") {
      const fromUrl = asText(new URL(window.location.href).searchParams.get("tenantId"));
      if (fromUrl) {
        window.sessionStorage.setItem(SESSION_TENANT_STORAGE_KEY, fromUrl);
        return fromUrl;
      }
    }
  } catch {
    // noop
  }

  const fromDocument = asText(graphStore.getDocument()?.metadata?.tenantId);
  if (fromDocument) {
    try {
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(SESSION_TENANT_STORAGE_KEY, fromDocument);
      }
    } catch {
      // noop
    }
    return fromDocument;
  }

  try {
    if (typeof window !== "undefined") {
      const existing = asText(window.sessionStorage.getItem(SESSION_TENANT_STORAGE_KEY));
      if (existing) return existing;
      const generated = `mindgraph-${Date.now().toString(36)}-${Math.floor(Math.random() * 10_000).toString(36)}`;
      window.sessionStorage.setItem(SESSION_TENANT_STORAGE_KEY, generated);
      return generated;
    }
  } catch {
    // noop
  }

  return `mindgraph-${Date.now().toString(36)}`;
};

const normalizeInboundEnvelope = (input) => {
  const value = isObject(input?.event) ? input.event : input;
  if (!isObject(value)) {
    return { ok: false, reason: "Bridge message must be a JSON object" };
  }

  const envelope = asText(value.envelope);
  if (envelope && envelope !== BRIDGE_ENVELOPE_VERSION) {
    return { ok: false, reason: `Unsupported bridge envelope version: ${envelope}` };
  }

  const tenantId = asText(value.tenantId);
  const eventName = asText(value.eventName);
  if (!tenantId) return { ok: false, reason: "Bridge envelope missing tenantId" };
  if (!eventName) return { ok: false, reason: "Bridge envelope missing eventName" };

  if (value.payload != null && !isObject(value.payload)) {
    return { ok: false, reason: "Bridge envelope payload must be an object" };
  }

  return {
    ok: true,
    envelope: {
      envelope: BRIDGE_ENVELOPE_VERSION,
      tenantId,
      eventName,
      payload: toObject(value.payload),
      publishedAt: normalizeIso(value.publishedAt),
      sourceSystem: asText(value.sourceSystem),
      traceId: asText(value.traceId)
    }
  };
};

class U2OSBridgeClient {
  #socket = null;
  #reconnectTimer = null;
  #reconnectAttempt = 0;
  #enabled = false;
  #endpoint = "";
  #secret = "";
  #tenantId = "";
  #forwardEventNames = new Set(DEFAULT_FORWARD_EVENT_NAMES);
  #forwardUnsubscribers = [];

  constructor() {
    this.#handleProviderSettings(uiStore.getRuntimeState().providerSettings ?? {});

    subscribe(EVENTS.RUNTIME_PROVIDER_SETTINGS_CHANGED, ({ payload }) => {
      this.#handleProviderSettings(payload?.settings ?? uiStore.getRuntimeState().providerSettings ?? {});
    });
  }

  setForwardEventNames(eventNames = DEFAULT_FORWARD_EVENT_NAMES) {
    const next = Array.isArray(eventNames)
      ? eventNames.map((eventName) => asText(eventName)).filter(Boolean)
      : DEFAULT_FORWARD_EVENT_NAMES;
    this.#forwardEventNames = new Set(next);
    this.#syncForwardSubscriptions();
  }

  getForwardEventNames() {
    return Array.from(this.#forwardEventNames);
  }

  #buildOutboundEnvelope(eventName, payload = {}, traceId = "") {
    const normalizedEventName = asText(eventName);
    if (!normalizedEventName) {
      throw new Error("eventName is required");
    }

    const resolvedTraceId = asText(traceId) || asText(payload?.traceId) || asText(payload?.correlationId) || randomTraceId();
    return {
      envelope: BRIDGE_ENVELOPE_VERSION,
      tenantId: this.#tenantId,
      eventName: normalizedEventName,
      payload: toObject(payload),
      publishedAt: nowIso(),
      sourceSystem: "mindgraph",
      traceId: resolvedTraceId
    };
  }

  #resolveApiBaseCandidates() {
    const candidates = [];
    const fromBridge = toHttpBaseUrl(this.#endpoint);
    if (fromBridge) candidates.push(fromBridge);
    if (typeof window !== "undefined" && window.location?.origin) {
      candidates.push(window.location.origin);
    }
    return [...new Set(candidates)];
  }

  #resolveAuthToken() {
    const settings = uiStore.getRuntimeState()?.providerSettings ?? {};
    const proxyToken = asText(settings?.proxyToken);
    if (proxyToken) return proxyToken;
    return asText(this.#secret);
  }

  async requestU2osApi({ path = "", method = "GET", query = {}, body = undefined, headers = {} } = {}) {
    const normalizedPath = asText(path);
    if (!normalizedPath) {
      throw new Error("U2OS API request requires a path");
    }

    if (!asText(this.#endpoint)) {
      throw new Error("U2OS bridge endpoint is not configured");
    }
    if (!asText(this.#tenantId)) {
      throw new Error("U2OS bridge tenantId is not available");
    }

    const baseCandidates = this.#resolveApiBaseCandidates();
    if (!baseCandidates.length) {
      throw new Error("Unable to resolve U2OS API base URL from bridge settings");
    }

    const normalizedMethod = asText(method, "GET").toUpperCase();
    const token = this.#resolveAuthToken();
    const queryParams = new URLSearchParams();
    Object.entries(toObject(query)).forEach(([key, value]) => {
      if (value == null || value === "") return;
      queryParams.set(key, String(value));
    });

    let lastError = null;
    for (const baseUrl of baseCandidates) {
      let requestUrl = "";
      try {
        const url = new URL(normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`, `${baseUrl}/`);
        if (!queryParams.has("tenantId")) queryParams.set("tenantId", this.#tenantId);
        queryParams.forEach((value, key) => url.searchParams.set(key, value));
        requestUrl = url.toString();

        const requestHeaders = {
          Accept: "application/json",
          "x-tenant-id": this.#tenantId,
          ...toObject(headers)
        };
        if (asText(this.#secret)) {
          requestHeaders["x-mindgraph-bridge-secret"] = this.#secret;
        }
        if (token && !requestHeaders.Authorization) {
          requestHeaders.Authorization = `Bearer ${token}`;
        }
        if (body !== undefined && !requestHeaders["Content-Type"]) {
          requestHeaders["Content-Type"] = "application/json";
        }

        const response = await fetch(requestUrl, {
          method: normalizedMethod,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body)
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          lastError = new Error(
            `U2OS API ${normalizedMethod} ${normalizedPath} failed (${response.status} ${response.statusText})${errorText ? `: ${errorText.slice(0, 260)}` : ""}`
          );
          continue;
        }

        if (response.status === 204) return null;
        const contentType = String(response.headers.get("content-type") ?? "").toLowerCase();
        if (!contentType.includes("application/json")) {
          const text = await response.text();
          return { raw: text };
        }
        return response.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.#appendActivity("warn", "U2OS API candidate failed", {
          baseUrl,
          path: normalizedPath,
          requestUrl,
          error: lastError.message
        });
      }
    }

    throw lastError ?? new Error(`U2OS API request failed: ${normalizedMethod} ${normalizedPath}`);
  }

  async queryU2osEntity({
    entity = "",
    operation = "list",
    identifier = "",
    filter = {},
    keyword = "",
    limit = 50,
    includeRelations = []
  } = {}) {
    const resource = getU2osEntityResource(entity);
    if (!resource) throw new Error(`Unsupported U2OS entity: ${entity || "(empty)"}`);

    const normalizedOperation = asText(operation, "list").toLowerCase();
    const normalizedLimit = Math.max(1, Math.min(500, Math.round(Number(limit) || 50)));
    const include = Array.isArray(includeRelations)
      ? includeRelations.map((entry) => asText(entry)).filter(Boolean).join(",")
      : "";
    const baseParams = {
      ...toObject(filter),
      ...(include ? { include } : {}),
      limit: normalizedLimit
    };

    let records = [];
    if (normalizedOperation === "get") {
      const id = asText(identifier);
      if (!id) throw new Error("U2OS get operation requires an identifier");
      const row = await this.requestU2osApi({ path: `/api/${resource}/${encodeURIComponent(id)}`, method: "GET" });
      records = row == null ? [] : [row];
    } else {
      const query = normalizedOperation === "search"
        ? {
            ...baseParams,
            q: asText(keyword) || asText(baseParams.q)
          }
        : baseParams;
      const response = await this.requestU2osApi({
        path: `/api/${resource}`,
        method: "GET",
        query
      });
      if (Array.isArray(response)) records = response;
      else if (Array.isArray(response?.items)) records = response.items;
      else if (response?.record && typeof response.record === "object") records = [response.record];
      else if (response && typeof response === "object") records = [response];
      else records = [];
    }

    return {
      results: records,
      count: records.length,
      meta: {
        queryId: `u2osq_${Date.now().toString(36)}_${Math.floor(Math.random() * 10_000).toString(36)}`,
        executedAt: nowIso(),
        tenantId: this.#tenantId,
        entity: asText(entity),
        operation: normalizedOperation
      }
    };
  }

  async mutateU2osEntity({ entity = "", operation = "create", entityId = "", payload = {} } = {}) {
    const resource = getU2osEntityResource(entity);
    if (!resource) throw new Error(`Unsupported U2OS entity: ${entity || "(empty)"}`);

    const normalizedOperation = asText(operation, "create").toLowerCase();
    const id = asText(entityId);
    const body = toObject(payload);
    let method = "POST";
    let path = `/api/${resource}`;
    let responseBody = null;

    if (normalizedOperation === "create") {
      method = "POST";
      responseBody = await this.requestU2osApi({ path, method, body });
    } else if (normalizedOperation === "update") {
      if (!id) throw new Error("U2OS update requires entityId");
      method = "PUT";
      path = `/api/${resource}/${encodeURIComponent(id)}`;
      responseBody = await this.requestU2osApi({ path, method, body });
    } else if (normalizedOperation === "patch") {
      if (!id) throw new Error("U2OS patch requires entityId");
      method = "PUT";
      path = `/api/${resource}/${encodeURIComponent(id)}`;
      responseBody = await this.requestU2osApi({ path, method, body });
    } else if (normalizedOperation === "delete") {
      if (!id) throw new Error("U2OS delete requires entityId");
      method = "DELETE";
      path = `/api/${resource}/${encodeURIComponent(id)}`;
      await this.requestU2osApi({ path, method });
      responseBody = { id };
    } else {
      throw new Error(`Unsupported U2OS mutate operation: ${normalizedOperation}`);
    }

    const resolvedEntityId =
      asText(responseBody?.id) || asText(responseBody?.public_id) || asText(entityId) || "";

    return {
      result: responseBody,
      entityId: resolvedEntityId,
      status: {
        ok: true,
        message: `${normalizedOperation} succeeded`,
        operation: normalizedOperation,
        entity: asText(entity)
      },
      meta: {
        tenantId: this.#tenantId,
        executedAt: nowIso(),
        method,
        path
      }
    };
  }

  async emitU2osEvent(eventName, payload = {}, options = {}) {
    if (!this.#socket || (typeof WebSocket !== "undefined" && this.#socket.readyState !== WebSocket.OPEN)) {
      throw new Error("U2OS bridge socket is not connected");
    }

    const envelope = this.#buildOutboundEnvelope(eventName, payload, options?.traceId);
    this.#socket.send(JSON.stringify(envelope));
    return {
      eventName: envelope.eventName,
      traceId: envelope.traceId,
      tenantId: envelope.tenantId,
      publishedAt: envelope.publishedAt,
      payload: envelope.payload
    };
  }

  #appendActivity(level, message, context = {}) {
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level,
      message,
      context,
      at: nowIso()
    });
  }

  #emitBridgeError(message, context = {}) {
    const text = asText(message) || "Unknown U2OS bridge error";
    publish(EVENTS.U2OS_BRIDGE_ERROR, {
      message: text,
      at: nowIso(),
      ...toObject(context)
    });
    this.#appendActivity("error", `U2OS bridge error: ${text}`, context);
  }

  #emitBridgeDisconnected(status, reason, detail = {}) {
    publish(EVENTS.U2OS_BRIDGE_DISCONNECTED, {
      status,
      reason,
      attempt: detail?.attempt ?? this.#reconnectAttempt,
      nextRetryMs: detail?.nextRetryMs ?? 0,
      endpoint: this.#endpoint,
      tenantId: this.#tenantId,
      at: nowIso()
    });
  }

  #emitBridgeConnected() {
    publish(EVENTS.U2OS_BRIDGE_CONNECTED, {
      endpoint: this.#endpoint,
      tenantId: this.#tenantId,
      at: nowIso()
    });
  }

  #buildBridgeUrl() {
    const base = toWsBaseUrl(this.#endpoint);
    if (!base) return null;

    base.searchParams.set("tenantId", this.#tenantId);
    base.searchParams.set("secret", this.#secret);
    return base.toString();
  }

  #resetReconnectState() {
    if (this.#reconnectTimer != null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#reconnectAttempt = 0;
  }

  #scheduleReconnect(reason) {
    if (!this.#enabled) {
      this.#emitBridgeDisconnected("disconnected", reason, { attempt: this.#reconnectAttempt, nextRetryMs: 0 });
      return;
    }

    if (this.#reconnectTimer != null) return;

    const delayMs = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.#reconnectAttempt), RECONNECT_MAX_MS);
    this.#reconnectAttempt += 1;

    this.#emitBridgeDisconnected("connecting", reason, {
      attempt: this.#reconnectAttempt,
      nextRetryMs: delayMs
    });
    this.#appendActivity(
      "warn",
      `U2OS bridge reconnect attempt ${this.#reconnectAttempt} in ${Math.round(delayMs / 1000)}s`,
      { delayMs, reason, endpoint: this.#endpoint }
    );

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delayMs);
  }

  #disconnect(reason = "disabled") {
    this.#resetReconnectState();
    this.#enabled = false;
    this.#syncForwardSubscriptions();

    const current = this.#socket;
    this.#socket = null;
    if (current) {
      current.onopen = null;
      current.onclose = null;
      current.onerror = null;
      current.onmessage = null;
      try {
        current.close(1000, reason);
      } catch {
        // noop
      }
    }

    this.#emitBridgeDisconnected("disconnected", reason, { attempt: 0, nextRetryMs: 0 });
  }

  #handleProviderSettings(rawSettings) {
    const settings = toObject(rawSettings);
    const bridgeEnabled = Boolean(settings.bridgeEnabled);
    const bridgeEndpoint = asText(settings.bridgeEndpoint);
    const bridgeSecret = asText(settings.bridgeSecret);
    const tenantId = resolveSessionTenantId();

    this.#endpoint = bridgeEndpoint;
    this.#secret = bridgeSecret;
    this.#tenantId = tenantId;

    if (!bridgeEnabled) {
      if (!this.#enabled && !this.#socket) return;
      this.#appendActivity("info", "U2OS bridge disabled", { endpoint: this.#endpoint });
      this.#disconnect("bridge disabled in settings");
      return;
    }

    if (!bridgeEndpoint || !bridgeSecret) {
      this.#disconnect("bridge endpoint or secret missing");
      this.#emitBridgeError("Bridge endpoint and bridge secret are required before connecting", {
        endpointConfigured: Boolean(bridgeEndpoint),
        secretConfigured: Boolean(bridgeSecret)
      });
      return;
    }

    const shouldReconnect =
      !this.#enabled ||
      !this.#socket ||
      asText(this.#socket.url) !== asText(this.#buildBridgeUrl());

    this.#enabled = true;
    this.#syncForwardSubscriptions();

    if (shouldReconnect) {
      const previous = this.#socket;
      this.#socket = null;
      if (previous) {
        previous.onopen = null;
        previous.onclose = null;
        previous.onerror = null;
        previous.onmessage = null;
        try {
          previous.close(1000, "bridge settings changed");
        } catch {
          // noop
        }
      }
      this.#resetReconnectState();
      this.#connect();
    }
  }

  #syncForwardSubscriptions() {
    this.#forwardUnsubscribers.forEach((run) => run());
    this.#forwardUnsubscribers = [];

    if (!this.#enabled) return;

    for (const eventName of this.#forwardEventNames) {
      const unsubscribe = subscribe(eventName, (detail) => {
        this.#forwardPanEvent(detail);
      });
      this.#forwardUnsubscribers.push(unsubscribe);
    }
  }

  #forwardPanEvent(detail) {
    if (!this.#socket || (typeof WebSocket !== "undefined" && this.#socket.readyState !== WebSocket.OPEN)) {
      return;
    }

    const eventName = asText(detail?.eventName);
    if (!eventName) return;

    const payload = toObject(detail?.payload);
    const traceId = asText(payload.traceId) || asText(payload.correlationId) || randomTraceId();

    const envelope = {
      envelope: BRIDGE_ENVELOPE_VERSION,
      tenantId: this.#tenantId,
      eventName,
      payload,
      publishedAt: normalizeIso(detail?.timestamp),
      sourceSystem: "mindgraph",
      traceId
    };

    try {
      this.#socket.send(JSON.stringify(envelope));
    } catch (error) {
      this.#emitBridgeError(error instanceof Error ? error.message : String(error), {
        phase: "send",
        eventName
      });
    }
  }

  #connect() {
    if (!this.#enabled) return;

    if (typeof WebSocket === "undefined") {
      this.#emitBridgeError("WebSocket API is unavailable in this environment");
      this.#emitBridgeDisconnected("disconnected", "websocket unsupported", { attempt: this.#reconnectAttempt });
      return;
    }

    if (this.#socket && this.#socket.readyState === WebSocket.OPEN) return;
    if (this.#socket && this.#socket.readyState === WebSocket.CONNECTING) return;

    const wsUrl = this.#buildBridgeUrl();
    if (!wsUrl) {
      this.#emitBridgeError(`Invalid bridge endpoint: ${this.#endpoint}`, { endpoint: this.#endpoint });
      this.#emitBridgeDisconnected("disconnected", "invalid endpoint", { attempt: this.#reconnectAttempt });
      return;
    }

    this.#emitBridgeDisconnected("connecting", "connecting", {
      attempt: this.#reconnectAttempt,
      nextRetryMs: 0
    });

    this.#appendActivity("info", "Connecting to U2OS bridge", {
      endpoint: this.#endpoint,
      tenantId: this.#tenantId,
      attempt: this.#reconnectAttempt
    });

    let socket;
    try {
      socket = new WebSocket(wsUrl);
    } catch (error) {
      this.#emitBridgeError(error instanceof Error ? error.message : String(error), { endpoint: this.#endpoint });
      this.#scheduleReconnect("socket construction failed");
      return;
    }

    this.#socket = socket;

    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#resetReconnectState();
      this.#emitBridgeConnected();
      this.#appendActivity("info", "Connected to U2OS bridge", {
        endpoint: this.#endpoint,
        tenantId: this.#tenantId
      });
    };

    socket.onclose = (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      const reason = asText(event?.reason) || `socket closed (${event?.code ?? "unknown"})`;
      this.#scheduleReconnect(reason);
    };

    socket.onerror = () => {
      if (this.#socket !== socket) return;
      this.#emitBridgeError("Bridge socket error", { endpoint: this.#endpoint });
    };

    socket.onmessage = (event) => {
      if (this.#socket !== socket) return;
      void this.#handleInboundMessage(event?.data);
    };
  }

  async #handleInboundMessage(rawData) {
    let parsed;
    try {
      parsed = await parseEventData(rawData);
    } catch {
      this.#emitBridgeError("Received non-JSON message from U2OS bridge", { phase: "receive" });
      return;
    }

    const kind = asText(parsed?.kind).toLowerCase();
    if (kind === "bridge.welcome") {
      const tenant = asText(parsed?.tenantId);
      if (tenant && tenant !== this.#tenantId) {
        this.#emitBridgeError("Bridge welcome tenant does not match current session", {
          expectedTenantId: this.#tenantId,
          receivedTenantId: tenant
        });
      }
      return;
    }

    if (kind === "pong") return;

    const normalized = normalizeInboundEnvelope(parsed);
    if (!normalized.ok) {
      this.#emitBridgeError(normalized.reason ?? "Invalid bridge envelope", { phase: "receive" });
      return;
    }

    if (normalized.envelope.tenantId !== this.#tenantId) {
      this.#emitBridgeError("Bridge envelope tenant does not match current session", {
        expectedTenantId: this.#tenantId,
        receivedTenantId: normalized.envelope.tenantId,
        eventName: normalized.envelope.eventName
      });
      return;
    }

    publish(EVENTS.U2OS_BRIDGE_EVENT_RECEIVED, {
      eventName: normalized.envelope.eventName,
      tenantId: normalized.envelope.tenantId,
      traceId: normalized.envelope.traceId,
      sourceChannel: normalized.envelope.sourceSystem || "u2os_bridge",
      at: normalized.envelope.publishedAt
    });

    publish(normalized.envelope.eventName, normalized.envelope.payload);
  }
}

export const bridgeClient = new U2OSBridgeClient();
