/** Provider diagnostics are an allowlist, never a serialized exception/body. */
export type ProviderDiagnostics = {
  version: 1;
  httpStatus: number | null;
  errorCode: string | null;
  errorType: string | null;
  requestId: string | null;
  retryAfterSeconds: number | null;
  omittedFields: string[];
};

export type ConfigurationReference = {
  credentialStore: "platform_settings" | "platform_environment" | "tenant_settings" | "unknown";
  settingsOrgId: string | null;
  credentialSetting: string | null;
};

// Unknown codes/types are deliberately omitted, rather than accepting arbitrary
// text that a provider/proxy could have copied from a prompt, key or email.
const CODES = new Set([
  "credit_balance_exhausted", "insufficient_quota", "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "rate_limit_exceeded",
  "slow_down", "invalid_api_key", "invalid_value", "invalid_request", "invalid_request_error",
  "authentication_error", "permission_error", "permission_denied", "access_denied", "forbidden",
  "unauthorized", "invalid_token", "token_expired", "key_expired", "quota_exceeded",
  "limit_exceeded", "units_limit_exceeded", "subscription_required", "plan_required",
  "rate_limit_error", "rate_limited", "too_many_requests", "overloaded_error",
  "server_error", "api_error", "internal_error", "service_unavailable_error", "server_is_overloaded",
  "not_found_error", "request_too_large", "billing_error", "billing_not_active",
]);
const SETTINGS = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AHREFS_API_KEY", "GOOGLE_MAPS_API_KEY", "HUNTER_API_KEY", "TWILIO_AUTH_TOKEN"]);
export function isProviderAllowanceFailure(d: ProviderDiagnostics): boolean {
  return [d.errorCode, d.errorType].some(code => code != null && ["credit_balance_exhausted", "insufficient_quota", "organization_spend_limit_exceeded", "project_spend_limit_exceeded", "organization_usage_limit_exceeded", "quota_exceeded", "units_limit_exceeded", "subscription_required", "plan_required", "billing_error", "billing_not_active"].includes(code));
}
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const clean = (v: unknown, secrets: readonly string[]): v is string => typeof v === "string"
  && v.length <= 128 && !secrets.some(s => s.length > 0 && v.includes(s))
  && !/sk-|Bearer|Basic|token[=:]|@|https?:|[\s\x00-\x1f\x7f]/i.test(v);

export function safeRequestId(value: unknown, secrets: readonly string[] = []): string | null {
  if (!clean(value, secrets)) return null;
  // Provider-generated request handles, not response messages or arbitrary IDs.
  return /^(?:req_[A-Za-z0-9]{1,96}|[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value) ? value : null;
}

function header(headers: unknown, name: string): unknown {
  if (headers instanceof Headers) return headers.get(name);
  const record = object(headers);
  return record[name] ?? record[Object.keys(record).find(k => k.toLowerCase() === name) ?? ""];
}

export function retryAfterSeconds(value: unknown, now = Date.now()): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 604800 ? Math.ceil(value) : null;
  if (typeof value !== "string" || value.length > 64) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return retryAfterSeconds(Number(value), now);
  // Only HTTP-date syntax; do not parse free-form strings or echo the header.
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? retryAfterSeconds(Math.max(0, (date - now) / 1000), now) : null;
}

/** Re-sanitize at both the transport and persistence boundaries. No causes,
 * messages, URLs, prompts, request headers or arbitrary object keys survive. */
export function providerDiagnostics(error: unknown, secrets: readonly string[] = []): ProviderDiagnostics {
  const e = object(error);
  const prior = object(e.diagnostics);
  const body = object(e.body ?? e.error);
  const detail = object(body.error ?? body);
  const rawCode = prior.errorCode ?? e.code ?? detail.code;
  const rawType = prior.errorType ?? e.type ?? detail.type;
  const rawId = prior.requestId ?? e.requestId ?? e.request_id ?? header(e.headers, "x-request-id") ?? header(e.headers, "request-id");
  const rawStatus = prior.httpStatus ?? e.status;
  const rawRetry = prior.retryAfterSeconds ?? e.retryAfterSeconds ?? header(e.headers, "retry-after");
  const code = (v: unknown) => clean(v, secrets) && CODES.has(v) ? v : null;
  const result: ProviderDiagnostics = {
    version: 1,
    httpStatus: typeof rawStatus === "number" && Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null,
    errorCode: code(rawCode), errorType: code(rawType), requestId: safeRequestId(rawId, secrets),
    retryAfterSeconds: retryAfterSeconds(rawRetry), omittedFields: [],
  };
  const fields = ["errorCode", "errorType", "requestId", "retryAfterSeconds"] as const;
  const raw = [rawCode, rawType, rawId, rawRetry];
  result.omittedFields = fields.filter((key, i) => (raw[i] != null && result[key] == null)
    || (Array.isArray(prior.omittedFields) && prior.omittedFields.includes(key)));
  return result;
}

export function configurationReference(value: unknown): ConfigurationReference {
  const v = object(value);
  const stores = ["platform_settings", "platform_environment", "tenant_settings"];
  return {
    credentialStore: stores.includes(String(v.credentialStore)) ? v.credentialStore as ConfigurationReference["credentialStore"] : "unknown",
    settingsOrgId: typeof v.settingsOrgId === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.settingsOrgId) ? v.settingsOrgId : null,
    credentialSetting: typeof v.credentialSetting === "string" && SETTINGS.has(v.credentialSetting) ? v.credentialSetting : null,
  };
}
