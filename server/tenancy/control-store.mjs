import { createControlAdapter } from "./adapters/index.mjs";
import {
  asTrimmed,
  deriveDomainFromHost,
  normalizeDomain,
  normalizeHost,
  nowIso,
  parseJson,
  uid
} from "./utils.mjs";

const isDuplicateConstraintError = (error) => {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return (
    code === "sqlite_constraint" ||
    code === "er_dup_entry" ||
    message.includes("unique") ||
    message.includes("duplicate") ||
    message.includes("already exists")
  );
};

const sqlSchemaStatements = Object.freeze([
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS instances (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    db_client TEXT NOT NULL,
    db_config_json TEXT NOT NULL,
    app_config_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS instance_domains (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    host TEXT NOT NULL,
    domain TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)",
  "CREATE INDEX IF NOT EXISTS idx_instances_customer_id ON instances(customer_id)",
  "CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status)",
  "CREATE INDEX IF NOT EXISTS idx_instances_is_default ON instances(is_default)",
  "CREATE INDEX IF NOT EXISTS idx_instance_domains_host ON instance_domains(host)",
  "CREATE INDEX IF NOT EXISTS idx_instance_domains_domain ON instance_domains(domain)",
  "CREATE INDEX IF NOT EXISTS idx_instance_domains_instance ON instance_domains(instance_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS udx_instance_domains_host_domain ON instance_domains(host, domain)"
]);

const toInstanceRecord = (row) => {
  if (!row) return null;
  return {
    ...row,
    is_default: row.is_default === true || row.is_default === 1 || row.is_default === "1",
    db_config: parseJson(row.db_config_json, {}),
    app_config: parseJson(row.app_config_json, {})
  };
};

export const createControlStore = async (config = {}) => {
  const adapter = await createControlAdapter(config);

  const initSchema = async () => {
    for (const statement of sqlSchemaStatements) {
      try {
        await adapter.execute(statement);
      } catch (error) {
        if (!isDuplicateConstraintError(error)) throw error;
      }
    }
  };

  const getInstance = async (id) => {
    const row = await adapter.queryOne("SELECT * FROM instances WHERE id = ? LIMIT 1", [asTrimmed(id)]);
    return toInstanceRecord(row);
  };

  const getDefaultInstance = async () => {
    const row = await adapter.queryOne(
      "SELECT * FROM instances WHERE is_default = 1 AND status = 'active' ORDER BY updated_at DESC LIMIT 1"
    );
    return toInstanceRecord(row);
  };

  const resolveByHostAndDomain = async (hostValue, domainValue = null) => {
    const host = normalizeHost(hostValue);
    const domain = normalizeDomain(domainValue || deriveDomainFromHost(host));
    if (!host || !domain) return null;

    const row = await adapter.queryOne(
      `SELECT i.*
       FROM instance_domains d
       JOIN instances i ON i.id = d.instance_id
       WHERE d.host = ?
         AND d.domain = ?
         AND d.status = 'active'
         AND i.status = 'active'
       LIMIT 1`,
      [host, domain]
    );

    return toInstanceRecord(row);
  };

  const listInstances = async () => {
    const rows = await adapter.queryAll("SELECT * FROM instances ORDER BY created_at ASC");
    return rows.map(toInstanceRecord).filter(Boolean);
  };

  const ensureDomainMapping = async (instanceId, { host, domain, status = "active" }) => {
    const now = nowIso();
    const normalizedHost = normalizeHost(host);
    const normalizedDomain = normalizeDomain(domain || deriveDomainFromHost(normalizedHost));
    if (!normalizedHost || !normalizedDomain) return null;

    const existing = await adapter.queryOne(
      "SELECT id, instance_id FROM instance_domains WHERE host = ? AND domain = ? LIMIT 1",
      [normalizedHost, normalizedDomain]
    );

    if (existing) {
      if (existing.instance_id !== instanceId) {
        throw new Error(
          `Host/domain '${normalizedHost}/${normalizedDomain}' already mapped to a different tenant instance`
        );
      }

      await adapter.execute(
        "UPDATE instance_domains SET status = ?, updated_at = ? WHERE id = ?",
        [status, now, existing.id]
      );
      return existing.id;
    }

    const domainId = uid("domain");
    await adapter.execute(
      `INSERT INTO instance_domains (
         id, instance_id, host, domain, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [domainId, instanceId, normalizedHost, normalizedDomain, status, now, now]
    );
    return domainId;
  };

  const ensureBootstrapTenant = async ({
    host = "localhost",
    domain = "localhost",
    customerName = "Local Default Tenant",
    instanceName = "Default Instance",
    dbClient = "sqlite",
    dbConfig = {}
  } = {}) => {
    const existingDefault = await getDefaultInstance();
    if (existingDefault) {
      await ensureDomainMapping(existingDefault.id, { host, domain, status: "active" });
      return getInstance(existingDefault.id);
    }

    const now = nowIso();
    const customerId = uid("customer");
    const instanceId = uid("instance");
    const tenantDbConfig =
      dbClient === "sqlite"
        ? {
            file: asTrimmed(dbConfig.file, `${process.cwd()}/data/mindgraph-tenant-${instanceId}.sqlite`)
          }
        : {
            host: asTrimmed(dbConfig.host),
            port: Number(dbConfig.port ?? 3306),
            user: asTrimmed(dbConfig.user),
            password: String(dbConfig.password ?? ""),
            database: asTrimmed(dbConfig.database)
          };

    await adapter.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO customers (id, name, status, metadata_json, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?, ?)`,
        [customerId, customerName, JSON.stringify({ bootstrap: true }), now, now]
      );

      await tx.execute(
        `INSERT INTO instances (
           id, customer_id, name, status, is_default, db_client, db_config_json, app_config_json, created_at, updated_at
         ) VALUES (?, ?, ?, 'active', 1, ?, ?, ?, ?, ?)`,
        [instanceId, customerId, instanceName, dbClient, JSON.stringify(tenantDbConfig), JSON.stringify({}), now, now]
      );
    });

    await ensureDomainMapping(instanceId, { host, domain, status: "active" });
    return getInstance(instanceId);
  };

  return {
    client: adapter.client,
    initSchema,
    getInstance,
    getDefaultInstance,
    resolveByHostAndDomain,
    listInstances,
    ensureBootstrapTenant,
    close: async () => {
      await adapter.close();
    }
  };
};
