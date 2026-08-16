import {
  PLAN_OWNER_LABEL,
  type StepPlan,
  type PlanStep,
} from "@/lib/domain/step-plan";

/**
 * The guided plan, rendered: "you are on step 8 of 13, here is the button".
 *
 * The header keeps the whole story glanceable — progress bar, the live step,
 * who owns it — and the full numbered checklist sits one tap away inside a
 * native details element so the banner never eats the page. Done steps
 * compress to a line; the live step carries the single primary button;
 * blocked steps say what is wrong, how to fix it, and where, in that order.
 * Server-rendered on purpose: the plan is a picture of stored state, so
 * there is nothing here for a client bundle to do.
 */
export function GuidedPlanPanel({
  plan,
  eyebrow = "Your path to submission",
  headerAction = true,
}: {
  plan: StepPlan;
  /** Panel label naming the journey, e.g. "Getting this sub job-ready". */
  eyebrow?: string;
  /**
   * Show the live step's button in the always-visible header. Turn off only
   * when another element right next to the panel already carries the same
   * action (the opportunity page's Next-step banner).
   */
  headerAction?: boolean;
}) {
  if (plan.closed) {
    return (
      <div className="rounded-md border border-border/75 bg-surface px-3 py-2.5 dark:border-white/[0.17]">
        <p className="text-sm font-medium text-foreground">{plan.closed.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{plan.closed.note}</p>
      </div>
    );
  }

  const pct = plan.total === 0 ? 0 : Math.round((plan.done / plan.total) * 100);
  const problems = plan.steps.filter((s) => s.status === "blocked");

  return (
    <div className="rounded-md border border-border/75 bg-surface dark:border-white/[0.17]">
      <div className="px-3 pb-2.5 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </p>
          <p className="num text-xs text-muted-foreground">
            {plan.done} of {plan.total} steps done
          </p>
        </div>
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-border/60"
          role="progressbar"
          aria-valuenow={plan.done}
          aria-valuemin={0}
          aria-valuemax={plan.total}
          aria-label={`${plan.done} of ${plan.total} steps done`}
        >
          <div
            className="h-full rounded-full bg-pursue transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">{plan.headline}</p>
        {plan.active && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {plan.active.plain}{" "}
            <span
              className={
                plan.active.owner === "you"
                  ? "font-medium text-accent-strong"
                  : "font-medium"
              }
            >
              {PLAN_OWNER_LABEL[plan.active.owner]}.
            </span>
          </p>
        )}
        {/* The live step's button belongs on screen, not one tap inside the
            checklist; a guide that hides its own button is a map, not a guide. */}
        {headerAction && plan.active?.action && (
          <a
            href={plan.active.action.href}
            className="btn-primary mt-2.5 inline-flex text-xs"
          >
            {plan.active.action.label}
          </a>
        )}
        {problems.length > 0 && (
          <p className="mt-1 text-xs font-medium text-risk">
            {problems.length} step{problems.length === 1 ? "" : "s"} need
            {problems.length === 1 ? "s" : ""} something fixed. Open the list below.
          </p>
        )}
      </div>

      <details className="group border-t border-border/60">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
          <span>Show every step</span>
          <span aria-hidden className="transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <ol className="space-y-0 px-3 pb-3">
          {plan.steps.map((step, i) => (
            <PlanStepRow
              key={step.key}
              step={step}
              isLast={i === plan.steps.length - 1}
              isActive={plan.active?.key === step.key}
            />
          ))}
        </ol>
      </details>
    </div>
  );
}

const CIRCLE: Record<PlanStep["status"], string> = {
  done: "border-pursue/40 bg-pursue/15 text-pursue",
  current: "border-gold bg-gold text-ink",
  blocked: "border-risk/50 bg-risk/15 text-risk",
  upcoming: "border-border bg-surface text-muted-foreground/70",
};

function PlanStepRow({
  step,
  isLast,
  isActive,
}: {
  step: PlanStep;
  isLast: boolean;
  isActive: boolean;
}) {
  const muted = step.status === "upcoming" || step.status === "done";
  return (
    <li className="relative flex gap-3 pb-0">
      {/* Connector line ties the numbers into one path. */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[0.8125rem] top-7 bottom-0 w-px bg-border/70"
        />
      )}
      <span
        aria-hidden
        className={`relative z-[1] mt-0.5 flex h-[1.65rem] w-[1.65rem] shrink-0 items-center justify-center rounded-full border text-[0.7rem] font-semibold ${CIRCLE[step.status]}`}
      >
        {step.status === "done" ? "✓" : step.status === "blocked" ? "!" : step.n}
      </span>
      <div className={`min-w-0 flex-1 ${isLast ? "pb-1" : "pb-4"}`}>
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p
            className={`text-sm ${
              muted
                ? "font-normal text-muted-foreground"
                : "font-semibold text-foreground"
            }`}
          >
            {step.title}
          </p>
          {step.detail && (
            <span className="text-xs text-muted-foreground">{step.detail}</span>
          )}
          {(step.status === "current" || step.status === "blocked") && (
            <span
              className={`badge ${
                step.owner === "you"
                  ? "bg-gold/15 text-accent-strong"
                  : "bg-surface-raised text-muted-foreground"
              }`}
            >
              {PLAN_OWNER_LABEL[step.owner]}
            </span>
          )}
        </div>
        {!muted && (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {step.plain}
          </p>
        )}
        {step.blockers && step.blockers.length > 0 && (
          <ul className="mt-2 space-y-2 rounded-md border border-risk/30 bg-risk/5 p-2.5">
            {step.blockers.map((b) => (
              <li key={b.what} className="text-xs leading-relaxed">
                <p className="font-medium text-risk">{b.what}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {b.how}{" "}
                  {b.href && (
                    <a
                      href={b.href}
                      className="font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                    >
                      Fix it here →
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        {step.action && (
          <a
            href={step.action.href}
            className={`${isActive && step.status === "current" ? "btn-primary" : "btn-ghost"} mt-2 inline-flex text-xs`}
          >
            {step.action.label}
          </a>
        )}
      </div>
    </li>
  );
}
