import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";

export const dataConnectors = {
  refresh(sourceId) {
    const payload = {
      sourceId,
      refreshedAt: new Date().toISOString()
    };

    publish(EVENTS.RUNTIME_DATA_REFRESHED, payload);
    return payload;
  }
};
