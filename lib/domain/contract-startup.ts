/**
 * What a contract needs doing in its first week, and what it will need later.
 *
 * Winning produced a contract row with an award amount and two dates, and
 * nothing else. Every obligation that follows from an award -- get the
 * insurance certificates in, hold a kickoff, invoice on a schedule, answer
 * CPARS, close it out -- existed only in whichever estimator's head had done
 * it before.
 *
 * These are derived from the contract's own dates rather than invented, and
 * each one says why it exists. A milestone with no date is still worth
 * creating: it is a thing that has to happen, and "no date on file" is a
 * better answer than the obligation not existing.
 *
 * Pure. The caller writes them.
 */

export interface StartupFacts {
  startDate?: string | null;
  endDate?: string | null;
  /** True when the award carries a bonding requirement. */
  bondRequired?: boolean;
  /** True when a subcontractor is already paired to the contract. */
  hasSubcontractor?: boolean;
}

export interface PlannedMilestone {
  key: string;
  kind: "milestone" | "deliverable";
  name: string;
  detail: string;
  /** Null when the contract has no date to derive one from. */
  dueAt: string | null;
}

export interface PlannedComplianceItem {
  key: string;
  category: string;
  label: string;
  detail: string;
  dueAt: string | null;
  /** How far ahead this one should start warning. */
  windowDays: number;
}

function addDays(date: string | null | undefined, days: number): string | null {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The milestones a federal contract has whether or not anybody writes them
 * down.
 *
 * Deliberately few. A list of twenty generated tasks is one somebody deletes
 * wholesale, and the five here are the ones with a date attached and a
 * consequence for missing them.
 */
export function plannedMilestones(f: StartupFacts): PlannedMilestone[] {
  const out: PlannedMilestone[] = [
    {
      key: "kickoff",
      kind: "milestone",
      name: "Hold the kickoff with the contracting officer",
      detail:
        "Agree the schedule, the invoicing cycle and who signs what, before any of it is assumed.",
      // A fortnight in, or unset when the contract has no start date. Not
      // today's date: a made-up deadline is one people learn to ignore.
      dueAt: addDays(f.startDate, 14),
    },
    {
      key: "insurance_on_file",
      kind: "deliverable",
      name: "Send the agency the insurance certificates",
      detail: "Most awards want these before anybody is allowed on site.",
      dueAt: addDays(f.startDate, 7),
    },
    {
      key: "first_invoice",
      kind: "deliverable",
      name: "Submit the first invoice",
      detail: "The first one sets the pattern, and the first rejection is the expensive one.",
      dueAt: addDays(f.startDate, 30),
    },
    {
      key: "closeout_package",
      kind: "deliverable",
      name: "Submit the closeout package",
      detail: "Final invoice, releases, and anything the contract lists as a closeout deliverable.",
      dueAt: addDays(f.endDate, 14),
    },
  ];

  if (f.bondRequired) {
    out.splice(1, 0, {
      key: "bond_in_place",
      kind: "deliverable",
      name: "Get the performance bond issued",
      detail: "A bonded award cannot start without it, and the surety takes time.",
      dueAt: addDays(f.startDate, 7),
    });
  }

  if (f.hasSubcontractor) {
    out.push({
      key: "sub_agreement",
      kind: "milestone",
      name: "Sign the subcontract agreement",
      detail: "Before the subcontractor mobilises, not after the first coordination call.",
      dueAt: addDays(f.startDate, 14),
    });
  }

  return out;
}

/**
 * The dated obligations that belong on the compliance board rather than on the
 * contract.
 *
 * `contract_deadline` is a category the compliance page has always known how
 * to display and nothing has ever written. These are the rows it was built
 * for.
 */
export function plannedComplianceItems(f: StartupFacts): PlannedComplianceItem[] {
  const items: PlannedComplianceItem[] = [];

  if (f.endDate) {
    items.push({
      key: "cpars",
      category: "cpars",
      label: "Answer the CPARS evaluation",
      detail:
        "The agency rates past performance after the work ends. An unanswered rating stands, and it is read on the next bid.",
      // The agency has 120 days after completion; the window is wide because
      // the consequence lands on every future bid rather than on this job.
      dueAt: addDays(f.endDate, 120),
      windowDays: 60,
    });
    items.push({
      key: "closeout",
      category: "contract_deadline",
      label: "Close the contract out",
      detail: "Final invoice, retainage released, and the file complete enough to be audited.",
      dueAt: addDays(f.endDate, 60),
      windowDays: 30,
    });
  }

  if (f.startDate) {
    items.push({
      key: "insurance_for_contract",
      category: "insurance",
      label: "Insurance the contract requires",
      detail:
        "Coverage this award requires, as distinct from what the company happens to carry. A lapse mid-project can void it.",
      dueAt: null,
      windowDays: 30,
    });
  }

  return items;
}

/** Every generated thing carries this, so a person can tell it from their own. */
export const GENERATED_NOTE =
  "Created when this contract was recorded. Change or remove it if this contract works differently.";
