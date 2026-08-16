/**
 * The shared shape of a guided step plan.
 *
 * Every workflow in the product tells its story the same way: a numbered list
 * of steps, each with a plain one-line explanation, a status, an owner, live
 * progress, named blockers (what is wrong, how to fix it, where), and the one
 * button that moves it. The opportunity plan, the subcontractor readiness
 * plan, the contract plan, and the call-queue guide all build this shape and
 * render through the same panel, so an operator who learned to read one has
 * learned to read them all.
 */

export type PlanStatus = "done" | "current" | "blocked" | "upcoming";
export type PlanOwner = "you" | "brost" | "subs" | "agency";

export const PLAN_OWNER_LABEL: Record<PlanOwner, string> = {
  you: "You do this",
  brost: "Brost Co does this",
  subs: "Waiting on subcontractors",
  agency: "Waiting on the agency",
};

export interface PlanBlocker {
  /** What is wrong, stated plainly. */
  what: string;
  /** How to fix it, stated as an instruction. */
  how: string;
  /** Where the fix happens. */
  href?: string;
}

export interface PlanStep {
  key: string;
  /** 1-based position in the plan. */
  n: number;
  title: string;
  /** One plain sentence saying what this step means. */
  plain: string;
  status: PlanStatus;
  owner: PlanOwner;
  /** Present-state progress, e.g. "1 of 2 trades priced". */
  detail?: string;
  /** The one button that moves this step, for current/blocked steps. */
  action?: { label: string; href: string };
  blockers?: PlanBlocker[];
}

export interface StepPlan {
  steps: PlanStep[];
  done: number;
  total: number;
  /** The live step; absent when the record is closed or fully done. */
  active?: PlanStep;
  /** "Step 8 of 13: Collect the prices" / "All 13 steps are done". */
  headline: string;
  /** Set instead of an active step when the record left its workflow. */
  closed?: { label: string; note: string };
}

export interface PlanTaskList {
  /** Running on its own right now, nobody is waiting on the operator. */
  running: PlanStep[];
  /** Live work the operator owns, plus anything stuck behind a problem. */
  needsYou: PlanStep[];
  /** Sitting with a subcontractor or the agency. */
  waitingOn: PlanStep[];
  /** The next few steps, so what is coming is never a surprise. */
  next: PlanStep[];
  /** True when nothing anywhere is live: the plan is finished or closed. */
  idle: boolean;
}

/**
 * The plan split by who is holding it right now.
 *
 * The full checklist answers "what is the shape of this job"; this answers
 * the question an operator actually opens a record with, "is anything waiting
 * on me, or is the machine still working". Blocked steps count as the
 * operator's whatever their nominal owner is, because a blocker never clears
 * itself.
 */
export function planTaskList(plan: StepPlan, opts: { nextCount?: number } = {}): PlanTaskList {
  const live = plan.steps.filter(
    (s) => s.status === "current" || s.status === "blocked"
  );
  const needsYou = live.filter((s) => s.status === "blocked" || s.owner === "you");
  const running = live.filter((s) => s.status === "current" && s.owner === "brost");
  const waitingOn = live.filter(
    (s) => s.status === "current" && (s.owner === "subs" || s.owner === "agency")
  );
  const firstUpcoming = plan.steps.findIndex((s) => s.status === "upcoming");
  const next =
    firstUpcoming === -1
      ? []
      : plan.steps.slice(firstUpcoming, firstUpcoming + (opts.nextCount ?? 3));
  return {
    running,
    needsYou,
    waitingOn,
    next,
    idle: live.length === 0,
  };
}

/**
 * Assemble a StepPlan from computed steps: counts done, finds the active
 * step, and writes the headline. `activeKey` pins the live step (pass null
 * for closed plans); when omitted the first non-done step is live.
 */
export function assemblePlan(
  steps: PlanStep[],
  opts: {
    activeKey?: string | null;
    closed?: StepPlan["closed"];
    allDoneHeadline?: string;
  } = {}
): StepPlan {
  const done = steps.filter((s) => s.status === "done").length;
  const active =
    opts.activeKey === null
      ? undefined
      : opts.activeKey != null
        ? steps.find((s) => s.key === opts.activeKey)
        : steps.find((s) => s.status !== "done");
  const headline = opts.closed
    ? opts.closed.label
    : done === steps.length
      ? (opts.allDoneHeadline ?? `All ${steps.length} steps are done`)
      : active
        ? `Step ${active.n} of ${steps.length}: ${active.title}`
        : `${done} of ${steps.length} steps done`;
  return { steps, done, total: steps.length, active, headline, closed: opts.closed };
}
