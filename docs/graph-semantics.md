# MindGraph Graph Semantics

This document defines the operational semantics currently implemented in MindGraph AI.

## Node Types

| Node type | Role | Runnable | Contract highlights |
|---|---|---|---|
| `note` | Reference/context | No | Optional tags/color only |
| `data` | Structured data source | No | Requires `sourceType`, `sourcePath`, `refreshMode` |
| `transformer` | Deterministic transform step | Yes | Requires `transformExpression`; requires at least 1 input source |
| `agent` | Reasoning/orchestration step | Yes | Requires `role`, `mode`; requires at least 1 input source |
| `view` | Presentation/render step | Yes | Requires `outputTemplate`; requires at least 1 input source |
| `action` | Side-effect/publish step | Yes | Requires `command`; requires at least 1 input source |

Contract defaults are normalized in `js/core/graph-semantics.js` via `normalizeNodeDataWithContract`.

## Edge Types

### Execution edges

- `depends_on`: source must complete before target can run.
- `triggers`: source completion requests target execution.

Execution planner uses these edges for dependency ordering and cycle checks.

### Data/context edges

- `feeds_data`: source output is passed to target as structured input.
- `reads_from`: source consumes target data-node payload.
- `writes_to`: source writes output to target sink.
- `transforms`: source transforms target payload/context.

Planner uses these edges to detect missing input payloads.

### Hierarchy edges

- `parent_of`: containment/scope edge for subtree execution selection.

Hierarchy edges do **not** imply execution order by themselves.

### Informational edges

- `informs`
- `critiques`
- `reports_to`
- `references`

These are reference-only and do not affect execution readiness.

## Planner Rules

Implemented in `js/runtime/execution-planner.js`:

1. Build runnable set from node type contracts (`agent`, `transformer`, `view`, `action`).
2. Build dependency graph from execution edge types (`depends_on`, `triggers`).
3. Detect cycles among runnable nodes.
4. Build topological order for runnable nodes (append leftovers if cycles exist).
5. For each runnable node compute:
   - upstream dependency ids
   - data provider ids (data-flow edges + `allowedDataSources`)
   - missing dependency outputs
   - missing provider payloads
   - missing required contract fields
   - stale upstream dependencies (`needsRerun`)
6. Mark node `ready` only when no blocking reasons exist.

## Runtime Behavior

`mock-agent-runtime` now executes all runnable node types, not only agents.

- `runNode`:
  - checks planner readiness
  - attempts to refresh missing data-node providers
  - executes type-specific mock logic
  - writes `status`, `lastOutput`, `lastRunAt`, run history through graph-store requests
- `runSubtree`:
  - scope from `parent_of`
  - order from planner execution graph
  - supports `partial: "stale"` mode for reruns
- `runAll`:
  - planner execution order across the full graph

## Implemented vs Planned

### Implemented now

- shared semantic definitions consumed by validation, canvas defaults, inspector, planner, and runtime
- edge validity checks in graph-store mutations
- planner-backed readiness/blocked state in canvas and inspector
- end-to-end seed workflow (`data -> transformer -> agent -> view -> action`)

### Planned next

- explicit edge-creation UI picker for manual type override during connect-drag
- richer port-level typing for node IO contracts
- persisted planner snapshots for history diffing and run diagnostics
- executor retry/backoff and non-mock runtime adapter
