/**
 * What a reliability score is made of.
 *
 * The roster showed a number out of a hundred with nothing behind it. A score
 * nobody can explain is a score nobody can argue with, which sounds like an
 * advantage until an operator disagrees with it and has no way to check
 * whether the system or their memory is wrong. Worse, it is not obvious from
 * the number alone that most of it is measuring how fast somebody answers
 * email, which is a real signal about a subcontractor and not the same thing
 * as whether they do good work.
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
  blacklisted: boolean;
}

export interface ScoreComponent {
  label: string;
  /** Points this contributes, rounded the way the total is. */
  points: number;
  /** What it is measuring, in a sentence. */
  detail: string;
}

export interface ReliabilityBreakdown {
  /** 0-100. */
  reliability: number;
  /** 0-100. */
  responsiveness: number;
  components: ScoreComponent[];
  /**
   * True when there is no outreach and no quote on record, so responsiveness
   * is a placeholder rather than a measurement.
   */
  responsivenessIsAssumed: boolean;
  /** One line saying what the number is and is not. */
  caveat: string;
}

/**
 * How fast they answer, out of a hundred.
 *
 * Weighted heavily toward answering within two days, because on a bid with a
 * quote deadline an answer next week is not an answer. With no outreach on
 * record there is nothing to measure, so it returns a placeholder and the
 * caller is told that is what it is.
 */
export function responsivenessScore(i: ReliabilityInputs): {
  score: number;
  assumed: boolean;
} {
  if (i.outreach === 0) {
    return { score: i.quotes > 0 ? 60 : 50, assumed: true };
  }
  const fast = i.respondedWithin48h / i.outreach;
  const any = i.respondedEver / i.outreach;
  return { score: Math.round(Math.min(100, fast * 80 + any * 20)), assumed: false };
}

/**
 * The reliability score, and the parts it is made of.
 *
 * Deliberately the same arithmetic the learning loop writes to the column, in
 * one place. The components add up to the total exactly, because a breakdown
 * whose parts do not sum to the number above them is worse than no breakdown:
 * it looks like an explanation and is a contradiction.
 */
export function reliabilityBreakdown(i: ReliabilityInputs): ReliabilityBreakdown {
  const resp = responsivenessScore(i);

  if (i.blacklisted) {
    return {
      reliability: 0,
      responsiveness: resp.score,
      components: [
        {
          label: "Marked do not use",
          points: 0,
          detail: "Somebody blocked this subcontractor. Nothing else is counted while that stands.",
        },
      ],
      responsivenessIsAssumed: resp.assumed,
      caveat: "Zero here is a decision somebody made, not a measurement.",
    };
  }

  const base = 30;
  const quoteBonus = i.quotes > 0 ? 40 : 0;
  const fromResponsiveness = Math.round(resp.score * 0.3);
  const total = Math.min(100, base + quoteBonus + fromResponsiveness);

  const components: ScoreComponent[] = [
    {
      label: "On the roster",
      points: base,
      detail: "Everyone not blocked starts here.",
    },
    {
      label: i.quotes > 0 ? `Has quoted (${i.quotes})` : "Has never quoted",
      points: quoteBonus,
      detail:
        i.quotes > 0
          ? "They have priced work for you, which is the strongest signal on this list."
          : "No quote on record. This is the largest single thing missing from the score.",
    },
    {
      label: `Answers email (${resp.score}/100)`,
      points: fromResponsiveness,
      detail: resp.assumed
        ? "No outreach on record, so this is a placeholder rather than a measurement."
        : `${i.respondedWithin48h} of ${i.outreach} answered within two days, ${i.respondedEver} answered at all.`,
    },
  ];

  /*
   * The parts always sum to the total exactly, and the ceiling is reachable:
   * 30 + 40 + 30 is 100, so a firm that has quoted and always answers within
   * two days scores full marks and nothing is ever clipped. That is worth
   * knowing because it means the breakdown can be read as arithmetic rather
   * than as an approximation of one.
   */
  return {
    reliability: total,
    responsiveness: resp.score,
    components,
    responsivenessIsAssumed: resp.assumed,
    caveat: "Measures how they deal with you, not the quality of their work on site.",
  };
}

/** Whether a subcontractor is preferred, recomputed rather than latched. */
export function isPreferred(i: ReliabilityInputs): boolean {
  return !i.blacklisted && reliabilityBreakdown(i).reliability >= 80;
}
