import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";

export const actionExecutor = {
  execute(actionId, input = {}) {
    const entry = {
      actionId,
      input,
      executedAt: new Date().toISOString()
    };

    publish(EVENTS.ACTIVITY_LOG_APPENDED, {
      level: "info",
      message: `Action executed: ${actionId}`
    });

    return entry;
  }
};
