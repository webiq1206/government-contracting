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

/** A compact orientation row, not a second navigation bar. */
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
  subtitle?: ReactNode;
  eyebrow?: string;
  status?: ReactNode;
  help?: HelpContent;
  children?: ReactNode;
  variant?: "light" | "dark";
}) {
  return (
    <div className="product-page-header flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="mb-1 text-xs font-medium text-muted-foreground">{eyebrow}</p>}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 break-words font-display text-xl font-semibold leading-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {help && <HelpPopover help={help} />}
        </div>
        {status != null && status !== "" && (
          <div className="mt-1 text-xs font-medium text-muted-foreground sm:text-sm">
            {status}
          </div>
        )}
        {subtitle != null && subtitle !== "" && (
          <div className="page-description mt-1 text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
      {children && (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
          {children}
        </div>
      )}
    </div>
  );
}
