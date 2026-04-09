// @ts-check

import { validateEventPayload } from "./event-contracts.js";

const bus = new EventTarget();
const wildcardHandlers = new Set();
let eventValidationEnabled = true;

const warnInvalidPayload = (eventName, payload, reason = "Invalid payload") => {
  try {
    console.warn(`[pan] ${reason}`, { eventName, payload });
  } catch {
    // noop
  }
};

export const publish = (eventName, payload = {}) => {
  if (eventValidationEnabled) {
    const validation = validateEventPayload(eventName, payload);
    if (!validation.ok) {
      warnInvalidPayload(eventName, payload, validation.reason);
    }
  }
  const detail = { eventName, payload, timestamp: Date.now() };
  bus.dispatchEvent(new CustomEvent(eventName, { detail }));
  wildcardHandlers.forEach((handler) => handler(detail));
};

export const subscribe = (eventName, handler) => {
  if (eventName === "*") {
    wildcardHandlers.add(handler);
    return () => unsubscribe(eventName, handler);
  }

  const wrapped = (event) => handler(event.detail);
  handler.__panWrapped = wrapped;
  bus.addEventListener(eventName, wrapped);
  return () => unsubscribe(eventName, handler);
};

export const unsubscribe = (eventName, handler) => {
  if (eventName === "*") {
    wildcardHandlers.delete(handler);
    return;
  }

  const wrapped = handler.__panWrapped ?? handler;
  bus.removeEventListener(eventName, wrapped);
};

export const setEventValidationEnabled = (enabled) => {
  eventValidationEnabled = Boolean(enabled);
};
