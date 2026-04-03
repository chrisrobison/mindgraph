import { PERSISTENCE } from "../core/constants.js";
import { EVENTS } from "../core/event-constants.js";
import {
	normalizeGraphDocument,
	validateGraphDocument,
} from "../core/graph-document.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "./graph-store.js";

class PersistenceStore {
	#autosaveEnabled = true;
	#dispose = [];
	#autosaveTimer = null;
	#serverAvailable = false;

	initialize() {
		this.#autosaveEnabled = this.#readAutosaveFlag();
		this.#checkServer();

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_DOCUMENT_SAVED, ({ payload }) => {
				if (!payload?.document) return;
				this.#persistSession(payload.document, "manual");
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_DOCUMENT_LOADED, ({ payload }) => {
				if (!this.#autosaveEnabled || !payload?.document) return;
				this.#scheduleAutosave(payload.document);
			}),
		);

		this.#dispose.push(
			subscribe(EVENTS.GRAPH_DOCUMENT_CHANGED, ({ payload }) => {
				this.#autosaveCurrent(payload?.reason ?? "document_changed");
			}),
		);

		publish(EVENTS.GRAPH_AUTOSAVE_STATE_CHANGED, {
			enabled: this.#autosaveEnabled,
			origin: "persistence-store",
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
			origin: "persistence-store",
		});
	}

	async restoreLastSession() {
		// Try server first
		if (this.#serverAvailable) {
			try {
				const response = await fetch(`${PERSISTENCE.serverUrl}/api/brain`);
				if (response.ok) {
					const data = await response.json();
					const normalized = normalizeGraphDocument(data);
					const validation = validateGraphDocument(normalized);
					if (validation.valid) {
						graphStore.load(normalized);
						publish(EVENTS.ACTIVITY_LOG_APPENDED, {
							level: "info",
							message: "Restored brain from disk",
						});
						return true;
					}
				}
			} catch {
				// Fall through to localStorage
			}
		}

		// Try localStorage
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
				message: "Restored brain from local cache",
			});
			return true;
		} catch {
			return false;
		}
	}

	/* ── Private ── */

	async #checkServer() {
		try {
			const response = await fetch(`${PERSISTENCE.serverUrl}/api/health`, {
				signal: AbortSignal.timeout(2000),
			});
			this.#serverAvailable = response.ok;
		} catch {
			this.#serverAvailable = false;
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

	async #persistSession(document, reason = "autosave") {
		// Always save to localStorage (instant reload)
		const storage = this.#storage();
		if (storage) {
			try {
				storage.setItem(
					PERSISTENCE.storage.lastSessionDocument,
					JSON.stringify(document),
				);
			} catch {
				// localStorage full or unavailable
			}
		}

		// Try to save to server (disk durability)
		if (this.#serverAvailable) {
			try {
				await fetch(`${PERSISTENCE.serverUrl}/api/brain`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(document),
				});
			} catch {
				// Server unavailable, localStorage was still saved
			}
		}

		publish(EVENTS.GRAPH_DOCUMENT_AUTOSAVED, {
			reason,
			at: new Date().toISOString(),
			origin: "persistence-store",
		});
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
		storage.setItem(
			PERSISTENCE.storage.autosaveEnabled,
			enabled ? "true" : "false",
		);
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
