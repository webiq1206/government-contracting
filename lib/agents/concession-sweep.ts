/**
 * Concession Sweep: make sure a deal that was agreed is a deal that exists.
 *
 * A hand-negotiated price passes through three places it can silently fail,
 * and in every one of them the customer finds out before we do:
 *
 *   1. the invitation is never accepted and the link quietly expires, so a
 *      deal agreed on a phone call evaporates without anybody deciding it
 *      should
 *   2. the invitation IS accepted but the terms never land on the account,
 *      which migration 048 records and then leaves for somebody to spot
 *   3. the discount lands in our columns but never reaches Stripe, or reaches
 *      Stripe and still is not on the invoice the customer is charged
 *
 * Each pass runs inside its own try/catch. Stripe being unreachable must not
 * stop a reminder email going out, and a mail outage must not stop a customer
 * being charged the wrong amount from being noticed.
 *
 * What to repair is decided in lib/domain/concession-integrity, which is pure
 * and tested. This file only reads rows, calls the decision, and performs the
 * write it asks for. The dangerous cases come back as "needs_human" and are
 * logged rather than guessed at: re-applying a discount that was already
 * applied is a double discount, and money mistakes made automatically are
 * the ones nobody catches.
 */
import { query, queryOne } from "../db";
import { logAgent } from "../logger";
import { getStripe } from "../billing/stripe";
import { applyDiscountToSubscription } from "../billing/concessions";
import { resendInvitation, repairInvitedTerms } from "../admin/invitations";
import {
  nudgeDecision,
  repairAction,
  discountVerdict,
  type InvitationSnapshot,
  type OrgSnapshot,
  type StripeDiscountState,
} from "../domain/concession-integrity";
import type { AgentDefinition } from "./types";
import type { AgentResult } from "../types";

const AGENT = "concession-sweep";
/** The sweep acts on its own authority; the audit trail says so plainly. */
const ACTOR = "system@concession-sweep";

const INVITATION_COLS = `
  id, email, concession_kind,
  expires_at::text as expires_at,
  accepted_at::text as accepted_at,
  revoked_at::text as revoked_at,
  terms_applied_at::text as terms_applied_at,
  accepted_org_id, sent_count`;

async function loadOrg(orgId: string): Promise<OrgSnapshot | null> {
  return queryOne<OrgSnapshot>(
    `select id, stripe_subscription_id, coalesce(billing_exempt, false) as billing_exempt,
            discount_percent_off, discount_ends_at::text as discount_ends_at,
            pending_coupon_id
       from organizations where id = $1`,
    [orgId]
  ).catch(() => null);
}

/** What Stripe currently says about one subscription and its latest invoice. */
async function readStripeState(subscriptionId: string): Promise<StripeDiscountState | null> {
  const stripe = getStripe();
  if (!stripe) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const discounts = (sub as unknown as { discounts?: unknown[] }).discounts ?? [];
    const first = discounts[0] as
      | { coupon?: { id?: string; percent_off?: number | null } }
      | undefined;

    // The invoice is the point of the exercise: a coupon attached to the
    // wrong thing still shows up on the subscription.
    let invoiceDiscountCents: number | null = null;
    try {
      const invoices = await stripe.invoices.list({
        subscription: subscriptionId,
        limit: 1,
      });
      const inv = invoices.data[0] as
        | { total_discount_amounts?: { amount: number }[] }
        | undefined;
      if (inv) {
        invoiceDiscountCents = (inv.total_discount_amounts ?? []).reduce(
          (n, d) => n + (d.amount ?? 0),
          0
        );
      }
    } catch {
      // No invoice yet, or the list call failed. Absence is not a failure.
      invoiceDiscountCents = null;
    }

    return {
      subscriptionCouponId: first?.coupon?.id ?? null,
      subscriptionPercentOff: first?.coupon?.percent_off ?? null,
      invoiceDiscountCents,
    };
  } catch {
    return null;
  }
}

export const concessionSweep: AgentDefinition = {
  name: AGENT,
  label: "Concession Sweep",
  description:
    "Reminds invited people before their link expires, applies agreed terms that never landed on an accepted account, and checks that granted discounts actually reached Stripe and the invoice.",
  worksWithoutClaude: true,
  async handler(): Promise<AgentResult> {
    let nudged = 0;
    let repaired = 0;
    let flagged = 0;

    // -----------------------------------------------------------------------
    // 1. Nudge invitations whose link is about to expire.
    // -----------------------------------------------------------------------
    try {
      const pending = await query<InvitationSnapshot>(
        `select ${INVITATION_COLS} from account_invitations
          where accepted_at is null and revoked_at is null and expires_at > now()
          order by expires_at asc limit 100`
      ).catch(() => []);

      for (const inv of pending) {
        const decision = nudgeDecision(inv);
        if (!decision.nudge) continue;
        // Re-sending mints a fresh link and a fresh expiry, which is the only
        // way to nudge at all: the token is stored hashed, so the original
        // link cannot be reconstructed to put in a reminder.
        const res = await resendInvitation({ id: inv.id, adminEmail: ACTOR });
        await logAgent({
          agent: AGENT,
          action: "invitation-nudged",
          level: res.ok ? "info" : "warn",
          message: res.ok
            ? `${inv.email} was invited but has not accepted, and the link had ${decision.daysLeft} day${decision.daysLeft === 1 ? "" : "s"} left. Sent it again with a fresh link. This is the only reminder; if they do not act, it lapses.`
            : `Could not remind ${inv.email} before their invitation expires: ${res.error}`,
        });
        if (res.ok) nudged++;
      }
    } catch (err) {
      await logAgent({
        agent: AGENT,
        action: "nudge-pass-failed",
        level: "error",
        message: `Could not check for expiring invitations: ${(err as Error).message}`,
      });
    }

    // -----------------------------------------------------------------------
    // 2. Apply terms that never landed on an accepted account.
    // -----------------------------------------------------------------------
    try {
      const stranded = await query<InvitationSnapshot>(
        `select ${INVITATION_COLS} from account_invitations
          where accepted_at is not null
            and terms_applied_at is null
            and revoked_at is null
          order by accepted_at asc limit 50`
      ).catch(() => []);

      for (const inv of stranded) {
        const org = inv.accepted_org_id ? await loadOrg(inv.accepted_org_id) : null;
        const decision = repairAction(inv, org);

        if (decision.action === "none") continue;

        if (decision.action === "needs_human") {
          flagged++;
          await logAgent({
            agent: AGENT,
            action: "terms-need-human",
            level: "warn",
            message: `${inv.email} accepted an invitation whose agreed terms never landed, and it cannot be fixed automatically: ${decision.reason}. Grant the concession from that account's admin page.`,
          });
          continue;
        }

        if (decision.action === "attach_coupon_to_subscription") {
          // They started paying before anyone noticed. The pending columns
          // are read at checkout, which has already happened, so the discount
          // has to go onto the live subscription instead.
          const couponId = org?.pending_coupon_id ?? null;
          if (!couponId || !org?.stripe_subscription_id) {
            flagged++;
            await logAgent({
              agent: AGENT,
              action: "terms-need-human",
              level: "warn",
              message: `${inv.email} is subscribed without the discount they were promised, and no coupon id is on file to attach. Apply it from the account page.`,
            });
            continue;
          }
          const applied = await applyDiscountToSubscription({
            subscriptionId: org.stripe_subscription_id,
            couponId,
          });
          if (!applied.ok) {
            flagged++;
            await logAgent({
              agent: AGENT,
              action: "terms-repair-failed",
              level: "error",
              message: `${inv.email} is being charged full price and Stripe refused the coupon: ${applied.error}`,
            });
            continue;
          }
        }

        const res = await repairInvitedTerms({ id: inv.id, actorEmail: ACTOR });
        await logAgent({
          agent: AGENT,
          action: res.ok ? "terms-repaired" : "terms-repair-failed",
          level: res.ok ? "warn" : "error",
          message: res.ok
            ? `${inv.email} accepted their invitation but the agreed terms never reached the account. Applied them: ${res.message}`
            : `Could not apply the agreed terms for ${inv.email}: ${res.error}`,
        });
        if (res.ok) repaired++;
        else flagged++;
      }
    } catch (err) {
      await logAgent({
        agent: AGENT,
        action: "repair-pass-failed",
        level: "error",
        message: `Could not check for unapplied invitation terms: ${(err as Error).message}`,
      });
    }

    // -----------------------------------------------------------------------
    // 3. Confirm granted discounts reached Stripe and the invoice.
    // -----------------------------------------------------------------------
    try {
      const withTerms = await query<OrgSnapshot & { name: string }>(
        `select id, name, stripe_subscription_id,
                coalesce(billing_exempt, false) as billing_exempt,
                discount_percent_off, discount_ends_at::text as discount_ends_at,
                pending_coupon_id
           from organizations
          where stripe_subscription_id is not null
            and (pending_coupon_id is not null or discount_percent_off is not null)
          limit 200`
      ).catch(() => []);

      for (const org of withTerms) {
        const state = await readStripeState(org.stripe_subscription_id!);
        // Stripe unreachable or unconfigured: say nothing rather than report
        // every discounted account as broken.
        if (!state) continue;

        const verdict = discountVerdict(org, state);
        if (verdict.ok) continue;
        flagged++;
        await logAgent({
          agent: AGENT,
          action: "discount-mismatch",
          level: verdict.severity === "error" ? "error" : "warn",
          message: `${org.name} (${org.id}): ${verdict.problem}`,
        });
      }
    } catch (err) {
      await logAgent({
        agent: AGENT,
        action: "discount-pass-failed",
        level: "error",
        message: `Could not verify granted discounts against Stripe: ${(err as Error).message}`,
      });
    }

    const parts = [
      `${nudged} invitation${nudged === 1 ? "" : "s"} reminded`,
      `${repaired} set of terms applied`,
      `${flagged} needing attention`,
    ];
    return {
      ok: true,
      summary: `Concession sweep: ${parts.join(", ")}.`,
      data: { nudged, repaired, flagged },
    };
  },
};
