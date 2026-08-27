/**
 * What a rule change would do to the records that exist right now.
 *
 * Every setting on the Automation Rules page is a standing instruction to
 * software that acts without being asked again. Changing one is not like
 * changing a preference: "minimum days between arrival and the deadline" going
 * from 3 to 7 does not merely apply to tomorrow's notices, it decides what
 * happens to the ones already on the board tonight.
 *
 * Nothing said so. The form saved, and the consequence arrived hours later as
 * records quietly leaving the pipeline. So a change is now costed against the
 * live account before it is saved, in records rather than in settings.
 *
 * Pure. The caller counts; this decides what the counts mean.
 */

import type { AutomationRules } from "./intake";

export interface RuleFacts {
  /** Open opportunities whose lead time is under the proposed minimum. */
  belowProposedLead: number;
  /** Open opportunities whose lead time was under the current minimum. */
  belowCurrentLead: number;
  /** Open opportunities with a deadline, for colour-band arithmetic. */
  datedOpen: number;
  /** Open opportunities inside the proposed amber band. */
  withinProposedApproaching: number;
  /** Open opportunities inside the proposed red band. */
  withinProposedUrgent: number;
  /** Archived records older than the proposed retention window. */
  archivedBeyondProposed: number;
  /** Archived records older than the current retention window. */
  archivedBeyondCurrent: number;
  /** Conversations with a follow-up already scheduled. */
  followUpsScheduled: number;
  /** Subcontractors that have already had at least the proposed number of follow-ups. */
  atProposedFollowUpCap: number;
  /** Call cards waiting to be worked. */
  callsPending: number;
  /** Review-tier opportunities with no decision recorded. */
  reviewUndecided: number;
}

export type ImpactSeverity = "removes" | "changes" | "none";

export interface RuleImpact {
  key: string;
  /** What the change does, in records. */
  summary: string;
  /** How many records it touches, or null when the answer is not a count. */
  affected: number | null;
  severity: ImpactSeverity;
  /**
   * True when the effect cannot be undone by changing the setting back.
   *
   * The distinction that matters most on this page: a colour band is a display
   * decision and reversible; a retention window deletes records, and putting
   * the number back does not bring them.
   */
  irreversible: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ruleImpacts(
  before: AutomationRules,
  after: AutomationRules,
  facts: RuleFacts
): RuleImpact[] {
  const out: RuleImpact[] = [];

  if (after.min_lead_days !== before.min_lead_days) {
    const newlyFailing = Math.max(0, facts.belowProposedLead - facts.belowCurrentLead);
    const tighter = after.min_lead_days > before.min_lead_days;
    out.push({
      key: "min_lead_days",
      summary: tighter
        ? newlyFailing === 0
          ? "Nothing currently open would newly fail the lead-time rule."
          : after.lead_action === "dismiss"
            ? `${plural(newlyFailing, "open opportunity is", "open opportunities are")} too close to the deadline under the new rule and would be passed on automatically.`
            : `${plural(newlyFailing, "open opportunity is", "open opportunities are")} too close to the deadline under the new rule and would be sent to review instead.`
        : "Loosening this does not bring back anything already passed on. It applies to what arrives from now on.",
      affected: tighter ? newlyFailing : null,
      /*
       * Only dismissal removes. Sending an opportunity to review moves it to
       * a queue somebody reads; treating that as a removal made the page ask
       * for confirmation over a change that takes nothing away, and a
       * confirmation people learn to click through is worse than none.
       */
      severity:
        tighter && newlyFailing > 0 && after.lead_action === "dismiss" ? "removes" : "changes",
      /*
       * Dismissal is reversible in the record and not in the calendar: an
       * opportunity passed on tonight can be reopened tomorrow, by which time
       * the deadline it was too close to may have gone.
       */
      irreversible: tighter && after.lead_action === "dismiss" && newlyFailing > 0,
    });
  }

  if (
    after.approaching_days !== before.approaching_days ||
    after.urgent_days !== before.urgent_days
  ) {
    out.push({
      key: "deadline_bands",
      summary:
        facts.datedOpen === 0
          ? "Nothing open has a deadline, so no card changes colour."
          : `${plural(facts.withinProposedUrgent, "open opportunity", "open opportunities")} would show red and ${facts.withinProposedApproaching} amber, out of ${facts.datedOpen} with a deadline.`,
      affected: facts.withinProposedUrgent + facts.withinProposedApproaching,
      // Colour only. Nothing is removed and nothing is sent.
      severity: "changes",
      irreversible: false,
    });
  }

  if (after.retention_days !== before.retention_days) {
    const newlyEligible = Math.max(
      0,
      facts.archivedBeyondProposed - facts.archivedBeyondCurrent
    );
    const shorter =
      after.retention_days > 0 &&
      (before.retention_days === 0 || after.retention_days < before.retention_days);
    out.push({
      key: "retention_days",
      summary: shorter
        ? newlyEligible === 0
          ? "No archived record is old enough for the new window to reach it yet."
          : `${plural(newlyEligible, "archived record becomes", "archived records become")} eligible for permanent deletion at the next sweep. Records with a bid or a contract are never deleted.`
        : "Keeping records longer removes nothing. Anything already deleted stays deleted.",
      affected: shorter ? newlyEligible : null,
      severity: shorter && newlyEligible > 0 ? "removes" : "changes",
      /*
       * The one setting on this page that destroys data. Putting the number
       * back does not bring the records back, and that has to be said before
       * the save rather than in a log afterwards.
       */
      irreversible: shorter && newlyEligible > 0,
    });
  }

  if (after.calls_enabled !== before.calls_enabled) {
    out.push({
      key: "calls_enabled",
      summary: after.calls_enabled
        ? "The call step returns to the pipeline. Opportunities already past it are not sent back."
        : facts.callsPending === 0
          ? "No call is waiting, so nothing is dropped. New opportunities will skip the call step."
          : `${plural(facts.callsPending, "call waiting to be made is", "calls waiting to be made are")} cleared, and their opportunities advance on the email alone.`,
      affected: after.calls_enabled ? null : facts.callsPending,
      severity: !after.calls_enabled && facts.callsPending > 0 ? "removes" : "changes",
      irreversible: false,
    });
  }

  if (after.followup_hours !== before.followup_hours) {
    out.push({
      key: "followup_hours",
      summary:
        facts.followUpsScheduled === 0
          ? "No follow-up is scheduled, so nothing moves."
          : `${plural(facts.followUpsScheduled, "scheduled follow-up is", "scheduled follow-ups are")} already booked at the old interval and keep their time. The new interval applies to the next send.`,
      affected: facts.followUpsScheduled,
      severity: "changes",
      irreversible: false,
    });
  }

  if (after.followup_max !== before.followup_max) {
    const fewer = after.followup_max < before.followup_max;
    out.push({
      key: "followup_max",
      summary: fewer
        ? facts.atProposedFollowUpCap === 0
          ? "No subcontractor has had that many follow-ups yet."
          : `${plural(facts.atProposedFollowUpCap, "subcontractor has", "subcontractors have")} already had this many and will get no more on their current opportunity.`
        : "Raising the cap does not resend anything. It allows more from the next run.",
      affected: fewer ? facts.atProposedFollowUpCap : null,
      severity: "changes",
      irreversible: false,
    });
  }

  if (after.auto_dismiss_review !== before.auto_dismiss_review) {
    out.push({
      key: "auto_dismiss_review",
      summary: after.auto_dismiss_review
        ? facts.reviewUndecided === 0
          ? "Nothing is sitting in review, so nothing expires."
          : `${plural(facts.reviewUndecided, "opportunity waiting on a decision becomes", "opportunities waiting on a decision become")} subject to the timer. Each is warned before it expires.`
        : "The timer stops. Anything waiting on a decision stays there until somebody decides.",
      affected: after.auto_dismiss_review ? facts.reviewUndecided : null,
      severity: after.auto_dismiss_review && facts.reviewUndecided > 0 ? "removes" : "changes",
      irreversible: false,
    });
  }

  if (
    after.call_hours_start !== before.call_hours_start ||
    after.call_hours_end !== before.call_hours_end
  ) {
    out.push({
      key: "call_hours",
      summary: `Calls are only offered between ${after.call_hours_start}:00 and ${after.call_hours_end}:00 in the subcontractor's own timezone. Cards outside the window wait rather than disappear.`,
      affected: facts.callsPending,
      severity: "changes",
      irreversible: false,
    });
  }

  return out;
}

/**
 * Whether a change needs a deliberate confirmation rather than a save button.
 *
 * Reserved for the changes that remove records. Asking twice for a colour band
 * teaches people to click through the question, and then the one that mattered
 * gets clicked through too.
 */
export function needsConfirmation(impacts: RuleImpact[]): boolean {
  return impacts.some((i) => i.irreversible || (i.severity === "removes" && (i.affected ?? 0) > 0));
}
