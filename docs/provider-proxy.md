# Provider Proxy Server

MindGraph includes a hosted-capable runtime proxy for model execution and tenant routing.

File: `server/provider-proxy-server.mjs`

## What It Provides

- Provider calls for OpenAI / Anthropic / Gemini
- WebSocket streaming + HTTP fallback for node execution
- Host/domain tenant resolution using a control-plane DB
- Optional bearer auth for proxy access (`MINDGRAPH_PROXY_TOKEN`)
- Guardrails: request body size, prompt length, provider timeout

## Start

```bash
cd /Users/cdr/Projects/mindgraph
node server/provider-proxy-server.mjs
```

## Core Environment Variables

Proxy transport/security:

- `MINDGRAPH_PROXY_HOST` (default `127.0.0.1`)
- `MINDGRAPH_PROXY_PORT` (default `8787`)
- `MINDGRAPH_PROXY_ALLOW_ORIGIN` (default local allowlist; use `*` for unrestricted)
- `MINDGRAPH_PROXY_TOKEN` (optional bearer token for HTTP + WS access)
- `MINDGRAPH_PROXY_REQUEST_TIMEOUT_MS` (default `45000`)
- `MINDGRAPH_PROXY_MAX_PROMPT_CHARS` (default `16000`)

Tenancy routing:

- `TENANCY_MODE` (`local` default, or `hybrid` / `hosted`)
- `TENANCY_STRICT_HOST_MATCH` (defaults to `true` in hosted mode)
- `TENANCY_TRUST_FORWARDED_HOST` (`false` default)
- `TENANCY_ALLOW_OVERRIDE` (`false` default)
- `TENANCY_OVERRIDE_HEADER` (default `x-tenant-id`)
- `TENANCY_OVERRIDE_QUERY_PARAM` (default `tenant_id`)
- `TENANCY_BOOTSTRAP_HOST` (default `localhost`)
- `TENANCY_BOOTSTRAP_DOMAIN` (default `localhost`)

Control-plane DB (global app DB):

- `CONTROL_DB_CLIENT` (`sqlite` default; `mysql` supported)
- `CONTROL_DB_FILE` (sqlite path, default `./data/mindgraph-control.sqlite`)
- `CONTROL_DB_HOST`, `CONTROL_DB_PORT`, `CONTROL_DB_USER`, `CONTROL_DB_PASSWORD`, `CONTROL_DB_NAME` (for mysql)

Provider fallback keys:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`

## Control-Plane Tables

The proxy maintains a global tenancy registry:

- `customers`
- `instances`
- `instance_domains`

Each `instances` row includes tenant-specific DB connection metadata (`db_client`, `db_config_json`) for per-tenant data isolation.

## Endpoints

- `GET /api/mindgraph/health`
- `POST /api/mindgraph/runtime/run-node`
- `WS /api/mindgraph/runtime/ws`

## WebSocket Protocol

Client -> server:

- `runtime.run_node.request`
- `runtime.run_node.cancel`
- `runtime.cancel_all.request`

Server -> client:

- `runtime.run_node.event`
- `runtime.run_node.progress`
- `runtime.run_node.completed`
- `runtime.run_node.failed`

`runtime.run_node.event` includes provider stream event types:

- `runtime.stream.stage`
- `runtime.stream.text.delta`
- `runtime.stream.tool_call.started`
- `runtime.stream.tool_call.progress`
- `runtime.stream.tool_call.completed`
- `runtime.stream.output.final`

## Runtime Settings UI

The bottom-panel `Runtime Settings` now supports:

- provider/model/API key
- proxy token (for hosted auth)
- key persistence toggle (`Remember Keys On This Device`)

By default, secrets are session-only unless remember mode is enabled.
