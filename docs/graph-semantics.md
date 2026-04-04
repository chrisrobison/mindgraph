# MindGraph Graph Semantics

This document defines the semantic model currently implemented in MindGraph AI.

## 1. Node Model

| Node type | Role | Runnable | Required data keys | Default input ports | Default output ports |
|---|---|---|---|---|---|
| `note` | reference/context | no | none | none | `reference:string` |
| `data` | data source/sink | no | `sourceType`, `sourcePath`, `refreshMode` | none | `dataset:object` |
| `transformer` | deterministic transform | yes | `transformExpression` | `input:object` (required) | `output:object` |
| `agent` | reasoning/orchestration | yes | `role`, `mode` | `context:object` (required) | `response:object` |
| `view` | presentation/render | yes | `outputTemplate` | `model:object` (required) | `render:object` |
| `action` | side-effect/publish | yes | `command` | `command_input:object` (required) | `result:object` |

Node contracts are normalized in `normalizeNodeDataWithContract`.

Executable node contracts also include runtime defaults:
- `status: "idle"`
- `lastRunAt`, `lastRunSummary`, `lastOutput`
- `runtimePolicy`: `maxAttempts`, `retryBackoffMs`, `retryBackoffFactor`, `failFast`

## 2. Edge Model

### Execution edges (affect runnable order)

- `depends_on`: target must wait for source completion
- `triggers`: source completion requests downstream execution

### Data/context edges (affect input readiness)

- `feeds_data`: source output becomes target input
- `reads_from`: source consumes target data node payload
- `writes_to`: source writes payload to target sink
- `transforms`: source transforms target payload/context

### Hierarchy edges (affect subtree scope)

- `parent_of`: containment/scope relation for subtree run planning

### Informational edges (reference-only)

- `informs`, `critiques`, `reports_to`, `references`

These do not affect execution order or data readiness.

## 3. Edge Contract Model

Every edge can carry a normalized payload contract in `edge.metadata.contract`:

- `sourcePort`
- `targetPort`
- `payloadType`
- `required`
- `schema`

Contract direction is semantic-aware:
- most data edges: provider=`source`, consumer=`target`
- `reads_from`: provider=`target`, consumer=`source`

`validateEdgeSemantics` enforces:
- valid edge type for source/target node types
- endpoint existence
- self-edge rules (`references` only)
- contract port/type compatibility

## 4. Planner Rules

Implemented in `js/runtime/execution-planner.js`.

Planner computes, per scope:
- runnable node set (by node contract)
- execution graph from execution edge types
- cycle detection and topological order
- data provider dependencies
- missing dependency outputs
- missing required contract fields
- missing required input ports
- stale upstream dependencies (`needsRerun`)

Per node, planner emits:
- `ready` / `blocked`
- `blockedReasons[]`
- `upstreamDependencies[]`
- `dataProviderIds[]`
- `missingRequiredPorts[]`
- `executionOrderIndex`

## 5. Runtime Execution Semantics

`runtime-service` owns execution orchestration and subscribes to intent events:
- `runtime.agent.run.requested`
- `runtime.subtree.run.requested`
- `runtime.all.run.requested`
- `runtime.run.cancel.requested`

Behavior:
- builds planner snapshot before batch runs
- executes in planner order
- retries with backoff per node runtime policy
- respects cancellation across adapters
- propagates upstream failures through batch skips
- supports per-node fail-fast policy

Runtime adapters currently implemented:
- `mock-agent-runtime` (local planner-aware execution)
- `http-agent-runtime` (`POST {endpoint}/run-node`)

## 6. UI Semantic Visibility

Implemented UI surfaces:
- connect-drag edge chooser with semantic presets + validity hints
- edge inspector semantic category/effect flags
- edge contract editor (ports/type/required/schema)
- planner readiness status in node/inspector
- run traces tab for execution diagnostics

## 7. Persistence and Audit

`runtime-audit-store` persists runtime diagnostics into graph metadata:
- `metadata.executionAudit.plannerSnapshots`
- `metadata.executionAudit.runTraces`

Writes occur through `GRAPH_METADATA_UPDATE_REQUESTED` so `graph-store` remains canonical owner.

## 8. Implemented vs Planned

### Implemented now

- explicit node/edge semantic categories
- connect flow aligned with runtime/planner semantics
- port-level node IO defaults + edge payload contracts
- request-driven runtime service with retry/cancel/failure propagation
- HTTP adapter behind shared planner/executor interface
- persisted planner snapshots and run traces

### Planned next

- richer schema enforcement and schema-aware port presets
- branch-parallel planner execution
- run-session timeline UX and snapshot diffing
- richer HTTP adapter protocol (streaming/tool-call traces)
