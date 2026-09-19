// @ts-check

/**
 * Catalog of WebLLM models exposed in the UI.
 *
 * Each entry lists the upstream MLC model id (matches the IDs in the
 * `@mlc-ai/web-llm` `prebuiltAppConfig`), a human-readable label, an
 * approximate on-disk size, and a one-line use-case hint.
 *
 * The catalog lives in code (rather than a config file) so it can be
 * imported by both UI components and the runtime adapter without any
 * additional plumbing.
 */

/**
 * @typedef {Object} WebLLMModelEntry
 * @property {string} id           Upstream MLC model id (e.g. "Llama-3.2-3B-Instruct-q4f16_1-MLC")
 * @property {string} label        Short human-readable label
 * @property {string} family       Model family ("llama" | "phi" | "qwen" | "hermes")
 * @property {number} sizeBytes    Approximate on-disk size after caching
 * @property {string} sizeLabel    Pretty-printed size for the UI ("~2.0 GB")
 * @property {string} note         One-line use-case description
 * @property {boolean} [recommended] Marks the suggested default
 * @property {boolean} [toolUseFinetuned] True if the model is fine-tuned for function/tool calls
 */

const GB = 1024 * 1024 * 1024;

/** @type {ReadonlyArray<WebLLMModelEntry>} */
export const WEBLLM_MODELS = Object.freeze([
  Object.freeze({
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B Instruct",
    family: "llama",
    sizeBytes: 2.0 * GB,
    sizeLabel: "~2.0 GB",
    note: "Balanced default; runs on most laptops.",
    recommended: true
  }),
  Object.freeze({
    id: "Phi-3.5-mini-instruct-q4f16_1-MLC",
    label: "Phi 3.5 mini Instruct",
    family: "phi",
    sizeBytes: 2.2 * GB,
    sizeLabel: "~2.2 GB",
    note: "Fastest small model; slightly weaker reasoning."
  }),
  Object.freeze({
    id: "Hermes-3-Llama-3.2-3B-q4f16_1-MLC",
    label: "Hermes 3 (Llama 3.2 3B)",
    family: "hermes",
    sizeBytes: 2.0 * GB,
    sizeLabel: "~2.0 GB",
    note: "Tool-use fine-tune; better function-calling reliability.",
    toolUseFinetuned: true
  }),
  Object.freeze({
    id: "Qwen2.5-7B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 7B Instruct",
    family: "qwen",
    sizeBytes: 4.5 * GB,
    sizeLabel: "~4.5 GB",
    note: "Strongest reasoning under 8 GB; viable on modern laptops."
  }),
  Object.freeze({
    id: "Llama-3.1-8B-Instruct-q4f16_1-MLC",
    label: "Llama 3.1 8B Instruct",
    family: "llama",
    sizeBytes: 5.0 * GB,
    sizeLabel: "~5.0 GB",
    note: "Highest local quality; needs a discrete or Apple Silicon GPU."
  })
]);

export const DEFAULT_WEBLLM_MODEL_ID =
  WEBLLM_MODELS.find((entry) => entry.recommended)?.id ?? WEBLLM_MODELS[0].id;

const MODEL_INDEX = new Map(WEBLLM_MODELS.map((entry) => [entry.id, entry]));

/**
 * Look up a model entry by its MLC id.
 * @param {string} id
 * @returns {WebLLMModelEntry | null}
 */
export const getWebLLMModel = (id) => MODEL_INDEX.get(String(id ?? "")) ?? null;

/**
 * Return true if the given id is in our supported catalog.
 * @param {string} id
 */
export const isSupportedWebLLMModel = (id) => MODEL_INDEX.has(String(id ?? ""));
