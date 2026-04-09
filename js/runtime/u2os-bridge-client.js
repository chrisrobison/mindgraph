// @ts-check

import { EVENTS } from "../core/event-constants.js";
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
      at: normalized.envelope.publishedAt
    });

    publish(normalized.envelope.eventName, normalized.envelope.payload);
  }
}

export const bridgeClient = new U2OSBridgeClient();
