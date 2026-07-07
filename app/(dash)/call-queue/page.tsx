import { callQueue } from "@/lib/data";
import type { CallCardRow } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";
import { CallWorkspaceLauncher } from "@/components/call-workspace-launcher";
import { countdown, currency, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * A Call Queue card. The whole card is a single clickable target that opens the
 * Call Workspace slide-over; the "Start call" button opens the same workspace.
 * Everything the operator can decide from without a call, trade, deadline,
 * project value, prior interaction, is visible at a glance on the card itself.
 */
function CallCard({ c }: { c: CallCardRow }) {
  const expiry = countdown(c.deadline);
  const overdue = expiry === "overdue";
  const soon =
    !!c.deadline &&
    (new Date(c.deadline).getTime() - Date.now()) / 86_400_000 < 7 &&
    !overdue;

  return (
    <CallWorkspaceLauncher
      cardId={c.id}
      className="card group cursor-pointer border-border hover:border-accent/60 hover:shadow-md transition-all"
    >
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="eyebrow mb-1">{c.trade ?? "General"}</p>
            <p className="font-serif text-xl font-semibold text-foreground truncate">
              {c.company_name}
            </p>
            {c.owner_name && (
              <p className="mt-0.5 text-sm text-slate-500 truncate">
                {c.owner_name}
              </p>
            )}
          </div>
          <span
            className={`badge shrink-0 ${
              overdue
                ? "bg-risk/15 text-risk"
                : soon
                  ? "bg-review/15 text-review"
                  : "bg-surface text-slate-500"
            }`}
          >
            {c.deadline ? `⏱ ${expiry}` : "No deadline"}
          </span>
        </div>

        {/* Project + value line */}
        <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
          <p className="truncate font-medium text-slate-800">
            {c.opportunity_title ?? "Untitled opportunity"}
          </p>
          <p className="mt-0.5 flex items-center justify-between text-xs text-slate-500">
            <span>{c.agency ?? "-"}</span>
            <span className="num font-medium text-slate-700">
              {c.value_estimated != null ? currency(c.value_estimated) : ""}
            </span>
          </p>
        </div>

        {/* Signals */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {c.phone ? (
            <a
              href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
              onClick={(e) => e.stopPropagation()}
              className="text-accent hover:underline"
            >
              📞 {c.phone}
            </a>
          ) : (
            <span className="text-risk">⚠ No phone on file</span>
          )}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              onClick={(e) => e.stopPropagation()}
              className="text-accent hover:underline"
            >
              ✉ {c.email}
            </a>
          )}
          {c.needs_project_history && (
            <span
              className="badge bg-review/15 text-review"
              title="We have no past projects on file for this sub. Ask about their last 3 similar jobs during the call."
            >
              Ask about past projects
            </span>
          )}
          {c.deadline && (
            <span className="ml-auto num text-xs text-slate-500">
              Bid due {shortDate(c.deadline)}
            </span>
          )}
        </div>

        {/* Primary action */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex items-center justify-between gap-2"
        >
          <p className="text-xs text-slate-500">
            Opens a full call workspace with script, attachments, and capture form.
          </p>
          <span className="btn-primary pointer-events-none">Start call →</span>
        </div>
      </div>
    </CallWorkspaceLauncher>
  );
}

export default async function CallQueuePage() {
  const cards = await callQueue();

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        help={PAGE_HELP["call-queue"]}
        title="Call Queue"
        subtitle={`${cards.length} call${cards.length === 1 ? "" : "s"} to make · soonest deadline first`}
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        {cards.length === 0 ? (
          <div className="card mx-auto mt-8 max-w-md text-center">
            <p className="text-3xl">📞</p>
            <p className="mt-3 text-base font-semibold text-foreground">
              No calls in the queue.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Subcontractor call cards appear here as soon as Sub Finder + Sub
              Verify identify responsive subs for a pursued opportunity.
            </p>
          </div>
        ) : (
          <div className="mx-auto grid max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
            {cards.map((c) => (
              <CallCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
