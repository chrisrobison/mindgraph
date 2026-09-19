// @ts-check

/**
 * IndexedDB-backed checkpoint store.
 *
 * Checkpoints are written here when the executor pauses a workflow, and
 * read by `approval.html` (same origin → same IDB database). Decisions
 * written by the approval page are propagated back to the main app via
 * BroadcastChannel so there is no polling.
 *
 * Schema (object store "checkpoints", keyPath "token"):
 *   token         — unique checkpoint id (e.g. "chk_1719000000_12345")
 *   nodeId        — id of the paused node
 *   nodeLabel     — human label for display in approval.html
 *   graphTitle    — title of the current workflow document
 *   message       — reviewer message configured on the node
 *   inputPayload  — upstream context data (serialisable object)
 *   status        — "pending" | "approved" | "rejected"
 *   createdAt     — ISO timestamp
 *   decidedBy     — who resolved (null while pending)
 *   decidedAt     — ISO timestamp (null while pending)
 *   decisionComment — free-text note (null while pending)
 */

const DB_NAME = "mindgraph-checkpoints";
const DB_VERSION = 1;
const STORE_NAME = "checkpoints";
export const BROADCAST_CHANNEL_NAME = "mindgraph-checkpoint-decisions";

/** @returns {Promise<IDBDatabase>} */
const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = /** @type {IDBOpenDBRequest} */ (event.target).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "token" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    req.onsuccess = (event) => resolve(/** @type {IDBOpenDBRequest} */ (event.target).result);
    req.onerror  = (event) => reject(/** @type {IDBOpenDBRequest} */ (event.target).error);
  });

/**
 * Run an IDB transaction and return the result of `operation`.
 * @template T
 * @param {"readonly"|"readwrite"} mode
 * @param {(store: IDBObjectStore) => IDBRequest<T>} operation
 * @returns {Promise<T>}
 */
const withStore = async (mode, operation) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = operation(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror    = () => { db.close(); reject(tx.error); };
  });
};

/**
 * @typedef {Object} CheckpointRecord
 * @property {string} token
 * @property {string} nodeId
 * @property {string} nodeLabel
 * @property {string} graphTitle
 * @property {string} message
 * @property {unknown} inputPayload
 * @property {"pending"|"approved"|"rejected"} status
 * @property {string} createdAt
 * @property {string|null} decidedBy
 * @property {string|null} decidedAt
 * @property {string|null} decisionComment
 */

/**
 * @typedef {Object} CheckpointDecision
 * @property {boolean} approved
 * @property {string} comment
 * @property {string} decidedBy
 * @property {string} decidedAt
 */

class CheckpointStore {
  /** @type {BroadcastChannel|null} */
  #channel = null;
  /** @type {Array<(decision: {token:string} & CheckpointDecision) => void>} */
  #decisionListeners = [];

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      this.#channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      this.#channel.onmessage = (event) => {
        const data = event.data;
        if (data?.type === "checkpoint_decision" && data?.token) {
          for (const listener of this.#decisionListeners) {
            try { listener(data); } catch { /* noop */ }
          }
        }
      };
    }
  }

  /**
   * Persist a new pending checkpoint record. Safe to call from the main app.
   * @param {Omit<CheckpointRecord, "status"|"decidedBy"|"decidedAt"|"decisionComment">} data
   */
  async create(data) {
    /** @type {CheckpointRecord} */
    const record = {
      ...data,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      decisionComment: null
    };
    await withStore("readwrite", (store) => store.put(record));
    return record;
  }

  /**
   * Fetch a single checkpoint by token.
   * @param {string} token
   * @returns {Promise<CheckpointRecord|null>}
   */
  async get(token) {
    const result = await withStore("readonly", (store) => store.get(token));
    return result ?? null;
  }

  /**
   * List all checkpoints ordered by createdAt descending.
   * @returns {Promise<CheckpointRecord[]>}
   */
  async list() {
    const all = await withStore("readonly", (store) => store.getAll());
    return (all ?? []).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  }

  /**
   * Record a decision for a pending checkpoint. Broadcasts the decision to
   * all tabs (including the main app if decided from approval.html).
   * @param {string} token
   * @param {CheckpointDecision} decision
   */
  async resolve(token, decision) {
    const existing = await this.get(token);
    if (!existing) return null;

    const updated = {
      ...existing,
      status: decision.approved ? "approved" : "rejected",
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt,
      decisionComment: decision.comment ?? null
    };

    await withStore("readwrite", (store) => store.put(updated));

    // Notify all tabs — including the main app tab that's waiting on the promise
    const message = { type: "checkpoint_decision", token, ...decision };
    this.#channel?.postMessage(message);

    return updated;
  }

  /**
   * Register a callback invoked whenever a decision arrives via BroadcastChannel.
   * Returns an unsubscribe function.
   * @param {(msg: {token:string} & CheckpointDecision) => void} listener
   * @returns {() => void}
   */
  onDecision(listener) {
    this.#decisionListeners.push(listener);
    return () => {
      const idx = this.#decisionListeners.indexOf(listener);
      if (idx !== -1) this.#decisionListeners.splice(idx, 1);
    };
  }

  /**
   * Clean up stale records older than `maxAgeDays` that are already resolved.
   * @param {number} [maxAgeDays=7]
   */
  async prune(maxAgeDays = 7) {
    const cutoff = new Date(Date.now() - maxAgeDays * 864e5).toISOString();
    const all = await this.list();
    const stale = all.filter(
      (entry) => entry.status !== "pending" && entry.createdAt < cutoff
    );
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const entry of stale) store.delete(entry.token);
      tx.oncomplete = () => { db.close(); resolve(undefined); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    return stale.length;
  }
}

export const checkpointStore = new CheckpointStore();
