// @ts-check

import { PERSISTENCE } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";
import { graphStore } from "./graph-store.js";

const nowIso = () => new Date().toISOString();
const makeId = () => `lib_${Date.now()}_${Math.floor(Math.random() * 100_000)}`;

const LIBRARY_VERSION = 1;
const MAX_ENTRIES = 50;

/**
 * @typedef {{ id: string, title: string, description: string, savedAt: string, updatedAt: string, nodeCount: number, edgeCount: number, document: object }} LibraryEntry
 */

class LibraryStore {
  /** @type {LibraryEntry[]} */
  #entries = [];

  initialize() {
    this.#load();
  }

  /** @returns {LibraryEntry[]} All entries, newest first */
  getEntries() {
    return this.#entries.map((entry) => ({ ...entry }));
  }

  /** @returns {LibraryEntry | null} */
  getEntry(id) {
    const entry = this.#entries.find((e) => e.id === id);
    return entry ? { ...entry } : null;
  }

  /**
   * Save the current graph document to the library.
   * If an entry with the same document.id already exists, update it.
   * Otherwise create a new entry.
   * @returns {LibraryEntry}
   */
  saveCurrentDocument() {
    const document = graphStore.getDocument();
    if (!document) return null;

    const existing = this.#entries.find((e) => e.document?.id === document.id);
    const at = nowIso();
    const meta = {
      title: String(document.title ?? "Untitled Workflow").trim() || "Untitled Workflow",
      description: String(document.description ?? "").trim(),
      nodeCount: Array.isArray(document.nodes) ? document.nodes.length : 0,
      edgeCount: Array.isArray(document.edges) ? document.edges.length : 0,
      document
    };

    if (existing) {
      const updated = { ...existing, ...meta, updatedAt: at };
      this.#entries = this.#entries.map((e) => (e.id === existing.id ? updated : e));
      this.#persist();
      this.#emit("update", updated);
      return { ...updated };
    }

    const entry = {
      id: makeId(),
      ...meta,
      savedAt: at,
      updatedAt: at
    };

    this.#entries = [entry, ...this.#entries].slice(0, MAX_ENTRIES);
    this.#persist();
    this.#emit("add", entry);
    return { ...entry };
  }

  /**
   * Rename a library entry.
   * @param {string} id
   * @param {{ title?: string, description?: string }} patch
   * @returns {LibraryEntry | null}
   */
  updateEntry(id, patch) {
    const index = this.#entries.findIndex((e) => e.id === id);
    if (index < 0) return null;
    const updated = {
      ...this.#entries[index],
      title: String(patch?.title ?? this.#entries[index].title).trim() || this.#entries[index].title,
      description: patch?.description !== undefined ? String(patch.description).trim() : this.#entries[index].description,
      updatedAt: nowIso()
    };
    this.#entries = this.#entries.map((e) => (e.id === id ? updated : e));
    this.#persist();
    this.#emit("update", updated);
    return { ...updated };
  }

  /**
   * Delete a library entry by id.
   * @param {string} id
   * @returns {boolean}
   */
  deleteEntry(id) {
    const had = this.#entries.some((e) => e.id === id);
    if (!had) return false;
    this.#entries = this.#entries.filter((e) => e.id !== id);
    this.#persist();
    this.#emit("delete", { id });
    return true;
  }

  /**
   * Duplicate a library entry under a new id and title.
   * @param {string} id
   * @returns {LibraryEntry | null}
   */
  duplicateEntry(id) {
    const source = this.#entries.find((e) => e.id === id);
    if (!source) return null;
    const at = nowIso();
    const newDocId = `graph_${Date.now()}`;
    const duplicate = {
      ...source,
      id: makeId(),
      title: `${source.title} (copy)`,
      savedAt: at,
      updatedAt: at,
      document: {
        ...source.document,
        id: newDocId,
        title: `${source.title} (copy)`
      }
    };
    this.#entries = [duplicate, ...this.#entries].slice(0, MAX_ENTRIES);
    this.#persist();
    this.#emit("add", duplicate);
    return { ...duplicate };
  }

  /**
   * Load a library entry's document into the active graph store.
   * @param {string} id
   * @returns {boolean}
   */
  openEntry(id) {
    const entry = this.#entries.find((e) => e.id === id);
    if (!entry?.document) return false;

    publish(EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED, {
      document: entry.document,
      reason: `library_open:${id}`,
      origin: "library-store"
    });

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Opened workflow: ${entry.title}`
    });

    return true;
  }

  /** @returns {number} */
  getCount() {
    return this.#entries.length;
  }

  // ── Private ─────────────────────────────────────────────────────

  #emit(action, data) {
    publish(EVENTS.LIBRARY_UPDATED, {
      action,
      data,
      count: this.#entries.length,
      at: nowIso()
    });
  }

  #persist() {
    const storage = this.#storage();
    if (!storage) return;
    try {
      storage.setItem(
        PERSISTENCE.storage.library,
        JSON.stringify({ version: LIBRARY_VERSION, entries: this.#entries })
      );
    } catch {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "warn",
        message: "Could not persist workflow library — storage may be full"
      });
    }
  }

  #load() {
    const storage = this.#storage();
    if (!storage) return;
    try {
      const raw = storage.getItem(PERSISTENCE.storage.library);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.entries)) {
        this.#entries = parsed.entries.filter(
          (e) => e && typeof e.id === "string" && typeof e.title === "string"
        );
      }
    } catch {
      this.#entries = [];
    }
  }

  #storage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}

export const libraryStore = new LibraryStore();
