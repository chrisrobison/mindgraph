# CAR Brain Simulator — Design Spec

**Date:** 2026-04-03
**Status:** Approved
**Repo:** amitko-pixel/carmindgraph (fork of chrisrobison/mindgraph)

## Overview

Reconstruct the MindGraph AI app into a visual brain simulator implementing the
Clustered Associative Recall (CAR) Protocol. The app becomes a working CAR engine
with a 3D neural visualization — you add memories, ask questions, and watch the
brain process them through the full 13-step retrieval sequence.

### What it is

- A CAR Protocol workbench + living memory system
- Domain-agnostic: ingests any knowledge (code, business, research)
- Three input modes: text memory input, query panel, JSON file import
- Ships with a Claude instruction manual for full project ingestion
- Visual: Neural dark 3D aesthetic using Three.js for the graph canvas

### What it is NOT

- Not a static visualization or educational demo
- Not a backend service — runs entirely in the browser
- Not a chat interface — it's a graph workbench with memory processing

## Architecture

### Approach: Hybrid (Three.js Canvas + DOM Panels)

Three.js renders the 3D brain visualization canvas. All other UI (toolbar, inspector,
input panels, activity log) stays as vanilla Web Components. The PAN event bus bridges
both worlds.

**What stays:**
- PAN event bus (`js/core/pan.js`)
- Store architecture (graph-store, ui-store, persistence-store)
- Web Components for all panels
- localStorage persistence with autosave
- Undo/redo (snapshot-based)

**What changes:**
- `graph-canvas` → Three.js WebGL scene (replaces DOM/SVG rendering)
- Node types → CAR protocol entities (chunk, cluster, question, pattern, trigger)
- Edge types → CAR relationships (linked_to, amends, contradicts, promotes_to, etc.)
- Inspector tabs → CAR metadata views
- Bottom panel tabs → Retrieval log, Consolidation, Contradictions, Questions, Metamemory
- Runtime → CAR engine (retrieval, scoring, consolidation) replaces mock-agent-runtime
- Seed data → Spain margins demo from the protocol
- New dependency: Three.js via CDN (`<script>` tag, ~150KB)

### App Layout (4-panel, preserved)

```
+--[TOP TOOLBAR]-----------------------------------------------+
| [Brain Logo] [CAR Brain] | [Memory ___] [Query ___] |        |
| [Play] [Step] [Reset] | [13-step dots] | [Zoom]             |
+--[PALETTE]--+--[3D CANVAS]------------------+--[INSPECTOR]---+
|  Select     |                                |  Overview      |
|  Pan/Orbit  |     THREE.JS WEBGL SCENE       |  Metadata      |
|  Add Chunk  |     (orbital camera,           |  Retrieval     |
|  Add Link   |      depth planes,             |  Scoring       |
|  Add Q      |      particle trails,          |  Questions     |
|  Trigger    |      bloom post-processing)    |  Timeline      |
+-------------+--------------------------------+----------------+
+--[BOTTOM PANEL]----------------------------------------------+
| [Retrieval Log] [Consolidation] [Contradictions] [Questions] |
| [Metamemory]                                                 |
+--------------------------------------------------------------+
```

## Data Model

### Node Types (replace existing 6)

| Type | CAR Section | 3D Shape | Description |
|------|-------------|----------|-------------|
| `chunk` | S3.3 | Sphere | Memory chunk (Tier 1/2/3). Size = access_count. Brightness = relevance. |
| `cluster` | S6, S12 | Translucent shell | Group of related chunks. Encloses members. |
| `question` | S4 | Tetrahedron | Question-based retrieval key (Level 1-5). |
| `pattern` | S11 | Octahedron | Tier 3 schema / cross-domain pattern. Permanent. |
| `trigger` | Principle 9 | Diamond | Prospective memory trigger with conditions. |

### Chunk Metadata Schema (S3.3)

Every chunk carries the full CAR metadata:

```javascript
{
  id: string,
  content: string,
  tier: 1 | 2 | 3,
  timestamp: ISO8601,
  session_id: string,
  source: "user_stated" | "agent_generated" | "imported",
  source_reliability: "high" | "medium" | "low",
  participants: string[],
  emotional_tone: string,
  emotional_intensity: number,        // 0.0 - 1.0
  stakes_level: "high" | "medium" | "low",
  topic_tags: string[],
  entity_tags: string[],
  decision_made: boolean,
  action_items: string[],
  status: "open" | "resolved",
  preceding_context_id: string | null,
  following_context_id: string | null,
  access_count: number,
  last_accessed: ISO8601,
  retrieval_cues: string[],
  amendments: Amendment[],
  linked_chunks: string[],
  generated_questions: string[]
}
```

### Question Node Schema (S4)

```javascript
{
  id: string,
  level: 1 | 2 | 3 | 4 | 5,  // Bare Fact → Conditional
  question_text: string,
  answer_text: string | null,
  answered: boolean,
  parent_question_id: string | null,
  linked_chunk_ids: string[],
  confidence: number | null
}
```

### Trigger Node Schema (Principle 9)

```javascript
{
  id: string,
  content: string,
  trigger_conditions: string[],
  expires: ISO8601 | null,
  fired: boolean,
  fire_count: number
}
```

### Pattern Node Schema (S11)

```javascript
{
  id: string,
  pattern: string,
  evidence: string[],          // chunk IDs
  confidence: number,
  implication: string,
  pattern_type: string,        // "causal_recurring", "correlation", etc.
  exceptions: string[]
}
```

### Edge Types (replace existing 9)

| Type | CAR Section | Visual | Description |
|------|-------------|--------|-------------|
| `linked_to` | Principle 6 | Soft glow line, shimmer | Cross-link between chunks |
| `amends` | S7.2 | Dashed arrow | Correction/amendment |
| `contradicts` | S7.1 | Red pulsing dashed | Active contradiction |
| `promotes_to` | S3.1 | Upward gradient arrow | Tier promotion (1→2→3) |
| `answers` | S4.4 | Gold beam, particles Q→chunk | Question answered by chunk |
| `decomposes_to` | S5 | Branching rays | Question → sub-questions |
| `clusters_with` | S6 | Thin translucent tether | Chunk → cluster |
| `preceded_by` | S3.3 | Faint timeline link | Temporal sequence |
| `triggers` | Principle 9 | Lightning bolt pulse | Trigger → activation |

### Relevance Scoring (S3.4)

Calculated dynamically at retrieval time per chunk:

```
relevance = recency_weight(days_since_created)
          * frequency_weight(access_count)
          * emotional_weight(emotional_intensity)
          * consequence_weight(decision_made)
          * connection_weight(linked_chunk_count)
          * zeigarnik_weight(status == "open" ? 1.5 : 1.0)
```

Recency follows Ebbinghaus decay, resets on each access:
- Day 1: 1.0
- Day 7: 0.75
- Day 30: 0.50
- Day 90: 0.30
- Day 365: 0.15

## 3D Visual Language

### Rendering Stack

Three.js via CDN. Post-processing: UnrealBloomPass for glow, optional SSAO.

### Color System

| Element | Hex | Usage |
|---------|-----|-------|
| Background | `#080c14` | Canvas deep space |
| Tier 1 (episodes) | `#00f5ff` | Cyan — hot, recent |
| Tier 2 (summaries) | `#7b61ff` | Electric purple — compressed |
| Tier 3 (schemas) | `#ff2d78` | Hot pink — permanent |
| Questions | `#ffd93d` | Gold — retrieval keys |
| Triggers | `#ff9f1c` | Amber — prospective |
| Clusters | `#ffffff` at 20% opacity | Translucent containment |
| Contradiction edges | `#ff3333` | Red pulse |
| Active retrieval | `#00f5ff` particle trail | During 13-step sequence |
| Panel backgrounds | `#0d1117` | All side panels |
| Panel text | `#c9d1d9` | Readable on dark |
| Accent text | `#ffffff` | Headers, emphasis |

### 3D Node Rendering

| Node | Geometry | Material | Size Rule |
|------|----------|----------|-----------|
| Chunk T1 | SphereGeometry(1, 32, 32) | MeshStandardMaterial + emissive | Base 1.0, scales with access_count |
| Chunk T2 | IcosahedronGeometry(1.5, 1) | MeshStandardMaterial + emissive | 1.5x base |
| Chunk T3 | OctahedronGeometry(2.0) | MeshStandardMaterial + emissive | 2.0x, slow rotation |
| Question | TetrahedronGeometry(0.8) | MeshStandardMaterial + emissive | 0.8x. Size scales with level (L1 small → L5 large) |
| Cluster | Custom shell mesh | MeshBasicMaterial transparent | Encloses member nodes |
| Trigger | Two ConeGeometry back-to-back | MeshStandardMaterial + emissive | 0.6x, sharp flash on match |

### Node Brightness

`emissiveIntensity = relevance_score * (isSelected ? 2.0 : 1.0)`

Hot memories (recently accessed): full emissive.
Cold memories (low access, decaying): emissive at 30%.

### Edge Rendering

All edges: THREE.Line or THREE.TubeGeometry with emissive material.
Active retrieval edges: particle system (THREE.Points) flowing along the path.
Contradiction edges: color `#ff3333`, opacity oscillates 0.3-0.8.

### Depth Planes

| Plane | Z Position | Contents |
|-------|-----------|----------|
| Front | z = 0 | Active retrieval, query, currently processing |
| Mid | z = -200 | Tier 1 raw episodes |
| Back | z = -400 | Tier 2 compressed summaries |
| Deep | z = -600 | Tier 3 schemas/patterns |

### Camera

- Default: orbital view (OrbitControls)
- Scroll: zoom in/out
- Click-drag empty space: orbit
- Auto-focus: when a node is selected, camera smoothly lerps to face it
- Retrieval mode: camera follows the active retrieval path

### Post-Processing

- UnrealBloomPass: threshold 0.8, strength 0.6, radius 0.4
- Optional fog: `scene.fog = new THREE.FogExp2(0x080c14, 0.0015)` for depth fade

## Interaction Design

### Input Modes

**Memory Input** (top toolbar):
1. User types memory text in the Memory field
2. Press Enter → system creates a Tier 1 chunk
3. Node appears at front plane with birth animation (scale 0→1, glow intensifies)
4. System auto-generates L1-L5 questions (tetrahedrons branch out)
5. System scans for links, contradictions, cluster candidates
6. New edges animate in (golden threads)
7. Inspector auto-opens on the new chunk

**Query Mode** (top toolbar):
1. User types question in the Query field
2. Press Enter → 13-step retrieval sequence begins
3. Result appears in bottom panel Retrieval Log with confidence grading
4. Response cites source chunks (clickable → camera flies to node)

**File Import:**
1. Drag-and-drop zone on toolbar or File menu
2. JSON parsed per CAR_INGESTION_PROTOCOL.md schema
3. Chunks appear in cascade animation (one by one, spreading outward)
4. Post-import: auto-consolidation runs

### Tool Palette

| Tool | Shortcut | Behavior |
|------|----------|----------|
| Select | `V` | Click to select, inspect in sidebar |
| Pan/Orbit | `H` | Click-drag to orbit. Scroll to zoom. |
| Add Chunk | `C` | Click in 3D space to place new chunk |
| Add Link | `L` | Click source → click target → choose edge type |
| Add Question | `Q` | Add question node, link to chunks |
| Add Trigger | `T` | Create trigger with conditions |

### Canvas Interactions

- **Click node:** Select, inspector shows metadata
- **Double-click node:** Inline edit label/content
- **Hover node:** Tooltip: content preview + relevance score
- **Right-click node:** Context menu: Retrieve from here, Promote tier, Add link, Delete
- **Click edge:** Select, inspector shows edge type + linked nodes
- **Scroll:** Zoom
- **Click-drag empty space:** Orbit camera
- **Shift+click:** Multi-select
- **Delete/Backspace:** Create amendment (never truly delete per Principle 2)

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `M` | Focus memory input |
| `Q` (when no tool active) | Focus query input |
| `Space` | Play/pause retrieval animation |
| `Right Arrow` | Step forward in retrieval sequence |
| `Esc` | Cancel action / clear selection |
| `Cmd+Z` | Undo |
| `Shift+Cmd+Z` | Redo |
| `1` / `2` / `3` | Filter: show only Tier 1/2/3 |
| `0` | Show all tiers |

## 13-Step Retrieval Sequence

The hero feature. Two modes:

- **Play mode:** Full sequence runs automatically (~8.5 seconds)
- **Step mode:** User advances manually with `→` key or Step button

### Sequence Choreography

| Step | Name | Duration | 3D Visual |
|------|------|----------|-----------|
| 1 | Session Primer | 0.5s | Warm glow sweeps across recent chunks. Triggers flash-check. |
| 2 | Context Construction | 0.8s | Query tetrahedron appears at front plane. Concentric particle rings ripple outward. |
| 3 | Question Decomposition | 1.0s | Query splits into 3-5 sub-question tetrahedrons, fan-out with branching particle rays. |
| 4 | Metamemory Check | 0.5s | Knowledge inventory pulses. Gaps highlight dim red. |
| 5 | Multi-Query Retrieval R1 | 1.2s | Sub-questions send particle beams into graph. Top-3 matches per query glow bright. |
| 6 | Cluster Formation | 0.8s | Retrieved chunks drift together (physics spring). Translucent shells form. |
| 7 | Cluster Expansion R2 | 1.0s | Adjacent chunks pulled in (temporal, entity, topic neighbors). Shells expand. |
| 8 | Tiered Retrieval | 0.8s | Camera pulls back. T1/T2/T3 planes light up in sequence front→back. |
| 9 | Interference Check | 0.6s | Red pulses between contradicting chunks. Winner glows, loser dims. |
| 10 | Confidence Grading | 0.5s | Each sub-question gets confidence badge (green/yellow/red). Overall score appears. |
| 11 | Thinking Profile | 0.3s | Subtle HUD overlay: detected session mode. |
| 12 | Synthesis + Response | 1.0s | All activated chunks pulse in unison. Response assembles in bottom panel. |
| 13 | Post-Retrieval Update | 0.5s | Accessed chunks flash (re-indexed). Strengthened edges brighten. |

### Step Progress Indicator

Horizontal bar at top of canvas: 13 segments.
- Done: cyan fill
- Active: gold fill, pulsing
- Pending: dark gray

## Inspector Panel

Right panel with tabs contextual to selected node type:

### Chunk Selected

| Tab | Content |
|-----|---------|
| Overview | Content text, tier badge, relevance gauge, emotional tone, stakes |
| Metadata | Full schema: source, reliability, participants, timestamps, access_count, status |
| Retrieval | Retrieval cues, generated questions, linked chunks |
| Timeline | Preceding/following context chain, amendment history |
| Scoring | Live relevance breakdown with factor weights as sliders |

### Question Selected

| Tab | Content |
|-----|---------|
| Questions | Level badge, question text, answer (if any), confidence, parent/child hierarchy |

### Cluster Selected

| Tab | Content |
|-----|---------|
| Cluster | Member chunks list, cluster strength, shared tags/entities |

### Nothing Selected (Empty State)

"Select a memory chunk to inspect its metadata, or ask a question to watch the brain think."
Plus a minimap showing all nodes as colored dots.

## Bottom Panel

| Tab | Content |
|-----|---------|
| Retrieval Log | 13-step sequence history: timestamps, step labels, confidence scores, citations |
| Consolidation | Tier promotion activity. Daily/weekly/monthly job status. |
| Contradictions | Active memory conflicts with version history. Badge count on tab. |
| Questions | Unanswered questions from self-questioning engine (S4.5). Badge count. |
| Metamemory | Knowledge inventory: topic coverage, known gaps, confidence per domain |

## First-Time Experience

No saved session → load demo brain using Spain margins example from the protocol:

- ~15 chunks across all 3 tiers
- Pre-formed clusters (Spain account, logistics)
- Questions at multiple levels
- One active contradiction (margin data: 22% vs 18%)
- One prospective trigger ("raise pricing issue when Idan mentioned")
- Guided prompt at top: "Type a question to watch the brain recall, or add a new memory."

## Claude Instruction Manual

Ships as `CAR_INGESTION_PROTOCOL.md` in the repo root. Tells Claude (or any LLM)
how to ingest an entire project into the CAR memory graph:

```
1. SCAN    — Read all source material (any domain)
2. CHUNK   — Break into atomic units (one fact/decision/event per chunk)
3. CLASSIFY — Assign tier (1=raw, 2=summary, 3=pattern), tags, entities
4. QUESTION — Generate questions at 5 levels per chunk (L1 bare fact → L5 conditional)
5. LINK    — Identify cross-links, contradictions, temporal sequences
6. SCORE   — Set initial relevance weights (emotional, stakes, consequence)
7. CLUSTER — Group related chunks by topic/entity/time
8. EXPORT  — Output as JSON matching the graph document schema
```

The output JSON imports directly via the app's File Import.

## Graph Document Schema (for persistence and import/export)

```javascript
{
  id: string,
  title: string,
  version: "1.0.0",
  nodes: Node[],          // chunks, questions, patterns, triggers
  edges: Edge[],
  clusters: Cluster[],    // cluster definitions with member IDs
  viewport: { x, y, z, zoom, rotationX, rotationY },
  metadata: {
    createdBy: string,
    description: string,
    selection: string[],
    metamemory: MetamemoryIndex
  }
}
```

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| 3D library | Three.js via CDN | Single dependency, well-documented, handles WebGL, post-processing |
| Panel UI | Vanilla Web Components (preserved) | Working infrastructure, no rebuild needed |
| State management | PAN event bus + stores (preserved) | Clean separation, proven pattern |
| Persistence | localStorage (preserved) | Simple, no server needed |
| Build step | None (preserved) | Static file serving, ES modules |
| Fonts | IBM Plex Sans + IBM Plex Mono | Sharp, technical, monospace for data |

## Current Limitations (inherited, accepted)

- No server persistence or collaborative sync
- Undo/redo is snapshot-based
- No real LLM integration (consolidation/question generation is rule-based simulation)
- Three.js adds ~150KB CDN dependency

## Security Notes

- Public repository — no secrets
- CLAUDE.md in .gitignore
- All data is client-side (localStorage)
- No external API calls except Three.js CDN

## Not In Scope (deferred)

- Real LLM-powered consolidation (future: connect to Claude API)
- Server-side persistence / multi-user
- Mobile/tablet responsive (desktop-first for this phase)
- WebXR / VR mode
- Audio/haptic feedback on retrieval events
