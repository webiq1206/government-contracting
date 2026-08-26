/**
 * Funnel / product analytics. Persists to `analytics_events` and nowhere else.
 *
 * The comment here used to say it "also forwards to window dataLayer when
 * present (GTM/GA)". It does not, and there is no dataLayer code anywhere in
 * the repository: the only occurrence of the word was that sentence. Nothing
 * leaves the deployment, which is the right answer, but a comment claiming a
 * third-party forward is worse than no comment. Somebody auditing privacy
 * would go looking for a tag manager configuration that does not exist, and
 * somebody adding an event would believe their payload was already going to
 * an outside vendor.
 *
 * What an event may carry is decided by `safeMeta` and `safePath`, applied
 * here rather than at the call sites. See `lib/domain/analytics-safety.ts`.
 */
import { query } from "./db";
import { safeMeta, safePath } from "./domain/analytics-safety";

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
        /*
         * Filtered here, at the one place every event passes through. A dozen
         * call sites each remembering to strip a query string is a dozen
         * chances to forget, and the one that forgets is the one that ships a
         * search term.
         */
        safePath(input.path),
        JSON.stringify(safeMeta(input.meta)),
      ]
    );
  } catch {
    // Table may not exist pre-migrate; never break UX for analytics.
  }
}
