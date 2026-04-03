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

### Node Placement

New chunks placed using force-directed layout within their depth plane:
- **Tier 1 chunks** land at z=-200, positioned near related chunks (by shared tags/entities). If no relations, placed at a random position within a 200-unit radius of center.
- **Tier 2 summaries** at z=-400, centered on the cluster they summarize.
- **Tier 3 schemas** at z=-600, evenly distributed across the deep plane.
- **Questions** float at z=-100 (between front and mid planes), near their parent chunk.
- **Force simulation** runs for 50 iterations on layout change (repulsion between same-plane nodes, attraction along edges). Uses lightweight force-directed algorithm, not a physics engine.

### Cluster Shell Shape

Cluster shells use a **bounding sphere** (not convex hull, too expensive for real-time):
- Compute center of mass of member nodes
- Radius = max distance to any member + 20% padding
- Material: `MeshBasicMaterial({ color: cluster_color, transparent: true, opacity: 0.08 })`
- Wireframe sphere overlay at opacity 0.03 for structure
- Shell repositions every frame to track member drift during force layout

### Performance Boundary

- Target: 60fps with up to 200 nodes and 400 edges
- At 200+ nodes: disable ambient particle field, reduce bloom radius
- At 500+ nodes: switch to instanced rendering (InstancedMesh), disable per-node glow, use LOD (far nodes become points)
- WebGL context loss: show DOM fallback message, offer JSON export of current state

### Tooltip Design

On hover (300ms delay), show a floating DOM tooltip anchored above the 3D node (CSS2DRenderer):

```
+--[tooltip]------------------+
| Spain margins dropped...    |  ← content (first 60 chars, ellipsis)
| T1 · 0.92 · 3 accesses    |  ← tier · relevance · access count
+-----------------------------+
```

Background: `#161b22` at 95% opacity. Border: 1px `var(--bg-border)`. Font: `var(--font-mono)` at `var(--font-size-sm)`. Max width: 240px. Positioned via `CSS2DObject` so it tracks the node in 3D space.

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
- Home position: camera at (0, 80, 350), looking at (0, 0, -200). Slightly elevated, showing depth layers front-to-back. On first load, camera starts at (0, 200, 600) and slowly swoops down to home over 2 seconds (the "brain waking up" moment).
- Scroll: zoom in/out (dolly toward/away from look-at target)
- Click-drag empty space: orbit around look-at target
- Auto-focus: when a node is selected, camera smoothly lerps to face it (duration 0.6s, easeInOutCubic)
- Retrieval mode: camera follows the active retrieval path, pulling back for tiered retrieval (step 8), zooming in for synthesis (step 12)
- Double-tap `H`: return to home position (smooth lerp)

### Post-Processing

- UnrealBloomPass: threshold 0.8, strength 0.6, radius 0.4
- Fog: `scene.fog = new THREE.FogExp2(0x080c14, 0.0015)` for depth fade (required, not optional)

### Atmospheric Layer (the "galaxy" feel)

This is what separates a Three.js demo from a living brain-galaxy:

- **Ambient particle field:** ~200 tiny points (`THREE.Points`, size 0.3-0.8, opacity 0.05-0.15) drifting slowly across the scene. Random velocity vectors, no interaction with nodes. Creates the feeling of floating in a living space.
- **Nebula clouds:** 3-5 large sprite planes (opacity 0.03-0.06) with soft radial gradient textures in `#00f5ff`, `#7b61ff`, `#ff2d78`. Positioned behind clusters at z=-800 to z=-1200. They give dense memory regions a "glow cloud" backdrop.
- **Star field:** ~500 static points at z=-1500 to z=-2500 (far background). Tiny, white, varying opacity 0.1-0.4. Parallax naturally as the camera orbits, giving depth scale.
- **Ambient light pulse:** Subtle sine-wave modulation (period ~8s, amplitude 0.05) on the scene ambient light intensity. The whole scene "breathes."

### Canvas Visual Hierarchy (eye tracking order)

1. **Active retrieval path** (when running): particle trail overrides all other focus
2. **Brightest cluster** (highest aggregate relevance): positioned near camera center on first load
3. **Hot individual chunks** (recently accessed, high relevance): glow through cluster shells
4. **Gold question nodes** create secondary focal points, scattered at mid-depth
5. **Cold chunks and deep-plane schemas** fade into background like distant stars
6. **Atmospheric particles and nebula clouds** provide spatial context without competing

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

## Micro-Interactions

These are the details that make every touch feel alive.

### Node Birth
New chunk: scale 0 → 1.0 over 0.4s (easeOutBack with slight overshoot). Emissive ramps from 0 → full over 0.6s. Connected edges draw in with a 0.2s delay each.

### Node Selection
Selected node: emissive doubles (x2.0). White ring appears around it (torus geometry, 0.1 thickness). All connected edges brighten to full opacity. Unrelated nodes dim to 40% opacity over 0.3s.

### Node Hover
Hover (300ms threshold): node scale 1.0 → 1.1 over 0.15s. Tooltip appears. Subtle white outline (0.5px).

### Node Deletion (Amendment)
Node doesn't vanish. It shrinks to 0.3x scale, drops to 10% opacity, and drifts to the back plane (z=-800) over 0.8s. An amendment edge traces from the new correction chunk to the old one. The old node stays, just dim. Never truly deleted. (CAR Principle 2)

### Edge Creation
New edge: line draws from source to target over 0.3s (dashOffset animation). Then particle burst at the connection point (10 particles, fan out and fade over 0.4s).

### Retrieval Hit
When a chunk is "found" during retrieval: brief scale pulse (1.0 → 1.3 → 1.0 over 0.2s). Particle burst (same as edge creation). Emissive spikes to 3x then settles to 2x.

### Cluster Formation
Chunks drift toward cluster center over 0.5s (spring physics). Shell fades in from 0% → 8% opacity over 0.3s. Gentle "whomp" visual (shell scale 0.8 → 1.0, ease out).

### Contradiction Detection
Both conflicting nodes flash red twice (0.1s on, 0.1s off). Red dashed edge materializes between them over 0.3s. Edge then pulses continuously (opacity 0.3 → 0.8 at 1.5s period).

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

## Interaction States

Every feature has five states. If we don't spec them, the implementer ships "no items found."

### Canvas States

| State | What the user sees |
|-------|-------------------|
| **Loading (first load)** | Dark canvas with ambient particles drifting. Faint "neurons connecting..." text centered, pulsing at 0.5Hz. Star field visible. After 1-2s the seed graph fades in node-by-node. |
| **Empty (no chunks)** | Full atmospheric layer active (particles, nebula clouds, star field). Centered text: "This brain is empty. Add a memory to begin." Gentle glow ring at center where the first node will appear. Memory input field pulses softly. |
| **Active (normal use)** | Full 3D graph with all atmospheric effects. Nodes, edges, clusters rendered per spec. |
| **Retrieval running** | 13-step sequence animating. Step overlay visible. Non-participating nodes dim to 20% opacity. Active path glows bright. Bottom panel streams step logs in real-time. |
| **Error (WebGL failure)** | Fallback message: "Your browser doesn't support WebGL. Try Chrome or Firefox." Rendered as DOM overlay, not canvas. |

### Memory Input States

| State | What the user sees |
|-------|-------------------|
| **Empty** | Placeholder: "Add a new memory chunk..." in #484f58 |
| **Typing** | Border glows cyan (#00f5ff at 30% opacity). Character count not shown (no limit). |
| **Processing** | Input disabled briefly, small spinner icon replaces the submit arrow. New chunk node's birth animation plays. |
| **Success** | Input clears. Brief green flash on the border (0.3s). Inspector opens on new chunk. Activity log appends "Chunk created: [first 30 chars]..." |

### Query Input States

| State | What the user sees |
|-------|-------------------|
| **Empty** | Placeholder: "Ask the brain a question..." in #484f58 |
| **Typing** | Border glows gold (#ffd93d at 30% opacity). |
| **Retrieval running** | Input disabled. 13-step progress dots animate. Step overlay appears on canvas. |
| **Result ready** | Input stays with the query text (not cleared). Bottom panel Retrieval Log tab auto-activates. Response shows with confidence score and source citations. |
| **Low confidence** | Same as result, but confidence badge is red. Response includes: "Confidence: LOW. Gaps: [specific missing info]." |
| **No matches** | Response: "No relevant memories found. Try adding more context, or rephrase." The brain does a brief "search sweep" animation (particle wave radiates outward and fades). |

### File Import States

| State | What the user sees |
|-------|-------------------|
| **Idle** | Import button in toolbar, subtle. |
| **Drag hover** | Full-canvas overlay: dark with cyan border and text "Drop JSON to import memories". |
| **Importing** | Progress bar at top of canvas: "Importing 47 chunks..." Nodes appear one-by-one with cascade animation. |
| **Success** | Progress bar fills, turns green, fades. Activity log: "Imported 47 chunks, 12 edges, 3 clusters." |
| **Error (invalid JSON)** | Toast notification at top-right: "Import failed: invalid JSON at line 23." Red border, auto-dismiss after 8s. |
| **Error (schema mismatch)** | Toast: "Import failed: missing required field 'content' in chunk 4." |

### Inspector States

| State | What the user sees |
|-------|-------------------|
| **Nothing selected** | "Select a memory chunk to inspect its metadata, or ask a question to watch the brain think." Plus minimap of all nodes as colored dots by tier. |
| **Chunk selected** | Full metadata view with tabs. Relevance score gauge animated. |
| **Multiple selected** | Header: "3 chunks selected". Shows shared tags, aggregate relevance, option to bulk-link or bulk-tag. |
| **Editing field** | Inline edit with save/cancel. Field border glows cyan during edit. Esc cancels. |

### Bottom Panel States

| Tab | Empty State |
|-----|------------|
| **Retrieval Log** | "No queries yet. Ask the brain a question to see the retrieval process." |
| **Consolidation** | "No consolidation activity. Add more memories to trigger tier promotion." |
| **Contradictions** | "No contradictions detected. Conflicting memories will appear here." |
| **Questions** | "No unanswered questions. The self-questioning engine activates as memories accumulate." |
| **Metamemory** | "Knowledge inventory empty. The brain builds its self-model as you add memories." |

## First-Time Experience & Emotional Arc

### The First 5 Seconds (visceral)

The user opens the app. The screen is almost black. Ambient particles drift slowly.
A single faint glow appears at center. Then another. Then edges begin to trace between
them, like synapses wiring themselves. Over 2 seconds, the seed graph materializes
node-by-node, clusters forming, edges threading, the camera slowly swooping from high
above down into the brain. Bloom intensifies as the graph "wakes up."

The user's first feeling should be: "whoa."

### The First 5 Minutes (behavioral)

The seed graph is loaded: the Spain margins example from the CAR protocol.

Contents:
- ~15 chunks across all 3 tiers
- Pre-formed clusters (Spain account, logistics)
- Questions at multiple levels
- One active contradiction (margin data: 22% vs 18%, red pulsing edge)
- One prospective trigger ("raise pricing issue when Idan mentioned")

A subtle prompt fades in at the top of the canvas (not a modal, not a banner, just
text that belongs in the space): "Ask something. Try: What happened with Spain margins?"

The user types a query. The 13-step retrieval fires. This is the "aha" moment. They
watch particles stream from the query node into the graph, chunks light up, clusters
form, contradictions flash red, and a graded response appears below. They understand
what this thing does.

### The First Session (reflective)

After the demo query, the prompt shifts: "Now add your own memory. Anything you know."
The user types a fact. They watch a new neuron appear, birth animation, questions
branch out, links form to existing chunks. They get it: this thing learns.

### Returning User

If autosave data exists, the camera starts at the home position (no swoop animation).
The graph is already there. The prompt says nothing. The user is home.

### User Journey Storyboard

| Step | User does | User feels | Design supports it with |
|------|----------|------------|------------------------|
| 1 | Opens app | Curiosity | Dark screen, slow materialization, camera swoop |
| 2 | Sees the seed graph | Awe | 3D depth, glowing nodes, ambient particles, nebula clouds |
| 3 | Reads the prompt | Invitation | Non-intrusive text, not a modal wall |
| 4 | Types first query | Anticipation | Gold border glow, query node appears |
| 5 | Watches retrieval | Wonder | 13-step animation, particles flowing, chunks lighting up |
| 6 | Reads the response | Understanding | Confidence grade, source citations, camera following path |
| 7 | Adds first memory | Ownership | Birth animation, questions branching, links forming |
| 8 | Explores the graph | Mastery | Orbit camera, hover tooltips, click to inspect |
| 9 | Imports a file | Power | Cascade animation, cluster auto-formation |
| 10 | Returns next day | Belonging | Instant load, graph as they left it, no friction |

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

## Design Tokens (CSS Variables)

All visual values go through CSS custom properties. No magic numbers in component CSS.

```css
:root {
  /* Background */
  --bg-canvas: #080c14;
  --bg-panel: #0d1117;
  --bg-input: #161b22;
  --bg-border: #21262d;
  --bg-hover: #161b22;

  /* Data colors (tier-mapped, never decorative) */
  --color-t1: #00f5ff;      /* Tier 1 episodes, cyan */
  --color-t2: #7b61ff;      /* Tier 2 summaries, purple */
  --color-t3: #ff2d78;      /* Tier 3 schemas, pink */
  --color-question: #ffd93d; /* Questions, gold */
  --color-trigger: #ff9f1c;  /* Triggers, amber */
  --color-contradiction: #ff3333; /* Conflicts, red */
  --color-cluster: rgba(255, 255, 255, 0.2); /* Cluster shells */

  /* Text */
  --text-primary: #e6edf3;
  --text-secondary: #c9d1d9;
  --text-muted: #484f58;
  --text-accent: #ffffff;

  /* Typography */
  --font-sans: 'IBM Plex Sans', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;
  --font-size-xs: 10px;
  --font-size-sm: 11px;
  --font-size-base: 12px;
  --font-size-md: 13px;
  --font-size-lg: 14px;

  /* Spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;

  /* Radii */
  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-lg: 6px;

  /* Transitions */
  --transition-fast: 0.15s ease;
  --transition-normal: 0.3s ease;
  --transition-slow: 0.6s ease-in-out;

  /* Layout */
  --toolbar-height: 44px;
  --palette-width: 56px;
  --inspector-width: 300px;
  --bottom-panel-height: 180px;
}
```

## Anti-Slop Rules

These keep the app from drifting into generic AI-generated aesthetics:

1. **Colors are data, not decoration.** Cyan = Tier 1. Purple = Tier 2. Pink = Tier 3. Gold = Questions. Never use these as background gradients, decorative accents, or branding.
2. **Tabs are text-only.** Underline-active style, `IBM Plex Mono` 10px uppercase, `#484f58` inactive / `#00f5ff` active with 2px bottom border. No pills, no background fills, no rounded containers.
3. **No card grids.** Inspector sections use stacked key-value rows, not cards. Bottom panel uses log-style rows, not cards.
4. **No decorative elements.** Every visual element maps to data. The atmospheric particles represent ambient "neural activity," not decoration. If it doesn't mean something, cut it.
5. **Monospace for data, sans-serif for labels.** `IBM Plex Mono` for all values, scores, IDs, timestamps. `IBM Plex Sans` for section headers and labels only.
6. **No border-radius > 6px.** Buttons: 4px. Panels: 0px (sharp edges). Input fields: 4px. Nodes are 3D geometry, not CSS.
7. **No colored left-borders on anything.** Tags use 1px borders in the data color at 40% opacity.

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

## Accessibility (desktop-only scope)

No mobile/tablet. But desktop a11y is not optional.

### Keyboard Navigation

- **Tab order:** Toolbar inputs → Palette tools → Inspector tabs → Bottom panel tabs
- **Canvas shortcuts:** All tool shortcuts (V, H, C, L, Q, T) work without focusing the canvas
- **Arrow keys:** When canvas is focused, arrow keys orbit camera (5 degrees per press)
- **Enter on node:** Selects node, opens inspector (equivalent to click)
- **Tab through nodes:** Tab/Shift+Tab cycles through visible nodes in relevance order
- **Esc:** Progressive escape: close popover → clear selection → deselect tool → return to Select

### Screen Reader Strategy

The 3D canvas is inherently non-accessible to screen readers. Mitigation:
- Canvas element gets `role="img"` with `aria-label` describing current state: "Brain graph with 15 memory chunks, 3 clusters, 1 active contradiction"
- All panel content (inspector, bottom panel, toolbar) is standard DOM with proper ARIA landmarks
- Inspector serves as the screen reader's "view" of the selected node
- Bottom panel retrieval log is a live region (`aria-live="polite"`) that announces step progress

### Color Contrast

Neon-on-dark is hard for contrast. Minimum requirements:
- Panel text (#c9d1d9 on #0d1117): ratio 9.5:1 (passes AAA)
- Muted text (#484f58 on #0d1117): ratio 3.1:1 (passes AA for large text only, used for labels)
- Active tab (#00f5ff on #0d1117): ratio 8.7:1 (passes AAA)
- Tag text (data colors on #161b22): all pass AA minimum

### Reduced Motion

Respect `prefers-reduced-motion: reduce`:
- Skip the first-load camera swoop (instant position)
- Disable ambient particle drift
- Retrieval sequence: show state changes without animation (instant step transitions)
- Bloom post-processing stays (it's not motion, it's a visual filter)

## Not In Scope (deferred)

- Real LLM-powered consolidation (future: connect to Claude API)
- Server-side persistence / multi-user
- Mobile/tablet responsive (desktop-first for this phase)
- WebXR / VR mode
- Audio/haptic feedback on retrieval events
