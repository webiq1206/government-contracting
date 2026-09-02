import Link from "next/link";
import {
  agentLogsPaged,
  agentRun,
  agentStatuses,
  jobRunsSummary,
  providerUsage,
  LOG_PAGE_SIZE,
  type AgentStatusRow,
} from "@/lib/data";
import { ROSTER } from "@/lib/agents/registry";
import { PageFrame } from "@/components/page-frame";
import {
  AutomationStatusPanel,
  AutomationIncidents,
} from "@/components/automation-incidents";
import { automationHealth } from "@/lib/automation-status";
import { syncAutomationIncidents } from "@/lib/incidents";
import { currentOrg } from "@/lib/data";
import { INCIDENT_NEXT_ACTION, INCIDENT_STATE_LABEL } from "@/lib/domain/incident";
import { RecoveryPanel } from "@/components/recovery-panel";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { AgentRunPeek } from "@/components/agent-run-peek";
import { QueueKeys } from "@/components/workspace/workspace-keys";
import { queuePosition } from "@/lib/domain/workspace-queue";
import { currentUser } from "@/lib/auth";
import { can } from "@/lib/domain/roles";
import { ActionButton } from "@/components/action-button";
import { AutomationControl } from "@/components/automation-control";
import { ProviderUsagePanel } from "@/components/provider-usage-panel";
import { getAutomationState } from "@/lib/app-settings";
import { timeAgo } from "@/lib/format";
import { scheduleLabel, nextRunAt, nextRunAcross } from "@/lib/domain/cron-describe";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}
function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

const LEVEL_COLOR: Record<string, string> = {
  success: "text-pursue",
  warn: "text-review",
  warning: "text-review",
  error: "text-risk",
  info: "text-slate-600",
};

function levelColor(level: string): string {
  return LEVEL_COLOR[level] ?? "text-slate-600";
}

/**
 * What an agent's most recent run says, in the words an operator would use.
 *
 * The roster used to show a schedule and nothing else, so "is this actually
 * doing anything" was unanswerable from the page whose entire job is to answer
 * it. Every branch here has to be readable on its own, including the two that
 * are easy to leave out: never ran at all, and ran but failed.
 */
function lastRunState(st: AgentStatusRow | undefined): {
  icon: string;
  tone: string;
  headline: string;
  detail: string | null;
} {
  if (!st || !st.last_run) {
    return {
      icon: "○",
      tone: "text-slate-500",
      headline: "Has never run",
      detail: null,
    };
  }
  const when = timeAgo(st.last_run);
  if (st.last_status === "error") {
    return {
      icon: "✕",
      tone: "text-risk",
      headline: `Last run failed ${when}`,
      detail: st.last_error?.slice(0, 200) ?? summaryText(st.last_summary),
    };
  }
  if (st.last_status === "running") {
    return { icon: "◐", tone: "text-review", headline: `Started ${when}, still running`, detail: null };
  }
  return {
    icon: "✓",
    tone: "text-pursue",
    headline: `Ran ${when}, succeeded`,
    detail: summaryText(st.last_summary),
  };
}

/**
 * The agent's own sentence about what it did, when it left one. Agents write a
 * `summary` string into the jsonb; anything else is shown compactly rather
 * than dropped, because a run with an unreadable result is still a result.
 */
function summaryText(summary: unknown): string | null {
  if (summary == null) return null;
  if (typeof summary === "string") return summary.slice(0, 200);
  if (typeof summary === "object") {
    const rec = summary as Record<string, unknown>;
    const line = rec.summary ?? rec.message;
    if (typeof line === "string" && line.trim()) return line.slice(0, 200);
    const json = JSON.stringify(summary);
    return json && json !== "{}" ? json.slice(0, 160) : null;
  }
  return String(summary).slice(0, 200);
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: {
    agent?: string;
    level?: string;
    q?: string;
    page?: string;
    run?: string;
  };
}) {
  const agentFilter = searchParams?.agent;
  const levelFilter = searchParams?.level;
  const q = searchParams?.q ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const [runs, paged, automation, statuses, live, provider] = await Promise.all([
    jobRunsSummary() as Promise<Row[]>,
    agentLogsPaged({ agent: agentFilter, level: levelFilter, q, page }),
    getAutomationState(),
    agentStatuses(),
    automationHealth(),
    providerUsage(),
  ]);
  const statusByAgent = new Map(statuses.map((s) => [s.agent, s]));
  // "When will anything happen next" is one of the seven facts the audit asks
  // this page's summary to carry, and it is the one that stops somebody
  // re-running by hand work that was about to run on its own.
  const nextRun = nextRunAcross(ROSTER.map((a) => a.cron));
  const nextRunLater = nextRun ?? null;
  /*
   * Record what the assessment just found, and read back the open incidents.
   *
   * Here rather than inside `automationHealth`, which the nav badge calls on
   * every page render: a write on every page load is a write nobody asked for
   * and would contend on the partial unique index under any real traffic.
   * This is the page where an incident matters.
   */
  const openIncidents = await syncAutomationIncidents(
    await currentOrg(),
    live,
    nextRunLater
  ).catch(() => []);

  const agentNext = new Map(ROSTER.map((a) => [a.name, nextRunAt(a.cron)]));
  const logs = paged.rows as Row[];
  const totalPages = Math.max(1, Math.ceil(paged.total / LOG_PAGE_SIZE));

  // Preserve active filters when building filter/pagination links.
  const link = (patch: Record<string, string | number | undefined>) => {
    const merged: Record<string, string> = {};
    const base: Record<string, string | undefined> = {
      agent: agentFilter,
      level: levelFilter,
      q: q || undefined,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) {
      if (v != null && v !== "") merged[k] = String(v);
    }
    const qs = new URLSearchParams(merged).toString();
    return qs ? `/agents?${qs}` : "/agents";
  };

  /*
   * The open run, as a query parameter.
   *
   * The log stores the request, the response and the record each run touched,
   * and rendered none of them: fifty rows of summary over the evidence that
   * would explain any one of them. Opening a row now shows all of it, beside
   * the stream rather than instead of it, so reading one failure does not cost
   * the filters and the page you found it on.
   */
  const openRunId = searchParams?.run ?? null;
  const openRun = openRunId ? await agentRun(openRunId) : null;
  const runIds = logs.map((l) => str(l.id));
  const runPosition = queuePosition(runIds, openRunId);
  const runHref = (id: string | null) => link({ page, run: id ?? undefined });
  const viewer = await currentUser().catch(() => null);

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["agents"]}
        title="Automation Health"
        explanation="Whether the automation is doing its work, what is stopping it, and how to fix it."
        status={live.headline}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div
        className="scroll-thin min-w-0 flex-1 space-y-6 overflow-y-auto p-5"
        data-guide-target="agent-log"
        id="agent-log"
      >
        {/* Master switch: pause/resume all automation side effects. */}
        <AutomationControl state={automation} healthy={live.state === "healthy"} />

        {/*
          The state, then the causes, then the roster. The old order was a
          failure COUNT, then a reverse-chronological feed of every one of
          them, which put the single fixable cause on page nine underneath its
          own symptoms.
        */}
        <AutomationStatusPanel health={live} nextRun={nextRun ? nextRun.toISOString() : null} />
        <AutomationIncidents health={live} />

        {/*
          What happens AFTER the fix at the provider, which is the part nobody
          had. An operator who has just topped up an account had no way to find
          out whether it worked except by waiting to see if the red went away.
        */}
        <RecoveryPanel
          incidents={openIncidents.map((i) => ({
            id: i.id,
            state: i.state,
            stateLabel: INCIDENT_STATE_LABEL[i.state],
            nextAction: INCIDENT_NEXT_ACTION[i.state],
            cause: i.cause,
            startedAt: i.startedAt.toISOString(),
            failedCount: i.failedCount,
            requeuedCount: i.requeuedCount,
            remainingCount: i.remainingCount,
            recommendedAction: i.recommendedAction,
            repairAttempts: i.repairAttempts,
            recoveryOwner: i.recoveryOwner,
            testRanAt: i.testRanAt?.toISOString() ?? null,
            testPassed: i.testPassed,
            recoveryNote: i.recoveryNote,
            history: [],
          }))}
        />

        {/*
          * Item 6 of the audit's structure, and the half of it that was
          * missing entirely. Placed under the incidents because it answers the
          * question the incidents raise: the balance ran out, so what is the
          * balance, and how much of it is left.
          */}
        <ProviderUsagePanel
          source={provider.source}
          grantExpiresAt={provider.grantExpiresAt ? provider.grantExpiresAt.toISOString() : null}
          callsOnPlatformKey={provider.callsOnPlatformKey}
          trialBudget={provider.trialBudget}
          usageRows={provider.usageRows}
          incidentCauses={live.incidents.map((i) => i.cause)}
        />

        {live.errors24h > 0 && (
          <p className="text-xs text-muted-foreground">
            <Link href={link({ level: "error", page: undefined })} className="underline underline-offset-2">
              See every failed run
            </Link>{" "}
            ({live.errors24h} of {live.runs24h} runs in the last 24 hours).
          </p>
        )}

        {/* Roster grid with run controls */}
        <section>
          <h2 className="label mb-2">Roster</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROSTER.map((a) => {
              const st = statusByAgent.get(a.name);
              const last = lastRunState(st);
              return (
                <div key={a.name} className="card flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{a.label}</p>
                      <p className="font-mono text-xs text-slate-500">{a.name}</p>
                    </div>
                    <span
                      className={
                        a.cron
                          ? "badge shrink-0 bg-accent/10 text-accent"
                          : "badge shrink-0 bg-slate-200 text-slate-600"
                      }
                      title={
                        // The schedule says how often; the title says when, so
                        // "it has not run" can be told apart from "it is not due".
                        agentNext.get(a.name)
                          ? `Next run ${agentNext.get(a.name)!.toISOString().replace("T", " ").slice(0, 16)} UTC`
                          : undefined
                      }
                    >
                      {scheduleLabel(a.cron)}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-600">{a.description}</p>

                  {/* The three questions the roster exists to answer: is it on,
                      did it run, did it work. */}
                  <div className="rounded-md border border-border/60 bg-slate-50/60 px-2.5 py-2">
                    <p className={`flex items-center gap-1.5 text-xs font-medium ${last.tone}`}>
                      <span aria-hidden>{last.icon}</span>
                      {last.headline}
                    </p>
                    {last.detail && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">{last.detail}</p>
                    )}
                    {st && st.runs_24h > 0 && (
                      <p className="mt-1 text-xs text-slate-500">
                        {st.runs_24h === 1
                          ? "1 run in 24h"
                          : `${st.runs_24h} runs in 24h`}
                        {st.errors_24h > 0
                          ? st.errors_24h === 1
                            ? ", 1 failed"
                            : `, ${st.errors_24h} failed`
                          : ""}
                      </p>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <Link
                      href={`/agents?agent=${a.name}`}
                      className="inline-flex min-h-11 items-center text-xs text-slate-600 hover:text-accent lg:min-h-0"
                    >
                      See what it did
                    </Link>
                    <ActionButton endpoint={`/api/agents/${a.name}/run`} className="btn-ghost">
                      Run now
                    </ActionButton>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Job run summary */}
        <section>
          <h2 className="label mb-2">Recent job runs</h2>
          {runs.length === 0 ? (
            <p className="card text-sm text-slate-600">
              No job runs recorded yet. Press Run now on any agent below.
            </p>
          ) : (
            <>
              <ul className="space-y-2 lg:hidden">
                {runs.map((r) => (
                  <li key={str(r.agent)} className="card p-3">
                    <p className="font-mono text-xs text-foreground">{str(r.agent)}</p>
                    <p className="mt-1 text-sm">
                      <span className="text-pursue">{num(r.ok) ?? 0} ok</span>
                      <span className="text-muted-foreground"> · </span>
                      <span className="text-risk">{num(r.error) ?? 0} errors</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {timeAgo(str(r.last_run) || null)}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="card hidden overflow-x-auto p-0 lg:block">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="th">Agent</th>
                      <th className="th">OK</th>
                      <th className="th">Errors</th>
                      <th className="th">Last run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={str(r.agent)} className="border-b border-border">
                        <td className="td font-mono text-xs">{str(r.agent)}</td>
                        <td className="td text-pursue">{num(r.ok) ?? 0}</td>
                        <td className="td text-risk">{num(r.error) ?? 0}</td>
                        <td className="td text-slate-600">{timeAgo(str(r.last_run) || null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {/* Log feed */}
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="label">Activity feed</h2>
            <span className="num text-xs text-slate-500">
              {paged.total.toLocaleString()} entr{paged.total === 1 ? "y" : "ies"}
            </span>
          </div>

          {/* Search + level filter (GET form so links stay shareable) */}
          <form method="get" action="/agents" className="mb-2 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            {agentFilter && <input type="hidden" name="agent" value={agentFilter} />}
            <input
              className="input w-full lg:max-w-xs"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search messages…"
              aria-label="Search Automation Health"
            />
            <select
              className="select w-full lg:w-auto"
              name="level"
              defaultValue={levelFilter ?? ""}
              aria-label="Filter the log by severity"
            >
              <option value="">All levels</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
              <option value="warn">Warnings</option>
              <option value="error">Errors</option>
            </select>
            <button className="btn-ghost w-full lg:w-auto" type="submit">
              Filter
            </button>
            {(q || levelFilter) && (
              <Link href={link({ q: undefined, level: undefined, page: undefined })} className="text-xs text-slate-500 hover:text-accent">
                Clear
              </Link>
            )}
          </form>

          <div className="mb-2 flex flex-wrap gap-1.5">
            <Link
              href={link({ agent: undefined, page: undefined })}
              className={`badge min-h-11 lg:min-h-0 ${!agentFilter ? "bg-accent/10 text-accent" : "bg-slate-200 text-slate-600"}`}
            >
              All agents
            </Link>
            {ROSTER.map((a) => (
              <Link
                key={a.name}
                href={link({ agent: a.name, page: undefined })}
                className={`badge min-h-11 lg:min-h-0 ${
                  agentFilter === a.name
                    ? "bg-accent/10 text-accent"
                    : "bg-slate-200 text-slate-600 hover:text-slate-800"
                }`}
              >
                {a.name}
              </Link>
            ))}
          </div>

          <div className="space-y-2">
            {logs.length === 0 && (
              <EmptyState
                title={
                  q || levelFilter
                    ? "No log entries match these filters"
                    : agentFilter
                      ? `No log entries for ${agentFilter} yet`
                      : "No log entries yet"
                }
                description={
                  q || levelFilter
                    ? "Try a different search term or clear filters."
                    : "Press Run now on any agent in the roster, or wait for the next scheduled job."
                }
                action={
                  q || levelFilter ? (
                    <Link
                      href={link({ q: undefined, level: undefined, page: undefined })}
                      className="btn-ghost text-sm"
                    >
                      Clear filters
                    </Link>
                  ) : undefined
                }
              />
            )}
            {logs.map((log) => {
              const level = str(log.level) || "info";
              const duration = num(log.duration_ms);
              const reasoning = str(log.reasoning);
              return (
                <Link
                  key={str(log.id)}
                  href={runHref(str(log.id))}
                  scroll={false}
                  aria-current={str(log.id) === openRunId ? "true" : undefined}
                  className={`card flex gap-3 transition-colors hover:border-accent/50 ${
                    str(log.id) === openRunId ? "border-gold bg-gold/[0.06]" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-slate-200 font-mono text-slate-700">
                        {str(log.agent)}
                      </span>
                      <span className={`text-xs font-semibold uppercase ${levelColor(level)}`}>
                        {level}
                      </span>
                      <span className="text-sm text-slate-800">{str(log.action)}</span>
                    </div>
                    {str(log.message) && (
                      <p className="mt-1 text-sm text-slate-700">{str(log.message)}</p>
                    )}
                    {reasoning && (
                      <p className="mt-1 text-xs text-slate-500">{reasoning}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-600">{timeAgo(str(log.created_at) || null)}</p>
                    {duration != null && (
                      <p className="mt-0.5 num text-xs text-slate-500">{duration}ms</p>
                    )}
                    <p className="mt-1 text-xs text-accent">Open</p>
                  </div>
                </Link>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              {page > 1 ? (
                <Link href={link({ page: page - 1 })} className="btn-ghost text-xs">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              <span className="num text-xs text-slate-500">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link href={link({ page: page + 1 })} className="btn-ghost text-xs">
                  Older →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </section>
      </div>

      {openRun && (
        <AgentRunPeek
          run={openRun}
          closeHref={runHref(null)}
          canRun={can(viewer?.orgRole, "manage_integrations")}
          nav={{
            prevHref: runPosition.prevId ? runHref(runPosition.prevId) : null,
            nextHref: runPosition.nextId ? runHref(runPosition.nextId) : null,
            index: runPosition.index,
            total: runPosition.total,
          }}
        />
      )}
      <QueueKeys
        prevHref={runPosition.prevId ? runHref(runPosition.prevId) : null}
        nextHref={runPosition.nextId ? runHref(runPosition.nextId) : null}
        closeHref={openRunId ? runHref(null) : null}
      />
      </div>
    </div>
  );
}
