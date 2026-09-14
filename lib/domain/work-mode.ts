/**
 * Who does the work: this company, subcontractors, or both.
 *
 * Pure. The company-wide default is an automation rule (work_execution);
 * an opportunity may override it, and on a mixed job individual scopes can
 * be marked self-performed. Everything that decides whether to source,
 * email, call or chase a subcontractor asks these functions, so the UI,
 * the queue and the agents cannot disagree about it.
 *
 * "Outreach off" is about this platform's optional workflow. It never
 * removes a requirement the solicitation imposes.
 */

export type WorkMode = "self" | "sub" | "mixed";

export const WORK_MODES: WorkMode[] = ["sub", "self", "mixed"];

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  sub: "Subcontracted",
  self: "Self-performed",
  mixed: "Mixed",
};

export const WORK_MODE_HINT: Record<WorkMode, string> = {
  sub: "Brost Co finds, emails and follows up with subcontractors for every trade, and builds the bid from their quotes.",
  self: "Your own crews do the work. No subcontractor sourcing, outreach or follow-ups. You enter your own pricing and the bid is built from that.",
  mixed: "Some scopes are yours, some are subcontracted. Mark the scopes you self-perform on each opportunity; the rest get subcontractor outreach.",
};

export function parseWorkMode(v: unknown): WorkMode | null {
  return v === "self" || v === "sub" || v === "mixed" ? v : null;
}

export interface WorkModeFacts {
  work_mode?: string | null;
  self_performed_trades?: string[] | null;
}

/** The mode in force for a record: its own override, else the company default. */
export function effectiveWorkMode(orgDefault: WorkMode, opp: WorkModeFacts | null | undefined): WorkMode {
  return parseWorkMode(opp?.work_mode) ?? orgDefault;
}

/** Whether subcontractor sourcing, outreach and follow-ups may run at all. */
export function outreachAllowed(orgDefault: WorkMode, opp: WorkModeFacts | null | undefined): boolean {
  return effectiveWorkMode(orgDefault, opp) !== "self";
}

/** Trades compare loosely: "HVAC" and "hvac " are one scope. */
export function tradeKey(trade: string | null | undefined): string {
  return (trade ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whether one scope is done in-house under the record's mode. */
export function tradeSelfPerformed(
  mode: WorkMode,
  selfTrades: readonly string[] | null | undefined,
  trade: string | null | undefined
): boolean {
  if (mode === "self") return true;
  if (mode === "sub") return false;
  const key = tradeKey(trade);
  if (!key) return false;
  return (selfTrades ?? []).some((t) => tradeKey(t) === key);
}

/** The scopes that still need a subcontractor. */
export function tradesNeedingSubs(
  mode: WorkMode,
  selfTrades: readonly string[] | null | undefined,
  trades: readonly string[]
): string[] {
  return trades.filter((t) => !tradeSelfPerformed(mode, selfTrades, t));
}

/** One sentence for the record page. */
export function describeWorkMode(mode: WorkMode, inherited: boolean, selfTrades: readonly string[] = []): string {
  const base =
    mode === "self"
      ? "Self-performed: no subcontractor outreach on this opportunity."
      : mode === "mixed"
        ? selfTrades.length > 0
          ? `Mixed: you self-perform ${selfTrades.join(", ")}; the other scopes get subcontractor outreach.`
          : "Mixed: mark the scopes you self-perform; the rest get subcontractor outreach."
        : "Subcontracted: Brost Co finds and contacts subcontractors for every scope.";
  return inherited ? `${base} (Company default.)` : base;
}

export interface OutreachStopCounts {
  pendingCalls: number;
  followUpsDue: number;
  sentMessages: number;
  subsPaired: number;
}

/**
 * What switching outreach off does to work already in motion, in sentences
 * a person reads before confirming. Says plainly that nothing already sent
 * is taken back.
 */
export function outreachOffImpact(c: OutreachStopCounts): string[] {
  const out: string[] = [];
  if (c.pendingCalls > 0) out.push(`${c.pendingCalls} prepared call${c.pendingCalls === 1 ? "" : "s"} will be cleared from the Call Queue.`);
  if (c.followUpsDue > 0) out.push(`${c.followUpsDue} scheduled follow-up email${c.followUpsDue === 1 ? "" : "s"} will not be sent.`);
  if (c.sentMessages > 0)
    out.push(
      `${c.sentMessages} message${c.sentMessages === 1 ? "" : "s"} already sent stay${c.sentMessages === 1 ? "s" : ""} on the record with any replies. Turning outreach off does not retract them.`
    );
  if (c.subsPaired > 0) out.push(`${c.subsPaired} paired subcontractor${c.subsPaired === 1 ? "" : "s"} and any quotes are kept.`);
  if (out.length === 0) out.push("No outreach is in motion on this opportunity, so nothing is stopped.");
  out.push("Deadlines, documents, requirements and pricing are unaffected.");
  return out;
}

/** SQL predicate: rows whose effective mode allows outreach. `param` is the org default's placeholder. */
export function outreachAllowedSql(alias: string, param: string): string {
  return `coalesce(${alias}.work_mode, ${param}) <> 'self'`;
}

/** Queue jobs that only make sense when subcontractor outreach is on. */
export const OUTREACH_JOBS: ReadonlySet<string> = new Set(["sub-finder", "sub-verify", "outreach", "call-prep"]);
