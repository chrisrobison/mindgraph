import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createControlStore } from "../server/tenancy/control-store.mjs";
import { createTenantResolver } from "../server/tenancy/tenant-resolver.mjs";
import { TENANCY_MODES } from "../server/tenancy/config.mjs";

const createTempDbPath = (name) =>
  path.join(os.tmpdir(), `mindgraph-${name}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.sqlite`);

const setupStore = async (dbPath, bootstrap = {}) => {
  const store = await createControlStore({
    client: "sqlite",
    file: dbPath
  });
  await store.initSchema();
  await store.ensureBootstrapTenant({
    host: bootstrap.host ?? "localhost",
    domain: bootstrap.domain ?? "localhost",
    dbClient: "sqlite",
    dbConfig: {
      file: `${dbPath}.tenant.sqlite`
    }
  });
  return store;
};

test("hosted mode resolves tenant by host/domain", async () => {
  const dbPath = createTempDbPath("hosted-resolution");
  const store = await setupStore(dbPath, {
    host: "acme.example.com",
    domain: "example.com"
  });

  try {
    const resolver = createTenantResolver({
      controlStore: store,
      config: {
        mode: TENANCY_MODES.HOSTED,
        strictHostMatch: true,
        trustForwardedHost: false,
        allowOverride: false,
        overrideHeader: "x-tenant-id",
        overrideQueryParam: "tenant_id"
      }
    });

    const result = await resolver.resolve({
      headers: {
        host: "acme.example.com"
      },
      url: "/api/mindgraph/runtime/run-node"
    });

    assert.equal(result.ok, true);
    assert.equal(result.context.source, "host");
    assert.equal(result.context.instance.status, "active");
    assert.equal(result.context.instance.dbClient, "sqlite");
  } finally {
    await store.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}.tenant.sqlite`, { force: true });
  }
});

test("hosted mode returns not-mapped for unknown host", async () => {
  const dbPath = createTempDbPath("hosted-miss");
  const store = await setupStore(dbPath, {
    host: "known.example.com",
    domain: "example.com"
  });

  try {
    const resolver = createTenantResolver({
      controlStore: store,
      config: {
        mode: TENANCY_MODES.HOSTED,
        strictHostMatch: true,
        trustForwardedHost: false,
        allowOverride: false,
        overrideHeader: "x-tenant-id",
        overrideQueryParam: "tenant_id"
      }
    });

    const result = await resolver.resolve({
      headers: {
        host: "missing.example.com"
      },
      url: "/api/mindgraph/runtime/run-node"
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "TENANT_HOST_NOT_MAPPED");
    assert.equal(result.error.status, 404);
  } finally {
    await store.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}.tenant.sqlite`, { force: true });
  }
});

test("local mode falls back to default tenant", async () => {
  const dbPath = createTempDbPath("local-default");
  const store = await setupStore(dbPath);

  try {
    const resolver = createTenantResolver({
      controlStore: store,
      config: {
        mode: TENANCY_MODES.LOCAL,
        strictHostMatch: false,
        trustForwardedHost: false,
        allowOverride: false,
        overrideHeader: "x-tenant-id",
        overrideQueryParam: "tenant_id"
      }
    });

    const result = await resolver.resolve({
      headers: {
        host: "any.domain.test"
      },
      url: "/api/mindgraph/runtime/run-node"
    });

    assert.equal(result.ok, true);
    assert.equal(result.context.source, "default");
    assert.equal(result.context.instance.is_default, true);
  } finally {
    await store.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}.tenant.sqlite`, { force: true });
  }
});

test("override header can resolve tenant in local mode when enabled", async () => {
  const dbPath = createTempDbPath("override");
  const store = await setupStore(dbPath);

  try {
    const [instance] = await store.listInstances();
    assert.ok(instance?.id);

    const resolver = createTenantResolver({
      controlStore: store,
      config: {
        mode: TENANCY_MODES.LOCAL,
        strictHostMatch: false,
        trustForwardedHost: false,
        allowOverride: true,
        overrideHeader: "x-tenant-id",
        overrideQueryParam: "tenant_id"
      }
    });

    const result = await resolver.resolve({
      headers: {
        host: "localhost",
        "x-tenant-id": instance.id
      },
      url: "/api/mindgraph/runtime/run-node"
    });

    assert.equal(result.ok, true);
    assert.equal(result.context.source, "override");
    assert.equal(result.context.instance.id, instance.id);
  } finally {
    await store.close();
    fs.rmSync(dbPath, { force: true });
    fs.rmSync(`${dbPath}.tenant.sqlite`, { force: true });
  }
});
