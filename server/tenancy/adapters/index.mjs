import { createMySqlControlAdapter } from "./mysql-control-adapter.mjs";
import { createSqliteControlAdapter } from "./sqlite-control-adapter.mjs";

export const createControlAdapter = async (config = {}) => {
  const client = String(config.client ?? "sqlite").trim().toLowerCase();
  if (client === "mysql") return createMySqlControlAdapter(config);
  if (client === "sqlite") return createSqliteControlAdapter(config);
  throw new Error(`Unsupported control DB client '${client}'. Supported: sqlite, mysql`);
};
