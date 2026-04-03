import { DATA_COLORS_CSS, TIER_COLOR_CSS } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { EDGE_TYPE_VALUES } from "../core/types.js";
import { graphStore } from "../store/graph-store.js";
import { escapeHtml } from "./inspector/shared.js";

/* ── Tabs per node type ── */

const CHUNK_TABS = [
	{ key: "overview", label: "Overview" },
	{ key: "metadata", label: "Metadata" },
	{ key: "retrieval", label: "Retrieval" },
	{ key: "timeline", label: "Timeline" },
	{ key: "scoring", label: "Scoring" },
];

const QUESTION_TABS = [{ key: "questions", label: "Questions" }];

const CLUSTER_TABS = [{ key: "cluster", label: "Cluster" }];

const PATTERN_TABS = [
	{ key: "overview", label: "Overview" },
	{ key: "metadata", label: "Evidence" },
];

const TRIGGER_TABS = [
	{ key: "overview", label: "Overview" },
	{ key: "metadata", label: "Conditions" },
];

const getTabsForType = (type) => {
	switch (type) {
		case "chunk":
			return CHUNK_TABS;
		case "question":
			return QUESTION_TABS;
		case "cluster":
			return CLUSTER_TABS;
		case "pattern":
			return PATTERN_TABS;
		case "trigger":
			return TRIGGER_TABS;
		default:
			return CHUNK_TABS;
	}
};

/* ── Tier badge helper ── */

const tierBadge = (tier) => {
	const color = TIER_COLOR_CSS[tier] ?? TIER_COLOR_CSS[1];
	return `<span class="tag tag-t${tier}" style="border-color:${color}40;color:${color}">T${tier}</span>`;
};

const typeBadge = (type) => {
	const colors = {
		chunk: DATA_COLORS_CSS.T1,
		question: DATA_COLORS_CSS.QUESTION,
		trigger: DATA_COLORS_CSS.TRIGGER,
		pattern: DATA_COLORS_CSS.T3,
		cluster: "#ffffff",
	};
	const c = colors[type] ?? "#c9d1d9";
	return `<span class="tag" style="border-color:${c}40;color:${c}">${type}</span>`;
};

/* ── KV row helper ── */

const kv = (label, value) =>
	`<span class="inspector-kv-label">${escapeHtml(label)}</span>
   <span class="inspector-kv-value">${escapeHtml(String(value ?? "-"))}</span>`;

const kvHtml = (label, html) =>
	`<span class="inspector-kv-label">${escapeHtml(label)}</span>
   <span class="inspector-kv-value">${html}</span>`;

/* ── Tab renderers ── */

const renderChunkOverview = (node) => {
	const d = node.data ?? {};
	const content = escapeHtml(d.content || node.description || "(no content)");
	const gaugeWidth = Math.round(
		((d.access_count ?? 1) / Math.max(d.access_count ?? 1, 10)) * 100,
	);
	const gaugeColor = TIER_COLOR_CSS[d.tier ?? 1];

	return `
    <div class="inspector-section-title">Content</div>
    <p style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--text-primary);line-height:1.5;margin:0">${content}</p>

    <div class="inspector-section-title">Properties</div>
    <div class="inspector-kv">
      ${kvHtml("Tier", tierBadge(d.tier ?? 1))}
      ${kv("Status", d.status ?? "open")}
      ${kv("Emotional Tone", d.emotional_tone ?? "neutral")}
      ${kv("Emotional Intensity", (d.emotional_intensity ?? 0).toFixed(2))}
      ${kv("Stakes", d.stakes_level ?? "low")}
      ${kv("Decision Made", d.decision_made ? "Yes" : "No")}
    </div>

    <div class="inspector-section-title">Relevance</div>
    <div class="relevance-gauge">
      <div class="relevance-gauge-fill" style="width:${gaugeWidth}%;background:${gaugeColor}"></div>
    </div>
    <div style="font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--text-muted);margin-top:2px">
      ${d.access_count ?? 1} accesses
    </div>
  `;
};

const renderChunkMetadata = (node) => {
	const d = node.data ?? {};
	const tags = (d.topic_tags ?? [])
		.map((t) => `<span class="tag tag-t1">${escapeHtml(t)}</span>`)
		.join(" ");
	const entities = (d.entity_tags ?? [])
		.map((t) => `<span class="tag tag-t2">${escapeHtml(t)}</span>`)
		.join(" ");

	return `
    <div class="inspector-section-title">Source</div>
    <div class="inspector-kv">
      ${kv("Source", d.source ?? "user_stated")}
      ${kv("Reliability", d.source_reliability ?? "high")}
      ${kv("Session", d.session_id || "-")}
      ${kv("Created", node.metadata?.createdAt ?? "-")}
      ${kv("Last Accessed", d.last_accessed ?? "-")}
      ${kv("Access Count", d.access_count ?? 0)}
    </div>

    <div class="inspector-section-title">Participants</div>
    <span style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--text-primary)">
      ${(d.participants ?? []).join(", ") || "-"}
    </span>

    <div class="inspector-section-title">Topic Tags</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${tags || "<span style='color:var(--text-muted)'>-</span>"}</div>

    <div class="inspector-section-title">Entity Tags</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">${entities || "<span style='color:var(--text-muted)'>-</span>"}</div>

    <div class="inspector-section-title">Action Items</div>
    <span style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--text-primary)">
      ${(d.action_items ?? []).join(", ") || "-"}
    </span>
  `;
};

const renderChunkRetrieval = (node) => {
	const d = node.data ?? {};
	const cues = (d.retrieval_cues ?? [])
		.map(
			(c) =>
				`<div style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--text-primary);padding:2px 0">${escapeHtml(c)}</div>`,
		)
		.join("");
	const questions = (d.generated_questions ?? [])
		.map(
			(q) =>
				`<div style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--color-question);padding:2px 0">${escapeHtml(q)}</div>`,
		)
		.join("");
	const links = (d.linked_chunks ?? [])
		.map(
			(id) =>
				`<div style="font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--color-t1);padding:2px 0;cursor:pointer" data-link-node="${id}">${escapeHtml(id)}</div>`,
		)
		.join("");

	return `
    <div class="inspector-section-title">Retrieval Cues</div>
    ${cues || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No cues generated yet</span>'}

    <div class="inspector-section-title">Generated Questions</div>
    ${questions || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No questions generated yet</span>'}

    <div class="inspector-section-title">Linked Chunks</div>
    ${links || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No links</span>'}
  `;
};

const renderChunkTimeline = (node) => {
	const d = node.data ?? {};
	const amendments = (d.amendments ?? [])
		.map(
			(a, i) => `<div class="log-row">
      <span class="log-step">#${i + 1}</span>
      <span class="log-message">${escapeHtml(a.content ?? a)}</span>
    </div>`,
		)
		.join("");

	return `
    <div class="inspector-section-title">Context Chain</div>
    <div class="inspector-kv">
      ${kv("Preceding", d.preceding_context_id ?? "none")}
      ${kv("Following", d.following_context_id ?? "none")}
    </div>

    <div class="inspector-section-title">Amendments</div>
    ${amendments || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No amendments</span>'}
  `;
};

const renderChunkScoring = (node) => {
	const d = node.data ?? {};
	return `
    <div class="inspector-section-title">Relevance Factors</div>
    <div class="inspector-kv">
      ${kv("Recency (days since created)", "—")}
      ${kv("Frequency (access_count)", d.access_count ?? 1)}
      ${kv("Emotional Weight", (d.emotional_intensity ?? 0).toFixed(2))}
      ${kv("Decision Made", d.decision_made ? "1.3x" : "1.0x")}
      ${kv("Connections", (d.linked_chunks ?? []).length)}
      ${kv("Zeigarnik (open?)", d.status === "open" ? "1.5x" : "1.0x")}
    </div>
    <div class="inspector-section-title" style="margin-top:var(--space-3)">Computed Score</div>
    <span style="font-family:var(--font-mono);font-size:var(--font-size-lg);color:var(--color-t1)">—</span>
    <span style="font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--text-muted);margin-left:var(--space-2)">
      (calculated at retrieval time)
    </span>
  `;
};

const renderQuestionTab = (node) => {
	const d = node.data ?? {};
	const levelLabels = [
		"",
		"Bare Fact",
		"Explanation",
		"Implication",
		"Counterfactual",
		"Conditional",
	];
	return `
    <div class="inspector-section-title">Question</div>
    <div class="inspector-kv">
      ${kvHtml("Level", `<span class="tag tag-question">L${d.level ?? 1} ${levelLabels[d.level ?? 1] ?? ""}</span>`)}
      ${kv("Question", d.question_text ?? "(empty)")}
      ${kv("Answered", d.answered ? "Yes" : "No")}
      ${kv("Answer", d.answer_text ?? "-")}
      ${kv("Confidence", d.confidence != null ? d.confidence.toFixed(2) : "-")}
      ${kv("Parent Q", d.parent_question_id ?? "none")}
    </div>

    <div class="inspector-section-title">Linked Chunks</div>
    ${(d.linked_chunk_ids ?? []).map((id) => `<div style="font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--color-t1);padding:2px 0">${escapeHtml(id)}</div>`).join("") || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No linked chunks</span>'}
  `;
};

const renderClusterTab = (node) => {
	const d = node.data ?? {};
	const members = (d.member_ids ?? [])
		.map(
			(id) =>
				`<div style="font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--color-t1);padding:2px 0">${escapeHtml(id)}</div>`,
		)
		.join("");

	return `
    <div class="inspector-section-title">Cluster</div>
    <div class="inspector-kv">
      ${kv("Members", (d.member_ids ?? []).length)}
      ${kv("Strength", d.cluster_strength ?? 0)}
    </div>

    <div class="inspector-section-title">Shared Tags</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      ${(d.shared_tags ?? []).map((t) => `<span class="tag tag-t1">${escapeHtml(t)}</span>`).join("") || "-"}
    </div>

    <div class="inspector-section-title">Members</div>
    ${members || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No members</span>'}
  `;
};

const renderPatternOverview = (node) => {
	const d = node.data ?? {};
	return `
    <div class="inspector-section-title">Pattern</div>
    <div class="inspector-kv">
      ${kv("Pattern", d.pattern ?? "-")}
      ${kv("Type", d.pattern_type ?? "-")}
      ${kv("Confidence", d.confidence != null ? d.confidence.toFixed(2) : "-")}
      ${kv("Implication", d.implication ?? "-")}
    </div>
  `;
};

const renderPatternEvidence = (node) => {
	const d = node.data ?? {};
	return `
    <div class="inspector-section-title">Evidence Chunks</div>
    ${(d.evidence ?? []).map((id) => `<div style="font-family:var(--font-mono);font-size:var(--font-size-xs);color:var(--color-t1);padding:2px 0">${escapeHtml(id)}</div>`).join("") || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No evidence</span>'}

    <div class="inspector-section-title">Exceptions</div>
    ${(d.exceptions ?? []).map((e) => `<div style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--color-contradiction);padding:2px 0">${escapeHtml(e)}</div>`).join("") || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">None</span>'}
  `;
};

const renderTriggerOverview = (node) => {
	const d = node.data ?? {};
	return `
    <div class="inspector-section-title">Trigger</div>
    <div class="inspector-kv">
      ${kv("Content", d.content ?? node.description ?? "-")}
      ${kv("Fired", d.fired ? "Yes" : "No")}
      ${kv("Fire Count", d.fire_count ?? 0)}
      ${kv("Expires", d.expires ?? "never")}
    </div>
  `;
};

const renderTriggerConditions = (node) => {
	const d = node.data ?? {};
	return `
    <div class="inspector-section-title">Conditions</div>
    ${(d.trigger_conditions ?? []).map((c) => `<div style="font-family:var(--font-mono);font-size:var(--font-size-sm);color:var(--color-trigger);padding:2px 0">${escapeHtml(c)}</div>`).join("") || '<span style="color:var(--text-muted);font-size:var(--font-size-sm)">No conditions</span>'}
  `;
};

/* ── Tab content dispatcher ── */

const renderTabContent = (node, tab) => {
	if (!node)
		return '<p class="inspector-empty">Select a memory chunk to inspect its metadata, or ask a question to watch the brain think.</p>';

	switch (node.type) {
		case "chunk":
			switch (tab) {
				case "overview":
					return renderChunkOverview(node);
				case "metadata":
					return renderChunkMetadata(node);
				case "retrieval":
					return renderChunkRetrieval(node);
				case "timeline":
					return renderChunkTimeline(node);
				case "scoring":
					return renderChunkScoring(node);
				default:
					return renderChunkOverview(node);
			}
		case "question":
			return renderQuestionTab(node);
		case "cluster":
			return renderClusterTab(node);
		case "pattern":
			return tab === "metadata"
				? renderPatternEvidence(node)
				: renderPatternOverview(node);
		case "trigger":
			return tab === "metadata"
				? renderTriggerConditions(node)
				: renderTriggerOverview(node);
		default:
			return renderChunkOverview(node);
	}
};

/* ── Inspector Panel component ── */

class InspectorPanel extends HTMLElement {
	#dispose = [];
	#activeTab = "overview";
	#selectedNodeId = null;
	#selectedNode = null;
	#selectedEdgeId = null;
	#selectedEdge = null;

	connectedCallback() {
		this.addEventListener("inspector-node-patch", (event) =>
			this.#onNodePatch(event),
		);

		this.#dispose.push(
			subscribe(EVENTS.INSPECTOR_TAB_CHANGED, ({ payload }) => {
				this.#activeTab = payload?.tab ?? "overview";
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_SELECTION_SET, ({ payload }) => {
				this.#selectedNodeId = payload?.nodeId ?? null;
				this.#selectedNode = this.#selectedNodeId
					? graphStore.getNode(this.#selectedNodeId)
					: null;
				this.#selectedEdgeId = null;
				this.#selectedEdge = null;
				// Reset tab to first available for this node type
				if (this.#selectedNode) {
					const tabs = getTabsForType(this.#selectedNode.type);
					if (!tabs.find((t) => t.key === this.#activeTab)) {
						this.#activeTab = tabs[0]?.key ?? "overview";
					}
				}
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_SELECTION_CLEARED, () => {
				this.#selectedNodeId = null;
				this.#selectedNode = null;
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_EDGE_SELECTED, ({ payload }) => {
				this.#selectedEdgeId = payload?.edgeId ?? null;
				this.#selectedEdge = this.#selectedEdgeId
					? graphStore.getEdge(this.#selectedEdgeId)
					: null;
				this.#selectedNodeId = null;
				this.#selectedNode = null;
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_EDGE_SELECTION_CLEARED, () => {
				this.#selectedEdgeId = null;
				this.#selectedEdge = null;
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_NODE_UPDATED, ({ payload }) => {
				if (payload?.nodeId == null || payload.nodeId !== this.#selectedNodeId)
					return;
				this.#selectedNode = graphStore.getNode(this.#selectedNodeId);
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_NODE_DELETED, ({ payload }) => {
				if (payload?.nodeId == null || payload.nodeId !== this.#selectedNodeId)
					return;
				this.#selectedNodeId = null;
				this.#selectedNode = null;
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_EDGE_UPDATED, ({ payload }) => {
				if (payload?.edgeId == null || payload.edgeId !== this.#selectedEdgeId)
					return;
				this.#selectedEdge = graphStore.getEdge(this.#selectedEdgeId);
				this.render();
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_EDGE_DELETED, ({ payload }) => {
				if (payload?.edgeId == null || payload.edgeId !== this.#selectedEdgeId)
					return;
				this.#selectedEdgeId = null;
				this.#selectedEdge = null;
				this.render();
			}),
		);

		this.render();
	}

	disconnectedCallback() {
		this.#dispose.forEach((run) => run());
		this.#dispose = [];
	}

	#onNodePatch(event) {
		const patch = event.detail?.patch;
		if (
			this.#selectedNodeId == null ||
			patch == null ||
			typeof patch !== "object"
		)
			return;

		publish(EVENTS.GRAPH_NODE_UPDATE_REQUESTED, {
			nodeId: this.#selectedNodeId,
			patch,
			origin: "inspector-panel",
		});
	}

	#bindEdgeInspector() {
		if (!this.#selectedEdgeId || !this.#selectedEdge) return;

		this.querySelector('[data-field="edge-type"]')?.addEventListener(
			"change",
			(event) => {
				publish(EVENTS.GRAPH_EDGE_UPDATE_REQUESTED, {
					edgeId: this.#selectedEdgeId,
					patch: { type: event.target.value },
					origin: "inspector-panel",
				});
			},
		);

		this.querySelector('[data-field="edge-label"]')?.addEventListener(
			"change",
			(event) => {
				publish(EVENTS.GRAPH_EDGE_UPDATE_REQUESTED, {
					edgeId: this.#selectedEdgeId,
					patch: { label: event.target.value },
					origin: "inspector-panel",
				});
			},
		);

		this.querySelector('[data-action="delete-edge"]')?.addEventListener(
			"click",
			() => {
				publish(EVENTS.GRAPH_EDGE_DELETE_REQUESTED, {
					edgeId: this.#selectedEdgeId,
					origin: "inspector-panel",
				});
			},
		);
	}

	#bindTabs() {
		this.querySelectorAll("[data-inspector-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				publish(EVENTS.INSPECTOR_TAB_CHANGED, {
					tab: button.dataset.inspectorTab,
					origin: "inspector-panel",
				});
			});
		});

		// Link clicks inside inspector
		this.querySelectorAll("[data-link-node]").forEach((el) => {
			el.addEventListener("click", () => {
				const nodeId = el.dataset.linkNode;
				if (nodeId) {
					publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
						nodeId,
						origin: "inspector-panel",
					});
				}
			});
		});
	}

	render() {
		if (this.#selectedEdge) {
			const edge = this.#selectedEdge;
			const sourceNode = graphStore.getNode(edge.source);
			const targetNode = graphStore.getNode(edge.target);
			const sourceLabel = escapeHtml(
				sourceNode?.label ?? edge.source ?? "(unknown)",
			);
			const targetLabel = escapeHtml(
				targetNode?.label ?? edge.target ?? "(unknown)",
			);
			const label = escapeHtml(String(edge.label ?? ""));

			this.innerHTML = `
        <aside class="mg-panel mg-inspector-panel">
          <header>Edge Inspector</header>
          <div class="content inspector-layout">
            <div class="inspector-summary">
              <p class="inspector-node-title">${sourceLabel} → ${targetLabel}</p>
              <p class="inspector-node-meta">${escapeHtml(edge.type ?? "linked_to")}</p>
            </div>
            <div class="inspector-section-title">Edge Details</div>
            <label class="inspector-field">
              <span>Type</span>
              <select data-field="edge-type">
                ${EDGE_TYPE_VALUES.map(
									(type) =>
										`<option value="${type}" ${type === edge.type ? "selected" : ""}>${type}</option>`,
								).join("")}
              </select>
            </label>
            <label class="inspector-field">
              <span>Label</span>
              <input type="text" data-field="edge-label" value="${label}" placeholder="Optional label" />
            </label>
            <button class="toolbar-btn" type="button" data-action="delete-edge" style="margin-top:var(--space-2)">Delete Edge</button>
          </div>
        </aside>
      `;
			this.#bindEdgeInspector();
			return;
		}

		const node = this.#selectedNode;
		const tabs = node ? getTabsForType(node.type) : [];
		const tabContent = renderTabContent(node, this.#activeTab);

		this.innerHTML = `
      <aside class="mg-panel mg-inspector-panel">
        <header>Inspector</header>
        <div class="content inspector-layout">
          ${
						node
							? `
            <div class="inspector-summary">
              <p class="inspector-node-title">${escapeHtml(node.label)}</p>
              <p class="inspector-node-meta">${typeBadge(node.type)} ${node.type === "chunk" ? tierBadge(node.data?.tier ?? 1) : ""}</p>
            </div>
            <div class="inspector-tabs" role="tablist" aria-label="Inspector tabs">
              ${tabs
								.map(
									(tab) =>
										`<button type="button" role="tab" data-inspector-tab="${tab.key}"
                      aria-selected="${this.#activeTab === tab.key}"
                      aria-pressed="${this.#activeTab === tab.key}">${tab.label}</button>`,
								)
								.join("")}
            </div>
            <div class="inspector-tab-content">${tabContent}</div>
          `
							: `<p class="inspector-empty">Select a memory chunk to inspect its metadata, or ask a question to watch the brain think.</p>`
					}
        </div>
      </aside>
    `;

		this.#bindTabs();
	}
}

customElements.define("inspector-panel", InspectorPanel);
