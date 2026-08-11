import Link from "next/link";
import { agentHealth, agentLogsPaged, jobRunsSummary, LOG_PAGE_SIZE } from "@/lib/data";
import { ROSTER } from "@/lib/agents/registry";
import { PageHeader } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { PAGE_HELP } from "@/lib/help-content";
import { ActionButton } from "@/components/action-button";
import { AutomationControl } from "@/components/automation-control";
import { getAutomationState } from "@/lib/app-settings";
import { timeAgo } from "@/lib/format";

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

export default async function AgentsPage({
  searchParams,
}: {
  searchParams?: { agent?: string; level?: string; q?: string; page?: string };
}) {
  const agentFilter = searchParams?.agent;
  const levelFilter = searchParams?.level;
  const q = searchParams?.q ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const [runs, paged, automation, health] = await Promise.all([
    jobRunsSummary() as Promise<Row[]>,
    agentLogsPaged({ agent: agentFilter, level: levelFilter, q, page }),
    getAutomationState(),
    agentHealth(),
  ]);
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

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["agents"]}
        title="Automation Log"
        status={
          health.errors24h > 0
            ? `${health.errors24h} error${health.errors24h === 1 ? "" : "s"} in the last 24 hours`
            : health.runs24h > 0
              ? "All agents healthy"
              : "No runs in the last 24 hours"
        }
        subtitle={`${ROSTER.length} agents run this platform. See what each one did, filter the feed, or run one manually.`}
      />

      <div
        className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5"
        data-guide-target="agent-log"
        id="agent-log"
      >
        {/* Master switch: pause/resume all automation side effects. */}
        <AutomationControl state={automation} />

        {/* One-look health: is the machine OK? */}
        {health.errors24h > 0 ? (
          <Link
            href={link({ level: "error", page: undefined })}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-risk/40 bg-risk/5 px-4 py-2.5 text-sm transition-colors hover:border-risk/70"
          >
            <span className="text-slate-800">
              <span className="font-semibold text-risk">
                {health.errors24h} of {health.runs24h} runs failed
              </span>{" "}
              in the last 24 hours
              {health.worstAgent ? (
                <>
                  , most affected:{" "}
                  <span className="font-mono text-xs">{health.worstAgent}</span>
                </>
              ) : null}
              .
            </span>
            <span className="btn-ghost pointer-events-none text-xs">See the errors →</span>
          </Link>
        ) : health.runs24h > 0 ? (
          <p className="rounded-md border border-pursue/30 bg-pursue/5 px-4 py-2.5 text-sm text-slate-700">
            <span className="font-semibold text-pursue">✓ All agents healthy.</span>{" "}
            {health.runs24h} run{health.runs24h === 1 ? "" : "s"} in the last 24 hours, no
            failures. Last activity {timeAgo(health.lastRunAt)}.
          </p>
        ) : (
          <p className="rounded-md border border-border bg-surface px-4 py-2.5 text-sm text-slate-600">
            No agent runs in the last 24 hours. If automation is running (above), the next
            scheduled job will appear here; you can also press &ldquo;Run now&rdquo; on any
            agent below.
          </p>
        )}

        {/* Roster grid with run controls */}
        <section>
          <h2 className="label mb-2">Roster</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROSTER.map((a) => (
              <div key={a.name} className="card flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{a.label}</p>
                    <p className="font-mono text-xs text-slate-500">{a.name}</p>
                  </div>
                  {a.cron ? (
                    <span className="badge bg-accent/10 font-mono text-accent">{a.cron}</span>
                  ) : (
                    <span className="badge bg-slate-200 text-slate-600">event-triggered</span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-slate-600">{a.description}</p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <Link
                    href={`/agents?agent=${a.name}`}
                    className="text-xs text-slate-600 hover:text-accent"
                  >
                    Filter to this agent
                  </Link>
                  <ActionButton endpoint={`/api/agents/${a.name}/run`} className="btn-ghost">
                    Run now
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Job run summary */}
        <section>
          <h2 className="label mb-2">Recent job runs</h2>
          <div className="card overflow-x-auto p-0">
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
                {runs.length === 0 && (
                  <tr>
                    <td className="td text-slate-600" colSpan={4}>
                      No job runs recorded yet. Press Run now on any agent below.
                    </td>
                  </tr>
                )}
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
          <form method="get" action="/agents" className="mb-2 flex flex-wrap items-center gap-2">
            {agentFilter && <input type="hidden" name="agent" value={agentFilter} />}
            <input
              className="input max-w-xs"
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search messages…"
            />
            <select className="select w-auto" name="level" defaultValue={levelFilter ?? ""}>
              <option value="">All levels</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
              <option value="warn">Warnings</option>
              <option value="error">Errors</option>
            </select>
            <button className="btn-ghost" type="submit">
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
              className={`badge ${!agentFilter ? "bg-accent/10 text-accent" : "bg-slate-200 text-slate-600"}`}
            >
              All agents
            </Link>
            {ROSTER.map((a) => (
              <Link
                key={a.name}
                href={link({ agent: a.name, page: undefined })}
                className={`badge ${
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
                <div key={str(log.id)} className="card flex gap-3">
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
                  </div>
                </div>
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
    </div>
  );
}
