# Provider Proxy Server

MindGraph includes a lightweight Node proxy server for model execution against:

- OpenAI ChatGPT
- Anthropic Claude
- Google Gemini

File: `server/provider-proxy-server.mjs`

## Why this exists

- keeps provider API calls and CORS handling out of browser components
- centralizes provider request shaping
- provides WebSocket realtime run progress + HTTP fallback

## Start

```bash
cd /Users/cdr/Projects/mindgraph
node server/provider-proxy-server.mjs
```

Environment overrides:

- `MINDGRAPH_PROXY_HOST` (default `127.0.0.1`)
- `MINDGRAPH_PROXY_PORT` (default `8787`)
- `MINDGRAPH_PROXY_ALLOW_ORIGIN` (default `*`)

Optional provider key env vars (fallback if UI key not set):

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

## Endpoints

- `GET /api/mindgraph/health`
- `POST /api/mindgraph/runtime/run-node`
- `WS /api/mindgraph/runtime/ws`

## WebSocket protocol

Client -> server:

- `runtime.run_node.request`
- `runtime.run_node.cancel`
- `runtime.cancel_all.request`

Server -> client:

- `runtime.run_node.progress`
- `runtime.run_node.completed`
- `runtime.run_node.failed`

## Runtime settings in UI

Configure provider/model/key from bottom panel `Runtime Settings`.

Settings are persisted in browser local storage and attached to HTTP-runtime requests.
