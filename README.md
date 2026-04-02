# MindGraph AI

MindGraph AI is a lightweight, framework-free visual graph workbench for modeling AI workflows in the browser.

It lets you:
- create and connect agent/data/action/view nodes
- inspect and edit node details in a structured panel
- run agent nodes through a mock runtime
- watch runtime activity and PAN events live
- save/load graph documents as JSON

## Run Locally

Use any static HTTP server (do not open `index.html` with `file://`).

```bash
cd /Users/cdr/Projects/mindgraph
python3 -m http.server 4173
```

Open:
- `http://127.0.0.1:4173`

## Why LARC/PAN

MindGraph AI uses a LARC-style architecture with a PAN event bus:
- **L**ightweight components: custom elements with local render/bind logic
- **A**ction-driven state changes: interactions emit explicit events
- **R**untime orchestration: runtime modules consume and publish domain events
- **C**omposable stores: graph/UI/persistence are event-synchronized instead of tightly coupled

PAN (`js/core/pan.js`) is the communication backbone:
- UI does not call runtime internals directly for orchestration
- stores and components subscribe to semantic events
- a live event console provides observability for every published event

## Component Architecture

Top-level shell:
- `app-shell` composes toolbar, palette, canvas, inspector, and bottom activity panel

Core UI modules:
- `top-toolbar` runtime actions, save/load, undo/redo, autosave toggle, zoom
- `left-tool-palette` tool selection and keyboard shortcut guide
- `graph-canvas` pan/zoom/drag/select/create/connect/duplicate/delete interactions
- `inspector-panel` tabbed node editing views
- `bottom-activity-panel` logs, task queue, run history, errors, PAN console

Node components:
- `note-node`, `agent-node`, `data-node`, `transformer-node`, `view-node`, `action-node`

State + services:
- `graph-store` graph document state + undo/redo history
- `ui-store` UI tab/tool/runtime panel state
- `persistence-store` localStorage autosave/restore
- `mock-agent-runtime` mock agent execution and activity publishing

## Graph Document Model

Graph documents are JSON objects with:
- `id`, `title`, `version`
- `nodes[]`
- `edges[]`
- `viewport` (`x`, `y`, `zoom`)
- `metadata`

Node shape:
- `id`, `type`, `label`, `description`, `position`, `data`, `metadata`

Edge shape:
- `id`, `type`, `source`, `target`, `label`, `metadata`

Validation and normalization are handled in:
- `js/core/graph-document.js`

## PAN Event Naming Conventions

Events follow dotted namespaces:
- `graph.*` graph state and interactions
- `toolbar.*` tool changes
- `inspector.*` inspector state
- `runtime.*` runtime lifecycle
- `activity.*` user-visible activity stream
- `task.*` runtime queue updates
- `panel.*` bottom panel UI state
- `ui.*` aggregated UI runtime state

Examples:
- `graph.node.updated`
- `graph.document.loaded`
- `runtime.agent.run.completed`
- `panel.dev.console.toggled`

## Mock Runtime Design

The runtime layer is intentionally isolated:
- `agent-runtime.js` provides a base runtime contract
- `mock-agent-runtime.js` implements deterministic simulated runs
- runtime publishes start/completion/failure/history/error events
- `data-connectors.js` and `action-executor.js` provide mock data/action behavior

This keeps UI and runtime decoupled through PAN events.

## Replacing Mock Runtime With Real AI Backend

Recommended migration path:
1. Keep PAN event contracts stable (`runtime.*`, `activity.*`, `task.*`).
2. Replace internals of `mock-agent-runtime` with real API calls.
3. Map backend run lifecycle to existing event payload shapes.
4. Keep graph document schema backward-compatible.
5. Add auth/network error handling while preserving event semantics.

Because UI already reacts to events instead of direct runtime method internals, backend replacement can happen incrementally.

## Persistence Behavior

- Manual export/import via toolbar (`Save JSON`, `Load JSON`)
- Optional localStorage autosave toggle in toolbar
- Last session restore on startup when autosave data exists
- Viewport (`x`, `y`, `zoom`) persisted as part of graph document snapshots

## Interaction Shortcuts

- `Delete` / `Backspace`: delete selected node
- `Cmd/Ctrl + D`: duplicate selected node
- `Cmd/Ctrl + Z`: undo
- `Shift + Cmd/Ctrl + Z` or `Ctrl + Y`: redo
- `Esc`: reset tool to Select, or clear selection if already Select

## Known Limitations

- No multi-select or marquee selection yet
- Edge creation still uses a prompt for edge type
- Undo/redo is snapshot-based (simple, not operation-diff optimized)
- No collaborative sync or server persistence
- No production authentication/authorization model yet

## Acceptance Checklist

Current build supports:
1. Seeded graph loads on startup (or autosaved last session)
2. Pan/select/drag/edit nodes
3. Create nodes and edges
4. Inspect and edit node details
5. Save/load JSON graph documents
6. Data node JSON preview in inspector
7. Agent runs through mock runtime
8. Live activity panel updates
9. Visible PAN event console with filtering/clear
10. Lightweight framework-free browser app
11. PAN event bus as the communication backbone
