# MindGraph AI

Open `index.html`. No backend required.

MindGraph AI is a browser-native, framework-free graph workbench for
operational AI workflows. Build a graph of typed nodes (data, transform,
agent, view, action, human-approval checkpoint, and more), connect them
with semantically-typed edges, and run the graph — by default entirely
client-side, using [WebLLM](https://webllm.mlc.ai/) for in-browser
inference over WebGPU. Cloud providers (OpenAI / Anthropic / Gemini) are
available as an opt-in mode behind a small stateless edge proxy.

It intentionally keeps:
- custom elements (Web Components), plain ES modules, no build step
- a PAN event bus (`js/core/pan.js`) — components publish intent, stores own mutation
- `graph-store` as the canonical graph document owner
- `ui-store` for UI-only state
- `persistence-store` for autosave/restore
- `checkpoint-store` (IndexedDB) for human-in-the-loop approval state

Roadmap: [ROADMAP.md](ROADMAP.md) · Migration history: [PLAN.md](PLAN.md)

## Run Locally

Use any static HTTP server (do not open with `file://`).

```bash
git clone https://github.com/chrisrobison/mindgraph.git
cd mindgraph
python3 -m http.server 4173
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173), pick a model in
`Runtime Settings` if prompted, and run a graph. On a first run, the chosen
WebLLM model downloads and caches in the browser (a progress dialog shows
size/stage); subsequent runs load from cache.

If your browser doesn't support WebGPU, MindGraph falls back to `mock`
mode automatically so the UI/planner remain usable without any model.

### Optional: Cloud Providers via Edge Proxy

To run agent nodes against OpenAI / Anthropic / Gemini instead of a local
model, start the stateless edge proxy in a second terminal:

```bash
npm run start:edge
```

Then in the app:
1. Set runtime mode to `HTTP Runtime` in the top toolbar.
2. Set runtime endpoint to `http://127.0.0.1:3001/api/llm` (the proxy's default).
3. Open `Runtime Settings` and configure provider, model, API key, and (optionally) proxy auth token.

Full details, environment variables, and request/response shape:
[docs/provider-proxy.md](docs/provider-proxy.md). The same proxy file also
runs unmodified on Cloudflare Workers, Vercel Edge, and Deno Deploy.

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
- `js/store/library-store.js`: named workflow library (save/browse/switch saved graphs)
- `js/store/checkpoint-store.js`: IndexedDB-backed human-in-the-loop checkpoint state, synced across tabs via `BroadcastChannel`
- `js/core/graph-document.js`: normalize + validate graph docs
- `js/core/graph-migrations.js`: schema versioning + ordered graph document migrations
- `js/core/graph-semantics.js`: node/edge contracts and semantic rules
- `js/runtime/execution-planner.js`: readiness, order, cycles, stale detection
- `js/runtime/runtime-service.js`: request-driven runtime orchestration, mode switching, retries, cancellation, propagation
- `js/runtime/mock-agent-runtime.js`: planner-aware local runtime adapter (no model calls)
- `js/runtime/webllm-agent-runtime.js` + `webllm-engine.js` + `webllm-model-catalog.js`: in-browser inference via WebGPU/WebLLM (default mode when supported)
- `js/runtime/http-agent-runtime.js`: external runtime adapter, `POST`s to the edge proxy for cloud providers
- `js/runtime/runtime-audit-store.js`: persists planner snapshots/run traces into graph metadata
- `edge/llm-proxy.mjs`: optional, stateless edge proxy for OpenAI/Anthropic/Gemini (see [docs/provider-proxy.md](docs/provider-proxy.md))

## Graph Semantics (Implemented)

Full design note: [docs/graph-semantics.md](docs/graph-semantics.md)
Provider proxy note: [docs/provider-proxy.md](docs/provider-proxy.md)

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
- role-aware port presets (with schema defaults) for contract authoring
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
- schema presets (`text`, `object`, `array`, `dataset`, `prompt`, `report`, `command_result`) with manual override support

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

- `webllm`: in-browser inference via WebGPU/WebLLM — default when the browser supports WebGPU, no backend required
- `mock`: in-browser execution against planner state, no model calls — always available, used as the fallback when WebGPU is unavailable
- `http`: delegates to the edge proxy (`edge/llm-proxy.mjs`) for cloud providers (OpenAI/Anthropic/Gemini)

The toolbar controls mode and HTTP endpoint. Mode/endpoint are persisted in local storage.
Provider settings (provider/model/api key/system prompt) are available in bottom panel `Runtime Settings`,
along with the WebLLM model picker and first-use download progress dialog.

## UI Clarity Improvements

- Connect drag now opens an edge-type chooser with semantic presets and validity hints.
- Edge inspector shows semantic category/effects, schema preset controls, and clearer compatibility errors.
- Node overview includes role-aware input/output port preset editing plus manual schema JSON editing.
- Toolbar includes a demo template picker/import action with scenario descriptions.
- Planner readiness is surfaced in node/inspector views.
- Bottom panel `Timeline` includes all/current/selected-node filters plus optional group-by-node event rendering.
- Bottom panel `Planner Diff` compares any two saved planner snapshots (status, blockers, dependencies, order, stale/rerun hints).
- Bottom panel now includes `Run Traces` alongside activity/history/errors.
- Bottom panel includes a `Runtime Settings` control panel for provider/model/API key configuration.
- Running items are visually highlighted with status animations across task queue/history/timeline and node status badges (with `prefers-reduced-motion` fallbacks).
- Left tool-palette SVG icons now inherit button color via inline `currentColor`, so icons automatically match light/dark themes.

## End-to-End Workflow (Seeded)

Seed graph demonstrates a real path:

`data_market_data` -> `transformer_signal_normalizer` -> `agent_strategy_synthesizer` -> `view_campaign_brief` -> `action_publish_brief`

With additional semantics:
- `reads_from` for config ingestion
- `depends_on` for execution ordering
- `parent_of` for subtree scope
- `references` for non-executable context links

## Demo Templates

Use the top toolbar `Import Template` picker to load these sample graphs:

1. `Research -> Brief -> Publish`
   - Flow: market research ingest -> synthesis transform -> brief drafting -> packet render -> CMS publish.
   - Demo value: explicit execution + data contracts (`feeds_data`, `reads_from`, `depends_on`) and a clean end-to-end publish path.
2. `Ingest -> Normalize -> Analyze -> Dashboard`
   - Flow: telemetry ingest -> schema normalization -> KPI analysis -> dashboard rendering.
   - Demo value: showcases semantic `transforms` + `reads_from` edges and planner-visible staging from data prep to presentation.
3. `Human Approval Gate`
   - Flow: draft recommendation -> review packet -> approval request -> gated release decision -> publish.
   - Demo value: intentionally leaves approval-state data empty so planner clearly shows `blocked` vs `ready` nodes and missing payload diagnostics.

## Audit and Trace Persistence

Runtime audit data is persisted in `document.metadata.executionAudit`:
- `plannerSnapshots` (capped)
- `runTraces` (capped)

This gives replay/debug context directly in the saved graph document.

## Graph Schema Versioning

Graph documents include a top-level integer `schemaVersion` and are migrated before normalization/validation.

- Current value is `CURRENT_GRAPH_SCHEMA_VERSION` in `js/core/graph-migrations.js`.
- Migration entrypoint is `migrateGraphDocument(...)`, called by `graphStore.load(...)`.
- `persistence-store` restore and toolbar JSON load both flow through `graphStore.load(...)`, so migration happens automatically on import/restore.
- Future schema versions fail safely with a readable migration error object (`code`, `message`, `sourceVersion`, `targetVersion`, `details`).

Migration authoring details: [docs/graph-schema-migrations.md](docs/graph-schema-migrations.md)

## Current Limitations

- Port contracts are lightweight and do not enforce full JSON Schema semantics.
- WebLLM models are text-only (no multimodal input) and are a multi-gigabyte first download; mobile WebGPU support is inconsistent, so mobile is not a supported target yet.
- The edge proxy handles single-node execution requests only (`POST /api/llm`); plan orchestration remains client-side.
- API keys are session-only by default; persistence requires explicit opt-in (`Remember Keys On This Device`).
- Planner uses in-memory recomputation each render/request (no incremental diff engine yet).
- Batch execution parallelism is intentionally bounded by a configurable concurrency limit (`metadata.runtimePolicy.batchConcurrencyLimit` or `runtimePolicy.concurrencyLimit` override).
- WebLLM (`@mlc-ai/web-llm`) is currently loaded from a CDN (`esm.run`) rather than vendored — first load requires that CDN to be reachable.

## Suggested Next Steps

1. Add stronger contract validation (optional JSON Schema validation mode, linting, and actionable fix hints).
2. Add durable run-session continuity (explicit persisted session objects, resume markers, and replay controls).
3. Add timeline analytics and export (event search/filter presets, branch-level metrics, JSON/CSV export).
4. Add deeper runtime observability (per-stage timing, token/latency/cost summaries where provider data is available).
5. Add automated UI regression coverage for theme-aware icons and runtime-status motion states.
