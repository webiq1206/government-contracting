import { classifyFailure } from "@/lib/domain/automation-health";

/** Bound the entire response, including its body. Never replay a mutation. */
export async function integrationRequest(
  endpoint: string,
  init: RequestInit,
  request: typeof fetch = fetch,
): Promise<{ response: Response; data: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await request(endpoint, { ...init, signal: controller.signal });
    const value: unknown = await response.json();
    return { response, data: value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null };
  } finally {
    clearTimeout(timer);
  }
}

/** Provider diagnostics may contain secrets or stack traces. Use the cause
 * to choose recovery guidance without echoing the provider response. */
export function connectionFailure(detail: unknown): string {
  switch (classifyFailure(typeof detail === "string" ? detail : "")) {
    case "spending_limit": return "A spending limit is holding this connection's work. Review API Usage before increasing the limit or resuming work.";
    case "provider_credit": return "The service reports insufficient credit. Work using it is blocked. Review billing with the service, then test the connection again.";
    case "provider_auth":
    case "integration_auth": return "The service rejected the connection details. Work using it may be blocked. Replace the saved details or reconnect the account, then test again.";
    case "provider_rate_limit": return "The service is receiving too many requests. Work may be delayed. Wait a few minutes before testing again.";
    case "not_configured": return "The connection needs setup before it can be used. Complete the details below, save them, then test the connection.";
    default: return "The connection could not be verified. Work using this service may be delayed. Check the setup details below, then choose Test connection again.";
  }
}
