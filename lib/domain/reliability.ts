/**
 * What a reliability score is made of, and what it is not made of.
 *
 * The roster showed a number out of a hundred with nothing behind it. A score
 * nobody can explain is a score nobody can argue with, which sounds like an
 * advantage until an operator disagrees with it and has no way to check
 * whether the system or their memory is wrong.
 *
 * Two things changed here, and the second matters more than the first.
 *
 * The first is breadth: the number now covers six things rather than two.
 * Whether they answer, whether they quote, whether the quote arrives by the
 * date they were given, whether it covers the work that was asked for, how the
 * job went when they got it, and how often they have backed out.
 *
 * The second is that a dimension with no evidence behind it scores nothing at
 * all rather than a placeholder. A firm added to the roster this morning has
 * not "scored 50 for responsiveness": nobody has emailed them. The whole score
 * comes back null in that case, because a number derived from no observations
 * is not a low score, it is not a score. That is the same rule the rest of the
 * product follows about zero and unknown, applied to the one figure that
 * decides which subcontractors get approached first.
 *
 * The arithmetic lives here rather than in the agent that writes the column,
 * so the breakdown shown to a person and the number stored in the row cannot
 * disagree. The agent calls this too.
 *
 * Pure.
 */

export interface ReliabilityInputs {
  /** Outbound emails sent to this subcontractor. */
  outreach: number;
  /** Of those, how many were answered within 48 hours. */
  respondedWithin48h: number;
  /** Of those, how many were answered at all. */
  respondedEver: number;
  /** Quotes they have actually given. */
  quotes: number;
  /**
   * Quotes given against a stated quote deadline.
   *
   * Only quotes where the subcontractor was actually told a date count: a
   * price that arrived "late" against a deadline nobody sent them is not a
   * fact about the subcontractor.
   */
  quotesWithDeadline?: number;
  /** Of those, how many arrived by it. */
  quotesOnTime?: number;
  /** Quotes that were checked against the scope that was asked for. */
  quotesScopeJudged?: number;
  /** Of those, how many covered the whole of it. */
  quotesFullScope?: number;
  /** Jobs they were given and finished. */
  jobsCompleted?: number;
  /** Of those, how many had a problem somebody recorded. */
  jobsWithIssues?: number;
  /** Times they committed to work and then backed out. */
  cancellations?: number;
  blacklisted: boolean;
}

/** The six things the score is made of, in a fixed order. */
export const RELIABILITY_DIMENSIONS = [
  "response",
  "quoting",
  "timeliness",
  "scope",
  "performance",
  "cancellations",
] as const;

export type ReliabilityDimension = (typeof RELIABILITY_DIMENSIONS)[number];

export interface DimensionScore {
  key: ReliabilityDimension;
  label: string;
  /**
   * 0 to 100, or null when there is nothing to measure it from.
   *
   * Null is the important value. It is not a zero, it is not a fifty, and a
   * screen that renders it as either is telling somebody a firm was judged on
   * something nobody has observed.
   */
  score: number | null;
  /** How much of the total this carries when it is measured. */
  weight: number;
  /** What it is measuring, or what would make it measurable. */
  detail: string;
}

/** How much evidence the whole score rests on. */
export type EvidenceLevel = "none" | "thin" | "some" | "solid";

export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  none: "Nothing recorded yet",
  thin: "Based on very little",
  some: "Based on a few dealings",
  solid: "Based on a real history",
};

export interface ReliabilityBreakdown {
  /** 0-100, or null when nothing has been observed. Never a placeholder. */
  reliability: number | null;
  /** 0-100, or null when nobody has emailed them. */
  responsiveness: number | null;
  dimensions: DimensionScore[];
  /** The dimensions with something behind them. */
  measured: ReliabilityDimension[];
  /** The dimensions with nothing behind them, and what would fill them. */
  unmeasured: ReliabilityDimension[];
  evidence: EvidenceLevel;
  /** How many separate dealings the score rests on. */
  evidenceCount: number;
  /** One line saying what the number is and is not. */
  caveat: string;
}

const WEIGHTS: Record<ReliabilityDimension, number> = {
  response: 25,
  quoting: 20,
  timeliness: 15,
  scope: 15,
  performance: 25,
  // Not a weighted dimension: a deduction. Backing out of committed work is
  // not something a good record elsewhere should average away.
  cancellations: 0,
};

/** Each cancellation costs this much, up to the cap below it. */
const CANCELLATION_COST = 15;
const CANCELLATION_CAP = 45;

function pct(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round(Math.min(100, Math.max(0, (part / whole) * 100)));
}

/**
 * How fast they answer, out of a hundred.
 *
 * Weighted heavily toward answering within two days, because on a bid with a
 * quote deadline an answer next week is not an answer.
 *
 * Null with no outreach on record. The previous version returned 50, or 60 if
 * they had quoted, which put a made-up number into a column operators sort by.
 */
export function responsivenessScore(i: ReliabilityInputs): number | null {
  if (i.outreach <= 0) return null;
  const fast = i.respondedWithin48h / i.outreach;
  const any = i.respondedEver / i.outreach;
  return Math.round(Math.min(100, fast * 80 + any * 20));
}

/**
 * The reliability score, and the parts it is made of.
 *
 * The measured dimensions are averaged by weight and rescaled over the weight
 * that was actually measured, so a firm with no award history is not held to a
 * ceiling it cannot reach. What it costs instead is stated plainly: the
 * evidence band says the number rests on less.
 */
export function reliabilityBreakdown(i: ReliabilityInputs): ReliabilityBreakdown {
  const dims = dimensionsFor(i);
  const evidenceCount =
    i.outreach + i.quotes + (i.jobsCompleted ?? 0) + (i.cancellations ?? 0);
  const evidence: EvidenceLevel =
    evidenceCount === 0 ? "none" : evidenceCount < 3 ? "thin" : evidenceCount < 10 ? "some" : "solid";

  if (i.blacklisted) {
    return {
      /*
       * Zero, not null, and the caveat says why. This is the one case where a
       * number with no measurement behind it is honest: somebody decided it,
       * and a decision is a fact about the record even when the evidence is
       * empty.
       */
      reliability: 0,
      responsiveness: responsivenessScore(i),
      dimensions: dims,
      measured: [],
      unmeasured: [...RELIABILITY_DIMENSIONS],
      evidence,
      evidenceCount,
      caveat: "Zero here is a decision somebody made, not a measurement.",
    };
  }

  const measured = dims.filter((d) => d.score != null && d.weight > 0);
  const measuredWeight = measured.reduce((a, d) => a + d.weight, 0);

  if (measuredWeight === 0) {
    return {
      // No observations, so no score. Not a low one.
      reliability: null,
      responsiveness: responsivenessScore(i),
      dimensions: dims,
      measured: [],
      unmeasured: [...RELIABILITY_DIMENSIONS],
      evidence,
      evidenceCount,
      caveat:
        "Nothing has been recorded about this firm yet, so there is no score. That is not the same as a bad one.",
    };
  }

  const weighted = measured.reduce((a, d) => a + d.weight * (d.score ?? 0), 0) / measuredWeight;
  const penalty = Math.min(CANCELLATION_CAP, (i.cancellations ?? 0) * CANCELLATION_COST);
  const reliability = Math.max(0, Math.min(100, Math.round(weighted - penalty)));

  return {
    reliability,
    responsiveness: responsivenessScore(i),
    dimensions: dims,
    measured: measured.map((d) => d.key),
    unmeasured: dims.filter((d) => d.score == null).map((d) => d.key),
    evidence,
    evidenceCount,
    caveat:
      evidenceCount < 3
        ? "This rests on one or two dealings. Treat it as a first impression rather than a record."
        : "Measures how they deal with you and how the work went, not anything a site visit would tell you.",
  };
}

function dimensionsFor(i: ReliabilityInputs): DimensionScore[] {
  const resp = responsivenessScore(i);

  const withDeadline = i.quotesWithDeadline ?? 0;
  const onTime = i.quotesOnTime ?? 0;
  const judged = i.quotesScopeJudged ?? 0;
  const full = i.quotesFullScope ?? 0;
  const jobs = i.jobsCompleted ?? 0;
  const issues = i.jobsWithIssues ?? 0;
  const cancels = i.cancellations ?? 0;

  /*
   * "Never quoted" is only a measurement once there was something to quote.
   * A firm nobody has approached has not failed to quote, and scoring them
   * zero for it would rank a stranger below somebody who declined.
   */
  const quotingMeasurable = i.outreach > 0 || i.quotes > 0;

  return [
    {
      key: "response",
      label: "Answers you",
      score: resp,
      weight: WEIGHTS.response,
      detail:
        resp == null
          ? "Nobody has emailed them yet, so there is nothing to measure."
          : `${i.respondedWithin48h} of ${i.outreach} answered within two days, ${i.respondedEver} answered at all.`,
    },
    {
      key: "quoting",
      label: "Gives you prices",
      score: quotingMeasurable ? (i.quotes > 0 ? 100 : 0) : null,
      weight: WEIGHTS.quoting,
      detail: !quotingMeasurable
        ? "They have never been asked for a price, so this says nothing yet."
        : i.quotes > 0
          ? `${i.quotes} ${i.quotes === 1 ? "quote" : "quotes"} on record.`
          : "Asked for a price and has not given one.",
    },
    {
      key: "timeliness",
      label: "Quotes by the date given",
      score: withDeadline > 0 ? pct(onTime, withDeadline) : null,
      weight: WEIGHTS.timeliness,
      detail:
        withDeadline > 0
          ? `${onTime} of ${withDeadline} arrived by the date they were given.`
          : "No quote has been asked for against a stated date, so lateness cannot be judged.",
    },
    {
      key: "scope",
      label: "Quotes the whole scope",
      score: judged > 0 ? pct(full, judged) : null,
      weight: WEIGHTS.scope,
      detail:
        judged > 0
          ? `${full} of ${judged} covered everything that was asked for.`
          : "No quote from them has been checked against the scope yet.",
    },
    {
      key: "performance",
      label: "How the work went",
      score: jobs > 0 ? pct(jobs - issues, jobs) : null,
      weight: WEIGHTS.performance,
      detail:
        jobs > 0
          ? `${jobs - issues} of ${jobs} finished with nothing recorded against them.`
          : "They have not been given work through here, so nothing is known about how they perform.",
    },
    {
      key: "cancellations",
      label: "Backing out",
      /*
       * Not a weighted dimension. A firm that has walked off two committed
       * jobs does not deserve to have that averaged away by a good email
       * habit, so it comes off the total instead.
       */
      score: cancels > 0 ? 0 : null,
      weight: WEIGHTS.cancellations,
      detail:
        cancels > 0
          ? `Backed out ${cancels} ${cancels === 1 ? "time" : "times"} after committing. That takes ${Math.min(CANCELLATION_CAP, cancels * CANCELLATION_COST)} points off the total.`
          : "Nothing recorded. This only counts what somebody wrote down.",
    },
  ];
}

/**
 * Whether a subcontractor is preferred, recomputed rather than latched.
 *
 * Now requires evidence as well as a high score. A firm with one answered
 * email used to reach the threshold on a placeholder responsiveness figure and
 * be promoted ahead of firms with years of history, which is precisely
 * backwards.
 */
export function isPreferred(i: ReliabilityInputs): boolean {
  if (i.blacklisted) return false;
  const b = reliabilityBreakdown(i);
  return b.reliability != null && b.reliability >= 80 && b.evidenceCount >= 3;
}

/** What to show where a score would go, when there is not one. */
export const NO_RELIABILITY_LABEL = "Not enough history to score";
