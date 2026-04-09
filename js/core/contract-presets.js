import { NODE_TYPES } from "./types.js";

const cloneJson = (value) => {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
};

const normalizePresetId = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const schemaPresetEntries = [
  [
    "text",
    {
      id: "text",
      label: "Text",
      payloadType: "string",
      description: "Plain text payload.",
      schema: {
        type: "string",
        minLength: 1
      }
    }
  ],
  [
    "number",
    {
      id: "number",
      label: "Number",
      payloadType: "number",
      description: "Numeric payload.",
      schema: {
        type: "number"
      }
    }
  ],
  [
    "object",
    {
      id: "object",
      label: "Object",
      payloadType: "object",
      description: "Generic JSON object payload.",
      schema: {
        type: "object",
        additionalProperties: true
      }
    }
  ],
  [
    "array",
    {
      id: "array",
      label: "Array",
      payloadType: "array",
      description: "Ordered list payload.",
      schema: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true
        }
      }
    }
  ],
  [
    "dataset",
    {
      id: "dataset",
      label: "Dataset",
      payloadType: "object",
      description: "Structured tabular data with rows and optional column metadata.",
      schema: {
        type: "object",
        required: ["rows"],
        properties: {
          rows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: true
            }
          },
          columns: {
            type: "array",
            items: {
              type: "string"
            }
          },
          rowCount: {
            type: "number"
          }
        }
      }
    }
  ],
  [
    "prompt",
    {
      id: "prompt",
      label: "Prompt",
      payloadType: "object",
      description: "Prompt payload with instruction and optional context variables.",
      schema: {
        type: "object",
        required: ["instruction"],
        properties: {
          instruction: {
            type: "string"
          },
          context: {
            type: "array",
            items: {
              type: "string"
            }
          },
          variables: {
            type: "object",
            additionalProperties: true
          }
        }
      }
    }
  ],
  [
    "report",
    {
      id: "report",
      label: "Report",
      payloadType: "object",
      description: "Structured report artifact with summary and section blocks.",
      schema: {
        type: "object",
        required: ["summary"],
        properties: {
          title: {
            type: "string"
          },
          summary: {
            type: "string"
          },
          sections: {
            type: "array",
            items: {
              type: "object",
              required: ["heading", "content"],
              properties: {
                heading: {
                  type: "string"
                },
                content: {
                  type: "string"
                }
              }
            }
          }
        }
      }
    }
  ],
  [
    "command_result",
    {
      id: "command_result",
      label: "Command Result",
      payloadType: "object",
      description: "Normalized command execution result payload.",
      schema: {
        type: "object",
        required: ["status"],
        properties: {
          status: {
            type: "string",
            enum: ["ok", "error"]
          },
          exitCode: {
            type: "number"
          },
          stdout: {
            type: "string"
          },
          stderr: {
            type: "string"
          },
          payload: {
            type: "object",
            additionalProperties: true
          }
        }
      }
    }
  ]
];

const SCHEMA_PRESET_BY_ID = Object.freeze(Object.fromEntries(schemaPresetEntries));
const SCHEMA_PRESETS = Object.freeze(schemaPresetEntries.map(([, preset]) => Object.freeze({ ...preset })));

const schemaPresetAliases = Object.freeze({
  commandresult: "command_result",
  command_result: "command_result",
  command_results: "command_result",
  command: "command_result"
});

const getSchemaPresetById = (id) => {
  const normalized = normalizePresetId(id);
  const canonicalId = SCHEMA_PRESET_BY_ID[normalized]
    ? normalized
    : schemaPresetAliases[normalized] ?? normalized;
  return SCHEMA_PRESET_BY_ID[canonicalId] ?? null;
};

const createPortPreset = ({
  id,
  label,
  description,
  schemaPreset,
  payloadType,
  required = false
}) => {
  const resolved = getSchemaPresetById(schemaPreset) ?? getSchemaPresetById("object");
  return Object.freeze({
    id,
    label,
    description,
    port: Object.freeze({
      id,
      label,
      payloadType: payloadType ?? resolved?.payloadType ?? "any",
      required,
      schema: cloneJson(resolved?.schema ?? {})
    })
  });
};

const PORT_PRESETS_BY_NODE_TYPE = Object.freeze({
  [NODE_TYPES.NOTE]: Object.freeze({
    input: Object.freeze([]),
    output: Object.freeze([
      createPortPreset({
        id: "reference",
        label: "Reference",
        schemaPreset: "text",
        required: false,
        description: "Reference text/context from a note node."
      })
    ])
  }),
  [NODE_TYPES.DATA]: Object.freeze({
    input: Object.freeze([]),
    output: Object.freeze([
      createPortPreset({
        id: "dataset",
        label: "Dataset",
        schemaPreset: "dataset",
        required: true,
        description: "Primary structured dataset output."
      }),
      createPortPreset({
        id: "record",
        label: "Record",
        schemaPreset: "object",
        required: false,
        description: "Single record/object output."
      }),
      createPortPreset({
        id: "report",
        label: "Report",
        schemaPreset: "report",
        required: false,
        description: "Prepared report artifact output."
      })
    ])
  }),
  [NODE_TYPES.U2OS_TRIGGER]: Object.freeze({
    input: Object.freeze([]),
    output: Object.freeze([
      createPortPreset({
        id: "payload",
        label: "Payload",
        schemaPreset: "object",
        required: true,
        description: "U2OS event payload emitted by trigger activation."
      }),
      createPortPreset({
        id: "metadata",
        label: "Metadata",
        schemaPreset: "object",
        required: false,
        description: "Event envelope metadata (tenantId, receivedAt, traceId, sourceChannel)."
      })
    ])
  }),
  [NODE_TYPES.U2OS_QUERY]: Object.freeze({
    input: Object.freeze([]),
    output: Object.freeze([
      createPortPreset({
        id: "results",
        label: "Results",
        schemaPreset: "array",
        required: true,
        description: "Array of records returned from the U2OS query."
      }),
      createPortPreset({
        id: "count",
        label: "Count",
        schemaPreset: "number",
        required: true,
        description: "Total number of matching records."
      }),
      createPortPreset({
        id: "meta",
        label: "Meta",
        schemaPreset: "object",
        required: false,
        description: "Query metadata such as executedAt/queryId/tenantId."
      })
    ])
  }),
  [NODE_TYPES.U2OS_MUTATE]: Object.freeze({
    input: Object.freeze([
      createPortPreset({
        id: "payload",
        label: "Payload",
        schemaPreset: "object",
        required: true,
        description: "Entity payload used for create/update/patch operations."
      }),
      createPortPreset({
        id: "entityId",
        label: "Entity ID",
        schemaPreset: "text",
        required: false,
        description: "Identifier for update/patch/delete operations."
      })
    ]),
    output: Object.freeze([
      createPortPreset({
        id: "result",
        label: "Result",
        schemaPreset: "object",
        required: false,
        description: "Created/updated/deleted entity response payload."
      }),
      createPortPreset({
        id: "entityId",
        label: "Entity ID",
        schemaPreset: "text",
        required: false,
        description: "Identifier of the affected entity record."
      }),
      createPortPreset({
        id: "status",
        label: "Status",
        schemaPreset: "object",
        required: true,
        description: "Mutation status payload with success/error details."
      })
    ])
  }),
  [NODE_TYPES.U2OS_EMIT]: Object.freeze({
    input: Object.freeze([
      createPortPreset({
        id: "payload",
        label: "Payload",
        schemaPreset: "object",
        required: true,
        description: "Event payload sent back to U2OS."
      })
    ]),
    output: Object.freeze([
      createPortPreset({
        id: "confirmation",
        label: "Confirmation",
        schemaPreset: "object",
        required: true,
        description: "Event echo payload including tenant/trace metadata."
      })
    ])
  }),
  [NODE_TYPES.TRANSFORMER]: Object.freeze({
    input: Object.freeze([
      createPortPreset({
        id: "input",
        label: "Input",
        schemaPreset: "object",
        required: true,
        description: "Default transform input object."
      }),
      createPortPreset({
        id: "dataset",
        label: "Dataset",
        schemaPreset: "dataset",
        required: false,
        description: "Dataset input for map/filter transforms."
      })
    ]),
    output: Object.freeze([
      createPortPreset({
        id: "output",
        label: "Output",
        schemaPreset: "object",
        required: true,
        description: "Default transform output object."
      }),
      createPortPreset({
        id: "report",
        label: "Report",
        schemaPreset: "report",
        required: false,
        description: "Optional report output from transform stage."
      })
    ])
  }),
  [NODE_TYPES.AGENT]: Object.freeze({
    input: Object.freeze([
      createPortPreset({
        id: "context",
        label: "Context",
        schemaPreset: "object",
        required: true,
        description: "Default structured context for reasoning."
      }),
      createPortPreset({
        id: "prompt",
        label: "Prompt",
        schemaPreset: "prompt",
        required: false,
        description: "Prompt template/instruction input."
      }),
      createPortPreset({
        id: "dataset",
        label: "Dataset",
        schemaPreset: "dataset",
        required: false,
        description: "Dataset context input for analysis tasks."
      })
    ]),
    output: Object.freeze([
      createPortPreset({
        id: "response",
        label: "Response",
        schemaPreset: "object",
        required: true,
        description: "Default structured agent response."
      }),
      createPortPreset({
        id: "report",
        label: "Report",
        schemaPreset: "report",
        required: false,
        description: "Human-readable report output."
      }),
      createPortPreset({
        id: "command_result",
        label: "Command Result",
        schemaPreset: "command_result",
        required: false,
        description: "Result payload from tool/command execution."
      })
    ])
  }),
  [NODE_TYPES.VIEW]: Object.freeze({
    input: Object.freeze([
      createPortPreset({
        id: "model",
        label: "Model",
        schemaPreset: "object",
        required: true,
        description: "Default model/context input for rendering."
      }),
      createPortPreset({
        id: "report",
        label: "Report",
        schemaPreset: "report",
        required: false,
        description: "Report input for render templates."
      })
    ]),
    output: Object.freeze([
      createPortPreset({
        id: "render",
        label: "Render",
        schemaPreset: "object",
        required: false,
        description: "Default rendered artifact payload."
      }),
      createPortPreset({
        id: "text",
        label: "Text",
        schemaPreset: "text",
        required: false,
        description: "Plain-text render output."
      })
    ])
  }),
  [NODE_TYPES.ACTION]: Object.freeze({
    input: Object.freeze([
      createPortPreset({
        id: "command_input",
        label: "Command Input",
        schemaPreset: "object",
        required: true,
        description: "Default command/action input payload."
      }),
      createPortPreset({
        id: "prompt",
        label: "Prompt",
        schemaPreset: "prompt",
        required: false,
        description: "Prompt/instruction input for side effects."
      })
    ]),
    output: Object.freeze([
      createPortPreset({
        id: "result",
        label: "Result",
        schemaPreset: "object",
        required: false,
        description: "Default action result payload."
      }),
      createPortPreset({
        id: "command_result",
        label: "Command Result",
        schemaPreset: "command_result",
        required: false,
        description: "Normalized command execution output."
      })
    ])
  })
});

const clonePresetPort = (presetPort) => ({
  id: String(presetPort?.id ?? "port"),
  label: String(presetPort?.label ?? presetPort?.id ?? "Port"),
  payloadType: String(presetPort?.payloadType ?? "any"),
  required: presetPort?.required !== false,
  schema: cloneJson(presetPort?.schema ?? {})
});

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const normalizedSchema = (schema) => (isObject(schema) ? JSON.stringify(schema) : "{}");

export const listSchemaPresets = () =>
  SCHEMA_PRESETS.map((preset) => ({
    ...preset,
    schema: cloneJson(preset.schema)
  }));

export const getSchemaPreset = (id) => {
  const preset = getSchemaPresetById(id);
  if (!preset) return null;
  return {
    ...preset,
    schema: cloneJson(preset.schema)
  };
};

export const inferSchemaPresetId = (entry = {}) => {
  const payloadType = String(entry?.payloadType ?? "any");
  const schemaString = normalizedSchema(entry?.schema);

  for (const preset of SCHEMA_PRESETS) {
    if (preset.payloadType !== payloadType) continue;
    if (normalizedSchema(preset.schema) === schemaString) return preset.id;
  }

  return null;
};

export const listPortPresetsForNodeType = (nodeType, direction = "input") => {
  const catalog = PORT_PRESETS_BY_NODE_TYPE[nodeType] ?? PORT_PRESETS_BY_NODE_TYPE[NODE_TYPES.NOTE];
  const presets = direction === "output" ? catalog.output : catalog.input;
  return (Array.isArray(presets) ? presets : []).map((preset) => ({
    ...preset,
    port: clonePresetPort(preset.port)
  }));
};

export const inferPortPresetId = (nodeType, direction, portLike = {}) => {
  const presets = listPortPresetsForNodeType(nodeType, direction);
  const target = {
    id: String(portLike?.id ?? ""),
    label: String(portLike?.label ?? ""),
    payloadType: String(portLike?.payloadType ?? "any"),
    required: portLike?.required !== false,
    schema: isObject(portLike?.schema) ? portLike.schema : {}
  };

  for (const preset of presets) {
    if (!preset?.id || !preset.port) continue;
    const candidate = preset.port;
    const schemaMatches = normalizedSchema(candidate.schema) === normalizedSchema(target.schema);
    if (
      candidate.id === target.id &&
      candidate.label === target.label &&
      candidate.payloadType === target.payloadType &&
      candidate.required === target.required &&
      schemaMatches
    ) {
      return preset.id;
    }
  }

  return null;
};

export const getDefaultPortsFromPresets = (nodeType) => {
  const inputPresets = listPortPresetsForNodeType(nodeType, "input");
  const outputPresets = listPortPresetsForNodeType(nodeType, "output");
  const includeAllInputPresets =
    nodeType === NODE_TYPES.U2OS_MUTATE || nodeType === NODE_TYPES.U2OS_EMIT;
  const includeAllOutputPresets =
    nodeType === NODE_TYPES.U2OS_TRIGGER ||
    nodeType === NODE_TYPES.U2OS_QUERY ||
    nodeType === NODE_TYPES.U2OS_MUTATE ||
    nodeType === NODE_TYPES.U2OS_EMIT;

  return {
    input: inputPresets.length
      ? includeAllInputPresets
        ? inputPresets.map((preset) => clonePresetPort(preset.port))
        : [clonePresetPort(inputPresets[0].port)]
      : [],
    output: outputPresets.length
      ? includeAllOutputPresets
        ? outputPresets.map((preset) => clonePresetPort(preset.port))
        : [clonePresetPort(outputPresets[0].port)]
      : []
  };
};
