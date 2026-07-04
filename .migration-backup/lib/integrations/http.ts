/**
 * Shared HTTP helper with timeout, JSON parsing, and typed errors. All
 * integration clients use this so retry/timeout behavior is uniform.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetchJsonOptions extends RequestInit {
  timeoutMs?: number;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchJsonOptions = {}
): Promise<T> {
  const { timeoutMs = 20_000, query, ...init } = opts;
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
      throw new HttpError(res.status, `${res.status} ${res.statusText} for ${u.pathname}`, body);
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
      const retryable = status === 0 || status === 429 || status >= 500;
      if (!retryable || i === retries) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
