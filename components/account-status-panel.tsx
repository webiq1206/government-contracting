import type { AccountStatus, StatusLine } from "@/lib/domain/account-status";

/**
 * The six account facts, side by side, so a contradiction between them would
 * be visible rather than distributed across three pages.
 *
 * Putting them together is the point. When "product access" lived on the
 * dashboard, "subscription status" on billing and "Stripe status" in the admin
 * panel, nothing ever displayed two of them at once, so nothing ever had to
 * make them agree -- and they did not.
 */

const TONE: Record<StatusLine["tone"], string> = {
  good: "text-pursue",
  warn: "text-review",
  bad: "text-risk",
  neutral: "text-foreground",
};

export function AccountStatusPanel({
  status,
  /** Support and admins get Stripe's raw view; customers do not need it. */
  showStripeRow = false,
}: {
  status: AccountStatus;
  showStripeRow?: boolean;
}) {
  const rows: [string, StatusLine][] = [
    ["Product access", status.productAccess],
    ["Billing", status.billing],
    ["Trial", status.trial],
    ["Automation", status.automation],
  ];
  if (showStripeRow) rows.push(["Stripe says", status.stripe]);

  return (
    <section aria-labelledby="account-status" className="rounded-md border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 id="account-status" className="label">
          Account status
        </h2>
        {/* The headline answer first, so nobody has to assemble it from the
            four rows underneath. */}
        <p className={`mt-1 font-display text-lg font-semibold ${TONE[status.effective.tone]}`}>
          {status.effective.value}
        </p>
        {status.effective.detail && (
          <p className="mt-1 text-sm text-muted-foreground">{status.effective.detail}</p>
        )}
      </div>

      <dl className="divide-y divide-border">
        {rows.map(([label, line]) => (
          <div key={label} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4">
            <dt className="w-40 shrink-0 text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
              {label}
            </dt>
            <dd className="min-w-0 flex-1">
              <span className={`text-sm font-medium ${TONE[line.tone]}`}>{line.value}</span>
              {line.detail && (
                <span className="block text-xs text-muted-foreground">{line.detail}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
