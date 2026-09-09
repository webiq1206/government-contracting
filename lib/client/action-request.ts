"use client";

/** Safe feedback for mutations. A timeout is an unknown outcome, never proof
 * that the server did nothing. Do not automatically retry a mutation here. */
export const ACTION_UNCONFIRMED = "The action could not be confirmed. It may still be processing. Check the record's current status before trying again.";

export function actionError(status: number, detail?: unknown): string {
  if (status === 401) return "Your sign-in has expired. Sign in again, then check the record before retrying.";
  if (status === 403) return "Your account cannot perform this action. Ask an account owner or administrator to review your access.";
  if (status === 429) return "Too many requests were made at once. Wait a moment, then check the record before trying again.";
  // Server diagnostics belong in logs. Only short, plain-language validation
  // messages can supplement the user-facing action guidance.
  if (status < 500 && typeof detail === "string" && detail.trim() && detail.length <= 500
    && !/stack|SQLSTATE|ECONN|ETIMEDOUT|TypeError|ReferenceError|\bat .*\(.*:\d+|relation .*does not exist|select .*from|api[_ -]?key|Bearer |sk-ant-|postgres(?:ql)?:\/\//i.test(detail)) {
    return detail;
  }
  return ACTION_UNCONFIRMED;
}

export async function requestAction(endpoint: string, init: RequestInit): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  // This helper is exclusively for this app's routes, never an outbound URL.
  if (!endpoint.startsWith("/api/") || endpoint.includes("\\")) {
    return { ok: false, error: ACTION_UNCONFIRMED };
  }
  try {
    const response = await fetch(endpoint, init);
    const data = await response.json().catch(() => null);
    if (!response.ok) return { ok: false, error: actionError(response.status, data?.error) };
    if (!data || typeof data !== "object" || Array.isArray(data) || data.ok === false || data.error) {
      return { ok: false, error: ACTION_UNCONFIRMED };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: ACTION_UNCONFIRMED };
  }
}
