import { createGraphDocument } from "./graph-document.js";
import { EDGE_TYPES, NODE_TYPES } from "./types.js";

export const seedDocument = createGraphDocument({
  id: "graph_seed_product_launch",
  title: "MindGraph AI - Product Launch Plan",
  version: "0.2.0",
  nodes: [
    {
      id: "agent_product_launch_plan",
      type: NODE_TYPES.AGENT,
      label: "Product Launch Plan",
      description: "Coordinator orchestrating launch agents and deliverables.",
      position: { x: 860, y: 180 },
      data: {
        role: "Agent Coordinator",
        mode: "orchestrate",
        status: "active",
        allowedDataSources: [
          "data_site_config",
          "data_market_data",
          "data_ads_api_mock",
          "data_support_db"
        ],
        linkedDataCount: 4
      }
    },
    {
      id: "agent_website_builder",
      type: NODE_TYPES.AGENT,
      label: "Website Builder",
      description: "Builds and ships launch pages from approved config.",
      position: { x: 260, y: 470 },
      data: {
        role: "Agent",
        mode: "build",
        status: "ready",
        allowedDataSources: ["data_site_config"],
        linkedDataCount: 1
      }
    },
    {
      id: "agent_market_analyst",
      type: NODE_TYPES.AGENT,
      label: "Market Analyst",
      description: "Monitors signals, trends, and competitive movement.",
      position: { x: 690, y: 470 },
      data: {
        role: "Agent",
        mode: "analyze",
        status: "active",
        allowedDataSources: ["data_market_data"],
        linkedDataCount: 1
      }
    },
    {
      id: "agent_ad_campaign_bot",
      type: NODE_TYPES.AGENT,
      label: "Ad Campaign Bot",
      description: "Optimizes campaign channels and spend targets.",
      position: { x: 1120, y: 470 },
      data: {
        role: "Agent",
        mode: "optimize",
        status: "idle",
        allowedDataSources: ["data_ads_api_mock"],
        linkedDataCount: 1
      }
    },
    {
      id: "agent_support_agent",
      type: NODE_TYPES.AGENT,
      label: "Support Agent",
      description: "Tracks user issues and launch readiness feedback.",
      position: { x: 1550, y: 470 },
      data: {
        role: "Agent",
        mode: "assist",
        status: "ready",
        allowedDataSources: ["data_support_db"],
        linkedDataCount: 1
      }
    },
    {
      id: "data_site_config",
      type: NODE_TYPES.DATA,
      label: "site_config.json",
      description: "Website structure and launch copy settings.",
      position: { x: 220, y: 780 },
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
      id: "data_market_data",
      type: NODE_TYPES.DATA,
      label: "market_data.json",
      description: "Market intelligence snapshots and trend extracts.",
      position: { x: 650, y: 780 },
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
      id: "data_ads_api_mock",
      type: NODE_TYPES.DATA,
      label: "ads_api_mock",
      description: "Mock ad-platform metrics and conversion signals.",
      position: { x: 1080, y: 780 },
      data: {
        source: "mock",
        sourceType: "mock",
        sourcePath: "ads_api_mock.json",
        sourceUrl: "",
        jsonPath: "",
        refreshMode: "periodic",
        refreshInterval: 30,
        cachedData: null,
        cachedSchema: null,
        lastUpdated: "",
        readonly: true
      }
    },
    {
      id: "data_support_db",
      type: NODE_TYPES.DATA,
      label: "support_db.json",
      description: "Support backlog and issue category records.",
      position: { x: 1510, y: 780 },
      data: {
        source: "json",
        sourceType: "json",
        sourcePath: "support_db.json",
        sourceUrl: "",
        jsonPath: "",
        refreshMode: "manual",
        refreshInterval: 60,
        cachedData: null,
        cachedSchema: null,
        lastUpdated: "",
        readonly: true
      }
    }
  ],
  edges: [
    {
      id: "edge_parent_website",
      type: EDGE_TYPES.PARENT_OF,
      source: "agent_product_launch_plan",
      target: "agent_website_builder",
      label: "parent_of"
    },
    {
      id: "edge_parent_market",
      type: EDGE_TYPES.PARENT_OF,
      source: "agent_product_launch_plan",
      target: "agent_market_analyst",
      label: "parent_of"
    },
    {
      id: "edge_parent_ads",
      type: EDGE_TYPES.PARENT_OF,
      source: "agent_product_launch_plan",
      target: "agent_ad_campaign_bot",
      label: "parent_of"
    },
    {
      id: "edge_parent_support",
      type: EDGE_TYPES.PARENT_OF,
      source: "agent_product_launch_plan",
      target: "agent_support_agent",
      label: "parent_of"
    },
    {
      id: "edge_report_website",
      type: EDGE_TYPES.REPORTS_TO,
      source: "agent_website_builder",
      target: "agent_product_launch_plan",
      label: "reports_to"
    },
    {
      id: "edge_report_market",
      type: EDGE_TYPES.REPORTS_TO,
      source: "agent_market_analyst",
      target: "agent_product_launch_plan",
      label: "reports_to"
    },
    {
      id: "edge_report_ads",
      type: EDGE_TYPES.REPORTS_TO,
      source: "agent_ad_campaign_bot",
      target: "agent_product_launch_plan",
      label: "reports_to"
    },
    {
      id: "edge_report_support",
      type: EDGE_TYPES.REPORTS_TO,
      source: "agent_support_agent",
      target: "agent_product_launch_plan",
      label: "reports_to"
    },
    {
      id: "edge_reads_site_config",
      type: EDGE_TYPES.READS_FROM,
      source: "agent_website_builder",
      target: "data_site_config",
      label: "reads_from"
    },
    {
      id: "edge_reads_market_data",
      type: EDGE_TYPES.READS_FROM,
      source: "agent_market_analyst",
      target: "data_market_data",
      label: "reads_from"
    },
    {
      id: "edge_reads_ads_api",
      type: EDGE_TYPES.READS_FROM,
      source: "agent_ad_campaign_bot",
      target: "data_ads_api_mock",
      label: "reads_from"
    },
    {
      id: "edge_reads_support_db",
      type: EDGE_TYPES.READS_FROM,
      source: "agent_support_agent",
      target: "data_support_db",
      label: "reads_from"
    }
  ],
  viewport: {
    x: -120,
    y: -100,
    zoom: 1
  },
  metadata: {
    createdBy: "mindgraph-seed",
    description: "Product launch coordination graph demo"
  }
});
