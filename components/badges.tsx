import { tierColor } from "@/lib/format";
import { HelpPopover, type HelpContent } from "./help-popover";

export function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null;
  return <span className={`badge uppercase ${tierColor(tier)}`}>{tier}</span>;
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-500">-</span>;
  const color =
    score >= 70 ? "text-accent" : score >= 50 ? "text-review" : "text-slate-600";
  return <span className={`num text-base font-semibold ${color}`}>{score}</span>;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  help,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  help?: HelpContent;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-6 py-5">
      <div>
        {eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
        <div className="flex items-center gap-2.5">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {help && <HelpPopover help={help} />}
        </div>
        <div className="mt-2 h-[3px] w-11 rounded-full bg-accent" />
        {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
