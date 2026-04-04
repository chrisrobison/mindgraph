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

const extractTextOpenAI = (data) => {
  const choice = data?.choices?.[0]?.message?.content;
  if (typeof choice === "string" && choice.trim()) return choice.trim();
  if (Array.isArray(choice)) {
    const text = choice
      .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
      .join("\n")
      .trim();
    if (text) return text;
  }
  throw new Error("OpenAI returned no message content");
};

const extractTextAnthropic = (data) => {
  const text = (Array.isArray(data?.content) ? data.content : [])
    .map((entry) => (entry?.type === "text" ? entry.text : ""))
    .join("\n")
    .trim();
  if (text) return text;
  throw new Error("Anthropic returned no text content");
};

const extractTextGemini = (data) => {
  const text = (Array.isArray(data?.candidates) ? data.candidates : [])
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n")
    .trim();
  if (text) return text;
  throw new Error("Gemini returned no text content");
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

  return extractTextOpenAI(await response.json());
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

  return extractTextAnthropic(await response.json());
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

  return extractTextGemini(await response.json());
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

const buildRuntimeResult = ({ settings, text }) => {
  const compact = String(text ?? "").trim();
  return {
    confidence: 0.76,
    summary: compact.split(/\n+/).slice(0, 2).join(" ").slice(0, 280),
    output: {
      type: "provider_output",
      provider: settings.provider,
      model: settings.model,
      summary: compact.slice(0, 420),
      text: compact,
      generatedAt: nowIso()
    }
  };
};

const executeRunRequest = async (payload, { progress, signal } = {}) => {
  const settings = normalizeProviderSettings(payload?.context?.providerSettings ?? {});
  requireProviderConfig(settings);

  const node = payload?.node ?? {};
  const nodePlan = payload?.nodePlan ?? {};

  progress?.({ stage: "plan", message: "Planning prompt", at: nowIso(), nodeId: node?.id, runId: payload?.runId });
  const prompt = buildPrompt({ node, nodePlan, context: payload?.context ?? {} });

  progress?.({ stage: "provider", message: `Calling ${settings.provider}/${settings.model}`, at: nowIso(), nodeId: node?.id, runId: payload?.runId });
  const text = await runProvider({
    ...settings,
    prompt,
    signal
  });

  progress?.({ stage: "finalize", message: "Formatting provider output", at: nowIso(), nodeId: node?.id, runId: payload?.runId });
  return buildRuntimeResult({ settings, text });
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
