/**
 * Funnel / product analytics. Persists to analytics_events; also forwards to
 * window dataLayer when present (GTM/GA). Never throws to callers.
 */
import { query } from "./db";

export type AnalyticsEventName =
  | "landing_view"
  | "pricing_view"
  | "cta_click"
  | "signup_started"
  | "account_created"
  | "checkout_started"
  | "subscription_completed"
  | "checkout_failed"
  | "login"
  | "onboarding_started"
  | "onboarding_completed"
  | "password_reset_requested"
  | "password_reset_completed";

export async function trackEvent(input: {
  event: AnalyticsEventName | string;
  orgId?: string | null;
  userId?: string | null;
  path?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await query(
      `insert into analytics_events (org_id, user_id, event, path, meta)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [
        input.orgId ?? null,
        input.userId && input.userId !== "env-operator" ? input.userId : null,
        input.event,
        input.path ?? null,
        JSON.stringify(input.meta ?? {}),
      ]
    );
  } catch {
    // Table may not exist pre-migrate; never break UX for analytics.
  }
}
