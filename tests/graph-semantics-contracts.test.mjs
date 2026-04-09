import assert from "node:assert/strict";
import test from "node:test";

import {
  getSchemaPreset,
  inferSchemaPresetId,
  listPortPresetsForNodeType,
  listSchemaPresets
} from "../js/core/contract-presets.js";
import { getDefaultPortsForNodeType, validateEdgeSemantics } from "../js/core/graph-semantics.js";
import { EDGE_TYPES, NODE_TYPES } from "../js/core/types.js";

test("schema helper exposes common payload presets", () => {
  const presets = listSchemaPresets();
  const presetIds = new Set(presets.map((preset) => preset.id));

  assert.equal(presetIds.has("text"), true);
  assert.equal(presetIds.has("object"), true);
  assert.equal(presetIds.has("array"), true);
  assert.equal(presetIds.has("dataset"), true);
  assert.equal(presetIds.has("prompt"), true);
  assert.equal(presetIds.has("report"), true);
  assert.equal(presetIds.has("command_result"), true);
});

test("node default ports stay backward compatible while carrying preset schema", () => {
  const dataDefaults = getDefaultPortsForNodeType(NODE_TYPES.DATA);
  assert.equal(dataDefaults.input.length, 0);
  assert.equal(dataDefaults.output.length, 1);
  assert.equal(dataDefaults.output[0].id, "dataset");
  assert.equal(dataDefaults.output[0].payloadType, "object");
  assert.equal(dataDefaults.output[0].required, true);
  assert.equal(dataDefaults.output[0].schema.type, "object");
  assert.deepEqual(dataDefaults.output[0].schema.required, ["rows"]);

  const triggerDefaults = getDefaultPortsForNodeType(NODE_TYPES.U2OS_TRIGGER);
  assert.equal(triggerDefaults.input.length, 0);
  assert.equal(triggerDefaults.output.length, 2);
  assert.equal(triggerDefaults.output[0].id, "payload");
  assert.equal(triggerDefaults.output[0].payloadType, "object");
  assert.equal(triggerDefaults.output[1].id, "metadata");
  assert.equal(triggerDefaults.output[1].payloadType, "object");

  const queryDefaults = getDefaultPortsForNodeType(NODE_TYPES.U2OS_QUERY);
  assert.equal(queryDefaults.input.length, 0);
  assert.equal(queryDefaults.output.some((port) => port.id === "results"), true);
  assert.equal(queryDefaults.output.some((port) => port.id === "count"), true);
  assert.equal(queryDefaults.output.some((port) => port.id === "meta"), true);

  const mutateDefaults = getDefaultPortsForNodeType(NODE_TYPES.U2OS_MUTATE);
  assert.equal(mutateDefaults.input.some((port) => port.id === "payload"), true);
  assert.equal(mutateDefaults.input.some((port) => port.id === "entityId"), true);
  assert.equal(mutateDefaults.output.some((port) => port.id === "status"), true);

  const emitDefaults = getDefaultPortsForNodeType(NODE_TYPES.U2OS_EMIT);
  assert.equal(emitDefaults.input.length, 1);
  assert.equal(emitDefaults.input[0].id, "payload");
  assert.equal(emitDefaults.output.length, 1);
  assert.equal(emitDefaults.output[0].id, "confirmation");
});

test("port presets are role-aware and infer correctly", () => {
  const agentInputPresets = listPortPresetsForNodeType(NODE_TYPES.AGENT, "input");
  const presetIds = agentInputPresets.map((preset) => preset.id);
  assert.deepEqual(presetIds, ["context", "prompt", "dataset"]);

  const commandResultPreset = getSchemaPreset("command result");
  assert.equal(commandResultPreset?.id, "command_result");
  assert.equal(
    inferSchemaPresetId({
      payloadType: commandResultPreset.payloadType,
      schema: commandResultPreset.schema
    }),
    "command_result"
  );
});

test("edge compatibility validation returns clear mismatch details", () => {
  const sourceNode = {
    id: "source",
    type: NODE_TYPES.DATA,
    data: {
      outputPorts: [{ id: "dataset", label: "Dataset", payloadType: "object", required: true, schema: {} }],
      inputPorts: []
    }
  };
  const targetNode = {
    id: "target",
    type: NODE_TYPES.AGENT,
    data: {
      inputPorts: [{ id: "context", label: "Context", payloadType: "object", required: true, schema: {} }],
      outputPorts: []
    }
  };

  const mismatchEdge = {
    id: "edge_mismatch",
    source: sourceNode.id,
    target: targetNode.id,
    type: EDGE_TYPES.FEEDS_DATA,
    metadata: {
      contract: {
        sourcePort: "dataset",
        targetPort: "context",
        payloadType: "string",
        required: true,
        schema: {}
      }
    }
  };

  const mismatchValidation = validateEdgeSemantics(mismatchEdge, sourceNode, targetNode);
  assert.equal(mismatchValidation.valid, false);
  assert.match(mismatchValidation.errors.join(" "), /payload mismatch/i);
  assert.match(mismatchValidation.errors.join(" "), /emits object/i);
  assert.match(mismatchValidation.errors.join(" "), /accepts object/i);

  const unknownPortEdge = {
    ...mismatchEdge,
    id: "edge_unknown_port",
    metadata: {
      contract: {
        sourcePort: "missing_output",
        targetPort: "context",
        payloadType: "object",
        required: true,
        schema: {}
      }
    }
  };

  const unknownPortValidation = validateEdgeSemantics(unknownPortEdge, sourceNode, targetNode);
  assert.equal(unknownPortValidation.valid, false);
  assert.match(unknownPortValidation.errors.join(" "), /unknown source output port/i);
  assert.match(unknownPortValidation.errors.join(" "), /available source output ports/i);
});
