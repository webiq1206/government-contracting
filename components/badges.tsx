import type { ReactNode } from "react";
import { tierColor } from "@/lib/format";
import { HelpPopover, type HelpContent } from "./help-popover";

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return <span className={`badge uppercase ${tierColor(tier)}`}>{tier}</span>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-500">-</span>;
  const color =
    score >= 70 ? "text-pursue" : score >= 50 ? "text-review" : "text-slate-600";
  return <span className={`num text-base font-semibold ${color}`}>{score}</span>;
}

/**
 * Page chrome: purpose (title) + optional status line + primary actions.
 * Children sit in the action slot (right on desktop, below on narrow screens).
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  status,
  help,
  children,
}: {
  title: string;
  /** Supporting sentence: what this page is for / how many items. */
  subtitle?: ReactNode;
  eyebrow?: string;
  /** Optional live status chip/line shown above the subtitle. */
  status?: ReactNode;
  help?: HelpContent;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6 sm:py-5">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <div className="flex items-start gap-2.5">
          <h1 className="min-w-0 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {help && <HelpPopover help={help} />}
        </div>
        <div className="mt-2 h-[3px] w-11 rounded-full bg-accent" />
        {status != null && status !== "" && (
          <div className="mt-2 text-sm font-medium text-slate-700">{status}</div>
        )}
        {subtitle != null && subtitle !== "" && (
          <div className="mt-1.5 text-sm leading-relaxed text-slate-500">{subtitle}</div>
        )}
      </div>
      {children && (
        <div className="flex max-w-full flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}
