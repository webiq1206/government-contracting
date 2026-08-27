/**
 * A rule change costed in records before it is saved.
 *
 * Every setting on the Automation Rules page is a standing instruction to
 * software that acts without being asked again. "Minimum days between arrival
 * and the deadline" going from 3 to 7 does not merely apply to tomorrow's
 * notices; it decides what happens to the ones on the board tonight. Nothing
 * said so, and the consequence arrived hours later as records quietly leaving
 * the pipeline.
 */
import { describe, it, expect } from "vitest";
import { ruleImpacts, needsConfirmation, type RuleFacts } from "../lib/domain/rule-impact";
import { DEFAULT_RULES, type AutomationRules } from "../lib/domain/intake";

const rules = (over: Partial<AutomationRules> = {}): AutomationRules => ({
  ...DEFAULT_RULES,
  ...over,
});

const facts = (over: Partial<RuleFacts> = {}): RuleFacts => ({
  belowProposedLead: 0,
  belowCurrentLead: 0,
  datedOpen: 0,
  withinProposedApproaching: 0,
  withinProposedUrgent: 0,
  archivedBeyondProposed: 0,
  archivedBeyondCurrent: 0,
  followUpsScheduled: 0,
  atProposedFollowUpCap: 0,
  callsPending: 0,
  reviewUndecided: 0,
  ...over,
});

const find = (list: ReturnType<typeof ruleImpacts>, key: string) =>
  list.find((i) => i.key === key);

describe("ruleImpacts", () => {
  it("says nothing when nothing changed", () => {
    expect(ruleImpacts(rules(), rules(), facts())).toEqual([]);
  });

  it("counts only what the change newly catches", () => {
    /*
     * The records already failing the old rule are already gone. Counting
     * them again would tell somebody a change costs eleven opportunities when
     * it costs three, and a preview that overstates is one people learn to
     * ignore.
     */
    const list = ruleImpacts(
      rules({ min_lead_days: 3 }),
      rules({ min_lead_days: 7 }),
      facts({ belowCurrentLead: 8, belowProposedLead: 11 })
    );
    expect(find(list, "min_lead_days")?.affected).toBe(3);
  });

  it("names the action the rule will actually take", () => {
    const dismiss = ruleImpacts(
      rules({ min_lead_days: 3, lead_action: "dismiss" }),
      rules({ min_lead_days: 7, lead_action: "dismiss" }),
      facts({ belowProposedLead: 4 })
    );
    expect(find(dismiss, "min_lead_days")?.summary).toContain("passed on automatically");
    const review = ruleImpacts(
      rules({ min_lead_days: 3, lead_action: "review" }),
      rules({ min_lead_days: 7, lead_action: "review" }),
      facts({ belowProposedLead: 4 })
    );
    expect(find(review, "min_lead_days")?.summary).toContain("sent to review");
  });

  it("does not ask for confirmation when the rule only sends work to review", () => {
    /*
     * Review is a queue somebody reads, not a bin. Asking to confirm it
     * teaches people to click through the question, and then the retention
     * one gets clicked through too.
     */
    const review = ruleImpacts(
      rules({ min_lead_days: 3, lead_action: "review" }),
      rules({ min_lead_days: 14, lead_action: "review" }),
      facts({ belowProposedLead: 6 })
    );
    expect(find(review, "min_lead_days")?.severity).toBe("changes");
    expect(needsConfirmation(review)).toBe(false);

    // Dismissal does take work off the board, and is confirmed.
    const dismiss = ruleImpacts(
      rules({ min_lead_days: 3, lead_action: "dismiss" }),
      rules({ min_lead_days: 14, lead_action: "dismiss" }),
      facts({ belowProposedLead: 6 })
    );
    expect(needsConfirmation(dismiss)).toBe(true);
  });

  it("does not pretend loosening a rule brings anything back", () => {
    const list = ruleImpacts(
      rules({ min_lead_days: 7 }),
      rules({ min_lead_days: 3 }),
      facts({ belowCurrentLead: 11, belowProposedLead: 8 })
    );
    expect(find(list, "min_lead_days")?.summary).toContain("does not bring back");
    expect(find(list, "min_lead_days")?.affected).toBeNull();
  });

  it("marks a shorter retention window as irreversible", () => {
    /*
     * The one setting on this page that destroys data. Putting the number
     * back does not bring the records back, and that has to be said before
     * the save rather than in a log afterwards.
     */
    const list = ruleImpacts(
      rules({ retention_days: 365 }),
      rules({ retention_days: 30 }),
      facts({ archivedBeyondCurrent: 2, archivedBeyondProposed: 40 })
    );
    const r = find(list, "retention_days")!;
    expect(r.affected).toBe(38);
    expect(r.irreversible).toBe(true);
    expect(needsConfirmation(list)).toBe(true);
  });

  it("treats turning retention off as removing nothing", () => {
    const list = ruleImpacts(
      rules({ retention_days: 30 }),
      rules({ retention_days: 0 }),
      facts({ archivedBeyondCurrent: 40, archivedBeyondProposed: 0 })
    );
    expect(find(list, "retention_days")?.irreversible).toBe(false);
    expect(needsConfirmation(list)).toBe(false);
  });

  it("never asks for confirmation over a colour band", () => {
    /*
     * Asking twice for something reversible teaches people to click through
     * the question, and then the one that mattered gets clicked through too.
     */
    const list = ruleImpacts(
      rules({ urgent_days: 3 }),
      rules({ urgent_days: 5 }),
      facts({ datedOpen: 40, withinProposedUrgent: 9, withinProposedApproaching: 14 })
    );
    expect(find(list, "deadline_bands")?.severity).toBe("changes");
    expect(needsConfirmation(list)).toBe(false);
  });

  it("says what switching calls off clears", () => {
    const list = ruleImpacts(
      rules({ calls_enabled: true }),
      rules({ calls_enabled: false }),
      facts({ callsPending: 6 })
    );
    const c = find(list, "calls_enabled")!;
    expect(c.affected).toBe(6);
    expect(c.summary).toContain("advance on the email alone");
  });

  it("does not claim already-booked follow-ups move", () => {
    // They carry the interval they were scheduled with. Saying otherwise
    // would have somebody expecting a send that is not coming.
    const list = ruleImpacts(
      rules({ followup_hours: 48 }),
      rules({ followup_hours: 24 }),
      facts({ followUpsScheduled: 5 })
    );
    expect(find(list, "followup_hours")?.summary).toContain("keep their time");
  });

  it("reports an empty board honestly rather than silently", () => {
    const list = ruleImpacts(
      rules({ min_lead_days: 3 }),
      rules({ min_lead_days: 7 }),
      facts()
    );
    expect(find(list, "min_lead_days")?.summary).toContain("Nothing currently open");
    expect(needsConfirmation(list)).toBe(false);
  });
});
