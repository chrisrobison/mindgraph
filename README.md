# CAR Brain Simulator

A 3D neural memory workbench implementing the [Clustered Associative Recall (CAR) Protocol](docs/superpowers/specs/2026-04-03-car-brain-simulator-design.md) for multi-agent memory systems. Built as a reconstructed fork of [MindGraph AI](https://github.com/chrisrobison/mindgraph).

Watch your memories form as glowing neurons in 3D space. Add knowledge, ask questions, and observe the 13-step retrieval sequence animate across a galaxy of interconnected memory chunks.

## Run Locally

```bash
node server.js
# Open http://127.0.0.1:4173
```

No build step. No npm install. Just Node.js and a browser with WebGL.

## What It Does

**Add memories** — type facts, decisions, events into the Memory input. Each becomes a Tier 1 chunk (glowing cyan sphere) with auto-generated questions and cross-links.

**Ask questions** — type a query and watch the brain think. The 13-step retrieval sequence fires: session priming, context construction, question decomposition, multi-query retrieval, cluster formation, interference checking, confidence grading, and synthesis. All visualized in real-time on the 3D canvas.

**Ingest projects** — point it at a directory and Claude processes every file through the CAR protocol, building a knowledge graph of your entire project.

## Architecture

Two-layer local application:

```
Browser (localhost:4173)              Local Server (server.js)
+------------------------+           +---------------------------+
| Three.js 3D Canvas     |           | Static file serving       |
| Web Component panels   |<--REST--->| /api/brain  (persistence) |
| PAN event bus          |           | /api/process (Claude CLI) |
| graph-store (state)    |           | /api/config  (settings)   |
+------------------------+           +---------------------------+
                                              |
                                     Claude Code CLI (default)
                                     or Anthropic API fallback
```

**Frontend:** Vanilla JS, Web Components, Three.js via CDN. Zero build step.
**Backend:** Single `server.js`, zero npm dependencies. Node.js `http` module only.
**AI Runner:** Claude Code CLI (uses your Claude subscription). Falls back to template-based processing when Claude isn't available.

## The 3D Brain

Nodes are 3D geometries rendered with Three.js:

| Node Type | Shape | Color | What It Represents |
|-----------|-------|-------|-------------------|
| Chunk (Tier 1) | Sphere | Cyan `#00f5ff` | Raw episodes, recent memories |
| Chunk (Tier 2) | Icosahedron | Purple `#7b61ff` | Compressed summaries |
| Chunk (Tier 3) | Octahedron | Pink `#ff2d78` | Permanent schemas/patterns |
| Question | Tetrahedron | Gold `#ffd93d` | Retrieval keys (L1-L5) |
| Trigger | Diamond | Amber `#ff9f1c` | Prospective memory triggers |
| Cluster | Translucent shell | White 20% | Groups of related chunks |

**Atmosphere:** 400 ambient particles, 800 background stars, 6 nebula gradient clouds, ambient light breathing. Post-processing bloom gives every node a radiating glow.

**Edges** connect memories with semantic relationships: `linked_to`, `amends`, `contradicts` (red pulse), `promotes_to`, `answers` (gold), `decomposes_to`, `clusters_with`, `preceded_by`, `triggers`.

## The 13-Step Retrieval Sequence

When you ask a question, the CAR engine runs the full retrieval pipeline:

1. **Session Primer** — check recent context, scan triggers
2. **Context Construction** — build a picture of why the question exists
3. **Question Decomposition** — split into 3-5 sub-questions
4. **Metamemory Check** — what do I know? what are my gaps?
5. **Multi-Query Retrieval R1** — score all chunks, top-3 per sub-query
6. **Cluster Formation** — group retrieved chunks
7. **Cluster Expansion R2** — pull in neighbors
8. **Tiered Retrieval** — search across all three memory tiers
9. **Interference Check** — detect contradictions
10. **Confidence Grading** — grade each sub-question
11. **Thinking Profile** — detect session mode
12. **Synthesis + Response** — reconstruct answer from fragments
13. **Post-Retrieval Update** — re-index, strengthen retrieval paths

Two modes: **Play** (auto-runs ~8.5 seconds) and **Step** (advance manually).

## CAR Protocol

Based on the Clustered Associative Recall Protocol (v1.0, March 2026) — a cognitive science-informed implementation guide for human-like memory recall in multi-agent systems.

Core principles:
- Memory is reconstruction from fragments, not file retrieval
- Never suppress or delete memory — build better retrieval cues instead
- Never present confident answers without grading confidence
- Questions are retrieval-ready keys; statements are passive data
- Every retrieval modifies the memory (read-write, not read-only)
- Forgetting is functional — relevance decay keeps the system fast

Relevance scoring uses Ebbinghaus decay curves, access frequency, emotional weight, consequence weight, connection density, and the Zeigarnik effect (open threads get a 1.5x retrieval bonus).

## Project Ingestion

The `CAR_INGESTION_PROTOCOL.md` describes how to feed any project into the brain:

1. SCAN — read all source material
2. CHUNK — break into atomic memory units
3. CLASSIFY — assign tier, tags, entities
4. QUESTION — generate questions at 5 levels per chunk
5. LINK — identify cross-links, contradictions, temporal sequences
6. SCORE — set initial relevance weights
7. CLUSTER — group related chunks
8. EXPORT — output as JSON for import

## Persistence

Brain data persists to `~/.car-brain/brains/` on disk (via the server API) with localStorage as a fallback for instant reload. Export/Import JSON from the toolbar for manual backup.

## Tech Stack

- **3D rendering:** Three.js v0.170.0 (CDN, ES modules)
- **UI framework:** None. Vanilla Web Components.
- **State management:** Custom PAN event bus (publish/subscribe on EventTarget)
- **Persistence:** Node.js server → disk JSON + browser localStorage
- **AI integration:** Claude Code CLI (subscription auth)
- **Build step:** None. Serve static files.
- **Dependencies:** Zero npm packages. Three.js from CDN only.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Select tool |
| `H` | Pan/Orbit tool |
| `C` | Add Chunk tool |
| `L` | Add Link tool |
| `Q` | Add Question tool |
| `T` | Add Trigger tool |
| `M` | Focus memory input |
| `Space` | Play/pause retrieval |
| `Right Arrow` | Step forward in retrieval |
| `Esc` | Cancel / clear selection |
| `Cmd+Z` | Undo |
| `1/2/3/0` | Filter by tier / show all |

## Origins

Reconstructed from [chrisrobison/mindgraph](https://github.com/chrisrobison/mindgraph), a framework-free graph workbench. The original 2D agent-workflow editor was rebuilt into a 3D brain simulator with the CAR protocol as its cognitive engine.

## License

See upstream repository for license terms.
