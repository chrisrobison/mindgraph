# No-Build Next Steps Plan

This plan implements quality and scale improvements while preserving the project constraints in [engineering-guardrails.md](/Users/cdr/Projects/mindgraph/docs/engineering-guardrails.md).

## 1. Lock Constraints in Writing

- Status: Completed
- Codify no-build + minimal-dependency guardrails.
- Make constraints explicit for future contributors.

## 2. Add IDE Type Intelligence (No Build Tooling)

- Status: Completed
- Add `jsconfig.json` with `checkJs` support.
- Add `@ts-check` and JSDoc typedef imports to core modules:
  - `js/core/graph-document.js`
  - `js/core/graph-semantics.js`
  - `js/runtime/execution-planner.js`
  - `js/store/graph-store.js`
- Add shared JSDoc type definitions for graph/planner/runtime models.

## 3. Type Event-Bus Contracts + Guard High-Risk Payloads

- Status: Completed
- Add JSDoc payload typedefs for critical events.
- Add lightweight payload guards for high-risk `*.requested` runtime/graph mutation events.
- Prefer warnings over hard crashes for malformed payloads.

## 4. Refactor Oversized Modules Without Behavior Changes

- Status: Completed
- Extract pure helper logic from large files into focused modules.
- Preserve existing public APIs and event names.

## 5. Performance Pass

- Status: Completed
- Add graph document revision tracking.
- Add planner memoization keyed by `(revision, rootNodeId)`.
- Reduce redundant deep-clone work on hot paths.

## 6. Proxy Robustness Pass

- Status: Completed
- Extract websocket protocol framing/parsing helpers into a dedicated module.
- Add focused tests for malformed frames, masking rules, and close/ping behavior.
- Add tests for cancellation/abort edge handling where practical.

## 7. Acceptance Gates

- Status: Completed
- `npm test` passes (217 passing / 0 failing).
- No mandatory build step introduced.
- No new runtime dependency unless explicitly approved.
- JSDoc coverage increases in touched modules.
