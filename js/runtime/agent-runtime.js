import { EVENTS } from "../core/event-constants.js";
import { publish } from "../core/pan.js";
import { graphStore } from "../store/graph-store.js";

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const inferType = (value) => {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
};

const normalizeSchema = (schema) => {
  if (schema == null || schema === "") return null;
  if (typeof schema === "string") {
    const trimmed = schema.trim();
    if (!trimmed) return null;

    if (
      ["string", "number", "boolean", "object", "array", "null"].includes(trimmed)
    ) {
      return { type: trimmed };
    }

    return null;
  }

  return isPlainObject(schema) ? schema : null;
};

const validateAgainstSchema = (schema, value, path = "$") => {
  if (!schema) return [];

  const errors = [];
  const expectedType = schema.type;

  if (expectedType) {
    const actualType = inferType(value);
    if (actualType !== expectedType) {
      errors.push(`${path} expected type ${expectedType} but received ${actualType}`);
      return errors;
    }
  }

  if (schema.enum && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
  }

  if (schema.type === "object" && isPlainObject(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (!(key in value)) {
        errors.push(`${path}.${key} is required`);
      }
    }

    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!(key in value)) continue;
      errors.push(...validateAgainstSchema(propertySchema, value[key], `${path}.${key}`));
    }
  }

  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((entry, index) => {
      errors.push(...validateAgainstSchema(schema.items, entry, `${path}[${index}]`));
    });
  }

  return errors;
};

export class AgentRuntime {
  constructor({ store = graphStore, panPublish = publish } = {}) {
    this.store = store;
    this.publish = panPublish;
    this.events = EVENTS;
  }

  async runNode(_nodeId) {
    throw new Error("runNode(nodeId) must be implemented by runtime adapter");
  }

  async runSubtree(_nodeId) {
    throw new Error("runSubtree(nodeId) must be implemented by runtime adapter");
  }

  async runAll() {
    throw new Error("runAll() must be implemented by runtime adapter");
  }

  validateInput(node, input = node?.data?.lastInput ?? {}) {
    const schema = normalizeSchema(node?.data?.inputSchema);
    if (!schema) return { valid: true, errors: [] };

    const errors = validateAgainstSchema(schema, input, "$input");
    return { valid: errors.length === 0, errors };
  }

  validateOutput(node, output = node?.data?.lastOutput ?? {}) {
    const schema = normalizeSchema(node?.data?.outputSchema);
    if (!schema) return { valid: true, errors: [] };

    const errors = validateAgainstSchema(schema, output, "$output");
    return { valid: errors.length === 0, errors };
  }
}
