import { TRIAL_ALLOWANCE_COPY } from "@/lib/billing/trial-catalog";

export function TrialAllowances() {
  return (
    <aside className="rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed" aria-label="Trial allowances">
      <h2 className="font-semibold text-foreground">What your trial includes</h2>
      <p className="mt-2">{TRIAL_ALLOWANCE_COPY}</p>
      <p className="mt-2 text-muted-foreground">At a trial cap, the affected action is held. Reaching a cap does not automatically subscribe or charge you. Review your account for paid-access options.</p>
      <p className="mt-2 text-muted-foreground">No card required. Choose a paid plan only when you are ready. Service connections and spending controls still apply. Outreach requires your mailbox and approval of sending rules; it is optional when you perform the work yourself.</p>
      <a className="mt-2 inline-flex min-h-11 items-center text-accent underline" href="/pricing-guide#usage">Review service costs and limits</a>
    </aside>
  );
}
