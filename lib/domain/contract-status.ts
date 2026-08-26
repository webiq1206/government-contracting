/**
 * Which pile a contract belongs in, and whether anything is wrong with it.
 *
 * Two statuses are stored -- `active` and `completed` -- and the Contracts
 * page showed exactly those two lists. That is enough to file a contract and
 * not nearly enough to run one. The three that were missing are the three an
 * operator actually looks for:
 *
 *   starting soon   awarded, not begun. Mobilisation, insurance certificates
 *                   and the subcontractor's paperwork all have to be in hand
 *                   BEFORE day one, and the window to notice is exactly the
 *                   window this view describes.
 *   at risk         running, with something wrong. Never stored, always
 *                   derived: a stored risk flag is a flag somebody has to
 *                   remember to clear, and the one nobody clears is the one
 *                   that stops being believed.
 *   terminated      lost or ended early. Filing this as "completed" makes
 *                   every win-rate and margin figure quietly wrong.
 *
 * Pure. The caller supplies the row; this decides what it means.
 */

export type ContractView = "active" | "starting_soon" | "at_risk" | "completed" | "terminated";

/** What is wrong, when something is. One entry per thing a person can act on. */
export type RiskKind =
  | "past_end_date"
  | "milestone_overdue"
  | "sub_spend_cap"
  | "cpars_overdue"
  | "no_dates";

export interface ContractRisk {
  kind: RiskKind;
  /** Plain language, naming the thing and the consequence. */
  detail: string;
  /** True when it stops work or money rather than merely warning. */
  blocking: boolean;
}

export interface ContractFacts {
  status?: string | null;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  /** Percentage of subcontracted value going to non-small businesses. */
  nonSsSubPct?: number | string | null;
  cparsDueAt?: string | Date | null;
  cparsStatus?: string | null;
  milestones?: { name?: string; due?: string; status?: string }[] | null;
  now?: Date;
}

/**
 * The federal small-business subcontracting cap.
 *
 * Additional non-small-business subcontractors are blocked at 49% because the
 * cap is 50 and the last award is the one that breaches it. Matches
 * nonSsCapState in compliance.ts; kept as its own constant here so this module
 * stays pure and importable from the browser.
 */
const NON_SS_BLOCK_PCT = 49;
const NON_SS_WARN_PCT = 45;

/** Inside this window, a contract is "starting soon" rather than merely awarded. */
const STARTING_SOON_DAYS = 30;

function asDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function days(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * Everything wrong with a running contract.
 *
 * Only computed for contracts that are actually running: a completed contract
 * whose end date has passed is not at risk, it is finished, and flagging it
 * would fill the view with things nobody can act on.
 */
export function contractRisks(facts: ContractFacts): ContractRisk[] {
  const now = facts.now ?? new Date();
  const risks: ContractRisk[] = [];
  const start = asDate(facts.startDate);
  const end = asDate(facts.endDate);

  if (!start && !end) {
    risks.push({
      kind: "no_dates",
      detail:
        "No period of performance recorded, so nothing about this contract's schedule can be tracked.",
      blocking: false,
    });
  }

  if (end && end.getTime() < now.getTime()) {
    risks.push({
      kind: "past_end_date",
      detail: `The period of performance ended ${Math.abs(days(now, end))} days ago and the contract is still open. Close it out or record the extension.`,
      blocking: false,
    });
  }

  for (const m of facts.milestones ?? []) {
    const due = asDate(m.due);
    const done = /complete|done|closed/i.test(m.status ?? "");
    if (due && !done && due.getTime() < now.getTime()) {
      risks.push({
        kind: "milestone_overdue",
        detail: `"${m.name ?? "A milestone"}" was due ${Math.abs(days(now, due))} days ago and is not marked complete.`,
        blocking: false,
      });
    }
  }

  const pct = num(facts.nonSsSubPct);
  if (pct != null && pct >= NON_SS_BLOCK_PCT) {
    risks.push({
      kind: "sub_spend_cap",
      detail: `${pct}% of subcontracted value is going to non-small businesses. No further non-small-business subcontractors can be added without breaching the 50% cap.`,
      blocking: true,
    });
  } else if (pct != null && pct >= NON_SS_WARN_PCT) {
    risks.push({
      kind: "sub_spend_cap",
      detail: `${pct}% of subcontracted value is going to non-small businesses, approaching the 50% cap.`,
      blocking: false,
    });
  }

  const cpars = asDate(facts.cparsDueAt);
  const cparsDone = /submit|complete|done/i.test(facts.cparsStatus ?? "");
  if (cpars && !cparsDone && cpars.getTime() < now.getTime()) {
    risks.push({
      kind: "cpars_overdue",
      detail: `The CPARS performance evaluation was due ${Math.abs(days(now, cpars))} days ago. A late or missing evaluation follows the company into every future bid.`,
      blocking: false,
    });
  }

  return risks;
}

/**
 * Which view this contract belongs in.
 *
 * Order matters: a terminated contract is terminated whatever its dates say,
 * and a contract that has not started cannot be at risk of anything except
 * not starting.
 */
export function contractView(facts: ContractFacts): ContractView {
  const now = facts.now ?? new Date();
  const status = (facts.status ?? "").toLowerCase();

  if (status === "terminated" || status === "lost") return "terminated";
  if (status === "completed" || status === "closed") return "completed";

  const start = asDate(facts.startDate);
  if (start && start.getTime() > now.getTime()) return "starting_soon";

  return contractRisks(facts).length > 0 ? "at_risk" : "active";
}

export const VIEW_LABEL: Record<ContractView, string> = {
  active: "Active",
  starting_soon: "Starting soon",
  at_risk: "At risk",
  completed: "Completed",
  terminated: "Lost or terminated",
};

export const VIEW_EXPLANATION: Record<ContractView, string> = {
  active: "Running, with nothing flagged.",
  starting_soon: "Awarded and not yet begun. Paperwork and mobilisation have to be in hand before day one.",
  at_risk: "Running, with something that needs attention.",
  completed: "Finished and closed out.",
  terminated: "Lost, cancelled, or ended early. Kept separate from completed so win rates stay honest.",
};

/** Sort key so the views appear in the order an operator works them. */
export const VIEW_ORDER: ContractView[] = [
  "at_risk",
  "starting_soon",
  "active",
  "completed",
  "terminated",
];

/** One line for the page header: what needs a person, not how many rows exist. */
export function contractsHeadline(counts: Record<ContractView, number>): string {
  if (counts.at_risk > 0) {
    return `${counts.at_risk} contract${counts.at_risk === 1 ? "" : "s"} need${counts.at_risk === 1 ? "s" : ""} attention`;
  }
  if (counts.starting_soon > 0) {
    return `${counts.starting_soon} starting soon`;
  }
  const running = counts.active;
  if (running > 0) return `${running} running, nothing flagged`;
  return "No active contracts";
}
