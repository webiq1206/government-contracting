/**
 * Whether paid AI work for an agent may be queued for an organization now.
 *
 * The spending ledger admits or refuses each provider call at run time, and
 * that is the check that actually protects money. But the schedulers that
 * feed the queue select on state ("scored, not yet briefed"), not on whether
 * the last attempt was refused, so while an allowance is exhausted they
 * re-create the same job every fifteen minutes. Each one runs, is refused
 * before it costs anything, and is logged as a failure. One account produced
 * seven hundred such "failures" a day. This asks the same admission question
 * once, before the job exists, so held work is simply not queued until the
 * allowance allows it. The memo keeps a sweep that would ask two hundred
 * times in a row from asking the database two hundred times.
 */

const MEMO_MS = 30_000;
const memo = new Map<string, { until: number; hold: string | null }>();

/** For tests, and for a settings change that should take effect at once. */
export function clearAiAdmissionMemo(): void {
  memo.clear();
}

/** Strip the ledger's prefix so the sentence reads as a reason. */
export function holdReason(message: string): string {
  return message.replace(/^API_BUDGET:\s*/, "");
}

/**
 * The reason this agent's AI work is on hold for the organization, or null
 * when it may be queued. Agents that run without AI are never held here, and
 * a failure to answer the question is treated as "not held": the run itself
 * will surface whatever went wrong, which is better than silently dropping
 * work because a lookup failed.
 */
export async function aiEnqueueHold(
  agentName: string,
  orgId: string | null | undefined
): Promise<string | null> {
  if (!orgId) return null;
  try {
    const { getAgent } = await import("../agents/registry");
    const def = getAgent(agentName);
    if (!def || def.worksWithoutClaude) return null;
    const tier = def.aiTier ?? "routine";
    const key = `${orgId}:${tier}`;
    const cached = memo.get(key);
    if (cached && cached.until > Date.now()) return cached.hold;
    let hold: string | null = null;
    try {
      const { runWithOrg } = await import("../tenant-context");
      const { checkAiSpending } = await import("../api-usage/check-spending");
      await runWithOrg(orgId, () => checkAiSpending(orgId, tier, def.name));
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "ApiUsageBlockedError") return null;
      /*
       * Only a spending refusal is a hold. The same typed error also says "AI
       * is not connected", which is a setup problem the run reports in its
       * own words (and which a manual run must still be allowed to surface),
       * not a reason to leave work unqueued.
       */
      if (!/^API_BUDGET:/.test(error.message)) return null;
      hold = error.message;
    }
    memo.set(key, { until: Date.now() + MEMO_MS, hold });
    return hold;
  } catch (error) {
    // A lookup that cannot run is not a hold. Queue the work; the run reports
    // whatever is actually wrong.
    console.warn(
      `[queue] AI admission could not be checked for ${agentName}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}
