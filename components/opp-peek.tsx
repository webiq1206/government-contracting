import Link from "next/link";
import { DetailDrawer, DrawerFact, DrawerSection } from "@/components/detail-drawer";
import { stageLabel } from "@/lib/domain/journey";
import { shortDate } from "@/lib/format";
import { VALUE_BASIS_TERMS, type ValueBasis } from "@/lib/domain/terminology";
import type { DataConfidence } from "@/lib/domain/score-confidence";
import type { OppPeek as OppPeekData } from "@/lib/data";

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function money(v: unknown): string | null {
  const n = num(v);
  if (n == null) return null;
  return `$${Math.round(n).toLocaleString()}`;
}

/*
 * The value basis, from the column that records where the number came from.
 * A figure stated in the solicitation and one modelled from comparable awards
 * are different kinds of thing, and pricing a bid off the second while
 * believing it is the first is how a margin disappears.
 */
function basisOf(source: unknown): ValueBasis | null {
  const s = str(source).toLowerCase();
  if (s === "solicitation" || s === "attachment" || s === "analysis") return "known";
  if (s === "comps" || s === "modeled" || s === "model") return "modeled";
  if (s === "operator" || s === "manual") return "estimated";
  return null;
}

function daysTo(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/**
 * A quick read on one opportunity, without leaving the table.
 *
 * Fit and confidence stay two numbers, never averaged into one. They answer
 * different questions -- is this worth chasing, and do we know enough to say
 * -- and an account with thin data would otherwise read as an account with
 * bad opportunities.
 */
export function OppPeek({
  data,
  closeHref,
}: {
  data: OppPeekData;
  closeHref: string;
}) {
  const o = data.opp;
  const deadline = str(o.deadline) || null;
  const days = deadline ? daysTo(deadline) : null;
  const fit = num(o.score);
  /*
   * Confidence is a stored object, not a column. It lives inside the analysis
   * because it describes how much of the solicitation could be read, which is
   * a property of the reading rather than of the opportunity.
   */
  const analysis = o.solicitation_analysis as { data_confidence?: DataConfidence } | null;
  const confidence = analysis?.data_confidence ?? null;
  const risks = Array.isArray(o.risk_flags) ? (o.risk_flags as string[]) : [];

  const coverage =
    data.tradesRequired === 0
      ? null
      : `${data.tradesCovered} of ${data.tradesRequired} trade${data.tradesRequired === 1 ? "" : "s"} quoted`;

  return (
    <DetailDrawer
      title={str(o.title) || "Untitled opportunity"}
      subtitle={str(o.agency) || null}
      closeHref={closeHref}
      openHref={`/opportunity/${str(o.id)}`}
      openLabel="Open the workspace"
    >
      <DrawerSection title="Where it stands">
        <DrawerFact label="Stage" value={stageLabel(str(o.stage))} />
        <DrawerFact
          label="Deadline"
          value={
            deadline ? (
              <span className={days != null && days < 3 ? "text-risk" : undefined}>
                {shortDate(deadline)}
                {days != null && ` · ${days < 0 ? `${Math.abs(days)}d past` : `${days}d left`}`}
              </span>
            ) : null
          }
          unknown="No deadline on the solicitation"
          hint={deadline ? "Government submission deadline." : undefined}
        />
        <DrawerFact
          label="Solicitation"
          value={str(o.solicitation_number) || null}
          unknown="No number recorded"
        />
      </DrawerSection>

      <DrawerSection title="Whether to chase it">
        {/*
          * Two numbers, deliberately. Fit is how good this looks; confidence
          * is how much of the solicitation was actually readable. Averaging
          * them makes a well-fitting job with a scanned PDF indistinguishable
          * from a poor one that parsed cleanly.
          */}
        <DrawerFact
          label="Fit"
          value={fit != null ? `${Math.round(fit)} / 100` : null}
          unknown="Not scored yet"
          hint="How well this matches what the company does."
        />
        <DrawerFact
          label="Data confidence"
          value={
            confidence
              ? `${Math.round(confidence.percent)} / 100 (${confidence.level})`
              : null
          }
          unknown="Not assessed yet"
          hint={
            confidence?.unknown?.length
              ? `Still missing: ${confidence.unknown.slice(0, 3).join(", ")}.`
              : "How much of the solicitation could actually be read."
          }
        />
        <DrawerFact
          label="Value"
          value={money(o.value_estimated)}
          unknown="Not stated in the solicitation"
          hint={
            basisOf(o.value_estimated_source)
              ? VALUE_BASIS_TERMS[basisOf(o.value_estimated_source)!].description
              : money(o.value_estimated)
                ? "Where this figure came from is not recorded."
                : undefined
          }
        />
      </DrawerSection>

      <DrawerSection title="Coverage">
        <DrawerFact
          label="Trades"
          value={coverage}
          unknown="No required trades identified yet, so coverage cannot be measured"
        />
        <DrawerFact
          label="Subcontractors contacted"
          value={data.subsContacted > 0 ? `${data.subsContacted} contacted, ${data.subsResponded} answered` : null}
          unknown="None contacted yet"
        />
        <DrawerFact
          label="Quotes in"
          value={data.quoteCount > 0 ? String(data.quoteCount) : null}
          unknown="None yet"
        />
      </DrawerSection>

      {risks.length > 0 && (
        <DrawerSection title="Flagged">
          <DrawerFact
            label="Risks"
            value={
              <span className="flex flex-wrap gap-1">
                {risks.map((r) => (
                  <span key={r} className="badge bg-risk/15 text-risk">
                    {r.replace(/_/g, " ")}
                  </span>
                ))}
              </span>
            }
          />
        </DrawerSection>
      )}

      <DrawerSection title="Outcome">
        <DrawerFact
          label="Bid"
          value={
            data.outcome
              ? data.outcome
              : data.bidSubmitted
                ? "Submitted, no outcome recorded"
                : null
          }
          unknown="Not submitted"
        />
      </DrawerSection>

      <Link
        href={`/communications?q=${encodeURIComponent(str(o.title).slice(0, 40))}`}
        className="btn-ghost inline-flex text-xs"
      >
        See the conversations
      </Link>
    </DetailDrawer>
  );
}
