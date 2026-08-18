/**
 * agent_logs writer, the platform's audit backbone. Every agent action is
 * logged with its reasoning (architecture principle: "Every agent action is
 * logged with its reasoning in the agent_logs table"). Console output mirrors
 * the DB write so logs are visible during local dev and on Replit.
 */
import { query } from "./db";
import { actingOrgId } from "./tenant-context";

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

/**
 * Which organization this log line belongs to.
 *
 * agent_logs is a root table, so 042's derive-org triggers never reached it,
 * and nothing here ever set the column: every row on the platform carries a
 * null org. The Automation Log page reads `where org_id = $1`, so the audit
 * backbone has been writing to a table no customer can read from. Agents get
 * the org from their runWithOrg context; a log written while serving a request
 * gets it from the signed-in user. The auth import is lazy because the worker
 * has no request to read.
 */
const resolveLogOrgId = actingOrgId;

/** Postgres: a referenced row does not exist. */
const FOREIGN_KEY_VIOLATION = "23503";

/** The three columns that point at other tables, and can therefore dangle. */
interface LogRefs {
  opportunityId: string | null;
  subcontractorId: string | null;
  bidId: string | null;
}

async function insertAgentLog(
  entry: AgentLogInput,
  level: string,
  refs: LogRefs,
  message: string | null,
  orgId: string | null
): Promise<void> {
  await query(
    `insert into agent_logs
       (org_id, agent, action, opportunity_id, subcontractor_id, bid_id,
        level, status, message, reasoning, input_json, output_json,
        duration_ms, claude_usage)
     values ($14,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      entry.agent,
      entry.action,
      refs.opportunityId,
      refs.subcontractorId,
      refs.bidId,
      level,
      entry.status ?? "ok",
      message,
      entry.reasoning ?? null,
      entry.input == null ? null : JSON.stringify(entry.input),
      entry.output == null ? null : JSON.stringify(entry.output),
      entry.durationMs ?? null,
      entry.claudeUsage == null ? null : JSON.stringify(entry.claudeUsage),
      orgId,
    ]
  );
}

/** The reference columns, paired with the constraint that guards each one. */
const REF_COLUMNS: { key: keyof LogRefs; column: string; label: string }[] = [
  { key: "opportunityId", column: "opportunity_id", label: "opportunity" },
  { key: "subcontractorId", column: "subcontractor_id", label: "subcontractor" },
  { key: "bidId", column: "bid_id", label: "bid" },
];

/**
 * Which of our reference columns a foreign key complaint is about, if any.
 *
 * Only the three record links may be dropped to save a log line. Any other
 * foreign key failure means something we do not understand is wrong, and
 * blanking columns until it inserts would file a misleading row and hide it.
 * Exported so the mapping can be tested without provoking a live violation.
 */
export function refColumnForConstraint(
  constraint: string | undefined
): (typeof REF_COLUMNS)[number] | null {
  if (!constraint || !constraint.startsWith("agent_logs")) return null;
  return REF_COLUMNS.find((r) => constraint.includes(r.column)) ?? null;
}

/** Keeps an id in the sentence once it can no longer be kept in a column. */
function describeDropped(dropped: { label: string; id: string }[]): string {
  const named = dropped.map((d) => `${d.label} ${d.id}`);
  const verb = named.length > 1 ? "no longer exist" : "no longer exists";
  return `(Recorded without its record link: ${named.join(", ")} ${verb}.)`;
}

export async function logAgent(entry: AgentLogInput): Promise<void> {
  const level = entry.level ?? "info";
  const prefix = `[${entry.agent}] ${entry.action}`;
  const line = entry.message ? `${prefix}, ${entry.message}` : prefix;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  const refs: LogRefs = {
    opportunityId: entry.opportunityId ?? null,
    subcontractorId: entry.subcontractorId ?? null,
    bidId: entry.bidId ?? null,
  };
  const message = entry.message ?? null;

  try {
    const orgId = await resolveLogOrgId();
    /**
     * A record this line points at may have been deleted, and until now the
     * line was lost with it. That is the worst possible moment to lose a log
     * line: the reason a job failed is exactly that its record is gone, and
     * the explanation was being discarded for the same reason it needed
     * writing.
     *
     * So drop a link the database refuses, name that id in the message
     * instead, and try again. One pass per reference column, because a payload
     * can name more than one deleted record, and each violation reports only
     * the first constraint it hits. Every other link is left intact: a job
     * about a live subcontractor and a deleted opportunity keeps the half of
     * the trail that is still true.
     */
    const dropped: { label: string; id: string }[] = [];
    for (let attempt = 0; attempt <= REF_COLUMNS.length; attempt++) {
      try {
        const text = dropped.length
          ? [message, describeDropped(dropped)].filter(Boolean).join(" ")
          : message;
        await insertAgentLog(entry, level, refs, text, orgId);
        return;
      } catch (err) {
        if ((err as { code?: string }).code !== FOREIGN_KEY_VIOLATION) throw err;
        const ref = refColumnForConstraint((err as { constraint?: string }).constraint);
        // Not one of the record links, so not ours to reinterpret.
        if (!ref) throw err;
        const id = refs[ref.key];
        refs[ref.key] = null;
        if (id) dropped.push({ label: ref.label, id });
      }
    }
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
