// @ts-check

import { EVENTS } from "../core/event-constants.js";
import { publish, subscribe } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";
import { libraryStore } from "../store/library-store.js";

const escHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const relativeTime = (isoString) => {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  if (isNaN(diff)) return "";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
};

class WorkflowBrowser extends HTMLElement {
  #dispose = [];
  #searchQuery = "";
  #renamingId = null;

  connectedCallback() {
    this.render();
    this.#bind();

    this.#dispose.push(
      subscribe(EVENTS.LIBRARY_UPDATED, () => {
        this.#renderEntries();
      })
    );

    // Close on Escape
    this._keyHandler = (event) => {
      if (event.key === "Escape") this.close();
    };
    document.addEventListener("keydown", this._keyHandler);
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
    if (this._keyHandler) {
      document.removeEventListener("keydown", this._keyHandler);
    }
  }

  open() {
    this.#searchQuery = "";
    this.removeAttribute("hidden");
    this.render();
    this.#bind();
    // Focus the search input
    requestAnimationFrame(() => {
      this.querySelector(".wf-browser-search")?.focus();
    });
  }

  close() {
    this.setAttribute("hidden", "");
  }

  #bind() {
    this.querySelector("[data-action='close']")?.addEventListener("click", () => this.close());

    // Click outside backdrop
    this.addEventListener("click", (event) => {
      if (event.target === this) this.close();
    });

    this.querySelector("[data-action='new-workflow']")?.addEventListener("click", () => {
      this.#onNewWorkflow();
    });

    this.querySelector("[data-action='save-current']")?.addEventListener("click", () => {
      this.#onSaveCurrent();
    });

    this.querySelector(".wf-browser-search")?.addEventListener("input", (event) => {
      this.#searchQuery = String(event.target.value ?? "").toLowerCase();
      this.#renderEntries();
    });

    this.#bindEntryActions();
  }

  #bindEntryActions() {
    this.querySelectorAll("[data-entry-action='open']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-entry-id]")?.dataset.entryId;
        if (!id) return;
        libraryStore.openEntry(id);
        this.close();
      });
    });

    this.querySelectorAll("[data-entry-action='duplicate']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-entry-id]")?.dataset.entryId;
        if (!id) return;
        libraryStore.duplicateEntry(id);
      });
    });

    this.querySelectorAll("[data-entry-action='delete']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.closest("[data-entry-id]")?.dataset.entryId;
        const title = btn.closest("[data-entry-id]")?.dataset.entryTitle;
        if (!id) return;
        if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
        libraryStore.deleteEntry(id);
      });
    });

    // Inline rename: click on title
    this.querySelectorAll("[data-entry-action='rename-start']").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        const card = el.closest("[data-entry-id]");
        const id = card?.dataset.entryId;
        if (!id) return;
        this.#startRename(id, card);
      });
    });
  }

  #startRename(id, card) {
    const titleEl = card.querySelector(".wf-entry-title");
    if (!titleEl) return;
    const currentTitle = titleEl.textContent.trim();

    const input = document.createElement("input");
    input.type = "text";
    input.value = currentTitle;
    input.className = "wf-rename-input";

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      const newTitle = input.value.trim() || currentTitle;
      libraryStore.updateEntry(id, { title: newTitle });
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
      if (event.key === "Escape") { input.value = currentTitle; input.blur(); }
    });
  }

  #onNewWorkflow() {
    const title = prompt("Workflow name:", "New Workflow");
    if (title === null) return; // cancelled
    const safeTitle = title.trim() || "New Workflow";
    const newDoc = {
      id: `graph_${Date.now()}`,
      title: safeTitle,
      schemaVersion: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    };
    publish(EVENTS.GRAPH_DOCUMENT_LOAD_REQUESTED, {
      document: newDoc,
      reason: "new_workflow",
      origin: "workflow-browser"
    });
    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `New workflow created: ${safeTitle}`
    });
    this.close();
  }

  #onSaveCurrent() {
    const entry = libraryStore.saveCurrentDocument();
    if (entry) {
      publish(EVENTS.ACTIVITY_LOG_APPENDED, {
        level: "info",
        message: `Saved to library: ${entry.title}`
      });
    }
  }

  #getFilteredEntries() {
    const entries = libraryStore.getEntries();
    if (!this.#searchQuery) return entries;
    return entries.filter(
      (e) =>
        e.title.toLowerCase().includes(this.#searchQuery) ||
        (e.description || "").toLowerCase().includes(this.#searchQuery)
    );
  }

  #renderEntries() {
    const container = this.querySelector(".wf-browser-grid");
    if (!container) return;
    const entries = this.#getFilteredEntries();
    container.innerHTML = entries.length ? entries.map((e) => this.#entryCard(e)).join("") : this.#emptyState();
    this.#bindEntryActions();
  }

  #entryCard(entry) {
    const currentDocId = graphStore.getDocument()?.id;
    const isActive = currentDocId === entry.document?.id;
    return `
      <div class="wf-entry-card${isActive ? " wf-entry-active" : ""}" data-entry-id="${escHtml(entry.id)}" data-entry-title="${escHtml(entry.title)}">
        <div class="wf-entry-header">
          <span class="wf-entry-title" data-entry-action="rename-start" title="Click to rename">${escHtml(entry.title)}</span>
          ${isActive ? '<span class="wf-entry-badge">open</span>' : ""}
        </div>
        ${entry.description ? `<p class="wf-entry-desc">${escHtml(entry.description)}</p>` : ""}
        <div class="wf-entry-meta">
          <span>${entry.nodeCount ?? 0} nodes · ${entry.edgeCount ?? 0} edges</span>
          <span>${relativeTime(entry.updatedAt)}</span>
        </div>
        <div class="wf-entry-actions">
          <button class="wf-btn-open" data-entry-action="open" type="button">Open</button>
          <button class="wf-btn-icon" data-entry-action="duplicate" type="button" title="Duplicate">⧉</button>
          <button class="wf-btn-icon wf-btn-delete" data-entry-action="delete" type="button" title="Delete">⊗</button>
        </div>
      </div>
    `;
  }

  #emptyState() {
    const total = libraryStore.getCount();
    if (total > 0 && this.#searchQuery) {
      return `<p class="wf-empty">No workflows match "<strong>${escHtml(this.#searchQuery)}</strong>".</p>`;
    }
    return `
      <div class="wf-empty">
        <p>No saved workflows yet.</p>
        <p>Click <strong>Save Current</strong> to save your active workflow, or <strong>New Workflow</strong> to start fresh.</p>
      </div>
    `;
  }

  render() {
    const entries = this.#getFilteredEntries();
    const count = libraryStore.getCount();

    this.innerHTML = `
      <div class="wf-browser-modal" role="dialog" aria-modal="true" aria-label="Workflow Library">
        <div class="wf-browser-header">
          <div class="wf-browser-title-row">
            <h2 class="wf-browser-title">Workflow Library</h2>
            <span class="wf-browser-count">${count} workflow${count !== 1 ? "s" : ""}</span>
          </div>
          <div class="wf-browser-header-actions">
            <button class="wf-btn-secondary" data-action="new-workflow" type="button">+ New Workflow</button>
            <button class="wf-btn-primary" data-action="save-current" type="button">↓ Save Current</button>
            <button class="wf-btn-close" data-action="close" type="button" aria-label="Close">✕</button>
          </div>
        </div>

        <div class="wf-browser-search-row">
          <input
            class="wf-browser-search"
            type="search"
            placeholder="Search workflows…"
            value="${escHtml(this.#searchQuery)}"
            aria-label="Search workflows"
          />
        </div>

        <div class="wf-browser-body">
          <div class="wf-browser-grid">
            ${entries.length ? entries.map((e) => this.#entryCard(e)).join("") : this.#emptyState()}
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("workflow-browser", WorkflowBrowser);

// Singleton accessor — creates the element once, appends to body
let _browserEl = null;

export const showWorkflowBrowser = () => {
  if (!_browserEl) {
    _browserEl = document.createElement("workflow-browser");
    _browserEl.setAttribute("hidden", "");
    _browserEl.className = "wf-browser-overlay";
    document.body.append(_browserEl);
  }
  _browserEl.open();
};
