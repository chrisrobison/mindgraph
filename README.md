# MindGraph AI

MindGraph AI is a lightweight, framework-free visual graph workbench for modeling AI workflows in the browser.

It keeps a browser-native stack:
- custom elements (Web Components)
- plain ES modules
- PAN event bus for app-wide coordination
- centralized graph state in `graph-store`

## Run Locally

Use any static HTTP server (do not open `index.html` with `file://`).

```bash
cd /Users/cdr/Projects/mindgraph
python3 -m http.server 4173
```

Open:
- `http://127.0.0.1:4173`

## Core Architecture

### State Ownership Rules

MindGraph now follows strict ownership rules:
- `graph-store` is the single source of truth for graph document mutations.
- PAN carries intent events (`*.requested`) and state/result events (`*.changed`, `*.created`, `*.updated`, etc).
- UI components render from graph-store snapshots and store-driven events.
- UI components keep only ephemeral interaction state (drag, pan, marquee, connect-mode context).

### Responsibilities

- `graph-store`
  - owns nodes, edges, viewport, selection, undo/redo history
  - consumes graph intent events and applies canonical mutations
  - publishes state-change events + `graph.document.changed`
- `ui-store`
  - owns UI-only state (tool/tab/dev-console/runtime panels)
  - emits graph intent events for selection/zoom actions
- `persistence-store`
  - listens to `graph.document.changed` and save/load events
  - handles autosave/restore to `localStorage`
- runtime modules (`mock-agent-runtime`, `data-connectors`)
  - read graph data from `graph-store`
  - request graph updates via `graph.node.update.requested`
  - publish runtime lifecycle and activity events
- components
  - publish intent events
  - subscribe to state/result events
  - render based on store state

## Event Model

### Intent / Request Events

Examples:
- `graph.node.select.requested`
- `graph.node.update.requested`
- `graph.node.move.requested`
- `graph.node.create.requested`
- `graph.node.delete.requested`
- `graph.edge.create.requested`
- `graph.selection.clear.requested`
- `graph.selection.set.requested`
- `graph.viewport.update.requested`
- `graph.document.load.requested`
- `graph.document.save.requested`
- `graph.document.undo.requested`
- `graph.document.redo.requested`
- `runtime.agent.run.requested`
- `runtime.subtree.run.requested`
- `runtime.all.run.requested`

### State / Result Events

Examples:
- `graph.node.selected`
- `graph.selection.set`
- `graph.selection.cleared`
- `graph.node.updated`
- `graph.node.created`
- `graph.node.deleted`
- `graph.edge.created`
- `graph.viewport.changed`
- `graph.document.loaded`
- `graph.document.saved`
- `graph.document.changed`
- `runtime.agent.run.started`
- `runtime.agent.run.completed`
- `runtime.agent.run.failed`

## Graph Mutation Flow

Canonical mutation flow:
1. Component/runtime publishes `*.requested` intent.
2. `graph-store` validates and applies mutation.
3. `graph-store` emits specific result event (`graph.node.updated`, `graph.edge.created`, etc).
4. `graph-store` emits `graph.document.changed` with reason metadata.
5. UI re-renders from store snapshots; persistence/autosave reacts to changed document events.

## Canvas Architecture

`graph-canvas` has been decomposed into focused modules:
- `js/components/graph-canvas/canvas-renderer.js`
- `js/components/graph-canvas/canvas-edges.js`
- `js/components/graph-canvas/canvas-viewport.js`
- `js/components/graph-canvas/canvas-selection.js`

The custom element now owns only ephemeral interaction state:
- active drag preview
- pan gesture
- marquee gesture
- connect-mode source
- edge-popover state

It no longer keeps a shadow graph document as a competing source of truth.

## Core User Loop Improvements

Implemented tightening of the core loop:
- create/select/edit nodes through request/state event flow
- connect edges with in-app popover (no `window.prompt`)
- shift-click additive/toggle selection
- marquee selection on empty-space drag in select tool
- `Esc` behavior:
  - close edge popover
  - clear connect source
  - reset tool to Select, or clear selection
- delete supports multi-selection

## Component Overview

Top-level shell:
- `app-shell` composes toolbar, palette, canvas, inspector, and bottom activity panel

Core UI modules:
- `top-toolbar` runtime actions, save/load, undo/redo, autosave toggle, zoom
- `left-tool-palette` tool selection and keyboard shortcut guide
- `graph-canvas` pan/zoom/drag/select/create/connect interactions
- `inspector-panel` tabbed node editing views
- `bottom-activity-panel` logs, task queue, run history, errors, PAN console

State + services:
- `graph-store` graph document state + undo/redo + canonical mutations
- `ui-store` UI tab/tool/runtime panel state
- `persistence-store` localStorage autosave/restore
- `mock-agent-runtime` mock agent execution and activity publishing

## Graph Document Model

Graph documents are JSON objects with:
- `id`, `title`, `version`
- `nodes[]`
- `edges[]`
- `viewport` (`x`, `y`, `zoom`)
- `metadata` (includes persisted selection)

Node shape:
- `id`, `type`, `label`, `description`, `position`, `data`, `metadata`

Edge shape:
- `id`, `type`, `source`, `target`, `label`, `metadata`

Validation and normalization are handled in:
- `js/core/graph-document.js`

## Persistence Behavior

- Manual export/import via toolbar (`Save JSON`, `Load JSON`)
- Optional localStorage autosave toggle in toolbar
- Last session restore on startup when autosave data exists
- Autosave watches `graph.document.changed`
- Viewport and selection are persisted in the graph document

## Interaction Shortcuts

- `Delete` / `Backspace`: delete selected node(s)
- `Cmd/Ctrl + D`: duplicate selected node
- `Cmd/Ctrl + Z`: undo
- `Shift + Cmd/Ctrl + Z` or `Ctrl + Y`: redo
- `Esc`: close connect popover / clear connect source / reset tool / clear selection
- `Shift + Click`: additive/toggle node selection

## Current Limitations

- Marquee uses top-left node position hit testing (not full node-bounds overlap yet)
- Undo/redo remains snapshot-based
- No collaborative sync or server persistence
- Mock runtime is intentionally local and simulated

## Acceptance Checklist

Current build supports:
1. Seeded graph loads on startup (or autosaved last session)
2. Pan/zoom/select works
3. Node creation, editing, deletion, and duplication work
4. In-app edge creation flow (type + label) works
5. Save/load JSON graph documents
6. Data node refresh behavior and inspector previews
7. Agent runs through mock runtime
8. Live activity panel updates
9. Visible PAN event console with filtering/clear
10. Lightweight framework-free browser app with disciplined store ownership
