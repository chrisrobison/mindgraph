import path from "node:path";
import { parseBool } from "./utils.mjs";

export const TENANCY_MODES = Object.freeze({
  LOCAL: "local",
  HYBRID: "hybrid",
  HOSTED: "hosted"
});

export const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://127.0.0.1:3000",
  "http://localhost:3000"
]);

const normalizeMode = (value) => {
  const mode = String(value ?? TENANCY_MODES.LOCAL).trim().toLowerCase();
  if (mode === TENANCY_MODES.HOSTED || mode === TENANCY_MODES.HYBRID) return mode;
  return TENANCY_MODES.LOCAL;
};

const parseAllowedOrigins = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return [...DEFAULT_ALLOWED_ORIGINS];
  if (raw === "*") return "*";
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const buildTenancyConfig = (env = process.env) => {
  const mode = normalizeMode(env.TENANCY_MODE);
  return {
    mode,
    strictHostMatch: parseBool(env.TENANCY_STRICT_HOST_MATCH, mode === TENANCY_MODES.HOSTED),
    trustForwardedHost: parseBool(env.TENANCY_TRUST_FORWARDED_HOST, false),
    allowOverride: parseBool(env.TENANCY_ALLOW_OVERRIDE, false),
    overrideHeader: String(env.TENANCY_OVERRIDE_HEADER ?? "x-tenant-id").trim().toLowerCase(),
    overrideQueryParam: String(env.TENANCY_OVERRIDE_QUERY_PARAM ?? "tenant_id").trim(),
    bootstrapHost: String(env.TENANCY_BOOTSTRAP_HOST ?? "localhost").trim().toLowerCase() || "localhost",
    bootstrapDomain: String(env.TENANCY_BOOTSTRAP_DOMAIN ?? "localhost").trim().toLowerCase() || "localhost"
  };
};

export const buildProxyConfig = (env = process.env) => ({
  host: String(env.MINDGRAPH_PROXY_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
  port: Number(env.MINDGRAPH_PROXY_PORT ?? 8787) || 8787,
  authToken: String(env.MINDGRAPH_PROXY_TOKEN ?? "").trim(),
  allowedOrigins: parseAllowedOrigins(env.MINDGRAPH_PROXY_ALLOW_ORIGIN),
  requestTimeoutMs: Math.max(1_000, Number(env.MINDGRAPH_PROXY_REQUEST_TIMEOUT_MS ?? 45_000) || 45_000),
  maxPromptChars: Math.max(256, Number(env.MINDGRAPH_PROXY_MAX_PROMPT_CHARS ?? 16_000) || 16_000)
});

export const buildControlDbConfig = (env = process.env) => ({
  client: String(env.CONTROL_DB_CLIENT ?? "sqlite").trim().toLowerCase() || "sqlite",
  host: String(env.CONTROL_DB_HOST ?? "").trim(),
  port: Number(env.CONTROL_DB_PORT ?? 3306) || 3306,
  user: String(env.CONTROL_DB_USER ?? "").trim(),
  password: String(env.CONTROL_DB_PASSWORD ?? "").trim(),
  database: String(env.CONTROL_DB_NAME ?? "").trim(),
  file:
    String(env.CONTROL_DB_FILE ?? "").trim() ||
    path.join(process.cwd(), "data", "mindgraph-control.sqlite")
});
