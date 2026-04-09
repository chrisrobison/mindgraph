import crypto from "node:crypto";
import http from "node:http";
import {
  asTrimmed,
  buildControlDbConfig,
  buildProxyConfig,
  buildTenancyConfig,
  createControlStore,
  createTenantResolver,
  getQueryValue,
  nowIso
} from "./tenancy/index.mjs";
import { decodeWsFrames, encodeWsPongFrame, encodeWsTextFrame } from "./runtime/ws-protocol.mjs";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const MAX_BODY_BYTES = 1_000_000;
const proxyConfig = buildProxyConfig(process.env);
const tenancyConfig = buildTenancyConfig(process.env);
const controlDbConfig = buildControlDbConfig(process.env);
const HOST = proxyConfig.host;
const PORT = proxyConfig.port;
const PROXY_AUTH_TOKEN = proxyConfig.authToken;
const REQUEST_TIMEOUT_MS = proxyConfig.requestTimeoutMs;
const MAX_PROMPT_CHARS = proxyConfig.maxPromptChars;
const ALLOWED_ORIGINS = proxyConfig.allowedOrigins;
const DEFAULT_MODELS = Object.freeze({
  openai: "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-2.0-flash"
});

const providerEnvKey = Object.freeze({
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY"
});
const STREAM_EVENT_TYPES = Object.freeze({
  STAGE: "runtime.stream.stage",
  TEXT_DELTA: "runtime.stream.text.delta",
  TOOL_CALL_STARTED: "runtime.stream.tool_call.started",
  TOOL_CALL_PROGRESS: "runtime.stream.tool_call.progress",
  TOOL_CALL_COMPLETED: "runtime.stream.tool_call.completed",
  OUTPUT_FINAL: "runtime.stream.output.final"
});

let wsClientSeq = 0;
const wsClients = new Map();
const wsRunControllers = new Map();

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

class ProxyError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = "ProxyError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const asErrorMessage = (error) => (error instanceof Error ? error.message : String(error));
const toProxyError = (error, fallbackCode = "PROXY_UNEXPECTED", fallbackStatus = 500) => {
  if (error instanceof ProxyError) return error;
  return new ProxyError(fallbackCode, asErrorMessage(error), { status: fallbackStatus });
};

const toErrorPayload = (error) => {
  const normalized = toProxyError(error);
  return {
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details ?? null
    },
    at: nowIso()
  };
};

const originAllowed = (origin) => {
  if (ALLOWED_ORIGINS === "*") return true;
  if (!origin) return true;
  return Array.isArray(ALLOWED_ORIGINS) && ALLOWED_ORIGINS.includes(origin);
};

const withCors = (req, res) => {
  const origin = asTrimmed(req?.headers?.origin, "");
  const allowed = originAllowed(origin);
  res.setHeader("Vary", "Origin");
  if (origin && allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (ALLOWED_ORIGINS === "*") {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return allowed;
};

const writeJson = (req, res, statusCode, payload) => {
  withCors(req, res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const writeProxyError = (req, res, error) => {
  const normalized = toProxyError(error);
  writeJson(req, res, normalized.status ?? 500, toErrorPayload(normalized));
};

const readBearerToken = (req) => {
  const authorization = asTrimmed(req?.headers?.authorization, "");
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice("bearer ".length).trim();
};

const validateProxyAuth = (token) => {
  if (!PROXY_AUTH_TOKEN) return true;
  const input = Buffer.from(String(token ?? ""), "utf8");
  const expected = Buffer.from(PROXY_AUTH_TOKEN, "utf8");
  if (input.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(input, expected);
  } catch {
    return false;
  }
};

const requireHttpAuth = (req) => {
  if (!PROXY_AUTH_TOKEN) return;
  const token = readBearerToken(req);
  if (!validateProxyAuth(token)) {
    throw new ProxyError("PROXY_AUTH_REQUIRED", "Missing or invalid proxy bearer token", { status: 401 });
  }
};

const requireUpgradeAuth = (req) => {
  if (!PROXY_AUTH_TOKEN) return;
  const bearer = readBearerToken(req);
  const tokenFromQuery = getQueryValue(req?.url, "proxy_token");
  const token = bearer || tokenFromQuery;
  if (!validateProxyAuth(token)) {
    throw new ProxyError("PROXY_AUTH_REQUIRED", "Missing or invalid proxy token for websocket upgrade", { status: 401 });
  }
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ProxyError("PROXY_BODY_TOO_LARGE", "Request body exceeds max size", { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw));
      } catch {
        reject(new ProxyError("PROXY_INVALID_JSON", "Invalid JSON body", { status: 400 }));
      }
    });

    req.on("error", reject);
  });

const controlStore = await createControlStore(controlDbConfig);
await controlStore.initSchema();
await controlStore.ensureBootstrapTenant({
  host: tenancyConfig.bootstrapHost,
  domain: tenancyConfig.bootstrapDomain,
  dbClient: "sqlite",
  dbConfig: {
    file: `${process.cwd()}/data/mindgraph-tenant-default.sqlite`
  }
});
const tenantResolver = createTenantResolver({
  controlStore,
  config: tenancyConfig
});

const normalizeProviderSettings = (settings = {}) => {
  const providerRaw = String(settings?.provider ?? "openai").trim().toLowerCase();
  const provider = providerRaw === "anthropic" || providerRaw === "gemini" ? providerRaw : "openai";
  const model = String(settings?.model ?? DEFAULT_MODELS[provider]).trim() || DEFAULT_MODELS[provider];
  const envKeyName = providerEnvKey[provider];
  const apiKey = String(settings?.apiKey ?? process.env[envKeyName] ?? "").trim();

  return {
    provider,
    model,
    apiKey,
    temperature: clamp(settings?.temperature, 0, 2, 0.3),
    maxTokens: Math.round(clamp(settings?.maxTokens, 64, 8192, 800)),
    systemPrompt: String(settings?.systemPrompt ?? "").trim()
  };
};

const requireProviderConfig = (settings) => {
  if (!settings.apiKey) {
    const envHint = providerEnvKey[settings.provider];
    throw new ProxyError("PROVIDER_API_KEY_MISSING", `Missing API key for ${settings.provider}. Set it in UI settings or ${envHint}.`, {
      status: 400,
      details: { provider: settings.provider, envHint }
    });
  }
};
const asString = (value) => String(value ?? "").trim();

const parseJsonLike = (value) => {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

const parseResponseError = async (response) => {
  try {
    const data = await response.json();
    const message = data?.error?.message || data?.message || JSON.stringify(data);
    return `${response.status} ${response.statusText}: ${message}`;
  } catch {
    const text = await response.text();
    return `${response.status} ${response.statusText}: ${text}`;
  }
};

const normalizeToolCall = (rawToolCall, fallbackName = "tool", index = 0) => ({
  id: asString(rawToolCall?.id) || `tool_${index + 1}`,
  name: asString(rawToolCall?.name ?? rawToolCall?.function?.name ?? fallbackName) || fallbackName,
  input: parseJsonLike(rawToolCall?.input ?? rawToolCall?.arguments ?? rawToolCall?.function?.arguments)
});

const extractOpenAIResult = (data) => {
  const message = data?.choices?.[0]?.message ?? {};
  const content = message?.content;
  let text = "";

  if (typeof content === "string" && content.trim()) {
    text = content.trim();
  } else if (Array.isArray(content)) {
    text = content
      .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
      .join("\n")
      .trim();
  }

  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls.map((entry, index) =>
        normalizeToolCall(
          {
            id: entry?.id,
            name: entry?.function?.name,
            arguments: entry?.function?.arguments
          },
          "function",
          index
        )
      )
    : [];

  if (!text && !toolCalls.length) {
    throw new Error("OpenAI returned no message content");
  }

  return {
    text,
    toolCalls
  };
};

const extractAnthropicResult = (data) => {
  const entries = Array.isArray(data?.content) ? data.content : [];
  const text = entries
    .map((entry) => (entry?.type === "text" ? entry.text : ""))
    .join("\n")
    .trim();
  const toolCalls = entries
    .map((entry, index) => {
      if (entry?.type !== "tool_use") return null;
      return normalizeToolCall(
        {
          id: entry?.id,
          name: entry?.name,
          input: entry?.input
        },
        "tool_use",
        index
      );
    })
    .filter(Boolean);

  if (!text && !toolCalls.length) {
    throw new Error("Anthropic returned no text content");
  }

  return {
    text,
    toolCalls
  };
};

const extractGeminiResult = (data) => {
  const parts = (Array.isArray(data?.candidates) ? data.candidates : []).flatMap((candidate) => candidate?.content?.parts ?? []);
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
  const toolCalls = parts
    .map((part, index) => {
      if (!part?.functionCall?.name) return null;
      return normalizeToolCall(
        {
          name: part.functionCall.name,
          input: part.functionCall.args
        },
        "function_call",
        index
      );
    })
    .filter(Boolean);

  if (!text && !toolCalls.length) {
    throw new Error("Gemini returned no text content");
  }

  return {
    text,
    toolCalls
  };
};

const callOpenAI = async ({ apiKey, model, systemPrompt, prompt, temperature, maxTokens, signal }) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        { role: "user", content: prompt }
      ]
    }),
    signal
  });

  if (!response.ok) {
    throw new ProxyError("PROVIDER_OPENAI_ERROR", `OpenAI error: ${await parseResponseError(response)}`, { status: 502 });
  }

  return extractOpenAIResult(await response.json());
};

const callAnthropic = async ({ apiKey, model, systemPrompt, prompt, temperature, maxTokens, signal }) => {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }]
    }),
    signal
  });

  if (!response.ok) {
    throw new ProxyError("PROVIDER_ANTHROPIC_ERROR", `Anthropic error: ${await parseResponseError(response)}`, { status: 502 });
  }

  return extractAnthropicResult(await response.json());
};

const callGemini = async ({ apiKey, model, systemPrompt, prompt, temperature, maxTokens, signal }) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...(systemPrompt
          ? {
              systemInstruction: {
                parts: [{ text: systemPrompt }]
              }
            }
          : {}),
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      }),
      signal
    }
  );

  if (!response.ok) {
    throw new ProxyError("PROVIDER_GEMINI_ERROR", `Gemini error: ${await parseResponseError(response)}`, { status: 502 });
  }

  return extractGeminiResult(await response.json());
};

const runProvider = async ({ provider, ...rest }) => {
  if (provider === "anthropic") return callAnthropic({ provider, ...rest });
  if (provider === "gemini") return callGemini({ provider, ...rest });
  return callOpenAI({ provider, ...rest });
};

const buildPrompt = ({ node, nodePlan, context }) => {
  const providerSummary = Array.isArray(nodePlan?.dataProviderIds) ? nodePlan.dataProviderIds.join(", ") : "none";
  const dependencySummary = Array.isArray(nodePlan?.upstreamDependencies)
    ? nodePlan.upstreamDependencies.join(", ")
    : "none";

  return [
    "You are executing a MindGraph node in an AI workflow graph.",
    "Return a concise, practical result for this node.",
    "",
    `Node ID: ${node?.id ?? "unknown"}`,
    `Node Label: ${node?.label ?? "Unnamed"}`,
    `Node Type: ${node?.type ?? "unknown"}`,
    `Description: ${node?.description ?? ""}`,
    `Upstream Dependencies: ${dependencySummary}`,
    `Data Providers: ${providerSummary}`,
    `Trigger: ${context?.trigger ?? "manual"}`,
    `Tenant Instance: ${context?.tenancy?.instanceId ?? "unknown"}`,
    "",
    "Node data JSON:",
    JSON.stringify(node?.data ?? {}, null, 2),
    "",
    "Provide output content suitable for downstream workflow execution."
  ].join("\n");
};

const chunkText = (value, chunkSize = 48) => {
  const source = asString(value);
  if (!source) return [];

  const segments = source.match(/(\s+|[^\s]+)/g) ?? [];
  const chunks = [];
  let buffer = "";
  segments.forEach((segment) => {
    if ((buffer + segment).length > chunkSize && buffer) {
      chunks.push(buffer);
      buffer = segment;
      return;
    }
    buffer += segment;
  });
  if (buffer) chunks.push(buffer);
  return chunks;
};

const buildRuntimeResult = ({ settings, text, toolCalls = [] }) => {
  const compact = String(text ?? "").trim();
  const summary = compact.split(/\n+/).slice(0, 2).join(" ").slice(0, 280) || "Provider response captured";
  return {
    confidence: 0.76,
    summary,
    output: {
      type: "provider_output",
      provider: settings.provider,
      model: settings.model,
      summary: compact.slice(0, 420) || summary,
      text: compact,
      toolCalls: toolCalls.length ? toolCalls : [],
      generatedAt: nowIso()
    }
  };
};

const executeRunRequest = async (payload, { progress, stream, signal, tenantContext } = {}) => {
  const settings = normalizeProviderSettings(payload?.context?.providerSettings ?? {});
  requireProviderConfig(settings);

  const node = payload?.node ?? {};
  const nodePlan = payload?.nodePlan ?? {};
  const runId = asString(payload?.runId) || `run_${Date.now()}`;
  const nodeId = asString(node?.id) || null;
  let eventSeq = 0;

  const emitStream = (eventType, detail = {}) => {
    const at = detail?.at ?? nowIso();
    stream?.({
      eventType,
      at,
      seq: ++eventSeq,
      nodeId,
      runId,
      provider: settings.provider,
      model: settings.model,
      ...detail
    });
  };

  const emitStage = (stage, message) => {
    const at = nowIso();
    progress?.({ stage, message, at, nodeId, runId });
    emitStream(STREAM_EVENT_TYPES.STAGE, { at, stage, message });
  };

  emitStage("plan", "Planning prompt");
  const prompt = buildPrompt({ node, nodePlan, context: payload?.context ?? {} });
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new ProxyError("PROXY_PROMPT_TOO_LARGE", `Prompt exceeds max length (${MAX_PROMPT_CHARS})`, {
      status: 400,
      details: { promptLength: prompt.length, maxPromptChars: MAX_PROMPT_CHARS }
    });
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const providerSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  emitStage("provider", `Calling ${settings.provider}/${settings.model}`);
  let providerResult = null;
  try {
    providerResult = await runProvider({
      ...settings,
      prompt,
      signal: providerSignal
    });
  } catch (error) {
    if (providerSignal?.aborted) {
      throw new ProxyError("PROVIDER_TIMEOUT", `Provider request exceeded timeout (${REQUEST_TIMEOUT_MS}ms)`, {
        status: 504
      });
    }
    throw error;
  }
  const text = asString(providerResult?.text);
  const toolCalls = Array.isArray(providerResult?.toolCalls) ? providerResult.toolCalls : [];

  toolCalls.forEach((toolCall, index) => {
    const toolCallId = asString(toolCall?.id) || `tool_${index + 1}`;
    const toolName = asString(toolCall?.name) || "tool";
    emitStream(STREAM_EVENT_TYPES.TOOL_CALL_STARTED, {
      toolCallId,
      toolName,
      index,
      input: toolCall?.input ?? null
    });
    emitStream(STREAM_EVENT_TYPES.TOOL_CALL_PROGRESS, {
      toolCallId,
      toolName,
      index,
      progress: 1,
      message: "Tool call payload received"
    });
    emitStream(STREAM_EVENT_TYPES.TOOL_CALL_COMPLETED, {
      toolCallId,
      toolName,
      index,
      output: toolCall?.output ?? null
    });
  });

  chunkText(text).forEach((delta, index) => {
    emitStream(STREAM_EVENT_TYPES.TEXT_DELTA, {
      delta,
      deltaIndex: index,
      isFinalChunk: false
    });
  });

  emitStage("finalize", "Formatting provider output");
  const result = buildRuntimeResult({ settings, text, toolCalls });
  if (tenantContext?.instance?.id) {
    result.tenant = {
      mode: tenantContext.mode,
      source: tenantContext.source,
      host: tenantContext.host,
      domain: tenantContext.domain,
      instanceId: tenantContext.instance.id
    };
    result.output.tenant = { ...result.tenant };
  }
  emitStream(STREAM_EVENT_TYPES.OUTPUT_FINAL, {
    summary: result.summary,
    confidence: result.confidence,
    output: result.output
  });
  return result;
};

const sendWsJson = (client, message) => {
  try {
    client.socket.write(encodeWsTextFrame(JSON.stringify(message)));
  } catch {
    // noop
  }
};

const parseWsFrames = (client, chunk) => {
  const mergedBuffer = Buffer.concat([client.buffer, chunk]);
  const parsed = decodeWsFrames(mergedBuffer, {
    requireMasked: true,
    maxPayloadBytes: MAX_BODY_BYTES
  });

  if (parsed.protocolError) {
    client.socket.destroy();
    return;
  }

  client.buffer = parsed.remaining;

  for (const frame of parsed.frames) {
    if (frame.opcode === 0x8) {
      client.socket.end();
      return;
    }

    if (frame.opcode === 0x9) {
      client.socket.write(encodeWsPongFrame(frame.payload));
      continue;
    }

    if (frame.opcode !== 0x1) {
      continue;
    }

    let message = null;
    try {
      message = JSON.parse(frame.payload.toString("utf8"));
    } catch {
      continue;
    }

    void handleWsMessage(client, message);
  }
};

const controllerKey = (clientId, requestId) => `${clientId}:${requestId}`;

const handleWsMessage = async (client, message) => {
  const type = String(message?.type ?? "");
  const requestId = String(message?.requestId ?? "").trim();

  if (type === "runtime.run_node.cancel") {
    const controller = wsRunControllers.get(controllerKey(client.id, requestId));
    if (controller) controller.abort();
    return;
  }

  if (type === "runtime.cancel_all.request") {
    for (const [key, controller] of wsRunControllers.entries()) {
      if (!key.startsWith(`${client.id}:`)) continue;
      controller.abort();
    }
    return;
  }

  if (type !== "runtime.run_node.request" || !requestId) {
    return;
  }

  const payload = message?.payload ?? {};
  const controller = new AbortController();
  const key = controllerKey(client.id, requestId);
  wsRunControllers.set(key, controller);

  try {
    const payloadWithTenant = {
      ...(payload ?? {}),
      context: {
        ...(payload?.context ?? {}),
        tenancy: {
          mode: client.tenantContext?.mode ?? tenancyConfig.mode,
          source: client.tenantContext?.source ?? "ws",
          host: client.tenantContext?.host ?? null,
          domain: client.tenantContext?.domain ?? null,
          instanceId: client.tenantContext?.instance?.id ?? null
        }
      }
    };

    const result = await executeRunRequest(payloadWithTenant, {
      signal: controller.signal,
      tenantContext: client.tenantContext ?? null,
      progress: (entry) => {
        sendWsJson(client, {
          type: "runtime.run_node.progress",
          requestId,
          ...entry
        });
      },
      stream: (event) => {
        sendWsJson(client, {
          type: "runtime.run_node.event",
          requestId,
          event
        });
      }
    });

    sendWsJson(client, {
      type: "runtime.run_node.completed",
      requestId,
      result
    });
  } catch (error) {
    const normalized = toProxyError(error);
    sendWsJson(client, {
      type: "runtime.run_node.failed",
      requestId,
      error: normalized.message,
      code: normalized.code,
      details: normalized.details ?? null
    });
  } finally {
    wsRunControllers.delete(key);
  }
};

const writeUpgradeError = (socket, statusCode, statusText, payload = null) => {
  const body = payload ? JSON.stringify(payload) : "";
  const lines = [
    `HTTP/1.1 ${statusCode} ${statusText}`,
    "Connection: close",
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
    "\r\n"
  ];
  socket.write(lines.join("\r\n"));
  if (body) socket.write(body);
  socket.destroy();
};

const handleUpgrade = async (req, socket) => {
  const pathname = (() => {
    try {
      return new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return req.url ?? "";
    }
  })();

  if (pathname !== "/api/mindgraph/runtime/ws") {
    writeUpgradeError(socket, 404, "Not Found", toErrorPayload(new ProxyError("PROXY_NOT_FOUND", "Not found", { status: 404 })));
    return;
  }

  try {
    requireUpgradeAuth(req);
  } catch (error) {
    writeUpgradeError(socket, 401, "Unauthorized", toErrorPayload(error));
    return;
  }

  const tenantResolution = await tenantResolver.resolve(req);
  if (!tenantResolution?.ok) {
    const error = new ProxyError(
      tenantResolution?.error?.code ?? "TENANT_RESOLUTION_FAILED",
      tenantResolution?.error?.message ?? "Tenant resolution failed",
      { status: tenantResolution?.error?.status ?? 400, details: tenantResolution?.error?.details ?? null }
    );
    writeUpgradeError(socket, error.status, "Bad Request", toErrorPayload(error));
    return;
  }

  const wsKey = req.headers["sec-websocket-key"];
  if (!wsKey) {
    writeUpgradeError(socket, 400, "Bad Request", toErrorPayload(new ProxyError("PROXY_WS_KEY_MISSING", "Missing websocket key", { status: 400 })));
    return;
  }

  const accept = crypto.createHash("sha1").update(`${wsKey}${WS_GUID}`).digest("base64");
  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ];

  socket.write(headers.join("\r\n"));

  const client = {
    id: `ws_${Date.now()}_${++wsClientSeq}`,
    socket,
    buffer: Buffer.alloc(0),
    tenantContext: tenantResolution.context
  };

  wsClients.set(client.id, client);

  socket.on("data", (chunk) => parseWsFrames(client, chunk));
  socket.on("error", () => {
    wsClients.delete(client.id);
  });
  socket.on("close", () => {
    wsClients.delete(client.id);
    for (const [key, controller] of wsRunControllers.entries()) {
      if (!key.startsWith(`${client.id}:`)) continue;
      controller.abort();
      wsRunControllers.delete(key);
    }
  });
};

const server = http.createServer(async (req, res) => {
  const pathname = (() => {
    try {
      return new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      return req.url ?? "";
    }
  })();

  const requestOrigin = asTrimmed(req?.headers?.origin, "");
  if (requestOrigin && !originAllowed(requestOrigin)) {
    writeProxyError(req, res, new ProxyError("PROXY_ORIGIN_NOT_ALLOWED", "Request origin is not allowed", { status: 403 }));
    return;
  }

  if (req.method === "OPTIONS") {
    const allowed = withCors(req, res);
    if (!allowed) {
      writeProxyError(req, res, new ProxyError("PROXY_ORIGIN_NOT_ALLOWED", "Request origin is not allowed", { status: 403 }));
      return;
    }
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/api/mindgraph/health") {
    writeJson(req, res, 200, {
      ok: true,
      service: "mindgraph-provider-proxy",
      now: nowIso(),
      wsClients: wsClients.size,
      tenancyMode: tenancyConfig.mode,
      strictHostMatch: tenancyConfig.strictHostMatch
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/mindgraph/runtime/run-node") {
    try {
      requireHttpAuth(req);
      const tenantResolution = await tenantResolver.resolve(req);
      if (!tenantResolution?.ok) {
        throw new ProxyError(
          tenantResolution?.error?.code ?? "TENANT_RESOLUTION_FAILED",
          tenantResolution?.error?.message ?? "Tenant resolution failed",
          { status: tenantResolution?.error?.status ?? 400, details: tenantResolution?.error?.details ?? null }
        );
      }

      const payload = await readJsonBody(req);
      const payloadWithTenant = {
        ...(payload ?? {}),
        context: {
          ...(payload?.context ?? {}),
          tenancy: {
            mode: tenantResolution.context.mode,
            source: tenantResolution.context.source,
            host: tenantResolution.context.host,
            domain: tenantResolution.context.domain,
            instanceId: tenantResolution.context.instance.id
          }
        }
      };
      const result = await executeRunRequest(payloadWithTenant, {
        tenantContext: tenantResolution.context
      });
      writeJson(req, res, 200, result);
    } catch (error) {
      writeProxyError(req, res, error);
    }
    return;
  }

  writeProxyError(req, res, new ProxyError("PROXY_NOT_FOUND", "Not found", { status: 404 }));
});

server.on("upgrade", (req, socket) => {
  void handleUpgrade(req, socket).catch(() => {
    socket.destroy();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mindgraph-proxy] listening on http://${HOST}:${PORT}`);
  console.log("[mindgraph-proxy] routes: POST /api/mindgraph/runtime/run-node, WS /api/mindgraph/runtime/ws");
  console.log(
    `[mindgraph-proxy] tenancy mode=${tenancyConfig.mode} strictHostMatch=${String(tenancyConfig.strictHostMatch)}`
  );
  console.log(
    `[mindgraph-proxy] control db client=${controlStore.client} file=${controlDbConfig.file ?? "(n/a)"}`
  );
});

const shutdown = async () => {
  try {
    await controlStore.close();
  } catch {
    // noop
  }
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
