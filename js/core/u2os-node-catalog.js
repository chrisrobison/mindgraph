import { EVENTS as U2OS_EVENT_DOMAINS, MINDGRAPH_U2OS_ENTITIES } from "./u2os-event-registry.js";

const asObject = (value) => (value != null && typeof value === "object" && !Array.isArray(value) ? value : null);

const toTitle = (value) =>
  String(value ?? "")
    .trim()
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase());

export const U2OS_ENTITIES = Object.freeze([...MINDGRAPH_U2OS_ENTITIES]);

export const U2OS_QUERY_OPERATIONS = Object.freeze(["list", "get", "search"]);
export const U2OS_MUTATE_OPERATIONS = Object.freeze(["create", "update", "patch", "delete"]);
export const U2OS_MUTATE_ENTITY_ID_OPERATIONS = Object.freeze(["update", "patch", "delete"]);

const ENTITY_RESOURCE_BY_KEY = Object.freeze({
  reservation: "appointments",
  customer: "customers",
  driver: "transportation_drivers",
  invoice: "invoices",
  schedule: "events",
  vehicle: "transportation_buses",
  document: "documents"
});

const ENTITY_RELATED_BY_KEY = Object.freeze({
  reservation: Object.freeze(["customer", "schedule", "invoice", "document"]),
  customer: Object.freeze(["reservation", "invoice", "document"]),
  driver: Object.freeze(["vehicle", "schedule", "reservation"]),
  invoice: Object.freeze(["customer", "reservation", "document"]),
  schedule: Object.freeze(["reservation", "driver", "vehicle"]),
  vehicle: Object.freeze(["driver", "schedule", "reservation"]),
  document: Object.freeze(["customer", "reservation", "invoice"])
});

const collectEventsByDomain = (registryNode, path = [], bucket = []) => {
  const node = asObject(registryNode);
  if (!node) return bucket;

  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      const domain = path.length ? path.join(" / ") : "General";
      bucket.push({ domain, eventName: value, action: toTitle(key) });
      continue;
    }

    if (asObject(value)) {
      collectEventsByDomain(value, [...path, toTitle(key)], bucket);
    }
  }

  return bucket;
};

const EVENT_GROUPS = (() => {
  const rows = collectEventsByDomain(U2OS_EVENT_DOMAINS)
    .sort((a, b) => {
      if (a.domain === b.domain) return a.eventName.localeCompare(b.eventName);
      return a.domain.localeCompare(b.domain);
    })
    .filter((entry, index, all) => {
      if (index === 0) return true;
      return all[index - 1].eventName !== entry.eventName;
    });

  const grouped = new Map();
  rows.forEach((entry) => {
    if (!grouped.has(entry.domain)) grouped.set(entry.domain, []);
    grouped.get(entry.domain).push(entry);
  });

  return Object.freeze(
    [...grouped.entries()].map(([domain, events]) =>
      Object.freeze({
        domain,
        events: Object.freeze(events.map((entry) => Object.freeze({ ...entry })))
      })
    )
  );
})();

export const getU2osEntityResource = (entity) => {
  const normalized = String(entity ?? "").trim().toLowerCase();
  return ENTITY_RESOURCE_BY_KEY[normalized] ?? "";
};

export const getU2osEntityRelatedOptions = (entity) => {
  const normalized = String(entity ?? "").trim().toLowerCase();
  return ENTITY_RELATED_BY_KEY[normalized] ?? [];
};

export const operationNeedsEntityId = (operation) =>
  U2OS_MUTATE_ENTITY_ID_OPERATIONS.includes(String(operation ?? "").trim().toLowerCase());

export const listU2osEventsByDomain = () => EVENT_GROUPS.map((group) => ({ ...group, events: [...group.events] }));
