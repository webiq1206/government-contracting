import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(path, oldText, newText) {
  const text = readFileSync(path, "utf8");
  const count = text.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected one match, found ${count}: ${oldText.slice(0, 100)}`);
  writeFileSync(path, text.replace(oldText, newText));
}

replaceOnce(
  "app/(dash)/workbench/page.tsx",
  `          status={queueUnavailable ? "Queue status unavailable" : summarizeQueue(items)}
          explanation="Everything waiting on a person, worked one at a time without leaving this screen."
          primaryAction={
            <Link href="/today" className="btn-ghost text-xs">
              Back to Today
            </Link>
          }
`,
  `          status={queueUnavailable ? "Queue status unavailable" : \`${'${actionable.length}'} need you\`}
          explanation="Work the items that need you. Waiting work stays out of the way."
`
);
replaceOnce(
  "app/(dash)/workbench/page.tsx",
  `placeholder="Company, solicitation, or why it is here…"`,
  `placeholder="Search work…"`
);
replaceOnce(
  "app/(dash)/workbench/page.tsx",
  `QUEUE_FILTERS.filter((f) => !isCompletedFilter(f)).map((f) => {`,
  `QUEUE_FILTERS.filter((f) => f === "all" || f === "waiting_on_others" || f === "overdue").map((f) => {`
);
replaceOnce(
  "app/(dash)/workbench/page.tsx",
  `                  {QUEUE_FILTER_LABEL[f]}
                  <span className="num text-muted-foreground">{n}</span>
`,
  `                  {f === "all" ? "Needs you" : f === "waiting_on_others" ? "Waiting" : QUEUE_FILTER_LABEL[f]}
                  <span className="num text-muted-foreground">{n}</span>
`
);
replaceOnce(
  "app/(dash)/workbench/page.tsx",
  `            })}
          </nav>

          <details className="mt-2" open={Boolean(kind || owner !== "anyone")}>`,
  `            })}
            <Link
              href="/today?due=completed_today"
              className="inline-flex coarse:min-h-11 shrink-0 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground hover:border-foreground/30 hover:text-foreground py-1.5"
            >
              Done
            </Link>
          </nav>

          <details className="mt-2" open={Boolean(kind || owner !== "anyone")}>`
);

replaceOnce(
  "app/(dash)/pipeline/page.tsx",
  `            : view === "lanes"
              ? "Grouped by whose turn it is. Start with Needs you."
              : "Full stage board. Amber cards wait on you; the rest run automatically."
`,
  `            : view === "lanes"
              ? "Start with what needs you."
              : "Choose a view when you need more detail."
`
);
replaceOnce(
  "app/(dash)/pipeline/page.tsx",
  `        <div className="flex gap-1 rounded-md border border-border p-0.5">
`,
  `        <details className="relative sm:hidden">
          <summary className="btn-secondary min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">View</summary>
          <div className="absolute right-0 top-12 z-30 grid min-w-40 gap-1 rounded-lg border border-border bg-background p-2 shadow-xl">
            <Link href="/pipeline?view=lanes" className="min-h-11 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">Simple</Link>
            <Link href="/pipeline?view=list" className="min-h-11 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">List</Link>
            <Link href="/pipeline?view=stages" className="min-h-11 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">All stages</Link>
            <Link href="/pipeline?view=table" className="min-h-11 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">Table</Link>
          </div>
        </details>
        <div className="hidden gap-1 rounded-md border border-border p-0.5 sm:flex">
`
);

replaceOnce(
  "app/(dash)/review/page.tsx",
  `          status={
            opps.length === 0
              ? "Nothing waiting"
              : \`${'${opps.length}'} to decide${'${urgent > 0 ? ` · ${urgent} dismissed within a day` : ""}'}\`
          }
          explanation="Read each opportunity, then pursue or pass. If an automatic dismissal is scheduled, its deadline appears on the card."
`,
  `          status={
            opps.length === 0
              ? "Nothing waiting"
              : \`${'${opps.length}'} decision${'${opps.length === 1 ? "" : "s"}'}${'${urgent > 0 ? ` · ${urgent} urgent` : ""}'}\`
          }
          explanation="Review one opportunity at a time. Pursue or pass."
`
);
replaceOnce(
  "app/(dash)/review/page.tsx",
  `className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-background px-4 py-2 dark:border-white/5"`,
  `className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 bg-background px-4 py-2 dark:border-white/5"`
);

console.log("Operational page simplification applied.");
