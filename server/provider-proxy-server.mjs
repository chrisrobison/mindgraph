import crypto from "node:crypto";
import http from "node:http";

const HOST = process.env.MINDGRAPH_PROXY_HOST || "127.0.0.1";
const PORT = Number(process.env.MINDGRAPH_PROXY_PORT || 8787);
const ALLOW_ORIGIN = process.env.MINDGRAPH_PROXY_ALLOW_ORIGIN || "*";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const MAX_BODY_BYTES = 1_000_000;
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

const nowIso = () => new Date().toISOString();

const withCors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
};

const writeJson = (res, statusCode, payload) => {
  withCors(res);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
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
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
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
    throw new Error(`Missing API key for ${settings.provider}. Set it in UI settings or ${envHint}.`);
  }
};

const asErrorMessage = (error) => (error instanceof Error ? error.message : String(error));
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
    throw new Error(`OpenAI error: ${await parseResponseError(response)}`);
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
    throw new Error(`Anthropic error: ${await parseResponseError(response)}`);
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
    throw new Error(`Gemini error: ${await parseResponseError(response)}`);
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

const executeRunRequest = async (payload, { progress, stream, signal } = {}) => {
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

  emitStage("provider", `Calling ${settings.provider}/${settings.model}`);
  const providerResult = await runProvider({
    ...settings,
    prompt,
    signal
  });
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
  emitStream(STREAM_EVENT_TYPES.OUTPUT_FINAL, {
    summary: result.summary,
    confidence: result.confidence,
    output: result.output
  });
  return result;
};

const sendWsFrame = (socket, data) => {
  const payload = Buffer.from(data, "utf8");
  let header = null;

  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }

  socket.write(Buffer.concat([header, payload]));
};

const sendWsJson = (client, message) => {
  try {
    sendWsFrame(client.socket, JSON.stringify(message));
  } catch {
    // noop
  }
};

const parseWsFrames = (client, chunk) => {
  client.buffer = Buffer.concat([client.buffer, chunk]);

  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;

    if (length === 126) {
      if (client.buffer.length < offset + 2) return;
      length = client.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (client.buffer.length < offset + 8) return;
      const high = client.buffer.readUInt32BE(offset);
      const low = client.buffer.readUInt32BE(offset + 4);
      if (high !== 0) {
        client.socket.destroy();
        return;
      }
      length = low;
      offset += 8;
    }

    if (!masked) {
      client.socket.destroy();
      return;
    }

    if (client.buffer.length < offset + 4 + length) return;

    const mask = client.buffer.subarray(offset, offset + 4);
    offset += 4;

    const payload = client.buffer.subarray(offset, offset + length);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }

    client.buffer = client.buffer.subarray(offset + length);

    if (opcode === 0x8) {
      client.socket.end();
      return;
    }

    if (opcode === 0x9) {
      client.socket.write(Buffer.from([0x8a, 0x00]));
      continue;
    }

    if (opcode !== 0x1) {
      continue;
    }

    let message = null;
    try {
      message = JSON.parse(payload.toString("utf8"));
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
    const result = await executeRunRequest(payload, {
      signal: controller.signal,
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
    sendWsJson(client, {
      type: "runtime.run_node.failed",
      requestId,
      error: asErrorMessage(error)
    });
  } finally {
    wsRunControllers.delete(key);
  }
};

const handleUpgrade = (req, socket) => {
  if (req.url !== "/api/mindgraph/runtime/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const wsKey = req.headers["sec-websocket-key"];
  if (!wsKey) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
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
    buffer: Buffer.alloc(0)
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
  if (req.method === "OPTIONS") {
    withCors(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/mindgraph/health") {
    writeJson(res, 200, {
      ok: true,
      service: "mindgraph-provider-proxy",
      now: nowIso(),
      wsClients: wsClients.size
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/mindgraph/runtime/run-node") {
    try {
      const payload = await readJsonBody(req);
      const result = await executeRunRequest(payload);
      writeJson(res, 200, result);
    } catch (error) {
      writeJson(res, 400, {
        ok: false,
        error: asErrorMessage(error),
        at: nowIso()
      });
    }
    return;
  }

  writeJson(res, 404, {
    ok: false,
    error: "Not found"
  });
});

server.on("upgrade", (req, socket) => {
  try {
    handleUpgrade(req, socket);
  } catch {
    socket.destroy();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[mindgraph-proxy] listening on http://${HOST}:${PORT}`);
  console.log("[mindgraph-proxy] routes: POST /api/mindgraph/runtime/run-node, WS /api/mindgraph/runtime/ws");
});
