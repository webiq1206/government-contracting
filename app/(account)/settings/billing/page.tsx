import Link from "next/link";
import { PageHeader } from "@/components/badges";
import { currentUser } from "@/lib/auth";
import { getOrganization } from "@/lib/organizations";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { shortDate } from "@/lib/format";
import { stripeEnabled } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams?: { error?: string; checkout?: string };
}) {
  const user = await currentUser();
  const org = user?.organizationId
    ? await getOrganization(user.organizationId)
    : null;

  const planLabel =
    org?.plan_key === "founding"
      ? `Founding · $${FOUNDING_MONTHLY_USD.toLocaleString()}/mo`
      : org?.plan_key === "standard"
        ? `Standard · $${STANDARD_MONTHLY_USD.toLocaleString()}/mo`
        : "No active plan";

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Billing"
        subtitle="Subscription, invoices, and cancellation for your organization."
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-auto p-5">
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
              <dd className="mt-0.5 text-slate-800">
                {org?.subscription_status ?? "none"}
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
              <dt className="label">Renews / ends</dt>
              <dd className="mt-0.5 text-slate-800">
                {org?.current_period_end
                  ? shortDate(org.current_period_end)
                  : "-"}
              </dd>
            </div>
            <div>
              <dt className="label">Cancel at period end</dt>
              <dd className="mt-0.5 text-slate-800">
                {org?.cancel_at_period_end ? "Yes" : "No"}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {stripeEnabled() && org?.stripe_customer_id ? (
              <Link href="/api/billing/portal" className="btn-primary">
                Manage billing in Stripe
              </Link>
            ) : (
              <Link
                href="/api/billing/checkout?plan=standard"
                className="btn-primary"
              >
                Start subscription
              </Link>
            )}
            <Link href="/settings/profile" className="btn-ghost">
              Company profile
            </Link>
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Cancel anytime in the Stripe customer portal. Founding rates stay in
            effect for the life of an active subscription and do not transfer to a
            new organization after cancellation.
          </p>
        </div>
      </div>
    </div>
  );
}
