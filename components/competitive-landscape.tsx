import { currency, shortDate } from "@/lib/format";
import { competitionRead, type FieldTone } from "@/lib/domain/competition";
import type { CompetitorRow } from "@/lib/data";

/** Field-intensity tone → the app's semantic text color. */
const TONE_CLASS: Record<FieldTone, string> = {
  risk: "text-risk",
  open: "text-pursue",
  neutral: "text-slate-600",
};

/** The incumbent block folded into raw_json.pricing_summary by Pricing Research. */
interface IncumbentInfo {
  recipient_name?: string;
  last_award_amount?: number;
  last_action_date?: string;
}

/**
 * Competitive Landscape, a plain-English read on who wins this kind of work.
 * Built entirely from the CPI-adjusted pricing_comps the Pricing Research agent
 * already gathered (NAICS + place of performance), so it needs no new data and
 * appears on every opportunity that has been priced. It answers three questions
 * an operator asks before bidding: is this a recompete, who are the repeat
 * winners, and how crowded is the field.
 */
export function CompetitiveLandscape({
  competitors,
  pricing,
}: {
  competitors: CompetitorRow[];
  pricing?: Record<string, unknown> | null;
}) {
  // Nothing to say until comps exist; render nothing rather than an empty card.
  if (!competitors || competitors.length === 0) return null;

  const read = competitionRead(competitors);
  const { firmCount, top3Share } = read;

  const isRecompete = Boolean(pricing?.is_recompete);
  const incumbent = (pricing?.incumbent as IncumbentInfo | null) ?? null;

  const topFirms = competitors.slice(0, 6);

  return (
    <div className="card text-sm">
      <p className="eyebrow mb-3">
        Competitive landscape · <span className="num">{firmCount}</span>{" "}
        {firmCount === 1 ? "firm" : "firms"}
      </p>

      {/* Recompete / incumbent headline, the single most useful fact here. */}
      {isRecompete && incumbent?.recipient_name && (
        <div className="mb-3 rounded-md border border-review/40 bg-review/5 px-3 py-2.5">
          <p className="label text-review">Recompete · current holder</p>
          <p className="mt-0.5 font-medium text-slate-800">{incumbent.recipient_name}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Last award{" "}
            {incumbent.last_award_amount != null && incumbent.last_award_amount > 0
              ? currency(incumbent.last_award_amount)
              : "amount unlisted"}
            {incumbent.last_action_date ? ` · ${shortDate(incumbent.last_action_date)}` : ""}. Beating
            an incumbent usually takes a sharper price or a clear discriminator.
          </p>
        </div>
      )}

      {/* Repeat winners, ranked by how often they win this NAICS + state. */}
      <p className="label mb-1.5">Who wins this work</p>
      <ul className="divide-y divide-border">
        {topFirms.map((c) => (
          <li key={c.recipient_name} className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0 truncate text-slate-700">
              {c.recipient_name}
              {c.is_incumbent && (
                <span className="badge ml-1.5 bg-review/15 text-review">incumbent</span>
              )}
            </span>
            <span className="flex shrink-0 items-baseline gap-2 text-xs text-slate-500">
              <span className="num">
                {c.award_count} win{c.award_count === 1 ? "" : "s"}
              </span>
              {c.median_adj > 0 && (
                <span className="num text-slate-500">~{currency(c.median_adj)}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* Plain-English intensity read. */}
      <div className="mt-3 border-t border-border pt-2.5">
        <p className={`text-xs font-medium ${TONE_CLASS[read.tone]}`}>
          {read.label}
          <span className="font-normal text-slate-500">
            {" "}
            · top 3 firms take {Math.round(top3Share * 100)}% of recent awards
          </span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{read.note}</p>
      </div>
    </div>
  );
}
