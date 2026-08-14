/**
 * Discounts we grant, as opposed to discounts a customer types in.
 *
 * The webhook has always read Stripe's discount data and mirrored it onto the
 * organization. This is the other half: the part that creates the discount in
 * the first place. Nothing in the codebase had ever called Stripe's coupon or
 * promotion code API before, and the shape of that API drives most of what is
 * here.
 *
 * THE ONE IDEA WORTH KNOWING
 *
 * A run of free months is not a different mechanism from a percentage off. It
 * is 100% off, repeating for that many months. Treating it as its own concept
 * would mean a second code path through Stripe, a second set of edge cases at
 * renewal, and two ways for the same customer to end up double-discounted.
 * So there is one function that makes coupons and both kinds go through it.
 *
 * A FREE ACCOUNT IS NOT IN HERE
 *
 * That is `billing_exempt`, our own column, and deliberately not a 100% coupon
 * that never ends. A coupon needs Stripe to be reachable, needs a subscription
 * to attach to, and can be overwritten by a webhook. An exemption is true
 * whatever Stripe thinks, which is the entire reason it exists.
 */
import { getStripe } from "./stripe";

/** What we can promise somebody. */
export type ConcessionKind = "none" | "percent" | "free_months" | "free_account";

export interface Concession {
  kind: ConcessionKind;
  /** 1-100, for `percent`. */
  percent?: number | null;
  /** How many months the discount runs. Required for `free_months`. */
  months?: number | null;
}

export interface ConcessionCode {
  /** Our own reference for this grant. Buys nobody anything. See below. */
  code: string;
  couponId: string;
}

/**
 * Characters that survive being read aloud and written down.
 *
 * No O/0, no I/1, no S/5, no B/8, so nobody reading an audit entry back has to
 * ask which one it was.
 *
 * THIS IS A LABEL, NOT A KEY. It used to be a Stripe promotion code, which
 * made it a bearer token: anyone who saw it could spend the discount, and
 * because each was good for one redemption, a stranger spending it also took
 * away the discount the customer had been promised. Discounts are attached
 * server-side now, so this string identifies a grant in our own records and
 * does nothing at Stripe.
 */
const ALPHABET = "ACDEFGHJKLMNPQRTUVWXY2346789";

/** `BROST-K4M9`. Four characters is ~614k combinations, checked for collisions. */
export function generateConcessionCode(random: () => number = Math.random): string {
  let tail = "";
  for (let i = 0; i < 4; i++) {
    tail += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return `BROST-${tail}`;
}

/**
 * The concession in words a customer would use.
 *
 * Written for the billing page as much as for the admin: somebody who has
 * never seen a Stripe invoice should be able to read this and know exactly
 * what they are paying and for how long.
 */
export function describeConcession(c: Concession): string {
  switch (c.kind) {
    case "free_account":
      return "Free account. Nothing to pay, ever.";
    case "free_months": {
      const n = c.months ?? 0;
      return n === 1
        ? "First month free, then the normal price."
        : `First ${n} months free, then the normal price.`;
    }
    case "percent": {
      const pct = c.percent ?? 0;
      if (!c.months) return `${pct}% off for as long as the subscription runs.`;
      return c.months === 1
        ? `${pct}% off the first month.`
        : `${pct}% off for the first ${c.months} months.`;
    }
    default:
      return "Standard pricing.";
  }
}

/** Anything wrong with these terms, said plainly, or null. */
export function validateConcession(c: Concession): string | null {
  if (c.kind === "percent") {
    const pct = Number(c.percent);
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
      return "A percentage discount has to be between 1 and 100.";
    }
    if (c.months != null) {
      const m = Number(c.months);
      if (!Number.isInteger(m) || m < 1 || m > 36) {
        return "A discount can run for 1 to 36 months, or leave it open-ended.";
      }
    }
    return null;
  }
  if (c.kind === "free_months") {
    const m = Number(c.months);
    if (!Number.isInteger(m) || m < 1 || m > 36) {
      return "Choose between 1 and 36 free months.";
    }
    return null;
  }
  return null;
}

/** Does this concession need a Stripe coupon behind it? */
export function needsStripeCode(kind: ConcessionKind): boolean {
  return kind === "percent" || kind === "free_months";
}

/**
 * Create the coupon behind a granted discount.
 *
 * A COUPON, DELIBERATELY NOT A PROMOTION CODE. A promotion code is the thing a
 * customer types into the box at checkout, which makes it a bearer token: the
 * moment it exists, anyone holding the string can spend it on any account, and
 * with a single redemption allowed they would spend the discount we promised
 * to somebody else. A coupon cannot be typed in. It can only be attached by us
 * to a subscription or a checkout session we are already building for a known
 * account, which is precisely the property a privately negotiated rate needs.
 *
 * IDEMPOTENCY KEYS ARE NOT OPTIONAL HERE. A network timeout on a request that
 * actually succeeded, retried, mints a second coupon. It is a real object with
 * real invoice consequences and it is invisible until it lands on somebody's
 * bill. The key is derived from the caller's own identifier (an invitation id,
 * an organization id plus the grant reference) so a retry of the same grant
 * collapses onto the same coupon.
 */
export async function createConcessionCode(input: {
  concession: Concession;
  /** Stable across retries of the same logical grant. */
  idempotencyKey: string;
  /** Our own reference, pre-generated so uniqueness is checked against our table. */
  code: string;
  /** Shown in the Stripe dashboard so a coupon is identifiable months later. */
  label: string;
}): Promise<{ ok: true; value: ConcessionCode } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) {
    return {
      ok: false,
      error: "Stripe is not configured here, so a discount code cannot be created.",
    };
  }

  const percentOff =
    input.concession.kind === "free_months" ? 100 : Number(input.concession.percent);
  const months = input.concession.months ?? null;

  try {
    const coupon = await stripe.coupons.create(
      {
        percent_off: percentOff,
        // A month count means the discount stops on its own. Without one it
        // runs for the life of the subscription, which is what an open-ended
        // negotiated rate means.
        ...(months
          ? { duration: "repeating", duration_in_months: months }
          : { duration: "forever" }),
        name: input.label,
        // Granted to one account, by hand. Even though nobody can redeem a
        // coupon themselves, this caps the damage of a bug on our side to a
        // single subscription.
        max_redemptions: 1,
        metadata: {
          source: "brostco_admin",
          kind: input.concession.kind,
          concession_ref: input.code,
        },
      },
      { idempotencyKey: `${input.idempotencyKey}:coupon` }
    );

    return { ok: true, value: { code: input.code, couponId: coupon.id } };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Put a discount onto a subscription that is already running.
 *
 * The card stays, the subscription is not interrupted, and normal billing
 * resumes when the coupon runs out. This is what makes "three free months" on
 * a paying account mean what the customer thinks it means.
 */
export async function applyDiscountToSubscription(input: {
  subscriptionId: string;
  couponId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is not configured here." };
  try {
    await stripe.subscriptions.update(input.subscriptionId, {
      discounts: [{ coupon: input.couponId }],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Take the discount off a running subscription, leaving everything else alone. */
export async function removeDiscountFromSubscription(input: {
  subscriptionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is not configured here." };
  try {
    await stripe.subscriptions.update(input.subscriptionId, { discounts: [] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Retire the coupon behind a withdrawn invitation.
 *
 * Only ever called for an offer nobody took up, so nothing is being taken away
 * from a customer. Deleting a Stripe coupon does not disturb discounts already
 * applied to running subscriptions, so this cannot reach an accepted account
 * even if the caller gets its ordering wrong.
 *
 * A failure here is logged and swallowed by the caller: the invitation is
 * already withdrawn, the link is dead, and a coupon nobody can redeem sitting
 * unused in Stripe is not worth failing an admin action over.
 */
export async function deleteConcessionCoupon(
  couponId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Stripe is not configured here." };
  try {
    await stripe.coupons.del(couponId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
