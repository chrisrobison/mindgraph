import { TENANCY_MODES } from "./config.mjs";
import {
  asTrimmed,
  deriveDomainFromHost,
  getQueryValue,
  normalizeDomain,
  normalizeHost
} from "./utils.mjs";

const errorPayload = (code, message, status, details = null) => ({
  ok: false,
  error: {
    code,
    message,
    status,
    details
  }
});

const extractRequestHost = (req, config) => {
  const forwarded = config.trustForwardedHost
    ? asTrimmed(String(req?.headers?.["x-forwarded-host"] ?? "").split(",")[0], "")
    : "";
  const raw = forwarded || asTrimmed(req?.headers?.host, "");
  return normalizeHost(raw);
};

const extractOverrideInstanceId = (req, config) => {
  if (!config.allowOverride) return "";

  const headerName = asTrimmed(config.overrideHeader, "x-tenant-id").toLowerCase();
  const headerValue = req?.headers?.[headerName];
  const fromHeader = asTrimmed(Array.isArray(headerValue) ? headerValue[0] : headerValue, "");
  if (fromHeader) return fromHeader;

  const queryParam = asTrimmed(config.overrideQueryParam, "tenant_id");
  if (!queryParam) return "";
  return asTrimmed(getQueryValue(req?.url, queryParam), "");
};

const mapContext = (instance, source, host, domain, mode) => ({
  ok: true,
  context: {
    mode,
    source,
    host,
    domain,
    instance: {
      id: instance.id,
      customerId: instance.customer_id ?? null,
      name: instance.name ?? "",
      status: instance.status ?? "unknown",
      is_default: Boolean(instance.is_default),
      dbClient: instance.db_client ?? "",
      dbConfig: { ...(instance.db_config ?? {}) },
      appConfig: { ...(instance.app_config ?? {}) }
    }
  }
});

export const createTenantResolver = ({ controlStore, config }) => {
  const resolve = async (req) => {
    const mode = config.mode;
    const overrideInstanceId = extractOverrideInstanceId(req, config);

    if (overrideInstanceId) {
      const instance = await controlStore.getInstance(overrideInstanceId);
      if (!instance || String(instance.status ?? "").toLowerCase() !== "active") {
        return errorPayload("TENANT_OVERRIDE_NOT_FOUND", "Requested tenant override was not found", 404, {
          instanceId: overrideInstanceId
        });
      }
      return mapContext(instance, "override", null, null, mode);
    }

    if (mode === TENANCY_MODES.LOCAL) {
      const instance = await controlStore.getDefaultInstance();
      if (!instance) {
        return errorPayload("TENANT_DEFAULT_MISSING", "No default tenant is configured", 500);
      }
      return mapContext(instance, "default", null, null, mode);
    }

    const host = extractRequestHost(req, config);
    const domain = normalizeDomain(deriveDomainFromHost(host));

    if (!host || !domain) {
      if (mode === TENANCY_MODES.HYBRID && !config.strictHostMatch) {
        const fallback = await controlStore.getDefaultInstance();
        if (fallback) return mapContext(fallback, "default", host, domain, mode);
      }
      return errorPayload("TENANT_HOST_REQUIRED", "Host-based tenant resolution requires a valid host header", 400);
    }

    const matched = await controlStore.resolveByHostAndDomain(host, domain);
    if (matched) {
      return mapContext(matched, "host", host, domain, mode);
    }

    if (mode === TENANCY_MODES.HYBRID && !config.strictHostMatch) {
      const fallback = await controlStore.getDefaultInstance();
      if (fallback) return mapContext(fallback, "default", host, domain, mode);
    }

    return errorPayload("TENANT_HOST_NOT_MAPPED", "No active tenant instance is mapped for this host", 404, {
      host,
      domain
    });
  };

  return {
    resolve
  };
};
