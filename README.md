# MindGraph AI

MindGraph AI is a browser-native, framework-free graph workbench for operational AI workflows.

It intentionally keeps:
- custom elements (Web Components)
- plain ES modules
- PAN event bus
- `graph-store` as the canonical graph document owner
- `ui-store` for UI-only state
- `persistence-store` for autosave/restore

## Run Locally

Use any static HTTP server (do not open with `file://`).

```bash
cd /Users/cdr/Projects/mindgraph
python3 -m http.server 4173
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

### Run Provider Proxy (OpenAI / Claude / Gemini)

In a second terminal:

```bash
cd /Users/cdr/Projects/mindgraph
node server/provider-proxy-server.mjs
```

Proxy defaults:
- HTTP health: `http://127.0.0.1:8787/api/mindgraph/health`
- Runtime HTTP endpoint: `http://127.0.0.1:8787/api/mindgraph/runtime`
- Runtime WebSocket endpoint: `ws://127.0.0.1:8787/api/mindgraph/runtime/ws`

Then in the app:
1. Set runtime mode to `HTTP Runtime` in the top toolbar.
2. Set runtime endpoint to `http://127.0.0.1:8787/api/mindgraph/runtime`.
3. Open `Provider Settings` and configure provider, model, and API key.

## Architecture

### Ownership and mutation discipline

1. Components publish `*.requested` intent events.
2. Stores/services validate + execute canonical mutations.
3. `graph-store` remains the source of truth for graph state.
4. Components render from store snapshots and result events.

No component directly mutates shared graph state.

### Primary modules

- `js/store/graph-store.js`: canonical graph mutations + selection + undo/redo + metadata updates
- `js/store/ui-store.js`: UI-only runtime/feed state (`activity`, `queue`, `history`, `traces`)
- `js/store/persistence-store.js`: autosave/restore
- `js/core/graph-document.js`: normalize + validate graph docs
- `js/core/graph-semantics.js`: node/edge contracts and semantic rules
- `js/runtime/execution-planner.js`: readiness, order, cycles, stale detection
- `js/runtime/runtime-service.js`: request-driven runtime orchestration, retries, cancellation, propagation
- `js/runtime/mock-agent-runtime.js`: planner-aware local runtime adapter
- `js/runtime/http-agent-runtime.js`: external runtime adapter (WebSocket first, HTTP fallback)
- `js/runtime/runtime-audit-store.js`: persists planner snapshots/run traces into graph metadata
- `server/provider-proxy-server.mjs`: provider proxy for OpenAI/Anthropic/Gemini (HTTP + WS)

## Graph Semantics (Implemented)

Full design note: [docs/graph-semantics.md](/Users/cdr/Projects/mindgraph/docs/graph-semantics.md)
Provider proxy note: [docs/provider-proxy.md](/Users/cdr/Projects/mindgraph/docs/provider-proxy.md)

### Node roles

- `note`: reference/context only
- `data`: structured source/sink node (non-runnable)
- `transformer`: runnable deterministic transform
- `agent`: runnable reasoning/orchestration
- `view`: runnable presentation/render
- `action`: runnable side-effect/publish

Node contracts are normalized via `normalizeNodeDataWithContract` and validated via `validateNodeContract`, including:
- required fields by node type
- `inputPorts` / `outputPorts`
- runtime policy defaults (`maxAttempts`, `retryBackoffMs`, `retryBackoffFactor`, `failFast`)

### Edge roles

- Execution edges: `depends_on`, `triggers`
- Data/context edges: `feeds_data`, `reads_from`, `writes_to`, `transforms`
- Hierarchy edges: `parent_of`
- Informational edges: `informs`, `critiques`, `reports_to`, `references`

Edge contracts are normalized and validated at create/update time:
- `sourcePort`
- `targetPort`
- `payloadType`
- `required`
- `schema`

## Planner and Execution Model

Planner answers:
- runnable vs blocked
- upstream dependencies
- missing input payloads
- missing required ports
- cycle detection
- subtree scope by hierarchy
- stale dependency rerun hints

Runtime service behavior:
- handles `runtime.*.requested` events (`run node`, `run subtree`, `run all`, `cancel`)
- applies retry/backoff from node runtime policy
- supports cancellation across adapters
- propagates upstream failures during batch plans
- supports fail-fast per node policy
- injects provider/model/key settings from UI into HTTP runtime requests

### Runtime modes

- `mock`: in-browser execution against planner state
- `http`: delegates to external runtime endpoint over WebSocket (fallback HTTP)

The toolbar controls mode and HTTP endpoint. Mode/endpoint are persisted in local storage.
Provider settings (provider/model/api key/system prompt) are available in bottom panel `Runtime Settings`.

## UI Clarity Improvements

- Connect drag now opens an edge-type chooser with semantic presets and validity hints.
- Edge inspector shows semantic category/effects and payload contract fields.
- Planner readiness is surfaced in node/inspector views.
- Bottom panel now includes `Run Traces` alongside activity/history/errors.
- Bottom panel includes a `Runtime Settings` control panel for provider/model/API key configuration.

## End-to-End Workflow (Seeded)

Seed graph demonstrates a real path:

`data_market_data` -> `transformer_signal_normalizer` -> `agent_strategy_synthesizer` -> `view_campaign_brief` -> `action_publish_brief`

With additional semantics:
- `reads_from` for config ingestion
- `depends_on` for execution ordering
- `parent_of` for subtree scope
- `references` for non-executable context links

## Audit and Trace Persistence

Runtime audit data is persisted in `document.metadata.executionAudit`:
- `plannerSnapshots` (capped)
- `runTraces` (capped)

This gives replay/debug context directly in the saved graph document.

## Current Limitations

- Port contracts are lightweight and do not enforce full JSON Schema semantics.
- Proxy server currently supports single-node execution requests (`run-node`) and sequential plan execution.
- API keys are stored in browser local storage for local development convenience.
- Planner uses in-memory recomputation each render/request (no incremental diff engine yet).
- Batch execution is currently sequential, not parallelized by independent DAG branches.

## Suggested Next Steps

1. Add editable per-port schema templates in inspector (with typed presets).
2. Add planner diff views between snapshots for run-to-run diagnosis.
3. Add resumable run sessions with explicit run IDs and timeline filtering.
4. Add branch-parallel execution for independent DAG segments.
5. Expand HTTP adapter contract to support streaming outputs and structured tool traces.
