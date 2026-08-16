import { planTaskList, type PlanStep, type StepPlan } from "@/lib/domain/step-plan";

/**
 * The live task list for the record side panel.
 *
 * The panel used to open on "No activity yet" and a column of empty space,
 * which is the least useful thing a record can say about itself. The same
 * plan that drives the checklist already knows what is running on its own,
 * what is stuck, and what comes next; this shows that slice of it, grouped
 * by who is holding the work, so the column answers "is anything waiting on
 * me" before the timeline answers "what has happened".
 */
export function OpportunityTaskList({ plan }: { plan: StepPlan }) {
  if (plan.closed) return null;
  const tasks = planTaskList(plan);
  if (tasks.idle && tasks.next.length === 0) return null;

  return (
    <div className="space-y-3">
      {tasks.needsYou.length > 0 && (
        <Group
          label="Needs you"
          tone="you"
          count={tasks.needsYou.length}
          steps={tasks.needsYou}
          showAction
        />
      )}
      {tasks.running.length > 0 && (
        <Group
          label="Happening automatically"
          tone="brost"
          count={tasks.running.length}
          steps={tasks.running}
        />
      )}
      {tasks.waitingOn.length > 0 && (
        <Group
          label="Waiting on others"
          tone="wait"
          count={tasks.waitingOn.length}
          steps={tasks.waitingOn}
        />
      )}
      {tasks.next.length > 0 && (
        <div>
          <p className="label mb-1">Next</p>
          <ol className="space-y-1">
            {tasks.next.map((s) => (
              <li key={s.key} className="flex gap-2 text-xs text-muted-foreground">
                <span className="num shrink-0 opacity-60">{s.n}</span>
                <span className="min-w-0">{s.title}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

const TONE: Record<string, string> = {
  you: "border-gold/50 bg-gold/10",
  brost: "border-border bg-surface",
  wait: "border-border bg-surface",
};

const DOT: Record<string, string> = {
  you: "bg-gold",
  brost: "bg-accent animate-pulse",
  wait: "bg-muted-foreground/50",
};

function Group({
  label,
  tone,
  count,
  steps,
  showAction = false,
}: {
  label: string;
  tone: "you" | "brost" | "wait";
  count: number;
  steps: PlanStep[];
  showAction?: boolean;
}) {
  return (
    <div className={`rounded-md border px-3 py-2.5 ${TONE[tone]}`}>
      <p className="flex items-center gap-1.5 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
        {label}
        <span className="num opacity-70">{count}</span>
      </p>
      <ul className="mt-1.5 space-y-2">
        {steps.map((s) => (
          <li key={s.key}>
            <p
              className={`text-sm font-medium ${
                s.status === "blocked" ? "text-risk" : "text-foreground"
              }`}
            >
              {s.status === "blocked" ? "! " : ""}
              {s.title}
            </p>
            {s.detail && (
              <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
            )}
            {s.blockers?.[0] && (
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {s.blockers[0].what}
                {s.blockers.length > 1 ? ` (+${s.blockers.length - 1} more)` : ""}
              </p>
            )}
            {showAction && s.action && (
              <a href={s.action.href} className="btn-primary mt-1.5 inline-flex text-xs">
                {s.action.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
