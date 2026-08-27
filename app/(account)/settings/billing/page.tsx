import Link from "next/link";
import { PageFrame } from "@/components/page-frame";
import { currentUser } from "@/lib/auth";
import { getOrganization } from "@/lib/organizations";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { shortDate } from "@/lib/format";
import { stripeEnabled } from "@/lib/billing/enabled";
import { accessLevel, trialDaysLeft, isCardlessTrial } from "@/lib/billing/entitlements";
import { allQuotaStates, TRIAL_METRIC_LABEL } from "@/lib/billing/trial-limits";
import { TrialPlanPicker } from "@/components/trial-plan-picker";
import { accountStatus } from "@/lib/domain/account-status";
import { permissionMessage } from "@/lib/domain/roles";
import { AccountStatusPanel } from "@/components/account-status-panel";
import { paymentState } from "@/lib/domain/payment-state";
import { getAutomationState } from "@/lib/app-settings";
import { invoicesFor } from "@/lib/billing/invoices";
import { describeCard, describeInvoice } from "@/lib/domain/payment-method";
import { reconcile } from "@/lib/domain/billing-reconciliation";

export const dynamic = "force-dynamic";

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  trial: "Free trial",
  trial_expired: "Trial ended",
  canceled: "Canceled",
  past_due: "Past due",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  none: "No subscription",
  paused: "Paused",
};

function subscriptionStatusLabel(status: string | null | undefined): string {
  if (!status) return "No subscription";
  return SUBSCRIPTION_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

function subscriptionStatusClass(status: string | null | undefined): string {
  switch (status) {
    case "active":
    case "trialing":
    case "trial":
      return "text-pursue";
    case "trial_expired":
      return "text-risk";
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "text-risk";
    case "canceled":
    case "incomplete_expired":
      return "text-slate-600";
    default:
      return "text-slate-800";
  }
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams?: { error?: string; checkout?: string; expired?: string };
}) {
  const user = await currentUser();
  const org = user?.organizationId
    ? await getOrganization(user.organizationId)
    : null;

  const access = org ? accessLevel(org) : "none";
  const onTrial = org ? isCardlessTrial(org) : false;
  const daysLeft = org ? trialDaysLeft(org) : 0;
  // Only a live trial has meters worth showing.
  const quotas = org && access === "trial" ? await allQuotaStates(org.id).catch(() => []) : [];

  const status = org?.subscription_status ?? "none";
  /*
   * One model for the six facts, so the page cannot say "Canceled" in one
   * place and "working" in another. The individual variables below still feed
   * the plan, invoice and discount sections; what changed is that the STATUS
   * a reader sees at the top now comes from a single decision rather than
   * from whichever field that part of the page happened to read.
   */
  const automationState = await getAutomationState().catch(() => ({ paused: false }));
  const accountFacts = accountStatus({
    subscriptionStatus: org?.subscription_status ?? null,
    trialEndsAt: org?.trial_ends_at ?? null,
    billingExempt: org?.billing_exempt ?? null,
    suspendedAt: org?.suspended_at ?? null,
    stripeCustomerId: org?.stripe_customer_id ?? null,
    amountCents: org?.stripe_amount_cents ?? org?.plan_amount_cents ?? null,
    billingInterval: org?.billing_interval ?? null,
    automationPaused: automationState.paused,
  });
  // A comped account's Stripe status is usually 'canceled' or 'none', which is
  // true and completely misleading on this page. Say what is actually
  // happening instead, or the owner reads "Canceled" on an account that works
  // perfectly and goes looking for a problem that does not exist.
  const comped = Boolean(org?.billing_exempt);
  /*
   * What happened to the last payment, and what happens next.
   *
   * The page used to print "Past due" and stop. Stripe had already told the
   * webhook why the card was refused and when it would be tried again, the
   * webhook put both in an email, and the page that email pointed at could
   * not answer the question the email raised.
   */
  const payment = paymentState({
    subscriptionStatus: org?.subscription_status ?? null,
    lastPaymentStatus: org?.last_payment_status ?? null,
    lastPaymentError: org?.last_payment_error ?? null,
    lastPaymentAt: org?.last_payment_at ?? null,
    nextPaymentAttemptAt: org?.next_payment_attempt_at ?? null,
    invoiceUrl: org?.last_invoice_url ?? null,
    cancelAtPeriodEnd: org?.cancel_at_period_end ?? null,
    currentPeriodEnd: org?.current_period_end ?? null,
    billingExempt: org?.billing_exempt ?? null,
  });
  /*
   * The card and the receipts, from this platform's own records.
   *
   * Read here rather than from Stripe on every page view: the page has to
   * render when Stripe is slow, and a billing page that hangs on the day
   * payments are having trouble is the one day it is being read.
   */
  const invoices = org && !comped ? await invoicesFor(org.id).catch(() => []) : [];
  const card = describeCard({
    brand: org?.card_brand ?? null,
    last4: org?.card_last4 ?? null,
    expMonth: org?.card_exp_month ?? null,
    expYear: org?.card_exp_year ?? null,
    recordedAt: org?.card_recorded_at ?? null,
    knownToStripe: Boolean(org?.stripe_customer_id),
    billingExempt: org?.billing_exempt ?? null,
  });

  /*
   * Whether what this account can do and what Stripe says can both be true.
   *
   * The same function the platform admin page runs over every account, run
   * here over this one. The rule is that these two must never quietly
   * disagree: if they do, the owner is told plainly, in the same words an
   * administrator sees, rather than left to notice that the page says full
   * access beside a cancelled subscription.
   */
  const conflicts = org
    ? reconcile([
        {
          org_id: org.id,
          org_name: org.name,
          subscription_status: org.subscription_status ?? "none",
          amount_cents: org.stripe_amount_cents ?? org.plan_amount_cents ?? null,
          billing_interval: org.billing_interval,
          trial_ends_at: org.trial_ends_at,
          last_payment_at: org.last_payment_at,
          last_payment_status: org.last_payment_status,
          stripe_subscription_id: org.stripe_subscription_id,
          stripe_customer_id: org.stripe_customer_id,
          billing_exempt: org.billing_exempt,
          suspended_at: org.suspended_at,
        },
      ])
    : [];

  const statusLabel = comped ? "Comped" : subscriptionStatusLabel(status);
  const isActive = status === "active" || status === "trialing";

  // What the customer is actually charged, taken from Stripe rather than the
  // list price, so a grandfathered or discounted rate is shown as it is.
  const cents = org?.stripe_amount_cents ?? org?.plan_amount_cents ?? null;
  const per = org?.billing_interval === "year" ? "per year" : "per month";
  const chargeLabel =
    cents != null ? `$${(cents / 100).toLocaleString("en-US")} ${per}` : "-";
  const discountLabel = org?.discount_percent_off
    ? `${org.discount_percent_off}% off${org.discount_code ? ` (${org.discount_code})` : ""}${
        org.discount_ends_at ? ` until ${shortDate(org.discount_ends_at)}` : ""
      }`
    : org?.discount_amount_off_cents
      ? `$${(org.discount_amount_off_cents / 100).toLocaleString("en-US")} off${
          org.discount_code ? ` (${org.discount_code})` : ""
        }`
      : null;
  // A discount that was arranged for this account before it had a subscription
  // to put one on. Stripe does not know about it yet, so it cannot appear in
  // the line above, and staying silent would mean a customer who was promised
  // three free months sees nothing about them anywhere until an invoice
  // arrives.
  const promisedDiscount = !comped ? (org?.pending_concession_label ?? null) : null;
  const hasStripeCustomer = Boolean(org?.stripe_customer_id);
  // A comped account has nothing to buy. Showing it a plan picker invites
  // somebody who was told their account is free to start paying for it, which
  // the checkout route now refuses anyway; this is so they are never offered
  // it in the first place.
  const canCheckout = stripeEnabled() && !hasStripeCustomer && !comped;

  /*
   * The plan, priced at what this account is actually charged.
   *
   * This line used to print the list price for the plan key while the Price
   * row three inches below it printed what Stripe bills, so a grandfathered
   * account read "Founding, $497/mo" in the largest text on the card and
   * "$299 per month" in the small text underneath. The larger number was the
   * wrong one, and the whole point of reading the amount from Stripe was to
   * stop the page quoting a price nobody pays.
   */
  const planName =
    org?.plan_key === "founding"
      ? "Founding"
      : org?.plan_key === "standard"
        ? "Standard"
        : null;
  const listMonthly =
    org?.plan_key === "founding"
      ? FOUNDING_MONTHLY_USD
      : org?.plan_key === "standard"
        ? STANDARD_MONTHLY_USD
        : null;
  const planLabel = !planName
    ? "No plan selected"
    : cents != null
      ? `${planName} · ${chargeLabel}`
      : // Nothing from Stripe yet, so this is the published rate rather than a
        // bill, and it says which of the two it is.
        `${planName} · list price $${(listMonthly ?? 0).toLocaleString()}/mo`;

  // A comped account has nothing to check out for and nothing to manage in the
  // Stripe portal. Offering either would only lead somewhere confusing.
  const primaryCta =
    hasStripeCustomer && !comped ? (
      <Link href="/api/billing/portal" className="btn-primary">
        Open billing portal
      </Link>
    ) : null;

  return (
    <>
      <PageFrame
        title="Billing"
        explanation="What this account can do, what it is charged, and how to change either."
        breadcrumbs={[{ label: "Settings", href: "/settings" }]}
        status={accountFacts.effective.value}
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {/* The six facts first. Everything below is detail on one of them. */}
        {/*
          * Stripe's raw view is normally left off a customer page: it is
          * jargon, and when it agrees with everything else it adds nothing.
          * It goes back on the moment the two disagree, because the notice
          * below is about a contradiction, and a reader cannot judge one
          * they are only being shown one half of.
          */}
        <AccountStatusPanel status={accountFacts} showStripeRow={conflicts.length > 0} />

        {/*
          * The payment, when there is anything to say about it. A healthy
          * subscription needs no panel of its own; the status above already
          * says so, and a green box saying "fine" on every visit is how
          * somebody learns to stop reading this part of the page.
          */}
        {(payment.urgent || payment.state === "canceling") && (
          <div
            role={payment.urgent ? "alert" : undefined}
            className={`card max-w-xl space-y-2 ${
              payment.urgent ? "border-risk/40 bg-risk/5" : "border-review/40 bg-review/5"
            }`}
          >
            <p className={`text-sm font-semibold ${payment.urgent ? "text-risk" : "text-review"}`}>
              {payment.headline}
            </p>
            {payment.reason && (
              <p className="text-sm leading-relaxed text-slate-700">
                <span className="label mr-1.5 inline">Reason:</span>
                {payment.reason}
              </p>
            )}
            <p className="text-sm leading-relaxed text-slate-700">{payment.next}</p>
            {payment.consequence && (
              <p className="text-sm leading-relaxed text-slate-600">{payment.consequence}</p>
            )}
            {payment.actionHref && payment.actionLabel && (
              <Link
                href={payment.actionHref}
                className={payment.urgent ? "btn-primary w-fit" : "btn-ghost w-fit"}
              >
                {payment.actionLabel}
              </Link>
            )}
          </div>
        )}

        {/*
          * Two facts about this account that cannot both be right.
          *
          * Several of these states are deliberate, so this does not accuse
          * anybody of anything: it says what disagrees and what happens next.
          * The alternative is the page quietly showing full access beside a
          * cancelled subscription and leaving the owner to work out which one
          * is going to win.
          */}
        {conflicts.length > 0 && (
          <div className="card max-w-xl space-y-2 border-review/40 bg-review/5" role="status">
            <p className="text-sm font-semibold text-review">
              This account is flagged for a billing review
            </p>
            {conflicts.map((c) => (
              <div key={c.kind} className="space-y-1">
                <p className="text-sm leading-relaxed text-slate-700">{c.disagreement}</p>
                <p className="text-sm leading-relaxed text-slate-600">{c.cost}</p>
              </div>
            ))}
            <p className="text-sm leading-relaxed text-slate-600">
              Nothing changes on your side while this is looked at, and your access
              is exactly what the top of this page says it is. Reply to any billing
              email, or write to hello@brostco.com, if you want it settled sooner.
            </p>
          </div>
        )}

        {searchParams?.error === "not_permitted" ? (
          <div className="rounded-md border border-review/40 bg-review/10 px-4 py-3 text-sm text-foreground">
            {/* Reached by following the checkout or portal link with a role
                that cannot use it. Names who can, so the next step is a
                conversation rather than a support ticket. */}
            {permissionMessage(user?.orgRole ?? null, "manage_billing")}
          </div>
        ) : searchParams?.error === "support_session" ? (
          <div className="rounded-md border border-risk/40 bg-risk/5 px-4 py-3 text-sm text-risk">
            Billing cannot be changed from a support session. Return to your own
            account first.
          </div>
        ) : searchParams?.error === "account_is_free" ? (
          <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-slate-600">
            There is nothing to subscribe to. This account is free and has full
            access already.
          </div>
        ) : (
          searchParams?.error && (
            <div className="rounded-md border border-risk/40 bg-risk/5 px-4 py-3 text-sm text-risk">
              Billing action failed ({searchParams.error}). Try again or contact
              hello@brostco.com.
            </div>
          )
        )}
        {comped && (
          <div className="rounded-md border border-pursue/40 bg-pursue/5 px-4 py-3 text-sm text-pursue">
            This account is comped. You have full access to everything and there
            is nothing to pay.
            {org?.billing_exempt_reason ? ` (${org.billing_exempt_reason})` : ""}
          </div>
        )}
        {promisedDiscount && (
          <div className="rounded-md border border-accent/40 bg-accent/5 px-4 py-3 text-sm text-accent-strong">
            {promisedDiscount} This is applied automatically when you subscribe,
            with no code to enter.
          </div>
        )}
        {searchParams?.checkout === "canceled" && (
          <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-slate-600">
            Checkout canceled. Your account is unchanged.
          </div>
        )}

        {/* The locked state. Anyone redirected here by the access gate lands
            on this first, so the answer to "why can I not get in" is the top
            of the page and the fix is directly under it. */}
        {access === "none" && onTrial && (
          <div className="card max-w-xl space-y-2 border-risk/40 bg-risk/5">
            <p className="text-sm font-semibold text-slate-900">Your free trial has ended</p>
            <p className="text-sm leading-relaxed text-slate-700">
              Nothing has been deleted. Your company profile, every opportunity found for
              you, your subcontractor database, and any quotes already received are exactly
              where you left them. Choose a plan below and it all comes straight back.
            </p>
            <p className="text-sm text-slate-600">
              You were never charged and no card is on file.
            </p>
          </div>
        )}

        {access === "trial" && (
          <div className="card max-w-xl space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="eyebrow">Free trial</p>
              <p className={`text-sm font-semibold ${daysLeft <= 2 ? "text-risk" : "text-slate-900"}`}>
                {daysLeft <= 0
                  ? "Ends today"
                  : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
                {org?.trial_ends_at ? ` · ${shortDate(org.trial_ends_at)}` : ""}
              </p>
            </div>
            <p className="text-sm leading-relaxed text-slate-600">
              Finding, scoring, and analysing opportunities runs without limit during the
              trial. These three are metered so the trial cannot run up a bill on your
              behalf:
            </p>
            <ul className="space-y-1.5 text-sm">
              {quotas.map((q) => (
                <li key={q.metric} className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">{TRIAL_METRIC_LABEL[q.metric]}</span>
                  <span className={`num text-sm ${q.exhausted ? "text-risk" : "text-slate-800"}`}>
                    {q.used} of {q.limit}
                    {q.exhausted ? " · used up" : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">
              Choosing a plan lifts every limit immediately. Nothing is charged until you do.
            </p>
          </div>
        )}

        {/* Plan choice, for anyone who has not yet paid. */}
        {!hasStripeCustomer && canCheckout && (
          <TrialPlanPicker
            expired={access === "none"}
            foundingMonthly={FOUNDING_MONTHLY_USD}
            standardMonthly={STANDARD_MONTHLY_USD}
          />
        )}

        {/*
          * A comped account has no plan, no price, no renewal and no portal,
          * and the card below printed all four as dashes and "No plan
          * selected". The audit asks for the irrelevant pricing and portal
          * content to be removed rather than emptied, because an owner told
          * their account is free reads a page full of blanks as a page that
          * is broken.
          */}
        {comped ? (
          <div className="card max-w-xl space-y-2">
            <p className="eyebrow">Current subscription</p>
            <p className="font-display text-2xl text-foreground">
              Full access, no billing required
            </p>
            <p className="text-sm leading-relaxed text-slate-600">
              There is no plan, no renewal date and no payment method on this account,
              because nothing is charged.
              {org?.billing_exempt_reason ? ` ${org.billing_exempt_reason}.` : ""}{" "}
              Every feature is available exactly as it is on a paid account.
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              If this ever changes you will be told before anything is charged, and the
              plan and payment sections will appear here.
            </p>
          </div>
        ) : (
        <div className="card max-w-xl space-y-3">
          <p className="eyebrow">Current subscription</p>
          <p className="font-display text-2xl text-foreground">{planLabel}</p>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="label">Status</dt>
              <dd className={`mt-0.5 font-medium ${subscriptionStatusClass(status)}`}>
                {statusLabel}
                {org?.cancel_at_period_end && isActive ? (
                  <span className="mt-0.5 block text-xs font-normal text-slate-600">
                    Cancels at period end
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="label">Price locked</dt>
              <dd className="mt-0.5 text-slate-800">
                {org?.price_locked
                  ? "Yes (founding rate retained while subscribed)"
                  : "No"}
              </dd>
            </div>
            <div>
              <dt className="label">
                {status === "trialing"
                  ? "Trial ends"
                  : org?.cancel_at_period_end
                    ? "Access until"
                    : "Renews on"}
              </dt>
              <dd className="mt-0.5 text-slate-800">
                {status === "trialing" && org?.trial_ends_at
                  ? shortDate(org.trial_ends_at)
                  : org?.current_period_end
                    ? shortDate(org.current_period_end)
                    : "-"}
              </dd>
            </div>
            <div>
              <dt className="label">Price</dt>
              <dd className="mt-0.5 text-slate-800">
                {chargeLabel}
                {discountLabel ? (
                  <span className="mt-0.5 block text-xs font-normal text-pursue">
                    {discountLabel}
                  </span>
                ) : null}
              </dd>
            </div>
            {status === "trialing" ? (
              <div>
                <dt className="label">After your trial</dt>
                <dd className="mt-0.5 text-slate-800">
                  {/* Stated plainly before the charge happens, not after. */}
                  {chargeLabel === "-"
                    ? "-"
                    : `${chargeLabel}, starting ${org?.trial_ends_at ? shortDate(org.trial_ends_at) : "when the trial ends"}`}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="label">Payment method</dt>
              <dd className="mt-0.5 text-slate-800">
                {card.value}
                {card.detail && (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {card.detail}
                  </span>
                )}
                {card.warning && (
                  <span
                    className={`mt-0.5 block text-xs font-normal ${card.tone === "bad" ? "text-risk" : "text-review"}`}
                  >
                    {card.warning}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="label">Billing portal</dt>
              <dd className="mt-0.5 text-slate-800">
                {hasStripeCustomer ? "Available" : "Set up after checkout"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {primaryCta}
            <Link href="/settings/profile" className="btn-ghost">
              Company profile
            </Link>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {hasStripeCustomer
              ? "Update payment method, view invoices, or cancel anytime in the Stripe customer portal. Founding rates stay in effect for the life of an active subscription and do not transfer to a new organization after cancellation."
              : isActive
                ? "Your workspace is unlocked. Connect Stripe checkout when you are ready to manage invoices and renewals from the billing portal."
                : "Start a subscription to unlock the full platform. Founding rates stay in effect for the life of an active subscription."}
          </p>
        </div>
        )}

        {/*
          * The receipts.
          *
          * Absent rather than zero when there are none: an account that has
          * never been charged has no invoices, and an account whose charges
          * predate this record has none HERE, which is a different sentence
          * and the one people need when they cannot find a receipt they know
          * exists.
          */}
        {!comped && hasStripeCustomer && (
          <div className="card max-w-xl space-y-3">
            <p className="eyebrow">Invoices</p>
            {invoices.length === 0 ? (
              <p className="text-sm leading-relaxed text-slate-600">
                No invoices have been recorded on this account yet. Charges made
                before this page started keeping its own copy are in the Stripe
                billing portal, which has every one of them.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {invoices.map((inv) => {
                  const line = describeInvoice({
                    number: inv.number,
                    status: inv.status,
                    amountPaidCents: inv.amount_paid_cents,
                    amountDueCents: inv.amount_due_cents,
                    currency: inv.currency,
                    issuedAt: inv.issued_at,
                    paidAt: inv.paid_at,
                    failureReason: inv.failure_reason,
                  });
                  return (
                    <li key={inv.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-sm text-slate-800">
                          {inv.issued_at ? shortDate(inv.issued_at) : "Date not recorded"}
                          {inv.number ? (
                            <span className="ml-2 text-xs text-muted-foreground">{inv.number}</span>
                          ) : null}
                        </span>
                        <span className="flex items-baseline gap-2">
                          <span className="num text-sm text-slate-800">
                            {line.amount ?? "Amount not recorded"}
                          </span>
                          <span
                            className={`text-xs font-medium ${
                              line.tone === "good"
                                ? "text-pursue"
                                : line.tone === "bad"
                                  ? "text-risk"
                                  : line.tone === "warn"
                                    ? "text-review"
                                    : "text-muted-foreground"
                            }`}
                          >
                            {line.outcome}
                          </span>
                        </span>
                      </div>
                      {line.note && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {line.note}
                        </p>
                      )}
                      {(inv.hosted_invoice_url || inv.invoice_pdf_url) && (
                        <a
                          className="mt-1 inline-block text-xs font-medium text-accent-strong underline"
                          href={inv.invoice_pdf_url ?? inv.hosted_invoice_url ?? "#"}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {inv.invoice_pdf_url ? "Download the receipt" : "Open this invoice"}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {invoices.length > 0 && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {`${invoices.length === 1 ? "This is the invoice" : `These are the ${invoices.length} most recent invoices`} this platform has a record of. The billing portal holds the complete history.`}
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
