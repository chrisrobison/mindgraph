import { PERSISTENCE } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import { normalizeGraphDocument, validateGraphDocument } from "../core/graph-document.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "./graph-store.js";

class PersistenceStore {
  #autosaveEnabled = true;
  #dispose = [];
  #autosaveTimer = null;

  initialize() {
    this.#autosaveEnabled = this.#readAutosaveFlag();

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_SAVED, ({ payload }) => {
        if (!payload?.document) return;
        this.#persistSession(payload.document, "manual");
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, ({ payload }) => {
        if (!this.#autosaveEnabled || !payload?.document) return;
        this.#scheduleAutosave(payload.document);
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_NODE_UPDATED, () => {
        this.#autosaveCurrent("node");
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_EDGE_CREATED, () => {
        this.#autosaveCurrent("edge");
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.GRAPH_VIEWPORT_CHANGED, () => {
        this.#autosaveCurrent("viewport");
      })
    );

    publish(EVENTS.GRAPH_AUTOSAVE_STATE_CHANGED, {
      enabled: this.#autosaveEnabled,
      origin: "persistence-store"
    });
  }

  dispose() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
    if (this.#autosaveTimer != null) {
      clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }
  }

  isAutosaveEnabled() {
    return this.#autosaveEnabled;
  }

  setAutosaveEnabled(enabled) {
    this.#autosaveEnabled = Boolean(enabled);
    this.#writeAutosaveFlag(this.#autosaveEnabled);

    if (this.#autosaveEnabled) {
      this.#autosaveCurrent("autosave_enabled");
    } else if (this.#autosaveTimer != null) {
      clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }

    publish(EVENTS.GRAPH_AUTOSAVE_STATE_CHANGED, {
      enabled: this.#autosaveEnabled,
      origin: "persistence-store"
    });
  }

  restoreLastSession() {
    const storage = this.#storage();
    if (!storage) return false;

    const raw = storage.getItem(PERSISTENCE.storage.lastSessionDocument);
    if (!raw) return false;

    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeGraphDocument(parsed);
      const validation = validateGraphDocument(normalized);
      if (!validation.valid) return false;

      graphStore.load(normalized);
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: "Restored graph from last autosaved session"
      });
      return true;
    } catch {
      return false;
    }
  }

  #autosaveCurrent(reason) {
    if (!this.#autosaveEnabled) return;
    const snapshot = graphStore.getDocument();
    if (!snapshot) return;
    this.#scheduleAutosave(snapshot, reason);
  }

  #scheduleAutosave(document, reason = "autosave") {
    if (!this.#autosaveEnabled) return;
    if (this.#autosaveTimer != null) {
      clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }

    this.#autosaveTimer = setTimeout(() => {
      this.#persistSession(document, reason);
    }, PERSISTENCE.autosaveDebounceMs);
  }

  #persistSession(document, reason = "autosave") {
    const storage = this.#storage();
    if (!storage) return false;

    try {
      storage.setItem(PERSISTENCE.storage.lastSessionDocument, JSON.stringify(document));
      publish(EVENTS.GRAPH_DOCUMENT_AUTOSAVED, {
        reason,
        at: new Date().toISOString(),
        origin: "persistence-store"
      });
      return true;
    } catch {
      return false;
    }
  }

  #readAutosaveFlag() {
    const storage = this.#storage();
    if (!storage) return true;

    const raw = storage.getItem(PERSISTENCE.storage.autosaveEnabled);
    if (raw == null) return true;
    return raw === "true";
  }

  #writeAutosaveFlag(enabled) {
    const storage = this.#storage();
    if (!storage) return;
    storage.setItem(PERSISTENCE.storage.autosaveEnabled, enabled ? "true" : "false");
  }

  #storage() {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  }
}

export const persistenceStore = new PersistenceStore();
