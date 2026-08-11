/**
 * Fire-and-forget product analytics from the browser.
 */

export function trackClientEvent(
  event: string,
  meta?: Record<string, unknown>,
  path?: string
): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        path: path ?? window.location.pathname,
        meta: meta ?? {},
      }),
      keepalive: true,
    });
  } catch {
    /* never break UX */
  }
}
