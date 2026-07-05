import Link from "next/link";
import { agentLogs, jobRunsSummary } from "@/lib/data";
import { ROSTER } from "@/lib/agents/registry";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
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
  searchParams?: { agent?: string };
}) {
  const agentFilter = searchParams?.agent;
  const [runs, logs] = await Promise.all([
    jobRunsSummary() as Promise<Row[]>,
    agentLogs({ agent: agentFilter, limit: 150 }) as Promise<Row[]>,
  ]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Agents & Logs"
        subtitle={`${ROSTER.length} agents in the roster`}
      />

      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
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
                    View logs
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
                    <td className="td text-slate-500" colSpan={4}>
                      No job runs recorded yet.
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
            <div className="flex flex-wrap gap-1.5">
              <Link
                href="/agents"
                className={`badge ${!agentFilter ? "bg-accent/10 text-accent" : "bg-slate-200 text-slate-600"}`}
              >
                All
              </Link>
              {ROSTER.map((a) => (
                <Link
                  key={a.name}
                  href={`/agents?agent=${a.name}`}
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
          </div>

          <div className="space-y-2">
            {logs.length === 0 && (
              <div className="card text-sm text-slate-500">
                No log entries{agentFilter ? ` for ${agentFilter}` : ""} yet.
              </div>
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
                      <p className="mt-0.5 num text-xs text-slate-400">{duration}ms</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
