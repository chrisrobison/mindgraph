/**
 * edge/llm-proxy.mjs — stateless LLM provider proxy
 *
 * Accepts a single POST /api/llm endpoint, calls the upstream provider
 * (OpenAI / Anthropic / Gemini) using a server-side API key, and returns
 * a JSON response.  No database, no WebSocket, no tenancy.
 *
 * Compatible runtimes (no modification required):
 *   node edge/llm-proxy.mjs                  — dev server (node:http)
 *   wrangler dev edge/llm-proxy.mjs          — Cloudflare Workers
 *   vercel dev                               — Vercel Edge Functions
 *   deno run --allow-net --allow-env edge/llm-proxy.mjs — Deno Deploy
 *
 * Environment variables:
 *   OPENAI_API_KEY       — OpenAI secret key
 *   ANTHROPIC_API_KEY    — Anthropic secret key
 *   GEMINI_API_KEY       — Google Gemini secret key
 *   PROXY_AUTH_TOKEN     — Optional bearer token clients must send
 *   ALLOWED_ORIGINS      — Comma-separated allowed CORS origins (default "*")
 *   PORT                 — Node-mode listen port (default 3001)
 *   HOST                 — Node-mode listen host (default 127.0.0.1)
 *
 * Request body (JSON):
 *   provider   — "openai" | "anthropic" | "gemini"  (default "openai")
 *   model      — provider model id (default per-provider)
 *   messages   — OpenAI-compatible message array [{ role, content }]
 *   temperature — 0–2 (default 0.3)
 *   maxTokens  — 64–8192 (default 800)
 *
 * Response (JSON):
 *   { ok: true,  text, model, provider, generatedAt }   — success
 *   { ok: false, error: { code, message } }             — error
 */

// ─── constants ──────────────────────────────────────────────────────────────

const DEFAULT_MODELS = Object.freeze({
  openai:    "gpt-4.1-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini:    "gemini-2.0-flash"
});

const PROVIDER_ENV_KEY = Object.freeze({
  openai:    "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini:    "GEMINI_API_KEY"
});

const MAX_BODY_BYTES   = 512_000;
const REQUEST_TIMEOUT_MS = 60_000;

// ─── helpers ─────────────────────────────────────────────────────────────────

const getEnv = (key) => {
  if (typeof process !== "undefined" && process.env) return process.env[key] ?? "";
  if (typeof Deno    !== "undefined")                 return Deno.env.get(key) ?? "";
  return "";               // Cloudflare Workers: env is passed per-request
};

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

const nowIso = () => new Date().toISOString();

const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders }
  });

const errorResponse = (code, message, status = 400, extraHeaders = {}) =>
  jsonResponse({ ok: false, error: { code, message } }, status, extraHeaders);

// ─── CORS ────────────────────────────────────────────────────────────────────

const buildCorsHeaders = (requestOrigin, allowedOrigins) => {
  if (!allowedOrigins || allowedOrigins === "*") {
    return { "Access-Control-Allow-Origin": "*" };
  }
  const origins = allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);
  const origin  = origins.includes(requestOrigin) ? requestOrigin : origins[0] ?? "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin"
  };
};

// ─── request parsing ─────────────────────────────────────────────────────────

const readBody = async (request) => {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw Object.assign(new Error("Request body too large"), { status: 413, code: "BODY_TOO_LARGE" });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400, code: "INVALID_JSON" });
  }
};

const normalizeRequest = (raw, envGetter) => {
  const providerRaw = String(raw?.provider ?? "openai").trim().toLowerCase();
  const provider    = providerRaw === "anthropic" || providerRaw === "gemini" ? providerRaw : "openai";
  const model       = String(raw?.model ?? DEFAULT_MODELS[provider]).trim() || DEFAULT_MODELS[provider];
  const temperature = clamp(raw?.temperature, 0, 2, 0.3);
  const maxTokens   = clamp(raw?.maxTokens,  64, 8192, 800);
  const messages    = Array.isArray(raw?.messages) ? raw.messages : [];
  const envKeyName  = PROVIDER_ENV_KEY[provider];
  const apiKey      = (raw?.apiKey ? String(raw.apiKey).trim() : "") || envGetter(envKeyName);

  if (!apiKey) {
    throw Object.assign(
      new Error(`Missing API key for ${provider}. Set ${envKeyName} on the server.`),
      { status: 401, code: "API_KEY_MISSING", provider }
    );
  }
  if (!messages.length) {
    throw Object.assign(new Error("messages array is required and must not be empty"), { status: 400, code: "MISSING_MESSAGES" });
  }

  // Derive a plain prompt string for providers that want it.
  const systemMsg = messages.find((m) => m?.role === "system")?.content ?? "";
  const userMsgs  = messages.filter((m) => m?.role !== "system");
  const prompt    = userMsgs.map((m) => String(m?.content ?? "")).join("\n\n").trim();

  return { provider, model, apiKey, temperature, maxTokens, messages, systemPrompt: systemMsg, prompt };
};

// ─── provider calls ──────────────────────────────────────────────────────────

const callOpenAI = async ({ apiKey, model, messages, temperature, maxTokens, signal }) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, temperature, max_tokens: maxTokens, messages }),
    signal
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw Object.assign(new Error(`OpenAI error: ${msg}`), { status: 502, code: "PROVIDER_ERROR" });
  }

  const data   = await res.json();
  const choice = data?.choices?.[0];
  const text   = String(choice?.message?.content ?? "").trim();
  return { text, model: data?.model ?? model };
};

const callAnthropic = async ({ apiKey, model, systemPrompt, prompt, temperature, maxTokens, signal }) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "x-api-key":       apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens:  maxTokens,
      temperature,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }]
    }),
    signal
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw Object.assign(new Error(`Anthropic error: ${msg}`), { status: 502, code: "PROVIDER_ERROR" });
  }

  const data = await res.json();
  const text = data?.content
    ?.filter((b) => b?.type === "text")
    ?.map((b) => b.text)
    ?.join("\n")
    ?.trim() ?? "";
  return { text, model };
};

const callGemini = async ({ apiKey, model, systemPrompt, prompt, temperature, maxTokens, signal }) => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      contents:       [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: maxTokens }
    }),
    signal
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    throw Object.assign(new Error(`Gemini error: ${msg}`), { status: 502, code: "PROVIDER_ERROR" });
  }

  const data  = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  const text  = parts.map((p) => p?.text ?? "").join("\n").trim();
  return { text, model };
};

const callProvider = async (params, signal) => {
  if (params.provider === "anthropic") return callAnthropic({ ...params, signal });
  if (params.provider === "gemini")    return callGemini({ ...params, signal });
  return callOpenAI({ ...params, signal });
};

// ─── main handler (Fetch API — works for CF Workers, Vercel, Deno) ───────────

/**
 * @param {Request} request
 * @param {{ [key: string]: string }} [workerEnv]  — Cloudflare Workers env binding
 */
export default async function handler(request, workerEnv) {
  const envGetter = workerEnv
    ? (key) => workerEnv[key] ?? ""
    : getEnv;

  const allowedOrigins = envGetter("ALLOWED_ORIGINS") || "*";
  const proxyAuthToken = envGetter("PROXY_AUTH_TOKEN");
  const origin         = request.headers.get("Origin") ?? "";
  const corsHeaders    = buildCorsHeaders(origin, allowedOrigins);

  // Preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only POST /api/llm
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/api/llm") {
    return errorResponse("NOT_FOUND", "POST /api/llm is the only supported endpoint.", 404, corsHeaders);
  }

  // Optional bearer auth
  if (proxyAuthToken) {
    const authHeader = request.headers.get("Authorization") ?? "";
    if (authHeader !== `Bearer ${proxyAuthToken}`) {
      return errorResponse("UNAUTHORIZED", "Invalid or missing proxy auth token.", 401, corsHeaders);
    }
  }

  try {
    const body    = await readBody(request);
    const params  = normalizeRequest(body, envGetter);
    const timeout = AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : null;
    const result  = await callProvider(params, timeout);

    const compact  = String(result.text ?? "").trim();
    const summary  = compact.split(/\n+/).slice(0, 2).join(" ").slice(0, 280) || "Provider response";

    return jsonResponse({
      ok:          true,
      provider:    params.provider,
      model:       result.model ?? params.model,
      text:        compact,
      summary,
      generatedAt: nowIso()
    }, 200, corsHeaders);

  } catch (err) {
    const status  = err?.status ?? 500;
    const code    = err?.code   ?? "INTERNAL_ERROR";
    return errorResponse(code, err.message ?? "Unexpected proxy error", status, corsHeaders);
  }
}

// ─── Node.js dev-server shim ─────────────────────────────────────────────────
// Runs when invoked directly:  node edge/llm-proxy.mjs
// Skipped in CF Workers / Vercel Edge (they import `default` only).

if (
  typeof process !== "undefined" &&
  typeof import.meta.url === "string" &&
  (process.argv[1] === new URL(import.meta.url).pathname ||
   process.argv[1]?.endsWith("/llm-proxy.mjs"))
) {
  const http = await import("node:http");
  const PORT = Number(getEnv("PORT") || 3001);
  const HOST = getEnv("HOST") || "127.0.0.1";

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();

    const request = new Request(`http://${HOST}:${PORT}${req.url}`, {
      method:  req.method,
      headers: req.headers,
      body:    req.method !== "GET" && req.method !== "HEAD" ? body : undefined
    });

    const response = await handler(request);
    const text     = await response.text();

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(text);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[mindgraph-edge-proxy] listening on http://${HOST}:${PORT}/api/llm`);
    console.log(`[mindgraph-edge-proxy] providers: OpenAI=${!!getEnv("OPENAI_API_KEY")} Anthropic=${!!getEnv("ANTHROPIC_API_KEY")} Gemini=${!!getEnv("GEMINI_API_KEY")}`);
  });
}
