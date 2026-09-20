# Cloud Provider Edge Proxy

MindGraph runs entirely client-side by default, using [WebLLM](https://webllm.mlc.ai/)
for in-browser inference. The edge proxy is an **optional** component for
users who want to route agent nodes to a cloud model (OpenAI / Anthropic /
Gemini) instead.

File: `edge/llm-proxy.mjs`

## What It Provides

- A single stateless endpoint: `POST /api/llm`
- Server-side API key handling for OpenAI, Anthropic, and Gemini
- Optional bearer-token auth for proxy access (`PROXY_AUTH_TOKEN`)
- CORS allowlisting, request size limits, and a provider request timeout

It intentionally has **no database, no WebSocket transport, and no
multi-tenancy** — those all belonged to the retired `server/provider-proxy-server.mjs`
and were removed when checkpoints and the workflow library moved to
IndexedDB and cloud calls moved to this stateless proxy.

## Run

Works unmodified across several runtimes:

```bash
node edge/llm-proxy.mjs                                    # local dev (node:http)
wrangler dev edge/llm-proxy.mjs                             # Cloudflare Workers
vercel dev                                                  # Vercel Edge Functions
deno run --allow-net --allow-env edge/llm-proxy.mjs         # Deno Deploy
```

Or via the npm script (local dev only):

```bash
npm run start:edge
```

## Environment Variables

- `OPENAI_API_KEY` — OpenAI secret key
- `ANTHROPIC_API_KEY` — Anthropic secret key
- `GEMINI_API_KEY` — Google Gemini secret key
- `PROXY_AUTH_TOKEN` — optional bearer token clients must send
- `ALLOWED_ORIGINS` — comma-separated allowed CORS origins (default `*`)
- `PORT` — Node-mode listen port (default `3001`)
- `HOST` — Node-mode listen host (default `127.0.0.1`)

## Request

```
POST /api/llm
Content-Type: application/json
Authorization: Bearer <PROXY_AUTH_TOKEN>   (only if configured)

{
  "provider": "openai" | "anthropic" | "gemini",   // default "openai"
  "model": "gpt-4.1-mini",                          // default per-provider
  "messages": [{ "role": "user", "content": "..." }],
  "temperature": 0.3,                               // 0–2
  "maxTokens": 800                                  // 64–8192
}
```

## Response

```json
{ "ok": true, "provider": "openai", "model": "gpt-4.1-mini", "text": "...", "summary": "...", "generatedAt": "2026-09-19T00:00:00.000Z" }
```

or, on failure:

```json
{ "ok": false, "error": { "code": "PROVIDER_ERROR", "message": "..." } }
```

## Runtime Settings UI

The bottom-panel `Runtime Settings` panel supports switching between
`webllm`, `mock`, and `http` (proxy-backed cloud) modes, and configuring
provider/model/API key/endpoint for `http` mode. Secrets are session-only
by default; persistence requires the explicit `Remember Keys On This
Device` opt-in.
