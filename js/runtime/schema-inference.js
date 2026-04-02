const MAX_DEPTH = 4;
const MAX_ARRAY_SAMPLE = 6;

const toPrimitiveType = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};

const mergeUnion = (values) => {
  const unique = [...new Set(values.filter(Boolean))];
  if (!unique.length) return "unknown";
  if (unique.length === 1) return unique[0];
  return unique.sort().join(" | ");
};

export const inferSchema = (value, depth = 0) => {
  if (depth >= MAX_DEPTH) {
    return { type: toPrimitiveType(value) };
  }

  if (Array.isArray(value)) {
    if (!value.length) {
      return { type: "array", itemType: "unknown" };
    }

    const sample = value.slice(0, MAX_ARRAY_SAMPLE);
    const itemSchemas = sample.map((entry) => inferSchema(entry, depth + 1));
    const itemTypes = itemSchemas.map((entry) => entry.type);
    const unionType = mergeUnion(itemTypes);

    const schema = {
      type: "array",
      itemType: unionType
    };

    const representative = itemSchemas.find((entry) => entry.type === itemTypes[0]);
    if (representative && (representative.type === "object" || representative.type === "array")) {
      schema.shape = representative;
    }

    return schema;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    const properties = {};

    keys.slice(0, 80).forEach((key) => {
      properties[key] = inferSchema(value[key], depth + 1);
    });

    return {
      type: "object",
      keys,
      properties
    };
  }

  return {
    type: toPrimitiveType(value)
  };
};
