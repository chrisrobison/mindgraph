# CAR Ingestion Protocol

Instructions for ingesting knowledge into a CAR Brain graph. Use this protocol
with Claude Code or any AI runner to convert raw information into structured
brain data.

## Pipeline

```
1. SCAN    — Read all source material (any domain)
2. CHUNK   — Break into atomic units (one fact/decision/event per chunk)
3. CLASSIFY — Assign tier (1=raw, 2=summary, 3=pattern), tags, entities
4. QUESTION — Generate questions at 5 levels per chunk (L1-L5)
5. LINK    — Identify cross-links, contradictions, temporal sequences
6. SCORE   — Set initial relevance weights (emotional, stakes, consequence)
7. CLUSTER — Group related chunks by topic/entity/time
8. EXPORT  — Output as JSON matching the graph document schema
```

## Step Details

### 1. SCAN

Read the input material. Accept any format:
- Text (conversations, notes, documents)
- Code files (source, config, docs)
- Structured data (JSON, YAML, CSV)

### 2. CHUNK

Break into atomic memory chunks. Each chunk contains exactly ONE:
- Fact or data point
- Decision or action item
- Event or observation
- Relationship or connection

Rule: if a sentence contains two independent facts, split it into two chunks.

### 3. CLASSIFY

For each chunk, assign:

```json
{
  "tier": 1,
  "source": "user_stated | agent_generated | imported",
  "source_reliability": "high | medium | low",
  "emotional_tone": "neutral | positive | negative | concerned | ...",
  "emotional_intensity": 0.0-1.0,
  "stakes_level": "high | medium | low",
  "topic_tags": ["tag1", "tag2"],
  "entity_tags": ["Entity1", "Entity2"],
  "decision_made": true/false,
  "status": "open | resolved"
}
```

Tier assignment:
- **Tier 1**: Raw episodic memory (individual facts, events, observations)
- **Tier 2**: Consolidated summary (synthesis of 3+ related T1 chunks)
- **Tier 3**: Schema/pattern (cross-domain insight, permanent knowledge)

### 4. QUESTION

Generate questions at 5 levels for each chunk:

| Level | Type | Example |
|-------|------|---------|
| L1 | Bare Fact | "What is the key fact stated here?" |
| L2 | Explanation | "Why did this happen?" |
| L3 | Implication | "What are the consequences?" |
| L4 | Counterfactual | "What if this hadn't happened?" |
| L5 | Conditional | "Under what conditions would this change?" |

### 5. LINK

Identify relationships between chunks:

| Edge Type | When |
|-----------|------|
| `linked_to` | Chunks share topic/entity/context |
| `amends` | One chunk corrects another |
| `contradicts` | Chunks contain conflicting information |
| `preceded_by` | Temporal sequence |
| `promotes_to` | T1 chunk is part of a T2 summary |
| `answers` | A chunk answers a question |

### 6. SCORE

Set initial relevance weights:
- `access_count`: 1 (new chunk)
- `emotional_intensity`: based on content analysis
- `stakes_level`: "high" if involves decisions, money, deadlines
- `decision_made`: true if the chunk records a decision

### 7. CLUSTER

Group chunks that share 2+ tags or entities. Each cluster gets:
- `member_ids`: list of chunk IDs
- `shared_tags`: tags all members share
- `shared_entities`: entities all members share
- `cluster_strength`: member count / total chunks

### 8. EXPORT

Output format (JSON):

```json
{
  "id": "brain_<project_name>",
  "title": "CAR Brain - <Project Name>",
  "version": "1.0.0",
  "nodes": [
    {
      "id": "chunk_<id>",
      "type": "chunk",
      "label": "<first 50 chars>",
      "description": "<full content>",
      "position": { "x": 0, "y": 0, "z": -200 },
      "data": { ... full chunk metadata ... }
    }
  ],
  "edges": [
    {
      "id": "edge_<id>",
      "type": "linked_to",
      "source": "chunk_a",
      "target": "chunk_b",
      "label": "linked_to"
    }
  ],
  "clusters": [
    {
      "id": "cluster_<id>",
      "label": "Cluster: <topic>",
      "member_ids": ["chunk_a", "chunk_b"],
      "shared_tags": ["topic"],
      "shared_entities": ["Entity"],
      "cluster_strength": 0.5
    }
  ],
  "viewport": { "x": 0, "y": 0, "z": 0, "zoom": 1 },
  "metadata": {
    "createdBy": "car-ingestion",
    "description": "<project description>"
  }
}
```

## Position Guidelines

Place nodes in 3D space by tier:
- **Tier 1 chunks**: z = -200 (mid plane)
- **Tier 2 summaries**: z = -400 (back plane)
- **Tier 3 patterns**: z = -600 (deep plane)
- **Questions**: z = -100 (front-mid)
- **Triggers**: z = -200 (mid plane)

Spread x/y positions to avoid overlap. Related chunks should be near each other.

## Usage

### With Claude Code CLI

```bash
claude -p "Read the file at ./notes.md and process it through the CAR
Ingestion Protocol. Output the result as a JSON file matching the CAR
Brain graph document schema." > brain.json
```

### Manual Import

1. Generate the JSON file using any AI tool
2. Open CAR Brain (http://localhost:4173)
3. Click Import in the toolbar
4. Select the JSON file
5. Watch the brain materialize
