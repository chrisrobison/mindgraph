// @ts-check

/**
 * <webllm-model-download-dialog>
 *
 * Modal dialog that shows download/initialisation progress for a WebLLM
 * model. The dialog self-manages via PAN events:
 *
 *   RUNTIME_TRACE_APPENDED { kind: "webllm_init_progress", progress, message, modelId }
 *     → updates the progress bar live as the engine initialises
 *
 *   RUNTIME_AGENT_RUN_STARTED  { mode: "webllm" }
 *     → opens the dialog if the engine isn't cached yet
 *
 *   RUNTIME_AGENT_RUN_COMPLETED / RUNTIME_AGENT_RUN_FAILED
 *     → closes the dialog on completion or failure
 *
 * The dialog can also be opened programmatically via `dialog.openForModel(modelId)`.
 */

import { EVENTS } from "../core/event-constants.js";
import { subscribe } from "../core/pan.js";
import { isEngineReady, getActiveModelId } from "../runtime/webllm-engine.js";
import { getWebLLMModel } from "../runtime/webllm-model-catalog.js";

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

class WebLLMModelDownloadDialog extends HTMLElement {
  #dialog = null;
  #modelId = "";
  #progress = 0;       // 0..1
  #message = "";
  #phase = "idle";     // "idle" | "loading" | "ready" | "error"
  #errorMessage = "";
  #runsPending = 0;
  #dispose = [];

  connectedCallback() {
    this.innerHTML = `
      <dialog class="webllm-dialog" aria-labelledby="webllm-dialog-title" aria-modal="true">
        <div class="webllm-dialog-inner">
          <header class="webllm-dialog-header">
            <span class="webllm-dialog-icon" aria-hidden="true">🧠</span>
            <h2 id="webllm-dialog-title" class="webllm-dialog-title">Loading Local AI Model</h2>
          </header>

          <div class="webllm-dialog-body">
            <p class="webllm-model-name" data-role="model-name"></p>
            <p class="webllm-model-size" data-role="model-size"></p>

            <div class="webllm-progress-wrap" data-role="progress-wrap" aria-hidden="true">
              <div class="webllm-progress-bar" data-role="progress-bar"></div>
            </div>
            <p class="webllm-progress-pct" data-role="progress-pct" aria-live="polite"></p>
            <p class="webllm-progress-msg" data-role="progress-msg" aria-live="polite"></p>

            <p class="webllm-error" data-role="error-msg" hidden></p>

            <p class="webllm-hint" data-role="hint-first-load">
              The model will be cached in your browser after the first download.
              Subsequent runs load instantly.
            </p>
          </div>

          <footer class="webllm-dialog-footer">
            <button type="button" class="webllm-btn webllm-btn-cancel" data-action="cancel">
              Cancel
            </button>
          </footer>
        </div>
      </dialog>
    `;

    this.#dialog = this.querySelector("dialog");

    this.querySelector('[data-action="cancel"]')?.addEventListener("click", () => {
      this.#cancel();
    });

    this.#dialog?.addEventListener("cancel", (event) => {
      // Prevent Escape from closing during active load
      if (this.#phase === "loading") event.preventDefault();
    });

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_TRACE_APPENDED, ({ payload }) => {
        if (payload?.kind !== "webllm_init_progress") return;
        this.#onProgress(payload);
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_AGENT_RUN_STARTED, ({ payload }) => {
        if (payload?.mode !== "webllm") return;
        this.#runsPending += 1;
        if (!isEngineReady()) {
          this.openForModel(getActiveModelId() || payload?.modelId || "");
        }
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_AGENT_RUN_COMPLETED, ({ payload }) => {
        if (payload?.mode !== "webllm") return;
        this.#runsPending = Math.max(0, this.#runsPending - 1);
        if (this.#runsPending === 0 && this.#phase === "loading") {
          this.#phase = "ready";
          this.#close();
        }
      })
    );

    this.#dispose.push(
      subscribe(EVENTS.RUNTIME_AGENT_RUN_FAILED, ({ payload }) => {
        if (payload?.mode !== "webllm") return;
        this.#runsPending = Math.max(0, this.#runsPending - 1);
        if (this.#phase === "loading") {
          const reason = String(payload?.reason ?? "Unknown engine error");
          this.#setError(reason);
        }
      })
    );
  }

  disconnectedCallback() {
    this.#dispose.forEach((run) => run());
    this.#dispose = [];
  }

  /**
   * Open the dialog for the given model id. Safe to call if it is already open.
   * @param {string} modelId
   */
  openForModel(modelId = "") {
    if (!this.#dialog) return;
    this.#modelId = String(modelId).trim();
    this.#progress = 0;
    this.#phase = "loading";
    this.#errorMessage = "";
    this.#render();
    if (!this.#dialog.open) {
      this.#dialog.showModal();
    }
  }

  #onProgress({ progress, message, modelId } = {}) {
    if (modelId && !this.#modelId) this.#modelId = String(modelId);
    if (modelId && this.#modelId !== String(modelId)) return;
    this.#progress = clamp01(progress);
    this.#message = String(message ?? "").trim();

    if (this.#dialog?.open) {
      this.#patchProgress();
    } else if (this.#phase !== "ready") {
      this.openForModel(this.#modelId);
    }

    // When WebLLM reports 1.0 progress it means fully loaded.
    if (this.#progress >= 1 && this.#phase === "loading") {
      this.#phase = "ready";
      // Short delay so user sees 100% briefly, then close.
      setTimeout(() => this.#close(), 600);
    }
  }

  #patchProgress() {
    const bar = this.querySelector('[data-role="progress-bar"]');
    const pct = this.querySelector('[data-role="progress-pct"]');
    const msg = this.querySelector('[data-role="progress-msg"]');
    const wrap = this.querySelector('[data-role="progress-wrap"]');
    const pctInt = Math.round(this.#progress * 100);
    if (bar) bar.style.width = `${pctInt}%`;
    if (pct) pct.textContent = `${pctInt}%`;
    if (msg) msg.textContent = this.#message;
    if (wrap) wrap.setAttribute("aria-valuenow", String(pctInt));
  }

  #setError(message) {
    this.#phase = "error";
    this.#errorMessage = message;
    this.#render();
  }

  #cancel() {
    // Publish a cancel-all so the runtime service aborts the in-flight run.
    // The import is done inline to avoid a circular dep at module parse time.
    import("../core/pan.js").then(({ publish }) => {
      import("../core/event-constants.js").then(({ EVENTS: EV }) => {
        publish(EV.RUNTIME_RUN_CANCEL_REQUESTED, { reason: "user_cancelled_webllm_load" });
      });
    });
    this.#close();
  }

  #close() {
    if (this.#dialog?.open) this.#dialog.close();
    this.#phase = "idle";
    this.#runsPending = 0;
  }

  #render() {
    if (!this.#dialog) return;

    const entry = getWebLLMModel(this.#modelId);
    const nameEl = this.querySelector('[data-role="model-name"]');
    const sizeEl = this.querySelector('[data-role="model-size"]');
    const errorEl = this.querySelector('[data-role="error-msg"]');
    const hintEl = this.querySelector('[data-role="hint-first-load"]');
    const cancelBtn = this.querySelector('[data-action="cancel"]');
    const progressWrap = this.querySelector('[data-role="progress-wrap"]');

    if (nameEl) {
      nameEl.textContent = entry ? entry.label : (this.#modelId || "Loading model…");
    }
    if (sizeEl) {
      const size = entry ? `Download size: ${entry.sizeLabel}` : "";
      sizeEl.textContent = size;
      sizeEl.hidden = !size;
    }

    if (this.#phase === "error") {
      if (errorEl) { errorEl.textContent = this.#errorMessage; errorEl.hidden = false; }
      if (progressWrap) progressWrap.hidden = true;
      if (hintEl) hintEl.hidden = true;
      if (cancelBtn) cancelBtn.textContent = "Close";
    } else {
      if (errorEl) errorEl.hidden = true;
      if (progressWrap) progressWrap.hidden = false;
      if (hintEl) hintEl.hidden = false;
      if (cancelBtn) cancelBtn.textContent = "Cancel";
    }

    this.#patchProgress();
  }
}

customElements.define("webllm-model-download-dialog", WebLLMModelDownloadDialog);
