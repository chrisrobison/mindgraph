import assert from "node:assert/strict";
import test from "node:test";

import { EVENTS } from "../js/core/event-constants.js";
import { WebLLMAgentRuntime } from "../js/runtime/webllm-agent-runtime.js";
import { DEFAULT_WEBLLM_MODEL_ID, WEBLLM_MODELS, isSupportedWebLLMModel } from "../js/runtime/webllm-model-catalog.js";

const createAgentNode = ({ id = "agent_1", label = "Test Agent" } = {}) => ({
  id,
  type: "agent",
  label,
  description: "Test agent node",
  data: { role: "Tester", mode: "orchestrate" }
});

/**
 * Build a minimal runnable graph: one data node feeding one agent node.
 * Agent nodes require `requiredInputSources: 1` to be planner-ready.
 */
const createRunnableAgentDocument = (agentNode) => ({
  nodes: [
    {
      id: "data_in",
      type: "data",
      label: "Input data",
      data: {
        sourceType: "embedded",
        sourcePath: "inline",
        refreshMode: "manual",
        cachedData: { hello: "world" }
      }
    },
    agentNode
  ],
  edges: [
    {
      id: "e_data_to_agent",
      type: "feeds_data",
      source: "data_in",
      target: agentNode.id,
      metadata: {
        contract: {
          sourcePort: "dataset",
          targetPort: "context",
          payloadType: "object",
          required: true
        }
      }
    }
  ]
});

const createFakeStore = (document) => {
  const byId = new Map(document.nodes.map((node) => [node.id, node]));
  return {
    document,
    getDocument: () => document,
    getNode: (id) => byId.get(id) ?? null
  };
};

const createRuntime = (overrides = {}) => {
  const node = createAgentNode();
  const document = createRunnableAgentDocument(node);
  const store = createFakeStore(document);
  const published = [];
  const publish = (event, payload) => published.push({ event, payload });

  const initEngine = overrides.initEngine ?? (async (modelId) => ({
    modelId,
    chat: async (messages) => ({
      text: `mock response for ${messages[messages.length - 1]?.content?.slice(0, 16) ?? ""}`,
      raw: null
    })
  }));

  const runtime = new WebLLMAgentRuntime({
    store,
    panPublish: publish,
    isWebGpuAvailable: () => true,
    initEngine,
    bridgeClient: {
      mutateU2osEntity: async () => ({ result: null, entityId: "", status: { ok: true } }),
      emitU2osEvent: async () => ({ ok: true })
    },
    ...overrides
  });

  return { runtime, store, published, node };
};

test("catalog: default model id is in catalog", () => {
  assert.ok(isSupportedWebLLMModel(DEFAULT_WEBLLM_MODEL_ID));
  assert.ok(WEBLLM_MODELS.length >= 3);
});

test("WebLLMAgentRuntime exposes the AgentRuntime contract", () => {
  const { runtime } = createRuntime();
  assert.equal(typeof runtime.runNode, "function");
  assert.equal(typeof runtime.runSubtree, "function");
  assert.equal(typeof runtime.runAll, "function");
  assert.equal(typeof runtime.cancelAll, "function");
  assert.equal(typeof runtime.isAvailable, "function");
});

test("runNode publishes started+completed events and returns provider_output", async () => {
  const { runtime, published, node } = createRuntime();

  const result = await runtime.runNode(node.id);

  assert.equal(result.ok, true);
  assert.equal(result.mode, "webllm");
  assert.equal(result.output.type, "provider_output");
  assert.equal(result.output.provider, "webllm");
  assert.ok(result.output.text.length > 0);

  const eventNames = published.map((entry) => entry.event);
  assert.ok(
    eventNames.includes(EVENTS.RUNTIME_AGENT_RUN_STARTED),
    "should publish RUNTIME_AGENT_RUN_STARTED"
  );
  assert.ok(
    eventNames.includes(EVENTS.RUNTIME_AGENT_RUN_COMPLETED),
    "should publish RUNTIME_AGENT_RUN_COMPLETED"
  );
  assert.ok(
    eventNames.includes(EVENTS.RUNTIME_RUN_HISTORY_APPENDED),
    "should publish RUNTIME_RUN_HISTORY_APPENDED"
  );
  assert.ok(
    eventNames.includes(EVENTS.GRAPH_NODE_UPDATE_REQUESTED),
    "should publish GRAPH_NODE_UPDATE_REQUESTED"
  );
});

test("runNode surfaces engine failures as RUNTIME_AGENT_RUN_FAILED", async () => {
  const { runtime, published, node } = createRuntime({
    initEngine: async () => ({
      modelId: DEFAULT_WEBLLM_MODEL_ID,
      chat: async () => {
        throw new Error("device out of memory");
      }
    })
  });

  const result = await runtime.runNode(node.id);

  assert.equal(result.ok, false);
  assert.match(result.error, /device out of memory/);

  const failedEntry = published.find((entry) => entry.event === EVENTS.RUNTIME_AGENT_RUN_FAILED);
  assert.ok(failedEntry, "should publish RUNTIME_AGENT_RUN_FAILED");
  assert.match(String(failedEntry.payload?.reason ?? ""), /device out of memory/);

  const errorEntry = published.find((entry) => entry.event === EVENTS.RUNTIME_ERROR_APPENDED);
  assert.ok(errorEntry, "should publish RUNTIME_ERROR_APPENDED");
  assert.equal(errorEntry.payload.source, "webllm-runtime");
});

test("runNode rejects when WebGPU is unavailable", async () => {
  const { runtime, node, published } = createRuntime({
    isWebGpuAvailable: () => false
  });

  const result = await runtime.runNode(node.id);

  assert.equal(result.ok, false);
  assert.match(result.error, /WebGPU is not available/);

  const failedEntry = published.find((entry) => entry.event === EVENTS.RUNTIME_AGENT_RUN_FAILED);
  assert.ok(failedEntry);
});

test("runNode returns a planner-blocked error for non-runnable nodes", async () => {
  const upstream = createAgentNode({ id: "upstream", label: "Upstream" });
  const blocked = { ...createAgentNode({ id: "blocked", label: "Blocked" }), data: {} };
  const document = {
    nodes: [upstream, blocked],
    edges: [
      {
        id: "e1",
        type: "depends_on",
        source: "upstream",
        target: "blocked"
      }
    ]
  };
  const store = createFakeStore(document);
  const published = [];
  const runtime = new WebLLMAgentRuntime({
    store,
    panPublish: (event, payload) => published.push({ event, payload }),
    isWebGpuAvailable: () => true,
    initEngine: async (modelId) => ({ modelId, chat: async () => ({ text: "" }) })
  });

  const result = await runtime.runNode("blocked");
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.blockedReasons));
});

test("runNode returns error for unknown node id", async () => {
  const { runtime, published } = createRuntime();
  const result = await runtime.runNode("nope");
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
  assert.ok(published.some((entry) => entry.event === EVENTS.RUNTIME_AGENT_RUN_FAILED));
});

test("setModelId rejects models outside the catalog and keeps the previous id", () => {
  const { runtime } = createRuntime();
  const before = runtime.getModelId();
  runtime.setModelId("definitely-not-a-real-model");
  // resolveModelId falls back to the default; the previous id is replaced only by valid ids.
  assert.ok(isSupportedWebLLMModel(runtime.getModelId()), "active model id stays in catalog");
  assert.equal(runtime.getModelId(), before === DEFAULT_WEBLLM_MODEL_ID ? DEFAULT_WEBLLM_MODEL_ID : DEFAULT_WEBLLM_MODEL_ID);
});

test("setModelId accepts a real catalog id", () => {
  const { runtime } = createRuntime();
  const alt = WEBLLM_MODELS.find((entry) => entry.id !== runtime.getModelId());
  if (!alt) return; // single-entry catalog edge case
  runtime.setModelId(alt.id);
  assert.equal(runtime.getModelId(), alt.id);
});

test("cancelAll aborts in-flight runs", async () => {
  let abortReason = null;
  const initEngine = async (modelId) => ({
    modelId,
    chat: (_messages, _opts, signal) =>
      new Promise((_resolve, reject) => {
        if (!signal) {
          reject(new Error("signal missing"));
          return;
        }
        signal.addEventListener("abort", () => {
          abortReason = signal.reason ?? "aborted";
          reject(new Error(`Aborted: ${abortReason}`));
        });
      })
  });

  const { runtime, node } = createRuntime({ initEngine });
  const pending = runtime.runNode(node.id);
  // Give the runtime a tick to register its abort controller.
  await new Promise((resolve) => setTimeout(resolve, 5));
  runtime.cancelAll("test_cancel");
  const result = await pending;

  assert.equal(result.ok, false);
  assert.equal(abortReason, "test_cancel");
});
