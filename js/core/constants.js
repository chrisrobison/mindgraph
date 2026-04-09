export const WORLD_SIZE = Object.freeze({
  width: 3200,
  height: 2200
});

export const GRAPH_LIMITS = Object.freeze({
  minZoom: 0.45,
  maxZoom: 1.8,
  zoomInFactor: 1.08,
  zoomOutFactor: 0.92,
  gridSize: 24,
  nodeMinX: -150,
  nodeMinY: -100,
  nodeMaxPaddingX: 100,
  nodeMaxPaddingY: 80
});

export const NODE_SIZE_BY_TYPE = Object.freeze({
  note: Object.freeze({ width: 250, height: 140 }),
  agent: Object.freeze({ width: 290, height: 180 }),
  data: Object.freeze({ width: 260, height: 138 }),
  u2os_trigger: Object.freeze({ width: 280, height: 164 }),
  u2os_query: Object.freeze({ width: 280, height: 164 }),
  u2os_mutate: Object.freeze({ width: 210, height: 104 }),
  u2os_emit: Object.freeze({ width: 210, height: 104 }),
  transformer: Object.freeze({ width: 210, height: 104 }),
  view: Object.freeze({ width: 210, height: 104 }),
  action: Object.freeze({ width: 210, height: 104 })
});

export const NODE_TEMPLATES = Object.freeze({
  note: Object.freeze({
    label: "New Note",
    description: "Capture context and decisions.",
    data: Object.freeze({ color: "#f4f9ff", tags: [] })
  }),
  agent: Object.freeze({
    label: "New Agent",
    description: "Define a role and objective.",
    data: Object.freeze({
      role: "Research Agent",
      mode: "orchestrate",
      status: "idle",
      confidence: 0.5,
      lastRunSummary: "",
      lastOutput: null,
      inputSchema: {},
      outputSchema: {},
      runHistory: [],
      activityHistory: [],
      allowedDataSources: [],
      linkedDataCount: 0
    })
  }),
  data: Object.freeze({
    label: "New Data",
    description: "Connect a data source.",
    data: Object.freeze({
      source: "json",
      sourceType: "json",
      sourcePath: "embedded:site_config",
      sourceUrl: "",
      jsonPath: "",
      refreshMode: "manual",
      refreshInterval: 60,
      readonly: true,
      cachedData: null,
      cachedSchema: null,
      lastUpdated: ""
    })
  }),
  u2os_trigger: Object.freeze({
    label: "U2OS Event Trigger",
    description: "Activates when a U2OS event is received",
    data: Object.freeze({
      eventName: "",
      filterExpression: "",
      cachedData: null,
      lastUpdated: "",
      lastReceivedAt: "",
      lastReceivedPayloadPreview: "",
      lastReceivedMetadata: null
    })
  }),
  u2os_query: Object.freeze({
    label: "U2OS Query",
    description: "Loads U2OS entity records through the bridge connection.",
    data: Object.freeze({
      entity: "reservation",
      operation: "list",
      filter: "",
      limit: 50,
      includeRelations: [],
      refreshMode: "manual",
      refreshInterval: 60,
      cachedData: null,
      cachedSchema: null,
      lastUpdated: ""
    })
  }),
  u2os_mutate: Object.freeze({
    label: "U2OS Mutate",
    description: "Creates, updates, or deletes a U2OS business entity.",
    data: Object.freeze({
      entity: "reservation",
      operation: "create",
      mapInputs: [],
      status: "idle",
      lastOutput: null,
      lastRunAt: "",
      lastRunSummary: ""
    })
  }),
  u2os_emit: Object.freeze({
    label: "U2OS Emit",
    description: "Emits a named U2OS event payload over the bridge.",
    data: Object.freeze({
      eventName: "",
      payloadMapping: [],
      status: "idle",
      lastOutput: null,
      lastRunAt: "",
      lastRunSummary: ""
    })
  }),
  transformer: Object.freeze({
    label: "New Transformer",
    description: "Transform source inputs.",
    data: Object.freeze({
      transformExpression: "identity",
      inputSchema: {},
      outputSchema: {},
      status: "idle",
      lastOutput: null,
      lastRunAt: "",
      lastRunSummary: ""
    })
  }),
  view: Object.freeze({
    label: "New View",
    description: "Render output for review.",
    data: Object.freeze({
      outputTemplate: "summary_card",
      status: "idle",
      lastOutput: null,
      lastRunAt: "",
      lastRunSummary: ""
    })
  }),
  action: Object.freeze({
    label: "New Action",
    description: "Run an external action.",
    data: Object.freeze({
      command: "noop",
      config: {},
      status: "idle",
      lastOutput: null,
      lastRunAt: "",
      lastRunSummary: ""
    })
  })
});

export const HISTORY_LIMITS = Object.freeze({
  graphSnapshots: 80
});

export const PERSISTENCE = Object.freeze({
  autosaveDebounceMs: 450,
  storage: Object.freeze({
    lastSessionDocument: "mindgraph.last_session.document",
    autosaveEnabled: "mindgraph.autosave.enabled",
    runtimeMode: "mindgraph.runtime.mode",
    runtimeEndpoint: "mindgraph.runtime.endpoint",
    runtimeProviderSettings: "mindgraph.runtime.provider.settings",
    runtimeProviderSettingsSession: "mindgraph.runtime.provider.settings.session",
    uiTheme: "mindgraph.ui.theme",
    uiToolbarDisplay: "mindgraph.ui.toolbar.display"
  })
});

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const clampZoom = (value) => clamp(value, GRAPH_LIMITS.minZoom, GRAPH_LIMITS.maxZoom);

export const clampGraphPoint = (position) => ({
  x: Math.round(
    clamp(
      Number(position?.x ?? 0),
      GRAPH_LIMITS.nodeMinX,
      WORLD_SIZE.width - GRAPH_LIMITS.nodeMaxPaddingX
    )
  ),
  y: Math.round(
    clamp(
      Number(position?.y ?? 0),
      GRAPH_LIMITS.nodeMinY,
      WORLD_SIZE.height - GRAPH_LIMITS.nodeMaxPaddingY
    )
  )
});

export const formatEdgeLabel = (value) =>
  String(value ?? "")
    .trim()
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
