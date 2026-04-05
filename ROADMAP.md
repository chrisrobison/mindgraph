# MindGraph AI Roadmap

Last updated: 2026-04

## Recently Shipped

- Semantic graph contracts for nodes/edges with role-aware port presets and schema helpers.
- Planner diagnostics with snapshot persistence and bottom-panel `Planner Diff`.
- Batch execution with dependency-aware branch parallelism, retries/backoff, fail-fast, and cancellation.
- Runtime timeline with run-session modeling, grouped node events, and filter modes (`All`, `Current Run`, `Selected Node`).
- Provider proxy integration for OpenAI / Anthropic / Gemini via HTTP + WebSocket runtime transport.
- UI quality updates:
  - running-state animations for queue/history/timeline/node badges
  - theme-adaptive toolbar icons via inline SVG + `currentColor`
  - reduced-motion safety fallbacks

## Near-Term Priorities

1. Contract enforcement depth
   - Add optional strict validation mode for contract payloads.
   - Surface actionable contract lint diagnostics in inspector and planner views.
2. Run-session durability
   - Persist explicit run-session objects, not only event traces.
   - Add resume markers and replay affordances across reloads.
3. Timeline analytics
   - Add search, saved filters, and branch-level throughput/failure metrics.
   - Support export for timeline/session summaries.

## Mid-Term Priorities

1. Runtime observability
   - Capture per-stage timing, retries, and provider telemetry in a normalized way.
   - Add roll-up metrics (latency, success rate, token/cost where available).
2. Planner performance
   - Move from full recompute to incremental planner updates for larger graphs.
3. Collaboration and sharing
   - Improve import/export flows for reusable templates and execution audits.

## Stretch / Later

1. Stronger schema tooling
   - Rich schema authoring UX and validation helpers.
2. Execution governance
   - Policy profiles for retries, failure handling, and concurrency by graph/subtree.
3. Plugin/provider extensibility
   - Cleaner adapter boundaries for external runtimes and data providers.
