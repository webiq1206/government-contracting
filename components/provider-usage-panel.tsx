import Link from "next/link";
import {
  credentialView,
  creditView,
  tokenTotals,
  allowanceView,
  formatTokens,
  type CredentialSource,
} from "@/lib/domain/provider-usage";

/**
 * Provider usage and credit status, which the audit lists as part of what
 * Automation Health has to show and the page did not show at all.
 *
 * The panel exists for one sentence an operator should never have to discover
 * by finding their pipeline stopped: this is the credential being spent, this
 * is how much is left of it, and this is what the provider is currently doing
 * with our calls. Everything here is dated or bounded; nothing is a zero
 * standing in for an unknown.
 */
export function ProviderUsagePanel({
  source,
  grantExpiresAt,
  callsOnPlatformKey,
  trialBudget,
  usageRows,
  incidentCauses,
}: {
  source: CredentialSource;
  grantExpiresAt: string | null;
  callsOnPlatformKey: number | null;
  trialBudget: number | null;
  usageRows: Record<string, unknown>[];
  incidentCauses: string[];
}) {
  const cred = credentialView(source, grantExpiresAt);
  const totals = tokenTotals(usageRows);
  const credit = creditView(incidentCauses, totals?.calls ?? 0);
  const allowance = allowanceView(callsOnPlatformKey ?? 0, trialBudget);

  const creditTone =
    credit.state === "out_of_credit" || credit.state === "key_rejected"
      ? "text-risk"
      : credit.state === "throttled"
        ? "text-review"
        : credit.state === "accepting"
          ? "text-pursue"
          : "text-muted-foreground";

  return (
    <section aria-labelledby="provider-usage" className="card space-y-3">
      <div>
        <h2 id="provider-usage" className="label">
          Provider usage and credit
        </h2>
        <p className="mt-1 text-sm text-foreground">{cred.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {cred.explanation}
        </p>
      </div>

      {/*
        * A grant that lapses is a scheduled outage, and nothing in this
        * product used to mention it until after every agent had stopped.
        */}
      {cred.expiry && (
        <p
          className={`rounded-md border px-3 py-2 text-xs leading-relaxed ${
            cred.expiry.urgency === "expired"
              ? "border-risk/40 bg-risk/5 text-risk"
              : cred.expiry.urgency === "soon"
                ? "border-review/40 bg-review/5 text-review"
                : "border-border bg-surface text-muted-foreground"
          }`}
        >
          {cred.expiry.urgency === "expired"
            ? "The grant on this key has lapsed. Agents that need the model will stop until a key is supplied."
            : `The grant on this key ends in ${cred.expiry.daysLeft} day${
                cred.expiry.daysLeft === 1 ? "" : "s"
              }. When it does, every agent that needs the model stops.`}{" "}
          <Link href="/settings/integrations" className="underline underline-offset-2">
            Supply your own key
          </Link>
        </p>
      )}

      <div>
        <p className={`text-sm font-medium ${creditTone}`}>{credit.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{credit.detail}</p>
      </div>

      {allowance && (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">Included calls used</span>
            <span className="num text-foreground">
              {allowance.used} of {allowance.limit}
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className={`h-full rounded-full ${
                allowance.exhausted ? "bg-risk" : allowance.nearLimit ? "bg-review" : "bg-accent/70"
              }`}
              style={{ width: `${Math.max(1, allowance.pctUsed)}%` }}
            />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {allowance.exhausted
              ? "The included allowance is spent. Supply your own key in Connected services to carry on."
              : allowance.nearLimit
                ? `${allowance.remaining} left. Supply your own key before it runs out, so nothing stops mid-bid.`
                : `${allowance.remaining} left.`}
          </p>
        </div>
      )}

      {/*
        * Token counts, or an explicit absence. A row of zeroes here would
        * describe a busy day and a silent one identically.
        */}
      {totals ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-xs sm:grid-cols-4">
          <Stat label="Model calls (24h)" value={String(totals.calls)} />
          <Stat label="Tokens in" value={formatTokens(totals.input + totals.cacheRead)} />
          <Stat label="Tokens out" value={formatTokens(totals.output)} />
          <Stat
            label="Served from cache"
            value={totals.cacheHitRate == null ? "Nothing sent" : `${totals.cacheHitRate}%`}
          />
        </dl>
      ) : (
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          No model calls recorded in the last 24 hours, so there is no usage to report. That is
          expected on a quiet account and a warning sign on a busy one.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}
