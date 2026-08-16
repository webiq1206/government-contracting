/**
 * The contract plan: running a won job, as the same numbered checklist the
 * rest of the product uses.
 *
 * A contract card shows milestones, a coordination log, a spend gauge, and a
 * CPARS row, but not the order of operations or which of them is currently
 * the problem. This module computes that: backup coverage first (the job must
 * survive a primary falling through), then the schedule, the coordination
 * proof agencies demand, the non-small-business spend cap, the performance
 * review, and closeout. Pure; the page hands it rows it already loads.
 */

import { assemblePlan, type PlanBlocker, type PlanStep, type StepPlan } from "./step-plan";

export interface ContractPlanInput {
  completed: boolean;
  hasBackupSub: boolean;
  milestones: { name?: string; due?: string; status?: string }[];
  coordinationCount: number;
  /** Non-small-business subcontractor spend, percent of total (0-100). */
  nonSsPct: number;
  cparsStatus: string | null;
  cparsDue: string | null;
  /** Injected clock (ISO) so overdue detection is testable. */
  now: string;
}

const MILESTONE_DONE = new Set(["complete", "completed", "done"]);

const DEFS: { key: string; title: string; plain: string; owner: PlanStep["owner"] }[] = [
  {
    key: "setup",
    title: "Set up the contract",
    plain: "Recording the win created this record with milestones, logs, and compliance tracking.",
    owner: "brost",
  },
  {
    key: "backup",
    title: "Line up a backup sub",
    plain: "A second subcontractor on standby keeps the job alive if the primary falls through.",
    owner: "you",
  },
  {
    key: "milestones",
    title: "Work the milestone schedule",
    plain: "Each deliverable has a date; keep statuses honest so nothing slips quietly.",
    owner: "you",
  },
  {
    key: "coordination",
    title: "Log coordination proof",
    plain: "Site visits, sub check-ins, and QC notes prove you manage the work rather than pass it through.",
    owner: "you",
  },
  {
    key: "cap",
    title: "Stay under the sub-spend cap",
    plain: "Federal rules cap non-small-business subcontractor spend at 50% of the work.",
    owner: "you",
  },
  {
    key: "cpars",
    title: "Get the performance review",
    plain: "CPARS is the government's report card on this job; a good rating wins future work.",
    owner: "agency",
  },
  {
    key: "closeout",
    title: "Close out the contract",
    plain: "When the work and paperwork are finished, mark it complete to move it to past contracts.",
    owner: "you",
  },
];

export function buildContractPlan(input: ContractPlanInput): StepPlan {
  const now = new Date(input.now).getTime();
  const milestonesDone = input.milestones.filter((m) =>
    MILESTONE_DONE.has((m.status ?? "").toLowerCase())
  ).length;
  const overdue = input.milestones.filter((m) => {
    if (MILESTONE_DONE.has((m.status ?? "").toLowerCase())) return false;
    if (!m.due) return false;
    const t = new Date(m.due).getTime();
    return Number.isFinite(t) && t < now;
  });
  const cpars = (input.cparsStatus ?? "not_started").toLowerCase();
  const cparsDone = cpars === "complete" || cpars === "completed";

  const done: Record<string, boolean> = {
    setup: true,
    backup: input.hasBackupSub,
    milestones:
      input.milestones.length > 0 && milestonesDone === input.milestones.length,
    coordination: input.coordinationCount > 0,
    cap: input.nonSsPct < 45,
    cpars: cparsDone,
    closeout: input.completed,
  };

  const blockers: Record<string, PlanBlocker[]> = {};

  if (!input.hasBackupSub && !input.completed) {
    blockers.backup = [
      {
        what: "No backup subcontractor is assigned.",
        how: "Pick one from the Sub Database so the job survives if the primary falls through.",
        href: "/subs",
      },
    ];
  }

  if (overdue.length > 0 && !input.completed) {
    blockers.milestones = overdue.slice(0, 4).map((m) => ({
      what: `"${m.name ?? "Milestone"}" is past its due date.`,
      how: "Update its status if the work happened, or reschedule it if it slipped.",
    }));
  }

  if (input.nonSsPct >= 45 && !input.completed) {
    blockers.cap = [
      input.nonSsPct >= 49
        ? {
            what: `Non-small-business sub spend is at ${Math.round(input.nonSsPct)}% of the 50% cap.`,
            how: "Stop adding non-small-business subs; shift remaining work to small businesses or self-perform.",
          }
        : {
            what: `Non-small-business sub spend is at ${Math.round(input.nonSsPct)}%, inside the warning band.`,
            how: "Plan the remaining sub assignments so the 50% cap is never crossed.",
          },
    ];
  }

  // Completed contracts read as a finished story; open ends (an unfinished
  // CPARS) still show, but nothing is "blocked" on a closed record.
  const activeIdx = input.completed ? -1 : DEFS.findIndex((d) => !done[d.key]);

  const detailFor = (key: string): string | undefined => {
    switch (key) {
      case "milestones":
        if (input.milestones.length === 0) return "No milestones logged yet";
        return `${milestonesDone} of ${input.milestones.length} complete${
          overdue.length > 0 ? `, ${overdue.length} overdue` : ""
        }`;
      case "coordination":
        return input.coordinationCount > 0
          ? `${input.coordinationCount} activit${input.coordinationCount === 1 ? "y" : "ies"} logged`
          : "Nothing logged yet";
      case "cap":
        return `${Math.round(input.nonSsPct)}% of the 50% cap`;
      case "cpars":
        if (cparsDone) return "Review complete";
        return input.cparsDue
          ? `Status: ${cpars.replace(/_/g, " ")}, due ${input.cparsDue.slice(0, 10)}`
          : `Status: ${cpars.replace(/_/g, " ")}`;
      default:
        return undefined;
    }
  };

  const steps: PlanStep[] = DEFS.map((def, i) => {
    let status: PlanStep["status"];
    if (done[def.key]) status = "done";
    else if (i === activeIdx) status = blockers[def.key]?.length ? "blocked" : "current";
    else status = blockers[def.key]?.length ? "blocked" : "upcoming";
    return {
      key: def.key,
      n: i + 1,
      title: def.title,
      plain: def.plain,
      status,
      owner: def.owner,
      detail: detailFor(def.key),
      blockers: status === "done" ? undefined : blockers[def.key],
    };
  });

  return assemblePlan(steps, {
    activeKey: input.completed ? null : undefined,
    allDoneHeadline: "All 7 steps are done",
  });
}
