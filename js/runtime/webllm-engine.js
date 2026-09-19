// @ts-check

/**
 * Lazy singleton wrapper around `@mlc-ai/web-llm`.
 *
 * The WebLLM bundle is ~MB-scale and only needed when the user actually
 * selects WebLLM mode, so we import it dynamically on first use. All other
 * runtime modes (mock, http) pay zero cost for this module.
 *
 * The module also exposes capability probes (`isWebGpuAvailable`) and a
 * test-injection hook (`__setEngineFactory`) so unit tests can replace
 * the upstream loader without monkey-patching ES module internals.
 */

import { DEFAULT_WEBLLM_MODEL_ID, isSupportedWebLLMModel } from "./webllm-model-catalog.js";

const WEBLLM_MODULE_URL = "https://esm.run/@mlc-ai/web-llm";

let engineFactoryOverride = null;
let cachedEngine = null;
let cachedModelId = "";
let inflightInit = null;

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/**
 * Detect whether the host environment can run WebLLM. Returns false in
 * Node (no `navigator.gpu`), older browsers, and explicitly when WebGPU
 * has been disabled via flags.
 */
export const isWebGpuAvailable = () => {
  if (typeof navigator === "undefined") return false;
  const gpu = /** @type {any} */ (navigator).gpu;
  return Boolean(gpu && typeof gpu.requestAdapter === "function");
};

/**
 * Pick a starting model id. Honors `preferred` if it's in the catalog,
 * otherwise falls back to the recommended default.
 * @param {string} preferred
 */
export const resolveModelId = (preferred = "") =>
  isSupportedWebLLMModel(preferred) ? String(preferred) : DEFAULT_WEBLLM_MODEL_ID;

/**
 * @typedef {Object} WebLLMInitProgress
 * @property {number} progress  0..1 download/initialization progress
 * @property {string} text      Human-readable stage label
 * @property {number} [timeElapsed]
 */

/**
 * @typedef {Object} WebLLMEngineAdapter
 * @property {string} modelId
 * @property {(messages: Array<{role:string,content:string}>, opts?: Record<string,unknown>, signal?: AbortSignal | null) => Promise<{text:string, raw?: unknown}>} chat
 * @property {() => Promise<void>} unload
 */

/**
 * Test-only escape hatch. When set, `initEngine` will call the provided
 * factory instead of dynamically importing `@mlc-ai/web-llm`. The factory
 * must return an object satisfying `WebLLMEngineAdapter`.
 *
 * @param {((modelId: string, onProgress: (p: WebLLMInitProgress) => void) => Promise<WebLLMEngineAdapter>) | null} factory
 */
export const __setEngineFactory = (factory) => {
  engineFactoryOverride = typeof factory === "function" ? factory : null;
  cachedEngine = null;
  cachedModelId = "";
  inflightInit = null;
};

/**
 * Default factory: dynamic-import `@mlc-ai/web-llm` and wrap the engine
 * in our `WebLLMEngineAdapter` shape.
 *
 * @param {string} modelId
 * @param {(p: WebLLMInitProgress) => void} onProgress
 * @returns {Promise<WebLLMEngineAdapter>}
 */
const defaultEngineFactory = async (modelId, onProgress) => {
  if (!isWebGpuAvailable()) {
    throw new Error("WebGPU is not available in this browser.");
  }

  // Dynamic import so non-WebLLM modes never pay the cost.
  const mod = await import(/* webpackIgnore: true */ WEBLLM_MODULE_URL);
  if (!mod || typeof mod.CreateMLCEngine !== "function") {
    throw new Error("Failed to load @mlc-ai/web-llm: CreateMLCEngine missing.");
  }

  const engine = await mod.CreateMLCEngine(modelId, {
    initProgressCallback: (report) => {
      try {
        onProgress({
          progress: Number(report?.progress ?? 0),
          text: String(report?.text ?? ""),
          timeElapsed: Number(report?.timeElapsed ?? 0)
        });
      } catch {
        // progress is best-effort; never throw
      }
    }
  });

  return {
    modelId,
    async chat(messages, opts = {}, signal = null) {
      const completion = await engine.chat.completions.create({
        messages,
        temperature: typeof opts.temperature === "number" ? opts.temperature : 0.3,
        max_tokens: typeof opts.maxTokens === "number" ? opts.maxTokens : 800,
        stream: false,
        ...(isPlainObject(opts.responseFormat) ? { response_format: opts.responseFormat } : {}),
        ...(Array.isArray(opts.tools) && opts.tools.length ? { tools: opts.tools } : {})
      });

      if (signal?.aborted) {
        throw new Error(`Aborted: ${signal.reason ?? "cancelled"}`);
      }

      const choice = completion?.choices?.[0]?.message ?? {};
      const text = String(choice?.content ?? "");
      return { text, raw: completion };
    },
    async unload() {
      if (typeof engine.unload === "function") {
        await engine.unload();
      }
    }
  };
};

/**
 * Initialize the engine for the given model id. If the requested model is
 * already loaded, returns the cached adapter. Concurrent calls share a
 * single in-flight initialization.
 *
 * @param {string} [requestedModelId]
 * @param {(p: WebLLMInitProgress) => void} [onProgress]
 * @returns {Promise<WebLLMEngineAdapter>}
 */
export const initEngine = async (requestedModelId = "", onProgress = () => {}) => {
  const modelId = resolveModelId(requestedModelId);

  if (cachedEngine && cachedModelId === modelId) {
    return cachedEngine;
  }

  if (inflightInit && cachedModelId === modelId) {
    return inflightInit;
  }

  if (cachedEngine && cachedModelId !== modelId) {
    try {
      await cachedEngine.unload();
    } catch {
      // best effort
    }
    cachedEngine = null;
    cachedModelId = "";
  }

  cachedModelId = modelId;
  const factory = engineFactoryOverride ?? defaultEngineFactory;
  inflightInit = factory(modelId, onProgress)
    .then((adapter) => {
      cachedEngine = adapter;
      inflightInit = null;
      return adapter;
    })
    .catch((error) => {
      inflightInit = null;
      cachedEngine = null;
      cachedModelId = "";
      throw error;
    });

  return inflightInit;
};

/**
 * Convenience: run a single chat completion against whichever model the
 * caller wants, initializing on demand.
 *
 * @param {Array<{role:string,content:string}>} messages
 * @param {{ modelId?: string, temperature?: number, maxTokens?: number, signal?: AbortSignal | null, onProgress?: (p: WebLLMInitProgress) => void }} [opts]
 */
export const chat = async (messages, opts = {}) => {
  const adapter = await initEngine(opts.modelId, opts.onProgress ?? (() => {}));
  return adapter.chat(messages, opts, opts.signal ?? null);
};

export const isEngineReady = () => Boolean(cachedEngine);

export const getActiveModelId = () => cachedModelId;
