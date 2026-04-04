import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CURRENT_GRAPH_SCHEMA_VERSION,
  migrateGraphDocument
} from "../js/core/graph-migrations.js";
import { normalizeGraphDocument, validateGraphDocument } from "../js/core/graph-document.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures", "graph-schemas");

const readFixture = (name) =>
  JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));

test("migrates legacy graph without schemaVersion to current schema", () => {
  const legacyDocument = readFixture("legacy-without-schema-version.json");
  const migration = migrateGraphDocument(legacyDocument);

  assert.equal(migration.ok, true);
  assert.equal(migration.sourceVersion, 1);
  assert.equal(migration.document.schemaVersion, CURRENT_GRAPH_SCHEMA_VERSION);
  assert.equal(migration.document.id, legacyDocument.id);

  const normalized = normalizeGraphDocument(migration.document);
  const validation = validateGraphDocument(normalized);
  assert.equal(validation.valid, true, validation.errors.join(", "));
});

test("migrates explicit schema v2 graph to current schema", () => {
  const legacyDocument = readFixture("legacy-schema-v2.json");
  const migration = migrateGraphDocument(legacyDocument);

  assert.equal(migration.ok, true);
  assert.equal(migration.sourceVersion, 2);
  assert.equal(migration.document.schemaVersion, CURRENT_GRAPH_SCHEMA_VERSION);
  assert.equal(migration.migrationsApplied.length, CURRENT_GRAPH_SCHEMA_VERSION - 2);

  const normalized = normalizeGraphDocument(migration.document);
  const validation = validateGraphDocument(normalized);
  assert.equal(validation.valid, true, validation.errors.join(", "));
});

test("fails safely when given a future schema version", () => {
  const futureDocument = {
    id: "graph_future_schema",
    title: "Future Graph",
    schemaVersion: CURRENT_GRAPH_SCHEMA_VERSION + 1,
    nodes: [],
    edges: []
  };

  const migration = migrateGraphDocument(futureDocument);
  assert.equal(migration.ok, false);
  assert.equal(migration.error.code, "GRAPH_SCHEMA_UNSUPPORTED_FUTURE_VERSION");
  assert.equal(migration.error.sourceVersion, CURRENT_GRAPH_SCHEMA_VERSION + 1);
  assert.equal(migration.error.targetVersion, CURRENT_GRAPH_SCHEMA_VERSION);
  assert.match(migration.error.message, /newer than this app supports/i);
});
