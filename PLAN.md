# MindGraph — WebLLM Migration Plan

> **Goal:** Make MindGraph runnable end-to-end in the browser by adopting
> [WebLLM](https://webllm.mlc.ai/) as the default inference provider, while
> preserving optional cloud-provider fallback (OpenAI / Anthropic / Gemini)
> behind a *minimal stateless* proxy. The existing 1062-line Node provider
> server gets retired in favor of a tiny edge function (or removed
> entirely, if no cloud fallback is configured).

## Guiding principles

1. **Browser-first.** The default user experience requires no backend at all.
   Open `index.html`, pick a model, run a graph.
2. **No build, no framework, no deps** still holds. WebLLM ships as a single
   ES module from a CDN (or vendored locally); the rest of the app remains
   plain modules + Web Components.
3. **Drop-in provider.** WebLLM becomes a peer of `mock` and `http` runtime
   modes. Existing graph documents continue to work unchanged.
4. **Graceful degradation.** No WebGPU → hide WebLLM, fall back to mock or
   cloud. No internet on first load → clear error, don't soft-fail.
5. **Delete more than we add.** Net code change should be negative once the
   migration completes.

---

## Architecture target

```
┌──────────── Browser ─────────────┐
│  index.html                      │
│   ├─ Web Components UI           │
│   ├─ js/store/* (canonical doc)  │
│   ├─ js/runtime/                 │
│   │    ├─ mock-agent-runtime     │  ← mode: "mock"
│   │    ├─ webllm-agent-runtime   │  ← mode: "webllm"  (NEW, default)
│   │    └─ http-agent-runtime     │  ← mode: "http"    (optional)
│   └─ IndexedDB                   │
│        ├─ workflow library       │
│        ├─ checkpoint store       │  ← moved from server
│        └─ WebLLM model cache     │
└──────────────────────────────────┘
              │  optional
              ▼
┌──── Edge proxy (stateless) ──────┐
│  POST /api/llm                   │
│   - body: { provider, model,     │
│            messages, settings }  │
│   - returns JSON or SSE stream   │
│   - reads provider key from env  │
└──────────────────────────────────┘
```

`server/` shrinks from ~2865 lines to ~150 lines (or zero) — only the
optional cloud-provider proxy remains; tenancy, control DB, WebSocket
framing, and the checkpoint store all go away or move client-side.

---

## Milestones

Each milestone is independently shippable. Acceptance criteria are stated
as observable behaviors; don't mark complete until they're true.

### M1 — WebLLM adapter (foundation)

Build the new runtime adapter and verify it works end-to-end in isolation
before touching UI.

**Deliverables**
- `js/runtime/webllm-agent-runtime.js` — `WebLLMAgentRuntime` extends
  `AgentRuntime`, implements `runNode`, `runSubtree`, `runAll`, `cancelAll`.
  Mirrors the structure of `http-agent-runtime.js` but calls WebLLM in-process.
- `js/runtime/webllm-engine.js` — singleton wrapper around `@mlc-ai/web-llm`
  exposing `initEngine(modelId, onProgress)`, `chat(messages, opts, signal)`,
  `getActiveModelId()`, and `isEngineReady()`. Lazy-loaded so the WebLLM
  bundle is not paid for in mock or http modes.
- `js/runtime/webllm-model-catalog.js` — exported list of supported model
  IDs, sizes, and human-readable labels (see "Models" below).
- Vendored or CDN-loaded `@mlc-ai/web-llm` ES module. Vendor at
  `vendor/web-llm/` if size is reasonable; otherwise import from
  `https://esm.run/@mlc-ai/web-llm` with a documented fallback.

**Acceptance**
- A new test `tests/webllm-agent-runtime.test.mjs` runs in `node --test`
  with the engine module stubbed. Verifies adapter contract: required
  methods exist, `runNode` publishes the expected PAN events, errors
  surface as `RUNTIME_NODE_FAILED`.
- Manual: from the browser console, instantiating the runtime and calling
  `runNode("<agent-node-id>")` against a real cached model produces a
  result attached to the node.

### M2 — Wire WebLLM into `RuntimeService`

Make WebLLM a first-class mode peer of `mock` / `http`.

**Deliverables**
- `runtime-service.js`: register `webllm` adapter, add to
  `getAvailableModes()` → `["mock", "webllm", "http"]`, persist via existing
  `runtimeMode` storage key.
- `js/store/ui-store.js`: extend provider enum to accept `"webllm"`.
  `defaultModelForProvider("webllm")` returns the catalog default.
  Provider settings sanitizer treats WebLLM specially: no `apiKey` field,
  no `proxyToken`, but does carry `model` (selected WebLLM model id).
- WebGPU capability probe in `js/runtime/webllm-engine.js`. Expose
  `isWebGpuAvailable()` for the UI and runtime-service to consult.

**Acceptance**
- Switching mode via `runtimeService.setMode("webllm")` runs the next node
  through the WebLLM adapter.
- On a browser without WebGPU, `getAvailableModes()` omits `"webllm"` and
  the UI hides it.
- `tests/runtime-service.test.mjs` (or equivalent) updated to cover mode
  switching.

### M3 — Settings UI: model picker + download progress

Make WebLLM usable from the UI without dropping to the console.

**Deliverables**
- Inspector / runtime settings panel gains a model dropdown when
  `provider === "webllm"`. Options come from the catalog.
- First-time model use triggers a non-blocking download dialog with a
  progress bar (WebLLM's `initProgressCallback` reports percentage + stage).
  Cached models load silently.
- Settings persist via the existing `mindgraph.runtime.provider.settings`
  key — no new storage schema.
- Capability indicator: if WebGPU is unavailable, show a single inline
  notice with the actual blocker ("This browser does not support WebGPU"
  / "Insufficient device memory").

**Acceptance**
- Pick a model in the UI → progress dialog appears on first use → model
  caches → subsequent runs are instant.
- Cold-load timing logged to activity log (`provider: webllm, model: …,
  load: 14.2s, cached: false`).
- Switching from `openai` → `webllm` in settings doesn't 404 or throw.

### M4 — Make WebLLM the default

Once M1–M3 are solid, flip the default.

**Deliverables**
- `js/store/ui-store.js`: `sanitizeProvider` defaults to `"webllm"` if
  WebGPU is available, otherwise `"mock"`.
- `runtime-service.js`: default mode `"webllm"` if available, else `"mock"`.
- README: update Quick Start to "open `index.html` and pick a model" —
  no `npm start` required for default usage.
- Demo seed workflows revalidated to ensure their default prompts produce
  sensible output on a small local model (Llama 3.2 3B baseline).

**Acceptance**
- Fresh-install user (no prior localStorage) lands on WebLLM mode.
- All bundled demo workflows complete successfully end-to-end on the
  default model.

### M5 — Move checkpoint store to IndexedDB

Eliminate the server's role in human-in-the-loop approvals.

**Deliverables**
- `js/store/checkpoint-store.js` — new store backed by IndexedDB. API
  mirrors current server endpoints: `create`, `list`, `get`, `resolve`.
- `js/runtime/checkpoint-executor.js` updated to call the local store
  instead of the HTTP proxy.
- `approval.html` updated to read/write through IndexedDB (or pure
  same-origin postMessage if cross-tab is desired).
- Migration shim: if older graphs reference a checkpoint URL on a remote
  server, read once and import into IndexedDB.

**Acceptance**
- A graph with a checkpoint node pauses, opens `approval.html`, the user
  approves, the graph resumes — with the dev server **off**.
- Existing `tests/checkpoint-*.test.mjs` (if any) updated and passing.

### M6 — Edge proxy for cloud providers

Replace `server/provider-proxy-server.mjs` (and all of `server/tenancy/`)
with a single stateless function.

**Deliverables**
- `edge/llm-proxy.mjs` — single-file function exporting a default handler
  suitable for Cloudflare Workers, Vercel Edge, Deno Deploy, or `node:http`
  in dev. ~150 lines. Accepts JSON body `{ provider, model, messages,
  settings }`, returns JSON (or SSE if `stream: true`). Reads provider
  keys from env. No DB, no checkpoint store, no WebSocket.
- `js/runtime/http-agent-runtime.js` updated to call the new endpoint and
  drop all WebSocket code paths.
- `server/` directory: legacy files marked deprecated; new structure
  documented.

**Acceptance**
- `edge/llm-proxy.mjs` runs as `node edge/llm-proxy.mjs` (dev),
  `wrangler dev` (Cloudflare), and `vercel dev` (Vercel) with no
  modification.
- Cloud-provider mode (`runtimeService.setMode("http")` with
  provider=anthropic) produces output identical to today.
- All existing server tests either ported, deleted with justification, or
  flagged as no-longer-applicable.

### M7 — Cleanup & deprecate Node server

**Deliverables**
- Delete or archive `server/provider-proxy-server.mjs`,
  `server/runtime/ws-protocol.mjs`, and `server/tenancy/`.
- Remove `npm start` scripts that launched the old server. Add scripts to
  launch the edge proxy locally.
- README rewritten: opening sentence is "Open `index.html`. No backend
  required." Cloud-fallback section deferred to "Advanced".
- `CHANGELOG.md` entry (or top-level `RELEASE_NOTES.md`) summarizing the
  migration.

**Acceptance**
- `git grep -i "websocket\|provider-proxy-server\|tenancy"` returns only
  history / changelog references.
- README quick-start works on a clean clone with no `npm install`.
- A first-time user can run the app without ever opening a terminal.

---

## Models (initial catalog)

Picked for size/quality balance. All run on WebLLM's standard model URLs.

| ID                                              | Size    | Use                                       |
|-------------------------------------------------|---------|-------------------------------------------|
| `Llama-3.2-3B-Instruct-q4f16_1-MLC`             | ~2.0 GB | **Default** — runs on most laptops        |
| `Phi-3.5-mini-instruct-q4f16_1-MLC`             | ~2.2 GB | Fastest, slightly weaker reasoning        |
| `Qwen2.5-7B-Instruct-q4f16_1-MLC`               | ~4.5 GB | Best reasoning + tool calls in <8GB tier |
| `Llama-3.1-8B-Instruct-q4f16_1-MLC`             | ~5.0 GB | Highest local quality, needs decent GPU   |
| `Hermes-3-Llama-3.2-3B-q4f16_1-MLC`             | ~2.0 GB | Better function-calling fine-tune         |

Catalog lives in code (`js/runtime/webllm-model-catalog.js`) — easy to
add/remove without changing UI.

---

## Risks & mitigations

| Risk                                          | Mitigation                                        |
|-----------------------------------------------|---------------------------------------------------|
| WebGPU not available (older browsers)         | Detect, hide WebLLM, default to mock or http      |
| Multi-GB first-load surprise                  | Clear progress dialog, size shown before download |
| Small local models underperform on complex nodes | Hybrid: user can switch single nodes to cloud   |
| WebLLM API changes                            | Pin to a specific version; vendor if practical    |
| Tool-calling reliability on small models      | M1 acceptance includes tool-use smoke test        |
| Existing graphs referencing removed server endpoints | M5 includes migration shim                  |

---

## Out of scope (for now)

- Multimodal inputs (images, audio) — WebLLM models in the catalog are
  text-only.
- Mobile support — WebGPU on mobile is too inconsistent for v1.
- Model fine-tuning or LoRA loading.
- Replacing the dev static-file server (current `python3 -m http.server`
  remains fine).
- Auth / multi-user — the new edge proxy is single-tenant by design.

---

## Status

- [x] M1 — WebLLM adapter (`js/runtime/webllm-agent-runtime.js`, `webllm-engine.js`, `webllm-model-catalog.js`, 10 tests)
- [x] M2 — Wire into RuntimeService (`getAvailableModes()` gated on WebGPU, `setWebLLMModelId`)
- [x] M3 — Settings UI + progress dialog (`webllm-model-download-dialog.js`, model picker, WebGPU notice)
- [x] M4 — Make WebLLM the default (new-user default = webllm when WebGPU available)
- [x] M5 — Checkpoint store → IndexedDB (`checkpoint-store.js`, `approval.html` rewritten, BroadcastChannel cross-tab sync)
- [x] M6 — Edge proxy (`edge/llm-proxy.mjs`, `http-agent-runtime.js` ported to POST `/api/llm`, all WS code removed)
- [x] M7 — Cleanup (`server/` deleted, `tests/server-tenancy`, `tests/ws-protocol`, `tests/provider-proxy-config` deleted, `npm start:edge` replaces `start:proxy`, package version bumped to 0.2.0)
