import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { planForPriceId, PLANS, type PlanKey } from "@/lib/billing/catalog";
import { query, queryOne } from "@/lib/db";
import { clearPendingConcession, updateOrganizationBilling } from "@/lib/organizations";
import { trackEvent } from "@/lib/analytics";
import {
  claimEvent,
  releaseEvent,
  isNewerThanApplied,
  markApplied,
} from "@/lib/billing/events";
import {
  notifyTrialStarted,
  notifyTrialEnding,
  notifyPaymentSucceeded,
  notifyPaymentFailed,
  notifyCanceled,
  notifyReactivated,
} from "@/lib/billing/notify";
import { recordInvoice, recordPaymentMethod } from "@/lib/billing/invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const iso = (sec: number | null | undefined): string | null =>
  sec ? new Date(sec * 1000).toISOString() : null;

/** Find the organization an event belongs to, without trusting the payload alone. */
async function orgIdForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const row = await queryOne<{ id: string }>(
    `select id from organizations where stripe_customer_id = $1`,
    [customerId]
  ).catch(() => null);
  return row?.id ?? null;
}

const asId = (v: unknown): string | null =>
  typeof v === "string" ? v : ((v as { id?: string } | null)?.id ?? null);

/**
 * File the invoice this event is about.
 *
 * Called on success and on failure, because the invoice somebody asks about
 * is nearly always the one that did not go through. Everything is taken from
 * the event payload; no extra Stripe call is made, so a receipt is recorded
 * even when Stripe is rate limiting or unreachable a second later.
 */
async function fileInvoice(orgId: string, inv: Stripe.Invoice, failureReason: string | null) {
  const wide = inv as unknown as {
    id?: string;
    number?: string | null;
    status?: string | null;
    amount_due?: number | null;
    amount_paid?: number | null;
    currency?: string | null;
    period_start?: number | null;
    period_end?: number | null;
    hosted_invoice_url?: string | null;
    invoice_pdf?: string | null;
    created?: number | null;
    status_transitions?: { paid_at?: number | null } | null;
  };
  if (!wide.id) return;
  await recordInvoice({
    orgId,
    stripeInvoiceId: wide.id,
    number: wide.number ?? null,
    // Stripe's own word for what happened. Turned into plain language on the
    // page rather than here, so the record keeps the value support can search
    // Stripe for.
    status: wide.status ?? "open",
    amountDueCents: wide.amount_due ?? null,
    amountPaidCents: wide.amount_paid ?? null,
    currency: wide.currency ?? null,
    periodStart: iso(wide.period_start),
    periodEnd: iso(wide.period_end),
    hostedInvoiceUrl: wide.hosted_invoice_url ?? null,
    invoicePdfUrl: wide.invoice_pdf ?? null,
    issuedAt: iso(wide.created),
    paidAt: iso(wide.status_transitions?.paid_at ?? null),
    failureReason,
  });
}

/**
 * Record the card behind a subscription, when Stripe names one.
 *
 * One retrieve call, on subscription events only, which happen a handful of
 * times in an account's life. Failure is swallowed: knowing the last four
 * digits is a convenience, and losing the subscription update over it would
 * be a real outage in exchange for a cosmetic one.
 */
async function captureCard(
  stripe: NonNullable<ReturnType<typeof getStripe>>,
  orgId: string,
  sub: Stripe.Subscription
) {
  try {
    const pmId =
      asId((sub as unknown as { default_payment_method?: unknown }).default_payment_method) ??
      null;
    let pm: Stripe.PaymentMethod | null = null;
    if (pmId) {
      pm = await stripe.paymentMethods.retrieve(pmId);
    } else {
      // No subscription-level card means the customer default is what will be
      // charged, so that is the one to describe.
      const customerId = asId(sub.customer);
      if (!customerId) return;
      const customer = await stripe.customers.retrieve(customerId);
      const defaultPm = asId(
        (customer as unknown as { invoice_settings?: { default_payment_method?: unknown } })
          .invoice_settings?.default_payment_method
      );
      if (!defaultPm) return;
      pm = await stripe.paymentMethods.retrieve(defaultPm);
    }
    const card = pm?.card;
    if (!card) return;
    await recordPaymentMethod(orgId, {
      brand: card.brand ?? null,
      last4: card.last4 ?? null,
      expMonth: card.exp_month ?? null,
      expYear: card.exp_year ?? null,
    });
  } catch (e) {
    console.warn("[stripe-webhook] could not read the payment method:", e);
  }
}

/**
 * Read the plan, price, and discount actually in force on a subscription.
 *
 * Amounts come from Stripe rather than our catalog on purpose. A grandfathered
 * or discounted subscriber pays less than list, and recording the list price
 * would overstate what they are being charged everywhere it is shown.
 */
/**
 * The discount fields we read, kept as a local shape rather than the SDK's.
 * Stripe has moved coupon details between the discount object and a discounts
 * array across API versions, so reading them structurally keeps this working
 * across an SDK bump instead of failing to compile on one.
 */
interface LooseDiscount {
  promotion_code?: string | { id?: string } | null;
  end?: number | null;
  coupon?: {
    id?: string | null;
    percent_off?: number | null;
    amount_off?: number | null;
  } | null;
}

function readSubscription(sub: Stripe.Subscription) {
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const { plan, interval } = planForPriceId(priceId);
  const loose = sub as unknown as {
    discount?: LooseDiscount | null;
    discounts?: LooseDiscount[] | null;
  };
  const discount = loose.discount ?? loose.discounts?.[0] ?? null;
  const coupon = discount?.coupon ?? null;
  return {
    priceId,
    plan,
    interval: interval ?? item?.price?.recurring?.interval ?? null,
    amountCents: item?.price?.unit_amount ?? null,
    status: sub.status,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    periodEnd: iso((sub as { current_period_end?: number }).current_period_end),
    trialEnd: iso((sub as { trial_end?: number | null }).trial_end),
    discountCode:
      (typeof discount?.promotion_code === "string"
        ? discount.promotion_code
        : (discount?.promotion_code?.id ?? null)) ??
      coupon?.id ??
      null,
    percentOff: coupon?.percent_off ?? null,
    amountOffCents: coupon?.amount_off ?? null,
    discountEndsAt: iso(discount?.end ?? null),
  };
}

/**
 * Stripe webhook.
 *
 * Signature verification is mandatory. The previous version fell back to
 * parsing unsigned JSON whenever STRIPE_WEBHOOK_SECRET was unset, which meant
 * anyone who found the URL could POST a forged event and activate a paid
 * subscription for free.
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set; refusing events.");
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      req.headers.get("stripe-signature") || "",
      secret
    );
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature error: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  // Claim before handling. The primary key on Stripe's event id is the lock,
  // so a retry arriving while the first is still running is skipped instead of
  // being processed twice.
  const claim = await claimEvent({
    id: event.id,
    type: event.type,
    createdAtSec: event.created,
  });
  if (!claim.fresh) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(stripe, event);
  } catch (err) {
    // Release the claim so Stripe's retry genuinely reprocesses this. Leaving
    // it would make the failure permanent while looking like a success.
    await releaseEvent(event.id);
    console.error("[stripe-webhook]", event.type, err);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(stripe: NonNullable<ReturnType<typeof getStripe>>, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.org_id || session.client_reference_id || null;
      const subId = asId(session.subscription);
      const customerId = asId(session.customer);
      if (!orgId || !subId) break;

      // Ordering guard, same as the subscription events below. Stripe delivers
      // at-least-once and unordered, so a delayed original checkout can arrive
      // AFTER a cancellation for the same account. Without this, that stale
      // checkout resurrected a canceled subscription and handed it full access
      // for free. A genuine re-subscribe carries a newer timestamp and still
      // passes (the check is >=, so a simultaneous subscription.created does
      // not drop it either).
      if (!(await isNewerThanApplied(orgId, event.created))) break;

      const sub = await stripe.subscriptions.retrieve(subId);
      const s = readSubscription(sub);
      const plan: PlanKey =
        s.plan !== "none" ? s.plan : ((session.metadata?.plan_key as PlanKey) ?? "standard");

      await updateOrganizationBilling(orgId, {
        stripe_customer_id: customerId,
        stripe_subscription_id: subId,
        stripe_price_id: s.priceId,
        plan_key: plan,
        // Stripe's amount, not the catalog's: a promo code or a grandfathered
        // rate means the customer pays less than list.
        plan_amount_cents: s.amountCents,
        stripe_amount_cents: s.amountCents,
        billing_interval: s.interval,
        subscription_status: s.status,
        price_locked: plan !== "none" && PLANS[plan as "standard" | "founding"]?.grandfathered,
        current_period_end: s.periodEnd,
        trial_ends_at: s.trialEnd,
        cancel_at_period_end: s.cancelAtPeriodEnd,
        discount_code: s.discountCode,
        discount_percent_off: s.percentOff,
        discount_amount_off_cents: s.amountOffCents,
        discount_ends_at: s.discountEndsAt,
      });
      // The subscription exists now, so whatever discount was promised has
      // either been applied at checkout or was never going to be. Either way
      // Stripe is the record from here.
      await clearPendingConcession(orgId);
      await markApplied(orgId, event.created);
      await captureCard(stripe, orgId, sub);
      await trackEvent({
        event: "subscription_completed",
        orgId,
        meta: { plan, interval: s.interval, session_id: session.id },
      });
      if (s.status === "trialing") {
        await notifyTrialStarted({
          orgId,
          planName: plan === "none" ? "Brost Co" : PLANS[plan].name,
          amountCents: s.amountCents,
          interval: s.interval,
          trialEndsAt: s.trialEnd,
        });
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId =
        sub.metadata?.org_id ||
        (await queryOne<{ id: string }>(
          `select id from organizations where stripe_subscription_id = $1`,
          [sub.id]
        ).catch(() => null))?.id ||
        (await orgIdForCustomer(asId(sub.customer)));
      if (!orgId) break;

      // Drop an event older than the state already applied. Stripe does not
      // guarantee order, and a delayed update would otherwise roll the account
      // back to stale values.
      if (!(await isNewerThanApplied(orgId, event.created))) break;

      const org = await queryOne<{
        price_locked: boolean;
        plan_key: string;
        subscription_status: string;
        cancel_at_period_end: boolean;
      }>(
        `select price_locked, plan_key, subscription_status, cancel_at_period_end
           from organizations where id = $1`,
        [orgId]
      );

      const s = readSubscription(sub);
      const deleted = event.type === "customer.subscription.deleted";
      // A grandfathered subscriber keeps their plan identity through every
      // renewal; only an explicit plan change moves them, and that arrives as
      // a different price id on a non-locked account.
      let plan: PlanKey = s.plan;
      if (org?.price_locked) plan = (org.plan_key as PlanKey) || "founding";
      else if (plan === "none") plan = "standard";

      const patch: Parameters<typeof updateOrganizationBilling>[1] = {
        stripe_subscription_id: sub.id,
        plan_key: plan,
        plan_amount_cents: s.amountCents,
        stripe_amount_cents: s.amountCents,
        billing_interval: s.interval,
        subscription_status: deleted ? "canceled" : s.status,
        cancel_at_period_end: s.cancelAtPeriodEnd,
        current_period_end: s.periodEnd,
        trial_ends_at: s.trialEnd,
        price_locked:
          Boolean(org?.price_locked) ||
          (plan !== "none" && PLANS[plan as "standard" | "founding"]?.grandfathered),
        discount_code: s.discountCode,
        discount_percent_off: s.percentOff,
        discount_amount_off_cents: s.amountOffCents,
        discount_ends_at: s.discountEndsAt,
      };
      if (!org?.price_locked) patch.stripe_price_id = s.priceId;
      await updateOrganizationBilling(orgId, patch);
      await markApplied(orgId, event.created);
      if (!deleted) await captureCard(stripe, orgId, sub);

      if (deleted) {
        await notifyCanceled({ orgId, endsAt: s.periodEnd, immediate: true });
      } else if (s.cancelAtPeriodEnd && !org?.cancel_at_period_end) {
        await notifyCanceled({ orgId, endsAt: s.periodEnd, immediate: false });
      } else if (!s.cancelAtPeriodEnd && org?.cancel_at_period_end) {
        await notifyReactivated({ orgId, periodEnd: s.periodEnd });
      }
      break;
    }

    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      const orgId =
        sub.metadata?.org_id || (await orgIdForCustomer(asId(sub.customer)));
      if (!orgId) break;
      const s = readSubscription(sub);
      await notifyTrialEnding({
        orgId,
        amountCents: s.amountCents,
        interval: s.interval,
        trialEndsAt: s.trialEnd,
      });
      break;
    }

    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const inv = event.data.object as Stripe.Invoice;
      const orgId = await orgIdForCustomer(asId(inv.customer));
      if (!orgId) break;
      await query(
        // The retry date and the invoice link are cleared alongside the error.
        // A stale "we will try again on the 4th" surviving a successful
        // payment is the same class of lie as the failure that never showed:
        // a page stating something that stopped being true.
        `update organizations
            set last_payment_status = 'succeeded',
                last_payment_at = now(),
                last_payment_error = null,
                next_payment_attempt_at = null,
                last_invoice_url = null,
                updated_at = now()
          where id = $1`,
        [orgId]
      );
      await fileInvoice(orgId, inv, null);
      // Only the first success of a billing period is worth an email; Stripe
      // sends both invoice.paid and invoice.payment_succeeded for the same
      // payment, and the events table already dedupes by event id, so this
      // guard covers the pair.
      if (event.type === "invoice.paid") {
        await notifyPaymentSucceeded({
          orgId,
          amountCents: inv.amount_paid ?? null,
          invoiceUrl: inv.hosted_invoice_url ?? null,
          periodEnd: iso((inv as { period_end?: number }).period_end),
        });
      }
      break;
    }

    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const inv = event.data.object as Stripe.Invoice;
      const orgId = await orgIdForCustomer(asId(inv.customer));
      if (!orgId) break;
      const reason =
        (inv as unknown as { last_finalization_error?: { message?: string } })
          .last_finalization_error?.message ?? null;
      // Stored, not only emailed. The customer's next move after reading that
      // email is to open the Billing page, and until now it could not tell
      // them why the payment failed or when it would be tried again.
      const nextAttemptAt = iso(
        (inv as { next_payment_attempt?: number | null }).next_payment_attempt
      );
      const invoiceUrl = inv.hosted_invoice_url ?? null;
      await query(
        `update organizations
            set last_payment_status = $2,
                last_payment_at = now(),
                last_payment_error = $3,
                next_payment_attempt_at = $4,
                last_invoice_url = $5,
                updated_at = now()
          where id = $1`,
        [
          orgId,
          event.type === "invoice.payment_failed" ? "failed" : "action_required",
          reason,
          nextAttemptAt,
          invoiceUrl,
        ]
      );
      await fileInvoice(orgId, inv, reason);
      await notifyPaymentFailed({
        orgId,
        amountCents: inv.amount_due ?? null,
        reason,
        nextAttemptAt,
        invoiceUrl,
      });
      // Subscription status itself (past_due, unpaid) arrives on the
      // subscription.updated event, so access is not changed here.
      break;
    }

    default:
      break;
  }
}
