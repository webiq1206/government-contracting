import { InfoTip } from "@/components/info-tip";
import { ScannableText } from "@/components/scannable-text";
import type { SubWorkDescription } from "@/lib/domain/sub-work";

/**
 * Layperson block: exactly what we need this subcontractor to perform.
 * Used on call workspace, call cards, opportunity coverage/subs, and Today.
 */
/** Past this, the scope gets a "show everything" disclosure instead of a wall. */
const LONG = 420;

/**
 * The whole scope, always reachable.
 *
 * This used to be clamped to three lines inside a card whose text had ALSO
 * been cut to 280 characters upstream, so the operator saw a sentence and a
 * half of the work they were supposed to price, with no way to read the rest.
 * Short scopes render in full; long ones show a preview and open on click.
 * Nothing is silently dropped either way.
 */
function ScopeBody({ text }: { text: string }) {
  if (text.length <= LONG) {
    return <ScannableText text={text} size="xs" className="mt-1 text-slate-700" />;
  }
  const preview = text.slice(0, LONG).replace(/\s+\S*$/, "");
  return (
    <details className="group mt-1">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="group-open:hidden">
          <ScannableText text={`${preview}…`} size="xs" className="text-slate-700" />
        </div>
        <span className="mt-1 inline-block text-[0.7rem] font-medium text-accent-strong underline decoration-accent/40 underline-offset-2">
          <span className="group-open:hidden">Show everything they need to do</span>
          <span className="hidden group-open:inline">Show less</span>
        </span>
      </summary>
      <ScannableText text={text} size="xs" className="mt-1 text-slate-700" />
    </details>
  );
}

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
    ? `What we need them to do: ${work.trade}`
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
        {!work.tradeSpecific && (
          <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">
            This is the overall job scope, not this trade&rsquo;s share of it: the analysis
            has not split the work by trade yet, which is why every trade here reads the
            same. Re-run the analysis to break it out.
          </p>
        )}
        <ScopeBody text={work.work} />
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
          Use it on calls and in replies, you should not need the full
          solicitation in front of you.
          {!work.tradeSpecific &&
            " This is the overall job scope; a trade-specific summary was not available yet."}
        </InfoTip>
      </div>
      <ScannableText text={work.work} className="mt-2 text-slate-800" />
      {work.trade && !work.tradeSpecific && (
        <p className="mt-2 text-xs text-slate-500">
          Focus the conversation on the <span className="font-medium">{work.trade}</span>{" "}
          portion of this job.
        </p>
      )}
    </div>
  );
}
