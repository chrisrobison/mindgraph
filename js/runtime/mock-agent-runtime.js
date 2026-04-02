import { AgentRuntime } from "./agent-runtime.js";

export class MockAgentRuntime extends AgentRuntime {
  run(nodeId, context = {}) {
    return super.run(nodeId, { ...context, runtime: "mock" });
  }
}
