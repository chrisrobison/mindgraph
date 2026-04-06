import test from "node:test";
import assert from "node:assert/strict";

import { buildProxyConfig, buildTenancyConfig, TENANCY_MODES } from "../server/tenancy/config.mjs";

test("buildProxyConfig defaults to local-safe origin allowlist", () => {
  const config = buildProxyConfig({});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8787);
  assert.equal(config.authToken, "");
  assert.ok(Array.isArray(config.allowedOrigins));
  assert.ok(config.allowedOrigins.includes("http://127.0.0.1:4173"));
  assert.ok(config.allowedOrigins.includes("http://localhost:4173"));
});

test("buildProxyConfig honors wildcard and timeout overrides", () => {
  const config = buildProxyConfig({
    MINDGRAPH_PROXY_ALLOW_ORIGIN: "*",
    MINDGRAPH_PROXY_REQUEST_TIMEOUT_MS: "65000",
    MINDGRAPH_PROXY_MAX_PROMPT_CHARS: "20000",
    MINDGRAPH_PROXY_TOKEN: "abc123"
  });

  assert.equal(config.allowedOrigins, "*");
  assert.equal(config.requestTimeoutMs, 65000);
  assert.equal(config.maxPromptChars, 20000);
  assert.equal(config.authToken, "abc123");
});

test("buildTenancyConfig hosted defaults strict host matching", () => {
  const config = buildTenancyConfig({
    TENANCY_MODE: TENANCY_MODES.HOSTED
  });

  assert.equal(config.mode, TENANCY_MODES.HOSTED);
  assert.equal(config.strictHostMatch, true);
  assert.equal(config.allowOverride, false);
});

test("buildTenancyConfig supports explicit hybrid override options", () => {
  const config = buildTenancyConfig({
    TENANCY_MODE: TENANCY_MODES.HYBRID,
    TENANCY_STRICT_HOST_MATCH: "false",
    TENANCY_ALLOW_OVERRIDE: "true",
    TENANCY_OVERRIDE_HEADER: "x-instance-id",
    TENANCY_OVERRIDE_QUERY_PARAM: "instance"
  });

  assert.equal(config.mode, TENANCY_MODES.HYBRID);
  assert.equal(config.strictHostMatch, false);
  assert.equal(config.allowOverride, true);
  assert.equal(config.overrideHeader, "x-instance-id");
  assert.equal(config.overrideQueryParam, "instance");
});
