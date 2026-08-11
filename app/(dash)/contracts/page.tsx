import Link from "next/link";
import { activeContracts, completedContracts } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { ActionButton } from "@/components/action-button";
import { PAGE_HELP } from "@/lib/help-content";
import { currency, shortDate, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

type Milestone = {
  name?: string;
  due?: string;
  status?: string;
  amount?: number;
};

type CoordinationEntry = {
  task?: string;
  label?: string;
  note?: string;
  done?: boolean;
  completed?: boolean;
  at?: string;
  timestamp?: string;
};

function milestoneStatusClass(status?: string): string {
  switch ((status ?? "").toLowerCase()) {
    case "complete":
    case "completed":
    case "done":
      return "bg-pursue/15 text-pursue";
    case "in_progress":
    case "active":
      return "bg-pursue/10 text-pursue";
    case "overdue":
    case "late":
    case "blocked":
      return "bg-risk/15 text-risk";
    default:
      return "bg-review/15 text-review";
  }
}

function NonSsGauge({ pctValue }: { pctValue: number }) {
  const cap = 50;
  const ratio = Math.min(1, Math.max(0, pctValue / cap));
  const barClass =
    pctValue >= 49 ? "bg-risk" : pctValue >= 45 ? "bg-review" : "bg-pursue";
  const textClass =
    pctValue >= 49
      ? "text-risk"
      : pctValue >= 45
        ? "text-review"
        : "text-pursue";
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="label" title="Federal rules cap how much of the work can go to subcontractors that are not small businesses">
          Non-small-business sub spend
        </p>
        <span className={`text-sm font-semibold ${textClass}`}>
          {pct(pctValue)} of 50% cap
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Federal rules: subs that are not small businesses can do at most 50% of
        the work. We warn at 45% and block new non-small-business subs at the cap.
      </p>
      <div className="relative mt-1 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${barClass}`}
          style={{ width: `${ratio * 100}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-slate-500"
          style={{ left: `${(45 / cap) * 100}%` }}
          title="45% alert"
        />
      </div>
    </div>
  );
}

function ContractCard({ c, completed = false }: { c: Record<string, unknown>; completed?: boolean }) {
  const milestones = (c.milestones as Milestone[] | null) ?? [];
  const coordination = (c.coordination_log as CoordinationEntry[] | null) ?? [];
  const nonSsPct = Number(c.non_ss_sub_pct ?? 0);
  const cparsStatus = (c.cpars_status as string | null) ?? "not_started";

  return (
    <div className={`card space-y-5 ${completed ? "opacity-80" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {(c.opportunity_title as string | null) ?? "Untitled contract"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {(c.contract_number as string | null) ?? "-"}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="text-sm font-semibold text-slate-900">
            {currency(c.award_amount as number | null)}
          </span>
          <ActionButton
            endpoint={`/api/contracts/${String(c.id)}/status`}
            body={{ status: completed ? "active" : "completed" }}
            className="btn-ghost text-xs"
            confirm={
              completed
                ? "Reopen this contract as active?"
                : "Mark this contract completed? It moves to Past contracts."
            }
          >
            {completed ? "Reopen" : "Mark complete"}
          </ActionButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <p className="label">Period</p>
          <p className="mt-0.5 text-sm text-slate-900">
            {shortDate(c.start_date as string | null)} -{" "}
            {shortDate(c.end_date as string | null)}
          </p>
        </div>
        <div>
          <p className="label">Primary sub</p>
          <p className="mt-0.5 text-sm text-slate-900">
            {(c.primary_sub_name as string | null) ?? "-"}
          </p>
        </div>
        <div>
          <p className="label">
            Backup sub{" "}
            <span className="text-[10px] normal-case text-risk">(required)</span>
          </p>
          <p
            className={`mt-0.5 text-sm ${
              c.backup_sub_name ? "text-slate-900" : "text-risk"
            }`}
          >
            {(c.backup_sub_name as string | null) ?? (
              <span className="text-risk">
                None assigned. Line up a backup from the Sub Database in case the primary falls through.
              </span>
            )}
          </p>
        </div>
        <div>
          <p
            className="label"
            title="CPARS is the government's report card on your performance. A good rating wins future work."
          >
            Performance review (CPARS)
          </p>
          <p className="mt-0.5 text-sm text-slate-900">
            {cparsStatus}
            {c.cpars_due_at ? (
              <span className="block text-xs text-slate-500">
                due {shortDate(c.cpars_due_at as string | null)}
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <NonSsGauge pctValue={nonSsPct} />

      <div>
        <p className="label">Milestone schedule</p>
        {milestones.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No milestones logged.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {milestones.map((m, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-800">
                    {m.name ?? "Milestone"}
                  </p>
                  <p className="text-xs text-slate-500">
                    due {shortDate(m.due)}
                    {m.amount != null ? ` · ${currency(m.amount)}` : ""}
                  </p>
                </div>
                <span className={`badge ${milestoneStatusClass(m.status)}`}>
                  {m.status ?? "not started"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="label">Coordination checklist</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Proof that your company actively manages this contract (site visits,
          sub coordination, QC checks). Agencies require this evidence that you
          are not just passing the work through to subs. Every item is logged
          with a timestamp.
        </p>
        {coordination.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">No activities logged yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {coordination.map((e, i) => {
              const done = e.done ?? e.completed ?? false;
              const at = e.at ?? e.timestamp ?? null;
              return (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
                >
                  <span className={done ? "text-pursue" : "text-slate-500"}>
                    {done ? "☑" : "☐"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800">
                      {e.task ?? e.label ?? e.note ?? "Activity"}
                    </p>
                    {at && (
                      <p className="text-xs text-slate-500">{shortDate(at)}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default async function ContractsPage() {
  const [contracts, past] = await Promise.all([
    activeContracts() as Promise<Record<string, unknown>[]>,
    completedContracts() as Promise<Record<string, unknown>[]>,
  ]);

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["contracts"]}
        title="Contracts"
        status={
          contracts.length === 0
            ? "No active contracts"
            : `${contracts.length} active${past.length ? ` · ${past.length} completed` : ""}`
        }
        subtitle="Awarded work under performance tracking: milestones, coordination proof, and non-small-business sub spend caps."
      />
      <div className="scroll-thin flex-1 space-y-8 overflow-y-auto p-4">
        <section className="mx-auto max-w-4xl">
          <h2 className="label mb-3">Active ({contracts.length})</h2>
          {contracts.length === 0 ? (
            <EmptyState
              title="No active contracts"
              description="When you record a win on an opportunity, the contract appears here for milestone tracking, coordination logs, and compliance caps."
              action={
                <Link href="/pipeline" className="btn-ghost text-sm">
                  Open pipeline
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {contracts.map((c) => (
                <ContractCard key={String(c.id)} c={c} />
              ))}
            </div>
          )}
        </section>

        {past.length > 0 && (
          <section className="mx-auto max-w-4xl">
            <h2 className="label mb-3">Past / completed ({past.length})</h2>
            <div className="grid grid-cols-1 gap-4">
              {past.map((c) => (
                <ContractCard key={String(c.id)} c={c} completed />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
