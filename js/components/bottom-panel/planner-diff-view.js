import { EVENTS } from "../../core/event-constants.js";
import { publish } from "../../core/pan.js";
import {
  diffPlannerSnapshots,
  normalizePlannerSnapshot,
  plannerStatusLabel
} from "../../runtime/planner-snapshot-diff.js";
import { escapeHtml, formatDateTime, toArray } from "./shared.js";

const toSnapshotId = (snapshot, index) =>
  String(snapshot?.snapshotId ?? `planner_snapshot_${index}`);

const parseTime = (value) => {
  const stamp = Date.parse(value ?? "");
  return Number.isFinite(stamp) ? stamp : Number.NaN;
};

const formatOrderIndex = (value) => {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0) return "n/a";
  return `#${index + 1}`;
};

const optionLabel = (snapshot) => {
  const time = formatDateTime(snapshot?.at);
  const mode = escapeHtml(snapshot?.mode ?? "unknown");
  const ready = Number(snapshot?.readyNodeIds?.length ?? 0);
  const blocked = Number(snapshot?.blockedNodeIds?.length ?? 0);
  return `${time} • ${mode} • ${ready} ready / ${blocked} blocked`;
};

const renderDelta = (label, delta, { addedPrefix = "+", removedPrefix = "-" } = {}) => {
  if (!delta?.changed) return "";
  return `
    <div class="planner-diff-delta-group">
      <span class="planner-diff-delta-label">${escapeHtml(label)}</span>
      <div class="planner-diff-delta-chips">
        ${delta.added.map((entry) => `<span class="chip planner-diff-chip-added">${addedPrefix}${escapeHtml(entry)}</span>`).join("")}
        ${delta.removed.map((entry) => `<span class="chip planner-diff-chip-removed">${removedPrefix}${escapeHtml(entry)}</span>`).join("")}
      </div>
    </div>
  `;
};

class BottomPlannerDiffView extends HTMLElement {
  #snapshots = [];
  #nodeLabelMap = new Map();
  #beforeId = null;
  #afterId = null;
  #filter = "";
  #statusOnly = false;
  #diffCache = new Map();

  set snapshots(value) {
    const normalized = toArray(value)
      .map((entry, index) => normalizePlannerSnapshot(entry, `planner_snapshot_${index}`))
      .map((entry, index) => ({
        ...entry,
        snapshotId: toSnapshotId(entry, index)
      }))
      .sort((a, b) => {
        const left = parseTime(a.at);
        const right = parseTime(b.at);
        if (Number.isNaN(left) || Number.isNaN(right)) return 0;
        return right - left;
      });

    const previousIds = new Set(this.#snapshots.map((entry) => entry.snapshotId));
    const nextIds = new Set(normalized.map((entry) => entry.snapshotId));
    const changed =
      normalized.length !== this.#snapshots.length ||
      [...nextIds].some((id) => !previousIds.has(id));

    this.#snapshots = normalized;

    if (!this.#snapshots.find((entry) => entry.snapshotId === this.#afterId)) {
      this.#afterId = this.#snapshots[0]?.snapshotId ?? null;
    }

    if (!this.#snapshots.find((entry) => entry.snapshotId === this.#beforeId)) {
      this.#beforeId = this.#snapshots[1]?.snapshotId ?? this.#snapshots[0]?.snapshotId ?? null;
    }

    if (changed) this.#diffCache.clear();
    if (this.isConnected) this.render();
  }

  set nodeLabels(value) {
    this.#nodeLabelMap = new Map(
      toArray(value)
        .filter((node) => node?.id)
        .map((node) => [node.id, node.label ?? node.id])
    );
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #snapshotById(snapshotId) {
    return this.#snapshots.find((entry) => entry.snapshotId === snapshotId) ?? null;
  }

  #diffFor(beforeSnapshot, afterSnapshot) {
    const key = `${beforeSnapshot?.snapshotId ?? "none"}::${afterSnapshot?.snapshotId ?? "none"}`;
    if (this.#diffCache.has(key)) return this.#diffCache.get(key);

    const diff = diffPlannerSnapshots(beforeSnapshot, afterSnapshot);
    this.#diffCache.set(key, diff);
    return diff;
  }

  #bind() {
    this.querySelector('[data-field="before-snapshot"]')?.addEventListener("change", (event) => {
      this.#beforeId = String(event.target.value ?? "").trim() || null;
      this.render();
    });

    this.querySelector('[data-field="after-snapshot"]')?.addEventListener("change", (event) => {
      this.#afterId = String(event.target.value ?? "").trim() || null;
      this.render();
    });

    this.querySelector('[data-field="planner-diff-filter"]')?.addEventListener("input", (event) => {
      this.#filter = String(event.target.value ?? "");
      this.render();
    });

    this.querySelector('[data-field="planner-diff-status-only"]')?.addEventListener("change", (event) => {
      this.#statusOnly = Boolean(event.target.checked);
      this.render();
    });

    this.querySelectorAll('[data-action="focus-node"]').forEach((button) => {
      button.addEventListener("click", () => {
        const nodeId = String(button.dataset.nodeId ?? "").trim();
        if (!nodeId) return;
        publish(EVENTS.GRAPH_NODE_SELECT_REQUESTED, {
          nodeId,
          additive: false,
          toggle: false,
          origin: "bottom-planner-diff-view"
        });
      });
    });
  }

  render() {
    if (this.#snapshots.length < 2) {
      this.innerHTML = `
        <p class="panel-empty">
          Planner diff will appear after at least two planner snapshots are captured.
        </p>
      `;
      return;
    }

    const before = this.#snapshotById(this.#beforeId) ?? this.#snapshots[1] ?? null;
    const after = this.#snapshotById(this.#afterId) ?? this.#snapshots[0] ?? null;

    if (!before || !after) {
      this.innerHTML = '<p class="panel-empty">Unable to load selected planner snapshots.</p>';
      return;
    }

    const sameSnapshot = before.snapshotId === after.snapshotId;
    const diff = this.#diffFor(before, after);

    const nodeLabelMap = this.#nodeLabelMap;

    const query = this.#filter.trim().toLowerCase();
    const filteredChanges = diff.nodeChanges.filter((change) => {
      if (this.#statusOnly && !change.statusChanged) return false;
      if (!query) return true;
      const label = String(nodeLabelMap.get(change.nodeId) ?? change.nodeId).toLowerCase();
      return label.includes(query) || change.nodeId.toLowerCase().includes(query);
    });

    const capped = filteredChanges.slice(0, 160);
    const hiddenCount = Math.max(0, filteredChanges.length - capped.length);

    this.innerHTML = `
      <div class="planner-diff-shell">
        <section class="panel-split planner-diff-controls">
          <h4>Snapshot Comparison</h4>
          <div class="planner-diff-controls-grid">
            <label class="runtime-settings-field">
              <span>Before Snapshot</span>
              <select data-field="before-snapshot">
                ${this.#snapshots
                  .map(
                    (snapshot) =>
                      `<option value="${escapeHtml(snapshot.snapshotId)}" ${snapshot.snapshotId === before.snapshotId ? "selected" : ""}>${escapeHtml(optionLabel(snapshot))}</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label class="runtime-settings-field">
              <span>After Snapshot</span>
              <select data-field="after-snapshot">
                ${this.#snapshots
                  .map(
                    (snapshot) =>
                      `<option value="${escapeHtml(snapshot.snapshotId)}" ${snapshot.snapshotId === after.snapshotId ? "selected" : ""}>${escapeHtml(optionLabel(snapshot))}</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label class="runtime-settings-field runtime-settings-field-wide">
              <span>Filter Nodes</span>
              <input type="text" data-field="planner-diff-filter" value="${escapeHtml(this.#filter)}" placeholder="Filter by node id or label" />
            </label>
            <label class="inspector-field checkbox planner-diff-toggle">
              <input type="checkbox" data-field="planner-diff-status-only" ${this.#statusOnly ? "checked" : ""} />
              <span>Show only status changes</span>
            </label>
          </div>
        </section>

        ${
          sameSnapshot
            ? '<p class="panel-empty">Pick two different snapshots to see a diff.</p>'
            : `
              <section class="panel-split">
                <h4>Summary</h4>
                <div class="planner-diff-summary-row">
                  <span class="chip">${diff.summary.statusChangedCount} status changed</span>
                  <span class="chip">${diff.summary.newlyBlockedCount} newly blocked</span>
                  <span class="chip">${diff.summary.newlyReadyCount} newly ready</span>
                  <span class="chip">${diff.summary.changedNodeCount} nodes changed</span>
                </div>
              </section>

              <section class="panel-split">
                <h4>Changed Nodes (${filteredChanges.length})</h4>
                ${
                  !capped.length
                    ? '<p class="panel-empty">No node changes match the current filters.</p>'
                    : `<ul class="panel-rows planner-diff-list">
                        ${capped
                          .map((change) => {
                            const nodeLabel = String(nodeLabelMap.get(change.nodeId) ?? change.nodeId);
                            const statusText = change.statusChanged
                              ? `${plannerStatusLabel(change.statusBefore)} -> ${plannerStatusLabel(change.statusAfter)}`
                              : plannerStatusLabel(change.statusAfter);

                            const rowClass = change.newlyBlocked
                              ? "panel-row panel-row-error"
                              : "panel-row";

                            return `
                              <li class="${rowClass}">
                                <div class="panel-row-main planner-diff-node-row">
                                  <strong>${escapeHtml(nodeLabel)}</strong>
                                  <code>${escapeHtml(change.nodeId)}</code>
                                  <span class="chip">${escapeHtml(statusText)}</span>
                                </div>
                                <div class="planner-diff-node-actions">
                                  <button type="button" data-action="focus-node" data-node-id="${escapeHtml(change.nodeId)}">Select node</button>
                                </div>
                                <div class="planner-diff-change-grid">
                                  ${
                                    change.blockedReasons.changed
                                      ? renderDelta("Blocked reasons", change.blockedReasons)
                                      : ""
                                  }
                                  ${
                                    change.upstreamDependencies.changed
                                      ? renderDelta("Dependencies", change.upstreamDependencies)
                                      : ""
                                  }
                                  ${
                                    change.missingRequiredPorts.changed
                                      ? renderDelta("Missing ports", change.missingRequiredPorts)
                                      : ""
                                  }
                                  ${
                                    change.executionOrder.changed
                                      ? `<div class="planner-diff-delta-group">
                                          <span class="planner-diff-delta-label">Execution order</span>
                                          <span class="chip">${escapeHtml(formatOrderIndex(change.executionOrder.before))} -> ${escapeHtml(formatOrderIndex(change.executionOrder.after))}</span>
                                        </div>`
                                      : ""
                                  }
                                  ${
                                    change.stale.changed
                                      ? `<div class="planner-diff-delta-group">
                                          <span class="planner-diff-delta-label">Rerun hint</span>
                                          <span class="chip">${change.stale.beforeNeedsRerun ? "needs rerun" : "fresh"} -> ${change.stale.afterNeedsRerun ? "needs rerun" : "fresh"}</span>
                                          ${renderDelta("Stale inputs", change.stale.dependencies)}
                                        </div>`
                                      : ""
                                  }
                                </div>
                              </li>
                            `;
                          })
                          .join("")}
                      </ul>`
                }
                ${
                  hiddenCount
                    ? `<p class="inspector-help">Showing first ${capped.length} changed nodes. Refine filters to inspect the remaining ${hiddenCount}.</p>`
                    : ""
                }
              </section>
            `
        }
      </div>
    `;

    this.#bind();
  }
}

customElements.define("bottom-planner-diff-view", BottomPlannerDiffView);
