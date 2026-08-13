import Link from "next/link";
import { PageHeader } from "@/components/badges";
import { currentUser } from "@/lib/auth";
import { getOrganization } from "@/lib/organizations";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { shortDate } from "@/lib/format";
import { stripeEnabled } from "@/lib/billing/enabled";

export const dynamic = "force-dynamic";

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
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
      return "text-pursue";
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
  searchParams?: { error?: string; checkout?: string };
}) {
  const user = await currentUser();
  const org = user?.organizationId
    ? await getOrganization(user.organizationId)
    : null;

  const status = org?.subscription_status ?? "none";
  const statusLabel = subscriptionStatusLabel(status);
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
  const hasStripeCustomer = Boolean(org?.stripe_customer_id);
  const canCheckout = stripeEnabled() && !hasStripeCustomer;

  const planLabel =
    org?.plan_key === "founding"
      ? `Founding · $${FOUNDING_MONTHLY_USD.toLocaleString()}/mo`
      : org?.plan_key === "standard"
        ? `Standard · $${STANDARD_MONTHLY_USD.toLocaleString()}/mo`
        : "No plan selected";

  const primaryCta = hasStripeCustomer ? (
    <Link href="/api/billing/portal" className="btn-primary">
      Open billing portal
    </Link>
  ) : canCheckout ? (
    <Link href="/api/billing/checkout?plan=standard" className="btn-primary">
      Start 7-day free trial
    </Link>
  ) : null;

  return (
    <>
      <PageHeader
        title="Billing"
        status={statusLabel}
        subtitle="Subscription, invoices, and cancellation for your organization."
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {searchParams?.error && (
          <div className="rounded-md border border-risk/40 bg-risk/5 px-4 py-3 text-sm text-risk">
            Billing action failed ({searchParams.error}). Try again or contact
            hello@brostco.com.
          </div>
        )}
        {searchParams?.checkout === "canceled" && (
          <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-slate-600">
            Checkout canceled. Your account is unchanged.
          </div>
        )}

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
      </div>
    </>
  );
}
