/**
 * agent_logs writer, the platform's audit backbone. Every agent action is
 * logged with its reasoning (architecture principle: "Every agent action is
 * logged with its reasoning in the agent_logs table"). Console output mirrors
 * the DB write so logs are visible during local dev and on Replit.
 */
import { query } from "./db";

export interface AgentLogInput {
  agent: string;
  action: string;
  opportunityId?: string | null;
  subcontractorId?: string | null;
  bidId?: string | null;
  level?: "info" | "warn" | "error" | "success";
  status?: "ok" | "error" | "skipped";
  message?: string;
  reasoning?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number;
  claudeUsage?: unknown;
}

export async function logAgent(entry: AgentLogInput): Promise<void> {
  const level = entry.level ?? "info";
  const prefix = `[${entry.agent}] ${entry.action}`;
  const line = entry.message ? `${prefix}, ${entry.message}` : prefix;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  try {
    await query(
      `insert into agent_logs
         (agent, action, opportunity_id, subcontractor_id, bid_id,
          level, status, message, reasoning, input_json, output_json,
          duration_ms, claude_usage)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        entry.agent,
        entry.action,
        entry.opportunityId ?? null,
        entry.subcontractorId ?? null,
        entry.bidId ?? null,
        level,
        entry.status ?? "ok",
        entry.message ?? null,
        entry.reasoning ?? null,
        entry.input == null ? null : JSON.stringify(entry.input),
        entry.output == null ? null : JSON.stringify(entry.output),
        entry.durationMs ?? null,
        entry.claudeUsage == null ? null : JSON.stringify(entry.claudeUsage),
      ]
    );
  } catch (err) {
    // Logging must never crash an agent. Surface to console only.
    console.error("[logger] failed to persist agent_log:", (err as Error).message);
  }
}

/** Convenience: wrap an async unit of work, timing it and logging success/failure. */
export async function withLog<T>(
  base: Omit<AgentLogInput, "durationMs" | "status" | "level">,
  fn: () => Promise<T>
): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    await logAgent({
      ...base,
      status: "ok",
      level: "success",
      durationMs: Date.now() - started,
    });
    return result;
  } catch (err) {
    await logAgent({
      ...base,
      status: "error",
      level: "error",
      message: `${base.message ?? ""} ${(err as Error).message}`.trim(),
      durationMs: Date.now() - started,
    });
    throw err;
  }
}
