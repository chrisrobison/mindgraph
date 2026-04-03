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

## Architecture

### Ownership and Mutation Discipline

1. Components/runtime publish `*.requested` intent events.
2. `graph-store` validates and applies canonical mutations.
3. `graph-store` emits typed result events (`graph.node.updated`, `graph.edge.created`, etc).
4. `graph-store` emits `graph.document.changed` with reason metadata.
5. UI renders from store snapshots.

No component directly mutates shared graph state.

### Primary Modules

- `js/store/graph-store.js`: canonical graph mutations + selection + undo/redo
- `js/store/ui-store.js`: tool/tab/panel viewport intents
- `js/store/persistence-store.js`: local autosave/restore
- `js/core/graph-document.js`: normalize + validate graph docs
- `js/core/graph-semantics.js`: node/edge contracts and semantic rules
- `js/runtime/execution-planner.js`: runnable order, readiness, blocking, cycles
- `js/runtime/mock-agent-runtime.js`: planner-driven execution mock runtime

## Graph Semantics (Implemented)

Full design note: [docs/graph-semantics.md](/Users/cdr/Projects/mindgraph/docs/graph-semantics.md)

### Node roles

- `note`: reference/context only
- `data`: structured source (non-runnable)
- `transformer`: runnable transform step
- `agent`: runnable reasoning/orchestration step
- `view`: runnable presentation step
- `action`: runnable side-effect/publish step

### Edge roles

- Execution: `depends_on`, `triggers`
- Data/context: `feeds_data`, `reads_from`, `writes_to`, `transforms`
- Hierarchy/scope: `parent_of`
- Informational: `informs`, `critiques`, `reports_to`, `references`

### Semantics alignment delivered

- Canvas connect flow now chooses default edge type from node semantics.
- Graph-store validates edge semantics at create/update time.
- Graph document validation checks node contracts + edge validity.
- Runtime planner and runtime executor use the same semantic edge model.
- Inspector shows edge semantic category/effects and validity.

## Execution Planner

Planner computes:
- runnable nodes
- topological execution order
- subtree scope by hierarchy edges
- missing dependencies
- missing input payloads
- missing required contract fields
- dependency cycles
- `ready` vs `blocked`
- stale upstream detection (`needsRerun`)

Used by:
- canvas/node readiness display
- inspector planner status
- runtime run-node/run-subtree/run-all

## Runtime Behavior

`mock-agent-runtime` now executes all runnable node types (`transformer`, `agent`, `view`, `action`) instead of only agents.

Execution flow:
1. Planner readiness check
2. Optional hydration of missing data-node providers
3. Type-specific mock execution
4. Node state update through graph-store requests (`status`, `lastOutput`, `lastRunAt`, run history)

Subtree execution:
- scope by `parent_of`
- order by execution edges
- optional stale-only mode (`partial: "stale"`)

## End-to-End Seed Workflow

Seed graph now demonstrates a concrete operational path:

`data_market_data` -> `transformer_signal_normalizer` -> `agent_strategy_synthesizer` -> `view_campaign_brief` -> `action_publish_brief`

Plus:
- `reads_from` to site config
- `parent_of` hierarchy for subtree targeting
- `references` note for contextual linkage

## UI Clarity Improvements

- Edge labels/colors now reflect semantic category.
- Edge inspector includes semantic description and effect flags.
- Node cards show planner readiness/blocked hints.
- Node inspector summary includes planner state and first blocking reason.

## Current Limitations

- Planner is in-memory and recalculated on render; no persisted plan snapshots yet.
- Validation is schema-like and lightweight, not full JSON Schema enforcement.
- Runtime remains mock execution (no external provider orchestration engine).
- Edge creation still defaults semantically (no in-drag type picker yet).

## Recommended Next Steps

1. Add explicit edge-type picker during connect drag with semantic presets.
2. Add port-level input/output typing and edge-level payload contracts.
3. Persist planner snapshots per run for traceability and debugging.
4. Add retry/backoff policies and execution cancellation semantics.
5. Introduce a non-mock runtime adapter behind the same planner interface.
