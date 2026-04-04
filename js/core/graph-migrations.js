import { clone } from "./utils.js";

export const CURRENT_GRAPH_SCHEMA_VERSION = 3;

const FIRST_GRAPH_SCHEMA_VERSION = 1;

const createMigrationError = ({
  code,
  message,
  sourceVersion,
  targetVersion = CURRENT_GRAPH_SCHEMA_VERSION,
  details = null
}) => ({
  code,
  message,
  sourceVersion,
  targetVersion,
  details
});

const normalizeSchemaVersion = (documentLike) => {
  const raw = Number(documentLike?.schemaVersion);
  if (Number.isInteger(raw) && raw >= FIRST_GRAPH_SCHEMA_VERSION) return raw;

  // Pre-versioned graphs are treated as schema version 1.
  return FIRST_GRAPH_SCHEMA_VERSION;
};

// Keep this array ordered by `from`, and add new one-step migrations at the end.
// Example: when moving from v3 -> v4, add `{ from: 3, to: 4, migrate: ... }`.
const GRAPH_MIGRATIONS = Object.freeze([
  {
    from: 1,
    to: 2,
    description: "Reserved placeholder: initial migration checkpoint.",
    migrate: (document) => document
  },
  {
    from: 2,
    to: 3,
    description: "Reserved placeholder: metadata/runtime compatibility checkpoint.",
    migrate: (document) => document
  }
]);

const migrationBySourceVersion = new Map(
  GRAPH_MIGRATIONS.map((migration) => [migration.from, migration])
);

export const migrateGraphDocument = (documentLike) => {
  if (!documentLike || typeof documentLike !== "object") {
    return {
      ok: false,
      error: createMigrationError({
        code: "GRAPH_SCHEMA_INVALID_DOCUMENT",
        message: "Graph document must be an object before migration.",
        sourceVersion: null,
        details: { receivedType: typeof documentLike }
      })
    };
  }

  const sourceVersion = normalizeSchemaVersion(documentLike);
  if (sourceVersion > CURRENT_GRAPH_SCHEMA_VERSION) {
    return {
      ok: false,
      error: createMigrationError({
        code: "GRAPH_SCHEMA_UNSUPPORTED_FUTURE_VERSION",
        message: `Graph schema version ${sourceVersion} is newer than this app supports (${CURRENT_GRAPH_SCHEMA_VERSION}).`,
        sourceVersion
      })
    };
  }

  let working = clone(documentLike);
  let currentVersion = sourceVersion;
  const appliedMigrations = [];

  while (currentVersion < CURRENT_GRAPH_SCHEMA_VERSION) {
    const migration = migrationBySourceVersion.get(currentVersion);
    if (!migration) {
      return {
        ok: false,
        error: createMigrationError({
          code: "GRAPH_SCHEMA_MIGRATION_PATH_MISSING",
          message: `No migration step found from schema version ${currentVersion}.`,
          sourceVersion,
          details: { currentVersion }
        })
      };
    }

    try {
      const migrated = migration.migrate(clone(working));
      if (!migrated || typeof migrated !== "object") {
        return {
          ok: false,
          error: createMigrationError({
            code: "GRAPH_SCHEMA_MIGRATION_INVALID_RESULT",
            message: `Migration ${migration.from} -> ${migration.to} did not return a document object.`,
            sourceVersion,
            details: { from: migration.from, to: migration.to }
          })
        };
      }

      working = migrated;
      currentVersion = migration.to;
      working.schemaVersion = currentVersion;
      appliedMigrations.push({
        from: migration.from,
        to: migration.to,
        description: migration.description
      });
    } catch (error) {
      return {
        ok: false,
        error: createMigrationError({
          code: "GRAPH_SCHEMA_MIGRATION_FAILED",
          message: `Migration ${migration.from} -> ${migration.to} failed: ${error?.message ?? "Unknown error"}`,
          sourceVersion,
          details: {
            from: migration.from,
            to: migration.to,
            cause: error?.message ?? null
          }
        })
      };
    }
  }

  if (!Number.isInteger(working.schemaVersion) || working.schemaVersion !== CURRENT_GRAPH_SCHEMA_VERSION) {
    working.schemaVersion = CURRENT_GRAPH_SCHEMA_VERSION;
  }

  return {
    ok: true,
    document: working,
    sourceVersion,
    targetVersion: CURRENT_GRAPH_SCHEMA_VERSION,
    migrationsApplied: appliedMigrations
  };
};

export const createGraphSchemaMigrationError = (error) => {
  const wrapped = new Error(error?.message ?? "Graph schema migration failed.");
  wrapped.name = "GraphSchemaMigrationError";
  wrapped.details = error;
  return wrapped;
};
