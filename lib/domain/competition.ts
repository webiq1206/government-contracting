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

export interface CompetitiveVerdict {
  /** What kind of fight this is, in one line. */
  headline: string;
  /** What the numbers mean for whether to bid, in plain sentences. */
  whatItMeans: string;
  /** Where to aim the price, and what else it takes to win. */
  priceGuidance: string;
  tone: FieldTone;
  /** How much weight the read can carry, given how much history there is. */
  confidence: "low" | "medium" | "high";
  confidenceNote: string;
}

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The competitive landscape as an answer rather than a table.
 *
 * The panel already listed who wins this work and how concentrated the field
 * is, but an operator looking at "33 firms, 50 wins, ~$28,531" still has to
 * work out for themselves whether to bid and at what price. This turns the
 * same aggregates into that answer: who you are really up against, what it
 * would take to displace them, and how much the read should be trusted.
 *
 * The incumbent's own numbers do the heavy lifting. On a recompete they are
 * the closest thing to a price for this exact work, which matters most when
 * the surrounding NAICS comps are too dispersed to mean anything.
 */
export function competitiveVerdict(
  competitors: CompetitorAggregate[],
  opts: {
    incumbentName?: string | null;
    incumbentLastAward?: number | null;
    isRecompete?: boolean;
  } = {}
): CompetitiveVerdict | null {
  if (!competitors || competitors.length === 0) return null;

  const read = competitionRead(competitors);
  const { firmCount, totalAwards, top3Share } = read;
  const incumbentRow =
    competitors.find((c) => c.is_incumbent) ??
    (opts.incumbentName
      ? competitors.find((c) => c.recipient_name === opts.incumbentName)
      : undefined);
  const isRecompete = opts.isRecompete ?? Boolean(incumbentRow);
  const incumbentShare =
    incumbentRow && totalAwards > 0 ? incumbentRow.award_count / totalAwards : 0;
  const lastAward = opts.incumbentLastAward ?? null;

  const confidence: CompetitiveVerdict["confidence"] =
    totalAwards >= 25 ? "high" : totalAwards >= 10 ? "medium" : "low";
  const confidenceNote =
    confidence === "high"
      ? `Based on ${totalAwards} awards across ${firmCount} firms.`
      : confidence === "medium"
        ? `Based on only ${totalAwards} awards, so treat this as a rough read.`
        : `Based on just ${totalAwards} award${totalAwards === 1 ? "" : "s"}, which is too little to read the field with confidence.`;

  // The price to beat, in order of how close it is to this actual job.
  const beatNumber =
    lastAward && lastAward > 0
      ? lastAward
      : incumbentRow && incumbentRow.median_adj > 0
        ? incumbentRow.median_adj
        : null;

  if (isRecompete && incumbentRow) {
    const entrenched = incumbentShare >= 0.35;
    const name = incumbentRow.recipient_name;
    return {
      headline: entrenched
        ? `Recompete against an entrenched incumbent: ${name} has won this work ${incumbentRow.award_count} times`
        : `Recompete: ${name} currently holds this work`,
      whatItMeans: entrenched
        ? `The agency already has a provider it keeps going back to, taking ${Math.round(incumbentShare * 100)}% of the awards in this category. You are not just submitting a price, you are asking them to switch, and that is the hardest kind of bid to win.`
        : `${name} holds the work now but does not dominate the category, so the agency changes providers here. A strong, well-priced bid is worth submitting.`,
      priceGuidance: beatNumber
        ? `They have been winning around ${money(beatNumber)}. Come in at or below that, and give one concrete reason to switch: faster response time, more trades self-performed, or better local coverage.`
        : `Their award amounts are not published, so price from your subcontractor quotes and lead with a concrete reason to switch.`,
      tone: entrenched ? "risk" : "neutral",
      confidence,
      confidenceNote,
    };
  }

  if (read.tone === "open") {
    return {
      headline: `Open field: ${firmCount} different firms win this work`,
      whatItMeans: `No single company controls this category, the top three take only ${Math.round(top3Share * 100)}% of awards. The agency spreads this work around, which means a new name is not a strike against you.`,
      priceGuidance:
        "Price it honestly from your quotes rather than trying to undercut anyone, and make sure the submission is complete and on time. That is usually what separates winners in a field this open.",
      tone: "open",
      confidence,
      confidenceNote,
    };
  }

  if (read.tone === "risk") {
    const leaders = competitors.slice(0, 3).map((c) => c.recipient_name);
    return {
      headline: `Concentrated field: three firms take ${Math.round(top3Share * 100)}% of this work`,
      whatItMeans: `${leaders.join(", ")} win most of these awards. There is no incumbent on this particular job, but the agency has habits, and a bid from an unfamiliar name has to be clearly better on paper.`,
      priceGuidance:
        "Be sharp on price and specific about directly relevant past work. A generic capability statement will not move an evaluator who already has firms they trust.",
      tone: "risk",
      confidence,
      confidenceNote,
    };
  }

  return {
    headline: `Moderately competitive: ${firmCount} firms bid this kind of work`,
    whatItMeans: `A handful of firms win regularly, taking ${Math.round(top3Share * 100)}% of awards between them, but the field is not closed. Nobody here is unbeatable.`,
    priceGuidance:
      "A complete, well-priced bid has a real chance. Lead with the most directly comparable work you have done.",
    tone: "neutral",
    confidence,
    confidenceNote,
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
