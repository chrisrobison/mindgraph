import { createGraphDocument } from "./graph-document.js";
import { EDGE_TYPES, NODE_TYPES } from "./types.js";

export const seedDocument = createGraphDocument({
  id: "graph_seed_campaign_workflow",
  title: "MindGraph AI - Campaign Intelligence Workflow",
  version: "0.3.0",
  nodes: [
    {
      id: "note_workflow_brief",
      type: NODE_TYPES.NOTE,
      label: "Workflow Brief",
      description: "Goal: generate a launch-ready campaign brief and publish action payload.",
      position: { x: 140, y: 140 },
      data: {
        color: "#f4f9ff",
        tags: ["context", "launch"]
      }
    },
    {
      id: "data_market_data",
      type: NODE_TYPES.DATA,
      label: "market_data.json",
      description: "Market signal snapshots and competitor movement.",
      position: { x: 180, y: 470 },
      data: {
        source: "json",
        sourceType: "json",
        sourcePath: "market_data.json",
        sourceUrl: "",
        jsonPath: "",
        refreshMode: "periodic",
        refreshInterval: 45,
        cachedData: null,
        cachedSchema: null,
        lastUpdated: "",
        readonly: true
      }
    },
    {
      id: "trigger_order_created",
      type: NODE_TYPES.U2OS_TRIGGER,
      label: "Order Created Trigger",
      description: "Starts workflow when U2OS publishes an order.created event.",
      position: { x: 180, y: 300 },
      data: {
        eventName: "order.created",
        filterExpression: "",
        cachedData: null,
        cachedSchema: null,
        lastUpdated: "",
        lastReceivedAt: "",
        lastReceivedPayloadPreview: "",
        lastReceivedMetadata: null
      }
    },
    {
      id: "data_site_config",
      type: NODE_TYPES.DATA,
      label: "site_config.json",
      description: "Site copy and feature flags used by downstream planning.",
      position: { x: 180, y: 740 },
      data: {
        source: "json",
        sourceType: "json",
        sourcePath: "site_config.json",
        sourceUrl: "",
        jsonPath: "",
        refreshMode: "onOpen",
        refreshInterval: 60,
        cachedData: null,
        cachedSchema: null,
        lastUpdated: "",
        readonly: true
      }
    },
    {
      id: "transformer_signal_normalizer",
      type: NODE_TYPES.TRANSFORMER,
      label: "Signal Normalizer",
      description: "Normalizes raw market payloads into planner-ready fields.",
      position: { x: 610, y: 520 },
      data: {
        transformExpression: "market_snapshot_to_signal_summary",
        inputSchema: {},
        outputSchema: {},
        status: "idle",
        lastOutput: null,
        lastRunAt: "",
        lastRunSummary: ""
      }
    },
    {
      id: "agent_strategy_synthesizer",
      type: NODE_TYPES.AGENT,
      label: "Strategy Synthesizer",
      description: "Builds a campaign strategy from normalized signals and config context.",
      position: { x: 1040, y: 500 },
      data: {
        role: "Campaign Strategist",
        mode: "synthesize",
        objective: "Produce a concise launch strategy with channel priorities.",
        status: "idle",
        confidence: 0.5,
        lastRunSummary: "",
        lastOutput: null,
        lastRunAt: "",
        inputSchema: {},
        outputSchema: {},
        runHistory: [],
        activityHistory: [],
        allowedDataSources: ["data_site_config"],
        linkedDataCount: 1
      }
    },
    {
      id: "view_campaign_brief",
      type: NODE_TYPES.VIEW,
      label: "Campaign Brief View",
      description: "Renders a reviewer-facing launch brief.",
      position: { x: 1470, y: 490 },
      data: {
        outputTemplate: "campaign_brief",
        status: "idle",
        lastOutput: null,
        lastRunAt: "",
        lastRunSummary: ""
      }
    },
    {
      id: "action_publish_brief",
      type: NODE_TYPES.ACTION,
      label: "Publish Brief Payload",
      description: "Prepares publish payload for downstream delivery system.",
      position: { x: 1900, y: 490 },
      data: {
        command: "publish_campaign_brief",
        config: {
          channel: "launch_ops_queue"
        },
        status: "idle",
        lastOutput: null,
        lastRunAt: "",
        lastRunSummary: ""
      }
    }
  ],
  edges: [
    {
      id: "edge_ref_note_strategy",
      type: EDGE_TYPES.REFERENCES,
      source: "note_workflow_brief",
      target: "agent_strategy_synthesizer",
      label: "references"
    },
    {
      id: "edge_trigger_to_transformer",
      type: EDGE_TYPES.FEEDS_DATA,
      source: "trigger_order_created",
      target: "transformer_signal_normalizer",
      label: "feeds_data"
    },
    {
      id: "edge_data_to_transformer",
      type: EDGE_TYPES.FEEDS_DATA,
      source: "data_market_data",
      target: "transformer_signal_normalizer",
      label: "feeds_data"
    },
    {
      id: "edge_transformer_to_agent_data",
      type: EDGE_TYPES.FEEDS_DATA,
      source: "transformer_signal_normalizer",
      target: "agent_strategy_synthesizer",
      label: "feeds_data"
    },
    {
      id: "edge_agent_reads_site_config",
      type: EDGE_TYPES.READS_FROM,
      source: "agent_strategy_synthesizer",
      target: "data_site_config",
      label: "reads_from"
    },
    {
      id: "edge_exec_transformer_agent",
      type: EDGE_TYPES.DEPENDS_ON,
      source: "transformer_signal_normalizer",
      target: "agent_strategy_synthesizer",
      label: "depends_on"
    },
    {
      id: "edge_exec_agent_view",
      type: EDGE_TYPES.DEPENDS_ON,
      source: "agent_strategy_synthesizer",
      target: "view_campaign_brief",
      label: "depends_on"
    },
    {
      id: "edge_data_agent_view",
      type: EDGE_TYPES.FEEDS_DATA,
      source: "agent_strategy_synthesizer",
      target: "view_campaign_brief",
      label: "feeds_data"
    },
    {
      id: "edge_exec_view_action",
      type: EDGE_TYPES.DEPENDS_ON,
      source: "view_campaign_brief",
      target: "action_publish_brief",
      label: "depends_on"
    },
    {
      id: "edge_data_view_action",
      type: EDGE_TYPES.FEEDS_DATA,
      source: "view_campaign_brief",
      target: "action_publish_brief",
      label: "feeds_data"
    },
    {
      id: "edge_hierarchy_strategy_view",
      type: EDGE_TYPES.PARENT_OF,
      source: "agent_strategy_synthesizer",
      target: "view_campaign_brief",
      label: "parent_of"
    },
    {
      id: "edge_hierarchy_strategy_action",
      type: EDGE_TYPES.PARENT_OF,
      source: "agent_strategy_synthesizer",
      target: "action_publish_brief",
      label: "parent_of"
    }
  ],
  viewport: {
    x: -70,
    y: -120,
    zoom: 1
  },
  metadata: {
    createdBy: "mindgraph-seed",
    description: "Pipeline seed graph with U2OS trigger entry, explicit semantics, and planner-compatible execution edges"
  }
});
