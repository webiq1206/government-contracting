/**
 * What a cardless trial can do, and how much of it.
 *
 * The shape of these limits is a judgement about what the trial is for. A
 * prime contractor evaluating this platform needs to answer one question:
 * "does it find real work I could actually bid, and can it run the
 * subcontractor loop for me?" Anything that helps answer that is unmetered.
 * Anything that spends real money per use, or puts our name in a stranger's
 * inbox, is metered.
 *
 * Unmetered on trial, on purpose:
 *   - Opportunity discovery from SAM.gov. This is the demonstration. It is
 *     also cron-driven, so a quota here would look like a broken product
 *     rather than a limit.
 *   - Scoring every opportunity against their company profile.
 *   - Subcontractor discovery, the database, notes, call queue, compliance,
 *     the W-9 portal, dashboards, search, and every read in the product.
 *
 * Metered, with the reason:
 *   - Outreach emails. Every one lands in a real subcontractor's inbox under
 *     our sending domain. Ten is enough to run one trade package end to end
 *     and watch replies parse back into quotes.
 *   - AI bid briefs. Each is a large Claude call against a full solicitation.
 *     Ten covers a week of real triage.
 *   - Bid packages. The finished deliverable, and the most expensive thing the
 *     platform builds. Two is enough to see one and then see it again on a
 *     job they care about.
 *
 * Usage is counted from the records themselves rather than from a counter
 * column. A counter can drift, double-count on a retry, or be missed by a new
 * code path; a count of the rows that actually exist cannot. A trial
 * organization's lifetime is its trial, so lifetime counts are trial counts.
 */
import { query } from "../db";

export type TrialMetric = "outreach_emails" | "ai_briefs" | "bid_packages";

export const TRIAL_LIMITS: Record<TrialMetric, number> = {
  outreach_emails: 10,
  ai_briefs: 10,
  bid_packages: 2,
};

/** Plain-English name for each meter, for the UI and for refusal messages. */
export const TRIAL_METRIC_LABEL: Record<TrialMetric, string> = {
  outreach_emails: "subcontractor emails",
  ai_briefs: "AI bid briefs",
  bid_packages: "bid packages",
};

/** What the operator gets back when a meter is exhausted. */
export const TRIAL_METRIC_BLOCKED_COPY: Record<TrialMetric, string> = {
  outreach_emails:
    "Your trial includes 10 subcontractor emails and they have all been sent. Choose a plan to keep the outreach running; every reply already received is still here.",
  ai_briefs:
    "Your trial includes 10 AI bid briefs and they have all been used. Opportunities keep arriving and scoring as normal; choose a plan to analyse more of them.",
  bid_packages:
    "Your trial includes 2 bid packages and both are built. Choose a plan to build more; the ones you have are still here to download.",
};

/** SQL that counts one metric for an organization. */
const COUNT_SQL: Record<TrialMetric, string> = {
  outreach_emails: `select count(*)::int as n from communications
                     where org_id = $1 and channel = 'email' and direction = 'outbound'`,
  ai_briefs: `select count(*)::int as n from opportunities
               where org_id = $1 and solicitation_analysis is not null`,
  bid_packages: `select count(*)::int as n from bids where org_id = $1`,
};

export interface QuotaState {
  metric: TrialMetric;
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

async function countMetric(orgId: string, metric: TrialMetric): Promise<number> {
  const rows = await query<{ n: number }>(COUNT_SQL[metric], [orgId]).catch(() => []);
  return rows[0]?.n ?? 0;
}

/** One meter's current state. */
export async function quotaState(orgId: string, metric: TrialMetric): Promise<QuotaState> {
  const used = await countMetric(orgId, metric);
  const limit = TRIAL_LIMITS[metric];
  return {
    metric,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    exhausted: used >= limit,
  };
}

/** Every meter, for the trial banner and the billing page. */
export async function allQuotaStates(orgId: string): Promise<QuotaState[]> {
  return Promise.all(
    (Object.keys(TRIAL_LIMITS) as TrialMetric[]).map((m) => quotaState(orgId, m))
  );
}

export interface QuotaDecision {
  allowed: boolean;
  /** Present only when blocked, written for the person who hit it. */
  message?: string;
  state?: QuotaState;
}

/**
 * Whether one metered action may proceed for this organization.
 *
 * Loads the organization itself rather than trusting a caller-supplied access
 * level: this runs inside agents and transports where the calling context is
 * several frames away from any session, and a stale "they're paid" belief is
 * exactly the mistake that would give away the product.
 *
 * Fails OPEN on a database error. A meter that cannot be read should not stop
 * a paying customer's outreach; the blast radius of a brief over-allowance on
 * a trial is a handful of emails, and the blast radius of the opposite is a
 * customer whose work silently stopped.
 */
export async function checkTrialQuota(
  orgId: string | null | undefined,
  metric: TrialMetric
): Promise<QuotaDecision> {
  if (!orgId) return { allowed: true };

  const rows = await query<{
    subscription_status: string;
    trial_ends_at: string | null;
    billing_exempt: boolean;
    suspended_at: string | null;
  }>(
    // billing_exempt and suspended_at are selected because accessLevel needs
    // them. Without the exemption here a comped account would be metered like
    // a trial, which is exactly the bug the exemption exists to prevent.
    `select subscription_status,
            trial_ends_at::text as trial_ends_at,
            billing_exempt,
            suspended_at::text as suspended_at
       from organizations where id = $1`,
    [orgId]
  ).catch(() => null);
  if (!rows || rows.length === 0) return { allowed: true };

  const { accessLevel } = await import("./entitlements");
  const level = accessLevel(rows[0]);

  // Paid and Stripe-trial organizations are never metered.
  if (level === "full") return { allowed: true };

  // No access at all is a different refusal, handled by the access gate rather
  // than by a quota message. Say so plainly instead of blaming a meter.
  if (level === "none") {
    return {
      allowed: false,
      message:
        "Your free trial has ended. Choose a plan to start this back up; nothing you set up has been lost.",
    };
  }

  const state = await quotaState(orgId, metric);
  if (state.exhausted) {
    return { allowed: false, message: TRIAL_METRIC_BLOCKED_COPY[metric], state };
  }
  return { allowed: true, state };
}
