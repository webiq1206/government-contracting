import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { adminBillingRows, summarise, webhookPulse } from "@/lib/billing/admin";
import { reconcile, webhookHealth } from "@/lib/domain/billing-reconciliation";
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

  const [rows, pulse] = await Promise.all([adminBillingRows(), webhookPulse()]);
  const s = summarise(rows);
  /*
   * The two things the audit asks to be at the top of this page.
   *
   * The footnote at the bottom used to tell the reader that anything
   * disagreeing with Stripe meant webhook delivery was failing and was worth
   * checking, which left the checking to a person who would have to compare
   * every row by hand on a page they open when something has already gone
   * wrong. Nobody does that.
   */
  const webhook = webhookHealth(pulse.lastEventAt, pulse.billableAccounts);
  const conflicts = reconcile(rows);
  const config = billingConfigured();
  const live = isLiveMode();

  return (
    <>
      <PageFrame
        breadcrumbs={[{ label: "Platform admin" }]}
        title="Customer billing"
        explanation="Plan, trial, discount, subscription status, and payment health for every account."
      />

      {/* page-main is overflow-hidden: every page owns its scroll. Without
          this wrapper the customer table clipped at the viewport and the page
          could not scroll at all once real rows accumulated. */}
      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
        {/* Whether the events that keep this page true are still arriving. */}
        <div
          className={`card text-sm ${
            webhook.suspect ? "border-risk/40 bg-risk/5" : "border-border"
          }`}
        >
          <p className={`font-medium ${webhook.suspect ? "text-risk" : "text-foreground"}`}>
            {webhook.label}
          </p>
          <p className="mt-1 leading-relaxed text-slate-600">{webhook.detail}</p>
        </div>

        {/*
          * Accounts whose access and whose subscription cannot both be right.
          * None of these is fixed automatically: several are legitimate states
          * somebody chose, and a deliberate choice and an accident look
          * identical from here.
          */}
        {conflicts.length > 0 && (
          <section aria-labelledby="billing-conflicts" className="space-y-2">
            <h2 id="billing-conflicts" className="label">
              {conflicts.length === 1
                ? "One account where access and billing disagree"
                : `${conflicts.length} accounts where access and billing disagree`}
            </h2>
            {conflicts.map((c) => (
              <article
                key={`${c.orgId}:${c.kind}`}
                className={`card ${
                  c.severity === "high" ? "border-risk/40 bg-risk/5" : "border-review/40 bg-review/5"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{c.orgName}</p>
                  <span
                    className={`badge ${
                      c.severity === "high" ? "bg-risk/15 text-risk" : "bg-review/15 text-review"
                    }`}
                  >
                    {c.severity === "high" ? "Costs money now" : "Worth a look"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">{c.disagreement}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{c.cost}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
                  {/*
                    * The label style, with a colour that survives the tinted
                    * card behind it. `.label` is muted-foreground at 0.7rem,
                    * which measures 2.39:1 on `bg-review/5` and fails 4.5:1.
                    * This is the line telling an administrator what to do
                    * about an account whose access and Stripe disagree, so it
                    * is the last text on the page that should be hard to read.
                    */}
                  <span className="mr-1.5 inline text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-foreground">
                    Do:
                  </span>
                  {c.action}
                </p>
              </article>
            ))}
          </section>
        )}

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
                  <th className="py-2 font-medium">Next attempt</th>
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
                    {/* Stored from the failure event rather than inferred: a
                        retry that Stripe has not scheduled must not be shown
                        as one that it has. */}
                    <td className="num py-2 text-xs">
                      {r.next_payment_attempt_at ? (
                        shortDate(r.next_payment_attempt_at)
                      ) : r.last_payment_status === "failed" ||
                        r.last_payment_status === "action_required" ? (
                        <span className="text-risk">none scheduled</span>
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

        <p className="text-xs leading-relaxed text-slate-500">
          Read from this application&apos;s own records, which the Stripe webhook keeps
          current. The panels at the top say when an event last arrived and which accounts
          hold two facts that cannot both be true, so a disagreement does not depend on
          somebody comparing every row by hand.
        </p>
      </div>
    </>
  );
}
