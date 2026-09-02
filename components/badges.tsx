import type { ReactNode } from "react";
import { tierColor } from "@/lib/format";
import { HelpPopover, type HelpContent } from "./help-popover";

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return <span className={`badge uppercase ${tierColor(tier)}`}>{tier}</span>;
}

export function ScoreBadge({
  score,
  variant = "inline",
}: {
  score: number | null;
  /** `box` matches the Opportunity mock square fit-score treatment. */
  variant?: "inline" | "box";
}) {
  if (score == null) return <span className="text-slate-500">-</span>;
  if (variant === "box") {
    return (
      <div className="fit-score-box" aria-label={`Fit score ${score}`}>
        <span className="num">{score}</span>
        <span className="label">Fit score</span>
      </div>
    );
  }
  const color =
    score >= 70 ? "text-pursue" : score >= 50 ? "text-review" : "text-slate-600";
  return <span className={`num text-base font-semibold ${color}`}>{score}</span>;
}

/**
 * Page chrome pinned above the page scroller (page-shell shrink-0 sibling).
 * Kept compact on mobile so content keeps most of the viewport under the
 * mobile top nav and above the tab bar. Prefer one header region; put
 * search/filters in PageToolbar rather than a third custom bar.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  status,
  help,
  children,
  variant: _variant = "light",
}: {
  title: string;
  /** Supporting sentence: what this page is for / how many items. */
  subtitle?: ReactNode;
  eyebrow?: string;
  /** Optional live status chip/line shown above the subtitle. */
  status?: ReactNode;
  help?: HelpContent;
  children?: ReactNode;
  /** @deprecated Theme tokens cover both surfaces; kept for call-site compatibility. */
  variant?: "light" | "dark";
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-end justify-between gap-x-3 gap-y-1.5 border-b border-border/55 bg-background px-4 py-2 dark:border-white/10 sm:px-6 sm:py-3">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <div className="flex items-start gap-2">
          <h1 className="min-w-0 font-display text-lg font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {help && <HelpPopover help={help} />}
        </div>
        <div className="mt-1.5 hidden h-px w-8 bg-gold sm:block sm:mt-2 sm:w-12" />
        {status != null && status !== "" && (
          <div className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground sm:mt-1.5 sm:line-clamp-none sm:text-sm">
            {status}
          </div>
        )}
        {subtitle != null && subtitle !== "" && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground sm:mt-1 sm:line-clamp-none sm:text-sm sm:leading-relaxed">
            {subtitle}
          </div>
        )}
      </div>
      {children && (
        <div className="flex max-w-full flex-wrap items-center gap-1.5 pt-0.5 sm:pt-0">
          {children}
        </div>
      )}
    </div>
  );
}
