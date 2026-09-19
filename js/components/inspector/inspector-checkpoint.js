// @ts-check

import { EVENTS } from "../../core/event-constants.js";
import { publish } from "../../core/pan.js";
import { checkpointExecutor } from "../../runtime/checkpoint-executor.js";
import { emitNodePatch, escapeHtml, patchNodeData, textValue } from "./shared.js";

class InspectorCheckpoint extends HTMLElement {
  #node = null;

  set node(value) {
    this.#node = value ?? null;
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
    this.#bindApprovalActions();
  }

  #applyPatch(patch) {
    if (this.#node == null) return;
    const next = { ...this.#node, ...patch };
    if (patch.data) next.data = { ...(this.#node.data ?? {}), ...patch.data };
    this.#node = next;
    emitNodePatch(this, patch);
  }

  #bindApprovalActions() {
    this.addEventListener("click", (event) => {
      const button = event.target.closest("[data-checkpoint-action]");
      if (!button) return;

      const action = button.dataset.checkpointAction;
      const token = this.#node?.data?.checkpointToken;
      if (!token) return;

      const commentField = this.querySelector("[data-checkpoint-comment]");
      const comment = commentField ? String(commentField.value ?? "").trim() : "";

      if (action === "approve") {
        publish(EVENTS.RUNTIME_CHECKPOINT_APPROVE_REQUESTED, { token, comment, decidedBy: "user" });
      } else if (action === "reject") {
        publish(EVENTS.RUNTIME_CHECKPOINT_REJECT_REQUESTED, { token, comment, decidedBy: "user" });
      }
    });

    this.addEventListener("change", (event) => {
      const target = event.target;
      const field = target?.dataset?.field;
      if (!field || !this.#node) return;

      if (field === "message") {
        this.#applyPatch(patchNodeData(this.#node, { message: target.value }));
      } else if (field === "notifyWebhookUrl") {
        this.#applyPatch(patchNodeData(this.#node, { notifyWebhookUrl: target.value }));
      } else if (field === "timeoutMs") {
        const ms = Math.max(0, Number(target.value) * 60_000);
        this.#applyPatch(patchNodeData(this.#node, { timeoutMs: isFinite(ms) ? ms : 0 }));
      } else if (field === "timeoutBehavior") {
        this.#applyPatch(patchNodeData(this.#node, { timeoutBehavior: target.value }));
      }
    });
  }

  render() {
    const node = this.#node;
    if (node == null) {
      this.innerHTML = '<p class="inspector-empty">Select a checkpoint node to configure.</p>';
      return;
    }

    const data = node.data ?? {};
    const status = data.status ?? "idle";
    const isPending = status === "pending_approval";
    const isResolved = status === "approved" || status === "completed" || status === "rejected";
    const token = data.checkpointToken ?? null;
    const message = escapeHtml(textValue(data.message ?? ""));
    const webhookUrl = escapeHtml(textValue(data.notifyWebhookUrl ?? ""));
    const timeoutMinutes = Math.round((Number(data.timeoutMs ?? 0)) / 60_000);
    const timeoutBehavior = data.timeoutBehavior ?? "block";

    const approvalUrl = isPending && token ? checkpointExecutor.getApprovalUrl(token) : null;

    const pendingSection = isPending ? `
      <section class="inspector-group checkpoint-approval-section">
        <h4>⏳ Awaiting Your Decision</h4>
        <p class="inspector-help">This workflow is paused. Review the incoming context below and approve or reject to continue.</p>
        ${data.message ? `<div class="checkpoint-inspector-message">${escapeHtml(data.message)}</div>` : ""}
        <label class="inspector-field">
          <span>Comment (optional)</span>
          <textarea data-checkpoint-comment rows="3" placeholder="Add a note for the audit log..."></textarea>
        </label>
        <div class="checkpoint-decision-buttons">
          <button type="button" class="checkpoint-btn-approve" data-checkpoint-action="approve">✓ Approve</button>
          <button type="button" class="checkpoint-btn-reject" data-checkpoint-action="reject">✗ Reject</button>
        </div>
        ${approvalUrl ? `
        <div class="checkpoint-approval-link">
          <span class="inspector-help">Or open the full approval page:</span>
          <a href="${escapeHtml(approvalUrl)}" target="_blank" rel="noopener" class="checkpoint-approval-url">Open Approval Page ↗</a>
        </div>` : ""}
        <p class="inspector-help">Token: <code>${escapeHtml(token ?? "")}</code></p>
      </section>
    ` : "";

    const resolvedSection = isResolved ? `
      <section class="inspector-group">
        <h4>${status === "rejected" ? "✗ Rejected" : "✓ Approved"}</h4>
        <p class="inspector-help">Decided by: <strong>${escapeHtml(data.decidedBy ?? "unknown")}</strong> at ${escapeHtml(data.decidedAt ?? "")}</p>
        ${data.decisionComment ? `<p class="inspector-help">Comment: <em>${escapeHtml(data.decisionComment)}</em></p>` : ""}
      </section>
    ` : "";

    const configSection = !isPending ? `
      <section class="inspector-group">
        <h4>Checkpoint Configuration</h4>
        <label class="inspector-field">
          <span>Reviewer Message</span>
          <textarea data-field="message" rows="4" placeholder="Context message shown to the approver...">${message}</textarea>
        </label>
        <label class="inspector-field">
          <span>Notify Webhook URL</span>
          <input type="url" data-field="notifyWebhookUrl" value="${webhookUrl}" placeholder="https://hooks.slack.com/..." />
        </label>
        <p class="inspector-help">When reached, a POST notification is sent to this URL (works with Slack, Teams, Discord, or any webhook).</p>
        <label class="inspector-field">
          <span>Timeout (minutes, 0 = no timeout)</span>
          <input type="number" data-field="timeoutMs" min="0" step="1" value="${timeoutMinutes}" />
        </label>
        <label class="inspector-field">
          <span>On Timeout</span>
          <select data-field="timeoutBehavior">
            <option value="block" ${timeoutBehavior === "block" ? "selected" : ""}>Block forever (no auto-decision)</option>
            <option value="approve" ${timeoutBehavior === "approve" ? "selected" : ""}>Auto-approve</option>
            <option value="reject" ${timeoutBehavior === "reject" ? "selected" : ""}>Auto-reject</option>
          </select>
        </label>
      </section>
    ` : "";

    this.innerHTML = `
      ${pendingSection}
      ${resolvedSection}
      ${configSection}
      <section class="inspector-group">
        <h4>How Checkpoints Work</h4>
        <p class="inspector-help">When a workflow reaches this node, execution pauses. The approver reviews context data and clicks Approve or Reject. Approved → downstream nodes continue. Rejected → workflow stops here.</p>
        <p class="inspector-help">When a workflow reaches this node, the <strong>Open Approval Page</strong> link appears — share it with a reviewer. Decisions are stored locally in your browser and sync back to the running workflow automatically via BroadcastChannel.</p>
      </section>
    `;
  }
}

customElements.define("inspector-checkpoint", InspectorCheckpoint);
