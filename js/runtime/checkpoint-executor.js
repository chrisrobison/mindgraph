// @ts-check

import { EVENTS } from "../core/event-constants.js";
import { subscribe } from "../core/pan.js";

const makeToken = () => `chk_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;

class CheckpointExecutor {
  /** @type {Map<string, { resolve: Function, nodeId: string }>} */
  #pending = new Map();
  /** @type {Map<string, string>} nodeId -> token */
  #nodeTokens = new Map();

  constructor() {
    subscribe(EVENTS.RUNTIME_CHECKPOINT_APPROVE_REQUESTED, ({ payload }) => {
      const token = String(payload?.token ?? "");
      const comment = String(payload?.comment ?? "");
      const decidedBy = String(payload?.decidedBy ?? "user");
      this.#resolve(token, {
        approved: true,
        comment,
        decidedBy,
        decidedAt: new Date().toISOString()
      });
    });

    subscribe(EVENTS.RUNTIME_CHECKPOINT_REJECT_REQUESTED, ({ payload }) => {
      const token = String(payload?.token ?? "");
      const comment = String(payload?.comment ?? "");
      const decidedBy = String(payload?.decidedBy ?? "user");
      this.#resolve(token, {
        approved: false,
        comment,
        decidedBy,
        decidedAt: new Date().toISOString()
      });
    });
  }

  /**
   * Called by mock runtime when a checkpoint node is reached.
   * Returns a promise that resolves when the human makes a decision.
   * @param {string} nodeId
   * @returns {{ token: string, decision: Promise<{approved: boolean, comment: string, decidedBy: string, decidedAt: string}> }}
   */
  createPending(nodeId) {
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
    this.#resolve(token, {
      approved: false,
      comment: "Cancelled",
      decidedBy: "system",
      decidedAt: new Date().toISOString()
    });
    this.#nodeTokens.delete(nodeId);
  }

  #resolve(token, decision) {
    const entry = this.#pending.get(token);
    if (!entry) return;
    this.#pending.delete(token);
    this.#nodeTokens.delete(entry.nodeId);
    entry.resolve(decision);
  }
}

export const checkpointExecutor = new CheckpointExecutor();
