import { InfoTip } from "@/components/info-tip";
import type { SubWorkDescription } from "@/lib/domain/sub-work";

/**
 * Layperson block: exactly what we need this subcontractor to perform.
 * Used on call workspace, call cards, opportunity coverage/subs, and Today.
 */
export function SubWorkNeeded({
  work,
  variant = "full",
  className = "",
}: {
  work: SubWorkDescription;
  variant?: "full" | "compact" | "inline";
  className?: string;
}) {
  if (!work.work) return null;

  const title = work.trade
    ? `What we need them to do — ${work.trade}`
    : "What we need them to do";

  if (variant === "inline") {
    return (
      <p className={`text-xs leading-relaxed text-slate-600 ${className}`}>
        <span className="font-medium text-slate-800">Work: </span>
        {work.work}
      </p>
    );
  }

  if (variant === "compact") {
    return (
      <div
        className={`rounded-md border border-accent/25 bg-accent-soft/40 px-3 py-2 ${className}`}
      >
        <p className="label text-accent-strong">{title}</p>
        <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-700">
          {work.work}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-md border border-accent/30 bg-accent-soft/50 px-4 py-3 ${className}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="eyebrow text-accent-strong">{title}</p>
        <InfoTip label="About this work description">
          Plain-English summary of the work this subcontractor would perform.
          Use it on calls and in replies — you should not need the full
          solicitation in front of you.
          {!work.tradeSpecific &&
            " This is the overall job scope; a trade-specific summary was not available yet."}
        </InfoTip>
      </div>
      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-800">
        {work.work}
      </p>
      {work.trade && !work.tradeSpecific && (
        <p className="mt-2 text-xs text-slate-500">
          Focus the conversation on the <span className="font-medium">{work.trade}</span>{" "}
          portion of this job.
        </p>
      )}
    </div>
  );
}
