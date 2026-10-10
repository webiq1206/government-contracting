import { metered, requestIdentity } from '../api-usage/ledger';
import { providerDiagnostics, isProviderAllowanceFailure, type ProviderDiagnostics } from '../api-usage/diagnostics';
/**
 * Shared HTTP helper with timeout, JSON parsing, and typed errors. All
 * integration clients use this so retry/timeout behavior is uniform.
 */
export class HttpError extends Error {
  readonly retryable: boolean;
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public diagnostics?: ProviderDiagnostics,
  ) {
    super(message);
    this.name = "HttpError";
    this.retryable = !(diagnostics && isProviderAllowanceFailure(diagnostics)) && (status === 429 || status >= 500);
  }
}

export interface FetchJsonOptions extends RequestInit {
  observed?: boolean;
  /** Internal transport context; never forwarded to fetch or serialized. */
  diagnosticContext?: { secret: string };
  metering?: { envKey: string; value: string; provider: string; service: string; feature: string; orgId?: string };
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {}
): Promise<T> {
  const { metering, observed, diagnosticContext, ...plain } = opts;
  const host = new URL(url).hostname;
  const publicProvider: Record<string,string> = { 'api.sam.gov':'SAM.gov', 'api.usaspending.gov':'USAspending', 'api.bls.gov':'BLS' };
  if(!metering && !observed && publicProvider[host]) {
    const { observePublicService } = await import('../api-usage/public-services');
    return observePublicService(publicProvider[host],new URL(url).pathname,()=>fetchJson<T>(url,{...plain,observed:true}));
  }
  if (metering) {
    const identity = await requestIdentity(metering.envKey, metering.value, metering.orgId);
    return metered(identity, metering.provider, metering.service, metering.feature,
      () => fetchJson<T>(url, { ...plain, diagnosticContext: { secret: metering.value } }), value => {
        const body = value as { status?: string } | null;
        const failed = metering.provider === 'Google Maps' && Boolean(body?.status && !['OK','ZERO_RESULTS'].includes(body.status));
        return { units: { requests: 1 }, failed, errorCode: failed ? body?.status : undefined };
      });
  }
  const { timeoutMs = 20_000, query, ...init } = plain;
  const u = new URL(url);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) u.searchParams.set(k, String(v));
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(u.toString(), { ...init, signal: controller.signal });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* leave as text */
    }
    if (!res.ok) {
      const diagnostics = providerDiagnostics({ status: res.status, body, headers: res.headers }, diagnosticContext ? [diagnosticContext.secret] : []);
      throw new HttpError(res.status,
        diagnosticContext ? `Provider request failed (HTTP ${res.status}).` : `${res.status} ${res.statusText} for ${u.pathname}`,
        diagnosticContext ? undefined : body, diagnostics);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Retry with exponential backoff on network/5xx errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, baseMs = 500 }: { retries?: number; baseMs?: number } = {}
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : 0;
      const retryable = (err as Error)?.name !== 'ApiUsageBlockedError' && (err as { retryable?: boolean })?.retryable !== false && (status === 0 || status === 429 || status >= 500);
      if (!retryable || i === retries) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
