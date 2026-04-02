import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";

export class AgentRuntime {
  run(nodeId, context = {}) {
    publish(EVENTS.RUNTIME_AGENT_RUN_STARTED, { nodeId, context });

    try {
      const result = {
        nodeId,
        status: "completed",
        output: `Agent run completed for ${nodeId}`,
        context
      };

      publish(EVENTS.RUNTIME_AGENT_RUN_COMPLETED, result);
      return result;
    } catch (error) {
      publish(EVENTS.RUNTIME_AGENT_RUN_FAILED, {
        nodeId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
