/**
 * Competitive-landscape read, a pure summary of who wins a NAICS + state and
 * how crowded the field is, derived from aggregated pricing_comps. Kept here
 * (and unit-tested) so the plain-English call the operator sees is deterministic
 * and independent of rendering.
 */

export interface CompetitorAggregate {
  recipient_name: string;
  award_count: number;
  median_adj: number;
  is_incumbent: boolean;
}

export type FieldTone = "risk" | "open" | "neutral";

export interface CompetitionRead {
  firmCount: number;
  totalAwards: number;
  /** Share of awards held by the three most frequent winners (0..1). */
  top3Share: number;
  label: string;
  note: string;
  tone: FieldTone;
}

/**
 * Classify the competitive field. Concentration is measured as the share of
 * recent awards captured by the top three firms:
 *   - ≥70%  → concentrated (incumbent-heavy, price sharply)
 *   - ≤45% and ≥6 firms → fragmented (open field, room to break in)
 *   - otherwise → moderately competitive
 */
export function competitionRead(competitors: CompetitorAggregate[]): CompetitionRead {
  const firmCount = competitors.length;
  const totalAwards = competitors.reduce((sum, c) => sum + c.award_count, 0);
  const top3Awards = competitors
    .slice(0, 3)
    .reduce((sum, c) => sum + c.award_count, 0);
  const top3Share = totalAwards > 0 ? top3Awards / totalAwards : 0;

  if (top3Share >= 0.7) {
    return {
      firmCount,
      totalAwards,
      top3Share,
      label: "Concentrated field",
      note: "A few firms win most of this work. Expect an incumbent advantage, price sharply.",
      tone: "risk",
    };
  }
  if (top3Share <= 0.45 && firmCount >= 6) {
    return {
      firmCount,
      totalAwards,
      top3Share,
      label: "Fragmented field",
      note: "Wins are spread across many firms, no one dominates, so there's real room to break in.",
      tone: "open",
    };
  }
  return {
    firmCount,
    totalAwards,
    top3Share,
    label: "Moderately competitive",
    note: "A handful of firms win regularly, but the field is open to a strong, well-priced bid.",
    tone: "neutral",
  };
}

/**
 * A short competitive-positioning brief for the proposal narrative generator.
 * It tells the writer *what to emphasize* given the shape of the field, and
 * deliberately does NOT surface competitor names or invite comparative claims,
 * naming or disparaging a competitor in a government proposal is a real risk,
 * and every fact in the narrative must still come only from the team's own
 * history. Returns null when there is no award history to reason from, in which
 * case the narrative prompt is unchanged from its baseline.
 */
export function competitivePositioningBrief(
  competitors: CompetitorAggregate[],
  opts: { isRecompete?: boolean } = {}
): string | null {
  if (!competitors || competitors.length === 0) return null;

  const read = competitionRead(competitors);
  const isRecompete = opts.isRecompete ?? competitors.some((c) => c.is_incumbent);

  const lines: string[] = [
    "COMPETITIVE CONTEXT (use ONLY to decide what to emphasize; do NOT name any competitor or make comparative/negative claims about other firms, and do NOT introduce any fact not present in the project history below):",
  ];

  if (isRecompete) {
    lines.push(
      "- This is a recompete with an incumbent already performing the work. Give the evaluator a concrete reason to switch: lead with the most directly relevant, verifiable experience and stress reliability and on-time delivery."
    );
  }

  if (read.tone === "risk") {
    lines.push(
      "- The field is concentrated (a few firms win most awards). Differentiate hard on depth of directly relevant, recent experience, do not read as a generic capabilities statement."
    );
  } else if (read.tone === "open") {
    lines.push(
      "- The field is fragmented (wins spread across many firms). Stand out on the breadth of trades the team self-performs and a track record of successful delivery."
    );
  } else {
    lines.push(
      "- The field is moderately competitive. Emphasize the strongest, most relevant projects and a credible, low-risk delivery approach."
    );
  }

  return lines.join("\n");
}
