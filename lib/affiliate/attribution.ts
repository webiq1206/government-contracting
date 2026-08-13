/**
 * Referral attribution and the commission ledger.
 *
 * Two rules shape everything here.
 *
 * Attribution happens once. The first code a customer subscribes with owns
 * that customer permanently; a second code later changes nothing. Re-attributing
 * on a later payment is the standard way affiliate programs get gamed, and it
 * also makes historical reporting unreconstructable.
 *
 * Terms are frozen at attribution. The commission rate and duration are copied
 * onto the attribution row rather than joined from the influencer or the code,
 * so changing a rate or expiring a code never rewrites what was promised on a
 * referral that already exists.
 */
import { query, queryOne } from "../db";

export interface InfluencerCode {
  id: string;
  influencer_id: string;
  code: string;
  discount_percent: string;
  applies_to: string;
  discount_months: number | null;
  commission_percent: string | null;
  commission_months: number | null;
  starts_at: string | null;
  ends_at: string | null;
  max_redemptions: number | null;
  redemption_count: number;
  active: boolean;
  influencer_status: string;
  influencer_commission_percent: string;
  influencer_commission_months: number | null;
}

/** Why a code cannot be used right now, or null when it is usable. */
export function codeUnusableReason(
  code: InfluencerCode,
  now = new Date()
): string | null {
  if (!code.active) return "This code is no longer active.";
  // A terminated influencer stops earning AND stops recruiting. A paused one
  // keeps their existing referrals but takes no new ones.
  if (code.influencer_status !== "active") return "This code is not available.";
  if (code.starts_at && new Date(code.starts_at) > now) return "This code is not active yet.";
  if (code.ends_at && new Date(code.ends_at) < now) return "This code has expired.";
  if (code.max_redemptions != null && code.redemption_count >= code.max_redemptions) {
    return "This code has reached its limit.";
  }
  return null;
}

/** Whether the code may be applied to the interval the customer is buying. */
export function appliesToInterval(code: InfluencerCode, interval: "month" | "year"): boolean {
  if (code.applies_to === "both") return true;
  return code.applies_to === interval;
}

export async function findCodeByText(text: string): Promise<InfluencerCode | null> {
  return queryOne<InfluencerCode>(
    `select c.*, i.status as influencer_status,
            i.commission_percent as influencer_commission_percent,
            i.commission_months as influencer_commission_months
       from influencer_codes c
       join influencers i on i.id = c.influencer_id
      where upper(c.code) = upper($1)`,
    [text.trim()]
  ).catch(() => null);
}

export async function findCodeByPromotionCodeId(id: string): Promise<InfluencerCode | null> {
  return queryOne<InfluencerCode>(
    `select c.*, i.status as influencer_status,
            i.commission_percent as influencer_commission_percent,
            i.commission_months as influencer_commission_months
       from influencer_codes c
       join influencers i on i.id = c.influencer_id
      where c.stripe_promotion_code_id = $1`,
    [id]
  ).catch(() => null);
}

/** Effective commission terms for a code, falling back to influencer defaults. */
export function effectiveTerms(code: InfluencerCode): {
  percent: number;
  months: number | null;
} {
  const percent = Number(code.commission_percent ?? code.influencer_commission_percent);
  const months =
    code.commission_months ?? code.influencer_commission_months ?? null;
  return { percent, months };
}

export interface AttributionResult {
  attributed: boolean;
  reason?: string;
  attributionId?: string;
}

/**
 * Attribute an organization to an influencer. Idempotent and first-wins.
 *
 * Never overwrites an existing attribution: the unique constraint on org_id
 * makes that impossible at the database level, and this reports it rather than
 * treating it as an error, because a customer re-entering a code is normal.
 */
export async function attributeOrganization(input: {
  orgId: string;
  code: InfluencerCode;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  now?: Date;
}): Promise<AttributionResult> {
  const now = input.now ?? new Date();
  const blocked = codeUnusableReason(input.code, now);
  if (blocked) return { attributed: false, reason: blocked };

  const { percent, months } = effectiveTerms(input.code);
  const endsAt =
    months != null
      ? new Date(now.getTime() + months * 30 * 86_400_000).toISOString()
      : null;

  const rows = await query<{ id: string }>(
    `insert into referral_attributions
       (org_id, influencer_id, code_id, stripe_customer_id, stripe_subscription_id,
        attributed_at, commission_percent, commission_months, commission_ends_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (org_id) do nothing
     returning id`,
    [
      input.orgId,
      input.code.influencer_id,
      input.code.id,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      now.toISOString(),
      percent,
      months,
      endsAt,
    ]
  );

  if (rows.length === 0) {
    return { attributed: false, reason: "This customer is already attributed." };
  }

  // Counted only on a real first attribution, so a customer re-entering the
  // code cannot burn through a usage limit.
  await query(
    `update influencer_codes set redemption_count = redemption_count + 1, updated_at = now()
      where id = $1`,
    [input.code.id]
  );

  return { attributed: true, attributionId: rows[0].id };
}

export interface Attribution {
  id: string;
  influencer_id: string;
  org_id: string;
  commission_percent: string;
  commission_ends_at: string | null;
}

export async function attributionForCustomer(
  stripeCustomerId: string
): Promise<Attribution | null> {
  return queryOne<Attribution>(
    `select id, influencer_id, org_id, commission_percent, commission_ends_at
       from referral_attributions where stripe_customer_id = $1`,
    [stripeCustomerId]
  ).catch(() => null);
}

/**
 * Record commission on a paid invoice.
 *
 * Idempotent on the invoice id: webhooks retry, and paying an influencer twice
 * for one payment is money that has to be clawed back from a real person.
 *
 * Commission is a percentage of GROSS subscription revenue, meaning the full
 * amount the customer was billed before Stripe's fees. A customer paying a
 * discounted price produces a smaller commission, which is the intended
 * behaviour: the influencer earns on money actually collected.
 */
export async function recordEarned(input: {
  attribution: Attribution;
  invoiceId: string;
  chargeId?: string | null;
  grossAmountCents: number;
  occurredAt?: Date;
  description: string;
}): Promise<{ recorded: boolean; amountCents: number; reason?: string }> {
  const occurredAt = input.occurredAt ?? new Date();

  // Past the commission window, the referral simply stops earning. Not an
  // error: this is how a fixed-duration deal ends.
  if (
    input.attribution.commission_ends_at &&
    new Date(input.attribution.commission_ends_at) < occurredAt
  ) {
    return { recorded: false, amountCents: 0, reason: "Commission period has ended." };
  }
  if (input.grossAmountCents <= 0) {
    return { recorded: false, amountCents: 0, reason: "Nothing was collected." };
  }

  const percent = Number(input.attribution.commission_percent);
  const amount = Math.round((input.grossAmountCents * percent) / 100);

  const rows = await query<{ id: string }>(
    `insert into commission_events
       (influencer_id, attribution_id, org_id, kind, stripe_invoice_id, stripe_charge_id,
        gross_amount_cents, commission_percent, amount_cents, occurred_at, description)
     values ($1,$2,$3,'earned',$4,$5,$6,$7,$8,$9,$10)
     on conflict (stripe_invoice_id, kind) where stripe_invoice_id is not null
     do nothing
     returning id`,
    [
      input.attribution.influencer_id,
      input.attribution.id,
      input.attribution.org_id,
      input.invoiceId,
      input.chargeId ?? null,
      input.grossAmountCents,
      percent,
      amount,
      occurredAt.toISOString(),
      input.description,
    ]
  );

  return rows.length > 0
    ? { recorded: true, amountCents: amount }
    : { recorded: false, amountCents: 0, reason: "Already recorded for this invoice." };
}

/**
 * Reverse commission when a payment is refunded or charged back.
 *
 * Written as a negative row rather than by deleting or editing the original,
 * so the influencer's statement can always say what happened and when instead
 * of showing an unexplained shortfall. Deducted from the next payout.
 */
export async function recordClawback(input: {
  attribution: Attribution;
  refundId: string;
  invoiceId?: string | null;
  refundedAmountCents: number;
  occurredAt?: Date;
  description: string;
}): Promise<{ recorded: boolean; amountCents: number; reason?: string }> {
  if (input.refundedAmountCents <= 0) {
    return { recorded: false, amountCents: 0, reason: "Nothing was refunded." };
  }
  const percent = Number(input.attribution.commission_percent);
  // Proportional to what was actually refunded, so a partial refund claws back
  // a partial commission rather than the whole thing.
  const amount = -Math.round((input.refundedAmountCents * percent) / 100);

  const rows = await query<{ id: string }>(
    `insert into commission_events
       (influencer_id, attribution_id, org_id, kind, stripe_refund_id, stripe_invoice_id,
        gross_amount_cents, commission_percent, amount_cents, occurred_at, description)
     values ($1,$2,$3,'clawback',$4,$5,$6,$7,$8,$9,$10)
     on conflict (stripe_refund_id) where stripe_refund_id is not null
     do nothing
     returning id`,
    [
      input.attribution.influencer_id,
      input.attribution.id,
      input.attribution.org_id,
      input.refundId,
      input.invoiceId ?? null,
      input.refundedAmountCents,
      percent,
      amount,
      (input.occurredAt ?? new Date()).toISOString(),
      input.description,
    ]
  );

  return rows.length > 0
    ? { recorded: true, amountCents: amount }
    : { recorded: false, amountCents: 0, reason: "Already clawed back for this refund." };
}

/** Unpaid balance for an influencer: earned minus clawbacks, in cents. */
export async function pendingBalanceCents(influencerId: string): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `select coalesce(sum(amount_cents), 0)::text as total
       from commission_events
      where influencer_id = $1 and payout_id is null`,
    [influencerId]
  ).catch(() => null);
  return Number(row?.total ?? 0);
}
