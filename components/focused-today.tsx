import { PendingLink as Link } from "@/components/pending-link";
import { DeadlineBadge } from "@/components/deadline-badge";
import type { WorkItem } from "@/lib/domain/work-queue";
import { focusTasks } from "@/lib/domain/focused-workspace";

export function FocusedToday({ items, overdue, dueToday, completed, activity, incomplete = false, setupRemaining = 0 }: {
  items: WorkItem[]; overdue: number; dueToday: number; completed: number;
  activity: string[]; incomplete?: boolean; setupRemaining?: number;
}) {
  const [next, ...upcoming] = focusTasks(items);
  return <section aria-label="Your day at a glance" className="focused-today space-y-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">{incomplete ? "Some information needs a refresh." : "One thing at a time. Start here."}</p>
      <Link href="/workbench" className="inline-flex min-h-11 items-center text-sm font-medium text-accent">All tasks <span aria-hidden className="ml-2">↗</span></Link>
    </div>
    <article className="rounded-2xl border border-accent/20 bg-surface p-5 sm:p-7" data-next-task>
      <p className="text-xs font-semibold text-accent">{next ? "Your next task" : incomplete ? "Check your workspace" : setupRemaining ? "Get started" : "You're caught up"}</p>
      <h2 className="mt-3 max-w-3xl font-display text-xl leading-snug text-foreground sm:text-2xl">{next?.title ?? (incomplete ? "Refresh your task information" : setupRemaining ? "Finish setting up BrostCo" : "No tasks need you right now")}</h2>
      {next?.context && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{next.context}</p>}
      {next && <div className="mt-3"><DeadlineBadge deadline={next.due ?? null} /></div>}
      {next?.blocker || next?.reason ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{next.blocker || next.reason}</p> : null}
      <Link href={next?.href ?? (incomplete ? "/today" : setupRemaining ? "/setup" : "/pipeline")} className="btn-primary mt-5">{next ? next.actionLabel || "Open task" : incomplete ? "Refresh Today" : setupRemaining ? "Continue setup" : "View opportunities"}</Link>
    </article>
    <div className="grid gap-7 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,1fr)]">
      <section aria-labelledby="up-next-title">
        <div className="mb-3 flex items-center justify-between"><h2 id="up-next-title" className="text-base font-semibold">Up next</h2><span className="text-xs text-muted-foreground">{upcoming.length} shown</span></div>
        <div className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-surface px-5">
          {upcoming.length ? upcoming.map(item => <Link key={item.key} href={item.href} data-upcoming-task className="flex min-h-20 items-center justify-between gap-4 py-4">
            <span className="min-w-0"><span className="block text-sm font-medium leading-relaxed">{item.title}</span>{item.context && <span className="mt-1 block truncate text-xs text-muted-foreground">{item.context}</span>}</span><span aria-hidden className="shrink-0 text-accent">↗</span>
          </Link>) : <p className="py-6 text-sm text-muted-foreground">{incomplete ? "Task information is incomplete." : "Nothing else needs you right now."}</p>}
        </div>
      </section>
      <section aria-labelledby="workload-title"><h2 id="workload-title" className="mb-3 text-base font-semibold">At a glance</h2>
        <div className="rounded-2xl border border-border/60 bg-surface p-5">
          <dl className="space-y-4">
            {[{label:"Overdue",value:overdue,href:"/today?due=overdue#queue"},{label:"Due today",value:dueToday,href:"/today?due=due_today#queue"},{label:"Completed today",value:completed,href:"/today?due=completed_today#queue"}].map(row => <div key={row.label} className="flex items-center justify-between gap-4"><dt className="text-sm text-muted-foreground"><Link href={row.href} className="inline-flex min-h-11 items-center hover:underline">{row.label}</Link></dt><dd className="num text-xl font-semibold">{incomplete ? "Not available" : row.value}</dd></div>)}
          </dl>
        </div>
      </section>
    </div>
    <section aria-labelledby="recent-work-title">
      <div className="flex items-center justify-between gap-3"><h2 id="recent-work-title" className="text-base font-semibold">Last 24 hours</h2><Link href="/activity" className="inline-flex min-h-11 items-center text-sm text-accent">View activity</Link></div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{incomplete ? "Check activity for the latest recorded work." : activity.length ? activity.slice(0,3).join(" · ") : "No new activity is recorded in this summary."}</p>
    </section>
  </section>;
}
