import { notFound } from "next/navigation";
import { PageHeader } from "@/components/badges";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { adminBillingRows, summarise } from "@/lib/billing/admin";
import { billingConfigured, isLiveMode } from "@/lib/billing/catalog";
import { shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  active: "bg-pursue/15 text-pursue",
  trialing: "bg-accent/15 text-accent-strong",
  past_due: "bg-risk/15 text-risk",
  unpaid: "bg-risk/15 text-risk",
  incomplete: "bg-review/15 text-review",
  canceled: "bg-slate-200 text-slate-600",
};

function money(cents: number | null | undefined): string {
  if (cents == null) return "-";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function discountLabel(r: {
  discount_code: string | null;
  discount_percent_off: string | null;
  discount_amount_off_cents: number | null;
  discount_ends_at: string | null;
}): string {
  if (!r.discount_percent_off && !r.discount_amount_off_cents) return "-";
  const amount = r.discount_percent_off
    ? `${Number(r.discount_percent_off)}% off`
    : `${money(r.discount_amount_off_cents)} off`;
  const code = r.discount_code ? ` (${r.discount_code})` : "";
  const until = r.discount_ends_at ? ` to ${shortDate(r.discount_ends_at)}` : "";
  return `${amount}${code}${until}`;
}

/**
 * Every customer's billing state on one page.
 *
 * Ordered so the accounts that need attention are at the top, because the
 * reason to open this page is almost always a payment that failed rather than
 * a subscription that is quietly working.
 */
export default async function AdminBillingPage() {
  const auth = await requirePlatformAdmin();
  // Anyone signed in but not an admin gets a 404: naming the page would tell
  // them it exists and is worth attacking.
  if (auth instanceof Response) notFound();

  const rows = await adminBillingRows();
  const s = summarise(rows);
  const config = billingConfigured();
  const live = isLiveMode();

  return (
    <>
      <PageHeader
        eyebrow="Platform admin"
        title="Customer billing"
        subtitle="Plan, trial, discount, subscription status, and payment health for every account."
      />

      <div className="space-y-4">
        {!config.ok && (
          <div className="card border-risk/40 bg-risk/5 text-sm text-risk">
            Billing is not fully configured, so nobody can subscribe. Missing:{" "}
            <span className="num">{config.missing.join(", ")}</span>
          </div>
        )}
        {config.ok && !live && (
          <div className="card border-review/40 bg-review/5 text-sm text-review">
            This deployment is using Stripe <strong>test</strong> keys. Figures below are
            test data, not real revenue.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Accounts", value: String(s.total) },
            { label: "On trial", value: String(s.trialing) },
            { label: "Paying", value: String(s.active) },
            { label: "Payment problems", value: String(s.pastDue) },
            { label: "MRR", value: money(s.mrrCents) },
          ].map((c) => (
            <div key={c.label} className="card">
              <p className="label">{c.label}</p>
              <p className="num mt-1 text-xl font-semibold text-foreground">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="card overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-600">
              No organizations yet.
            </p>
          ) : (
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Plan</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Price</th>
                  <th className="py-2 pr-3 font-medium">Discount</th>
                  <th className="py-2 pr-3 font-medium">Trial ends</th>
                  <th className="py-2 pr-3 font-medium">Renews</th>
                  <th className="py-2 font-medium">Last payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.org_id} className="border-t border-border align-top">
                    <td className="py-2 pr-3">
                      <span className="block font-medium text-foreground">{r.org_name}</span>
                      <span className="num block text-xs text-slate-500">
                        {r.owner_email ?? "no owner on file"}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="capitalize">{r.plan_key}</span>
                      <span className="block text-xs text-slate-500">
                        {r.billing_interval === "year" ? "annual" : "monthly"}
                        {r.price_locked ? " · rate locked" : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`badge ${STATUS_TONE[r.subscription_status] ?? "bg-slate-200 text-slate-600"}`}
                      >
                        {r.subscription_status.replace(/_/g, " ")}
                      </span>
                      {r.cancel_at_period_end && (
                        <span className="mt-0.5 block text-xs text-review">
                          cancels at period end
                        </span>
                      )}
                    </td>
                    <td className="num py-2 pr-3">{money(r.amount_cents)}</td>
                    <td className="py-2 pr-3 text-xs">{discountLabel(r)}</td>
                    <td className="num py-2 pr-3 text-xs">
                      {r.trial_ends_at ? shortDate(r.trial_ends_at) : "-"}
                    </td>
                    <td className="num py-2 pr-3 text-xs">
                      {r.current_period_end ? shortDate(r.current_period_end) : "-"}
                    </td>
                    <td className="py-2 text-xs">
                      {r.last_payment_status ? (
                        <>
                          <span
                            className={
                              r.last_payment_status === "succeeded"
                                ? "text-pursue"
                                : "text-risk"
                            }
                          >
                            {r.last_payment_status.replace(/_/g, " ")}
                          </span>
                          {r.last_payment_at && (
                            <span className="num block text-slate-500">
                              {shortDate(r.last_payment_at)}
                            </span>
                          )}
                          {r.last_payment_error && (
                            <span className="block text-slate-500">
                              {r.last_payment_error}
                            </span>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Read from this application&apos;s own records, which the Stripe webhook keeps
          current. Anything here that disagrees with Stripe means webhook delivery is
          failing and is worth checking.
        </p>
      </div>
    </>
  );
}
