import { InfoTip } from "@/components/info-tip";
import type { AttentionItem, BidReadiness } from "@/lib/domain/bid-readiness";

/**
 * Attention-first strip for the opportunity page: only what needs a human,
 * plus a one-line bid-readiness summary.
 */
export function AttentionStrip({
  readiness,
}: {
  readiness: BidReadiness;
}) {
  const items = readiness.attention;
  if (items.length === 0 && !readiness.summary) return null;

  return (
    <div id="attention" className="scroll-mt-12 space-y-3">
      <div className="rounded-md border border-border bg-background px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">Bid readiness</p>
          <p className="text-sm text-slate-700">{readiness.summary}</p>
        </div>
      </div>

      {items.length > 0 && (
        <div className="rounded-md border border-review/40 bg-review/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow text-review">What needs your attention</p>
            <InfoTip label="About attention items">
              Only blockers and judgment calls appear here. Everything else is
              automated or already handled.
            </InfoTip>
          </div>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <AttentionRow key={item.key} item={item} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const tone =
    item.severity === "action"
      ? "border-risk/40 bg-background"
      : item.severity === "warn"
        ? "border-review/30 bg-background"
        : "border-border bg-background";
  const body = (
    <div className={`rounded-md border px-3 py-2.5 ${tone}`}>
      <p className="text-sm font-medium text-slate-900">{item.label}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.why}</p>
      {item.href && (
        <span className="mt-1 inline-block text-xs font-medium text-accent">
          Take care of this →
        </span>
      )}
    </div>
  );
  if (item.href) {
    return (
      <li>
        <a href={item.href} className="block transition-opacity hover:opacity-90">
          {body}
        </a>
      </li>
    );
  }
  return <li>{body}</li>;
}
