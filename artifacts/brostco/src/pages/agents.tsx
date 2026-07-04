import { useState } from "react";
import { useGetAgents, useGetAgentLogs, getGetAgentLogsQueryKey, getGetAgentsQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/badges";
import { ActionButton } from "@/components/action-button";
import { timeAgo } from "@/lib/format";

interface AgentDef {
  name: string;
  label: string;
  description: string;
  cron: string | null;
}

const LEVEL_COLOR: Record<string, string> = {
  success: "text-pursue",
  warn: "text-review",
  warning: "text-review",
  error: "text-risk",
  info: "text-slate-400",
};

export default function AgentsPage() {
  const [agentFilter, setAgentFilter] = useState<string | undefined>();
  const { data: agentsData } = useGetAgents();
  const roster: AgentDef[] = (agentsData as Record<string, unknown> | undefined)?.roster as AgentDef[] ?? [];
  const jobRuns = (agentsData as Record<string, unknown> | undefined)?.job_runs as Record<string, unknown>[] ?? [];

  const logsParams = agentFilter ? { agent: agentFilter } : {};
  const { data: logs = [] } = useGetAgentLogs(logsParams as never);

  const agentsQKey = getGetAgentsQueryKey() as unknown as string[];
  const logsQKey = getGetAgentLogsQueryKey(logsParams as never) as unknown as string[];

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Agents & Logs" subtitle={`${roster.length} agents in the roster`} />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        <section>
          <h2 className="label mb-2">Roster</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {roster.map((a) => {
              const recentRun = (jobRuns as Record<string, unknown>[]).find((r) => r.agent === a.name);
              return (
                <div key={a.name} className="card flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">{a.label}</p>
                      <p className="font-mono text-xs text-slate-500">{a.name}</p>
                    </div>
                    {a.cron ? (
                      <span className="badge bg-brand-600/15 font-mono text-brand-400">{a.cron}</span>
                    ) : (
                      <span className="badge bg-ink-700 text-slate-400">event-triggered</span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs text-slate-400">{a.description}</p>
                  {recentRun && (
                    <p className="text-xs text-slate-500">
                      Last run: <span className={recentRun.status === "ok" ? "text-pursue" : "text-risk"}>{String(recentRun.status)}</span>{" "}
                      {timeAgo(String(recentRun.started_at))}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                    <button
                      className="text-xs text-slate-400 hover:text-brand-400"
                      onClick={() => setAgentFilter(agentFilter === a.name ? undefined : a.name)}
                    >
                      {agentFilter === a.name ? "Clear filter" : "View logs"}
                    </button>
                    <ActionButton
                      endpoint={`/api/agents/${a.name}/run`}
                      className="btn-ghost"
                      invalidateKeys={[agentsQKey, logsQKey]}
                    >Run now</ActionButton>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="label">{agentFilter ? `Logs for ${agentFilter}` : "Recent activity"}</h2>
            {agentFilter && (
              <button className="text-xs text-slate-400 hover:text-brand-400" onClick={() => setAgentFilter(undefined)}>Show all</button>
            )}
          </div>
          <div className="card overflow-hidden p-0">
            <table className="w-full border-collapse">
              <thead className="border-b border-ink-800 bg-ink-900/60">
                <tr>
                  <th className="th">Agent</th>
                  <th className="th">Action</th>
                  <th className="th">Level</th>
                  <th className="th">Message</th>
                  <th className="th">Time</th>
                </tr>
              </thead>
              <tbody>
                {(logs as Record<string, unknown>[]).map((log) => (
                  <tr key={String(log.id)} className="border-b border-ink-800/40 last:border-0">
                    <td className="td font-mono text-xs">{String(log.agent)}</td>
                    <td className="td text-xs text-slate-400">{String(log.action)}</td>
                    <td className="td">
                      <span className={`text-xs font-medium ${LEVEL_COLOR[String(log.level)] ?? "text-slate-400"}`}>
                        {String(log.level)}
                      </span>
                    </td>
                    <td className="td max-w-xs truncate text-xs text-slate-300">{log.message ? String(log.message) : "—"}</td>
                    <td className="td text-xs text-slate-500">{timeAgo(String(log.created_at))}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr><td colSpan={5} className="td py-6 text-center text-slate-500">No logs yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
