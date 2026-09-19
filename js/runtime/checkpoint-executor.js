// @ts-check

import { EVENTS } from "../core/event-constants.js";
import { subscribe } from "../core/pan.js";
import { checkpointStore } from "../store/checkpoint-store.js";
import { graphStore } from "../store/graph-store.js";

const makeToken = () => `chk_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;

class CheckpointExecutor {
  /** @type {Map<string, { resolve: Function, nodeId: string }>} */
  #pending = new Map();
  /** @type {Map<string, string>} nodeId -> token */
  #nodeTokens = new Map();
  /** @type {(() => void)|null} */
  #unsubscribeDecisions = null;

  constructor() {
    // Same-tab decisions via PAN events (inspector approve/reject buttons)
    subscribe(EVENTS.RUNTIME_CHECKPOINT_APPROVE_REQUESTED, ({ payload }) => {
      const token = String(payload?.token ?? "");
      const comment = String(payload?.comment ?? "");
      const decidedBy = String(payload?.decidedBy ?? "user");
      const decidedAt = new Date().toISOString();
      this.#resolvePending(token, { approved: true, comment, decidedBy, decidedAt });
      // Persist the decision so approval.html reflects the in-app action.
      checkpointStore.resolve(token, { approved: true, comment, decidedBy, decidedAt }).catch(() => {});
    });

    subscribe(EVENTS.RUNTIME_CHECKPOINT_REJECT_REQUESTED, ({ payload }) => {
      const token = String(payload?.token ?? "");
      const comment = String(payload?.comment ?? "");
      const decidedBy = String(payload?.decidedBy ?? "user");
      const decidedAt = new Date().toISOString();
      this.#resolvePending(token, { approved: false, comment, decidedBy, decidedAt });
      checkpointStore.resolve(token, { approved: false, comment, decidedBy, decidedAt }).catch(() => {});
    });

    // Cross-tab decisions via BroadcastChannel (approval.html → main app)
    this.#unsubscribeDecisions = checkpointStore.onDecision(({ token, approved, comment, decidedBy, decidedAt }) => {
      this.#resolvePending(token, { approved, comment, decidedBy, decidedAt });
    });
  }

  /**
   * Called by runtimes when a checkpoint node is reached.
   * Writes the pending record to IndexedDB so approval.html can read it.
   *
   * @param {string} nodeId
   * @param {{ nodeLabel?: string, message?: string, inputPayload?: unknown }} [meta]
   * @returns {{ token: string, decision: Promise<{approved: boolean, comment: string, decidedBy: string, decidedAt: string}> }}
   */
  createPending(nodeId, meta = {}) {
    // Cancel any existing pending for this node
    const existingToken = this.#nodeTokens.get(nodeId);
    if (existingToken) {
      this.#pending.delete(existingToken);
    }

    const token = makeToken();
    const decision = new Promise((resolve) => {
      this.#pending.set(token, { resolve, nodeId });
    });
    this.#nodeTokens.set(nodeId, token);

    // Persist to IndexedDB asynchronously — non-blocking, best effort.
    const graphDoc = graphStore.getDocument();
    checkpointStore.create({
      token,
      nodeId,
      nodeLabel: String(meta.nodeLabel ?? nodeId),
      graphTitle: String(graphDoc?.title ?? "Untitled MindGraph"),
      message: String(meta.message ?? ""),
      inputPayload: meta.inputPayload ?? null,
      createdAt: new Date().toISOString()
    }).catch(() => {
      // IDB write failure is non-fatal — in-memory flow still works.
    });

    return { token, decision };
  }

  hasPending(token) {
    return this.#pending.has(token);
  }

  getPendingCount() {
    return this.#pending.size;
  }

  getTokenForNode(nodeId) {
    return this.#nodeTokens.get(nodeId) ?? null;
  }

  cancelNode(nodeId) {
    const token = this.#nodeTokens.get(nodeId);
    if (!token) return;
    const decidedAt = new Date().toISOString();
    this.#resolvePending(token, {
      approved: false,
      comment: "Cancelled",
      decidedBy: "system",
      decidedAt
    });
    checkpointStore.resolve(token, {
      approved: false,
      comment: "Cancelled",
      decidedBy: "system",
      decidedAt
    }).catch(() => {});
    this.#nodeTokens.delete(nodeId);
  }

  /**
   * Build the URL for the standalone approval page for a given token.
   * Returns null if not in a browser context.
   * @param {string} token
   */
  getApprovalUrl(token) {
    if (typeof location === "undefined") return null;
    const base = location.href.replace(/\/[^/]*$/, "/");
    return `${base}approval.html?token=${encodeURIComponent(token)}`;
  }

  #resolvePending(token, decision) {
    const entry = this.#pending.get(token);
    if (!entry) return;
    this.#pending.delete(token);
    this.#nodeTokens.delete(entry.nodeId);
    entry.resolve(decision);
  }
}

export const checkpointExecutor = new CheckpointExecutor();
