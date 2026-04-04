import { uiStore } from "../../store/ui-store.js";
import { escapeHtml } from "./shared.js";

const PROVIDERS = Object.freeze([
  {
    key: "openai",
    label: "OpenAI ChatGPT",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"]
  },
  {
    key: "anthropic",
    label: "Anthropic Claude",
    models: ["claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest"]
  },
  {
    key: "gemini",
    label: "Google Gemini",
    models: ["gemini-2.0-flash", "gemini-2.5-pro-preview"]
  }
]);

const providerByKey = Object.freeze(Object.fromEntries(PROVIDERS.map((entry) => [entry.key, entry])));

const sanitizeSettings = (raw = {}) => {
  const provider = providerByKey[raw?.provider] ? raw.provider : "openai";
  const providerDefaults = providerByKey[provider]?.models ?? providerByKey.openai.models;
  return {
    provider,
    model: String(raw?.model ?? providerDefaults[0] ?? "").trim() || providerDefaults[0],
    apiKey: String(raw?.apiKey ?? ""),
    temperature: Number.isFinite(Number(raw?.temperature)) ? Number(raw.temperature) : 0.3,
    maxTokens: Number.isFinite(Number(raw?.maxTokens)) ? Number(raw.maxTokens) : 800,
    systemPrompt: String(raw?.systemPrompt ?? "")
  };
};

class BottomRuntimeSettingsView extends HTMLElement {
  #settings = sanitizeSettings();
  #runtimeMode = "mock";

  set settings(value) {
    this.#settings = sanitizeSettings(value ?? {});
    if (this.isConnected) this.render();
  }

  set runtimeMode(value) {
    this.#runtimeMode = String(value ?? "mock");
    if (this.isConnected) this.render();
  }

  connectedCallback() {
    this.render();
  }

  #update(patch) {
    uiStore.updateRuntimeProviderSettings(patch, "runtime-settings-view");
  }

  render() {
    const settings = this.#settings;
    const provider = providerByKey[settings.provider] ?? providerByKey.openai;
    const modelOptions = provider.models
      .map((model) => `<option value="${escapeHtml(model)}" ${settings.model === model ? "selected" : ""}>${escapeHtml(model)}</option>`)
      .join("");

    this.innerHTML = `
      <section class="panel-split">
        <h4>Provider Settings</h4>
        <p class="panel-empty">These keys are stored in local browser storage and sent only to the configured runtime proxy.</p>
      </section>

      <section class="runtime-settings-grid">
        <label class="runtime-settings-field">
          <span>Provider</span>
          <select data-field="provider">
            ${PROVIDERS.map((entry) => `<option value="${entry.key}" ${settings.provider === entry.key ? "selected" : ""}>${escapeHtml(entry.label)}</option>`).join("")}
          </select>
        </label>

        <label class="runtime-settings-field">
          <span>Model</span>
          <select data-field="model">${modelOptions}</select>
        </label>

        <label class="runtime-settings-field">
          <span>API Key</span>
          <input type="password" data-field="apiKey" value="${escapeHtml(settings.apiKey)}" placeholder="sk-... / claude... / AIza..." autocomplete="off" />
        </label>

        <label class="runtime-settings-field">
          <span>Temperature</span>
          <input type="number" min="0" max="2" step="0.1" data-field="temperature" value="${escapeHtml(settings.temperature)}" />
        </label>

        <label class="runtime-settings-field">
          <span>Max Tokens</span>
          <input type="number" min="64" max="8192" step="1" data-field="maxTokens" value="${escapeHtml(settings.maxTokens)}" />
        </label>

        <label class="runtime-settings-field runtime-settings-field-wide">
          <span>System Prompt (optional)</span>
          <textarea rows="4" data-field="systemPrompt" placeholder="You are an expert workflow execution assistant.">${escapeHtml(settings.systemPrompt)}</textarea>
        </label>
      </section>

      <section class="panel-split">
        <h4>Transport</h4>
        <p class="panel-empty">Current runtime mode: <strong>${escapeHtml(this.#runtimeMode)}</strong>. Use <strong>HTTP Runtime</strong> in the top toolbar to route runs through the proxy server via WebSocket (with HTTP fallback).</p>
      </section>
    `;

    this.querySelector('[data-field="provider"]')?.addEventListener("change", (event) => {
      const nextProvider = event.target.value;
      const defaultModel = providerByKey[nextProvider]?.models?.[0] ?? providerByKey.openai.models[0];
      this.#update({ provider: nextProvider, model: defaultModel });
    });

    this.querySelector('[data-field="model"]')?.addEventListener("change", (event) => {
      this.#update({ model: String(event.target.value ?? "").trim() });
    });

    this.querySelector('[data-field="apiKey"]')?.addEventListener("change", (event) => {
      this.#update({ apiKey: String(event.target.value ?? "").trim() });
    });

    this.querySelector('[data-field="temperature"]')?.addEventListener("change", (event) => {
      this.#update({ temperature: Number(event.target.value) });
    });

    this.querySelector('[data-field="maxTokens"]')?.addEventListener("change", (event) => {
      this.#update({ maxTokens: Number(event.target.value) });
    });

    this.querySelector('[data-field="systemPrompt"]')?.addEventListener("change", (event) => {
      this.#update({ systemPrompt: String(event.target.value ?? "") });
    });
  }
}

customElements.define("bottom-runtime-settings-view", BottomRuntimeSettingsView);
