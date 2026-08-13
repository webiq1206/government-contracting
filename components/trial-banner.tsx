import Link from "next/link";
import { TRIAL_METRIC_LABEL, type QuotaState } from "@/lib/billing/trial-limits";

/**
 * Short forms for narrow screens. The full labels wrapped the banner onto four
 * lines on a phone, costing 129px of a 812px viewport on every page.
 */
const SHORT_LABEL: Record<string, string> = {
  outreach_emails: "emails",
  ai_briefs: "briefs",
  bid_packages: "packages",
};

/**
 * The trial's status line, on every page of the dashboard.
 *
 * Two jobs, in this order: tell someone how long they have left, and tell them
 * what they have left. The second matters more than it looks. Without it, the
 * first time a trial hits a limit it reads as the product breaking; with it,
 * hitting a limit is the expected end of something they have been watching
 * count down.
 *
 * Deliberately not dismissible. It is one line, it is the only thing standing
 * between a working account and a locked one, and a dismissed banner is how
 * someone finds out their trial ended by discovering they cannot log in.
 */
export function TrialBanner({
  daysLeft,
  quotas,
}: {
  daysLeft: number;
  quotas: QuotaState[];
}) {
  const urgent = daysLeft <= 2;
  const anyExhausted = quotas.some((q) => q.exhausted);

  const dayLabel =
    daysLeft <= 0
      ? "Last day of your trial"
      : daysLeft === 1
        ? "1 day left in your trial"
        : `${daysLeft} days left in your trial`;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 text-xs sm:px-6 ${
        urgent || anyExhausted
          ? "border-risk/30 bg-risk/10"
          : "border-border bg-surface/60"
      }`}
    >
      <span
        className={`font-semibold ${urgent || anyExhausted ? "text-risk" : "text-slate-900"}`}
      >
        {dayLabel}
      </span>

      <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
        {quotas.map((q) => (
          <span key={q.metric} className={q.exhausted ? "text-risk" : undefined}>
            <span className="num">
              {q.used}/{q.limit}
            </span>{" "}
            <span className="sm:hidden">{SHORT_LABEL[q.metric] ?? q.metric}</span>
            <span className="hidden sm:inline">{TRIAL_METRIC_LABEL[q.metric]}</span>
          </span>
        ))}
      </span>

      <Link href="/settings/billing" className="btn-primary ml-auto shrink-0 text-xs">
        {anyExhausted ? "Remove limits" : "Choose a plan"}
      </Link>
    </div>
  );
}
