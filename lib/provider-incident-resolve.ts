/**
 * Close the incident row when a provider call actually succeeds.
 *
 * Clearing refusal_reason is not enough. The Automation page keeps an open
 * incident, and the last day of errors stays blocking until that row is
 * recovered. A probe and an ordinary successful call both come through here.
 */
import { query } from "./db";
import { advance, IllegalTransition } from "./incidents";
import { PROVIDER_LATCH_CAUSES } from "./domain/incident";
import type { IncidentState } from "./domain/incident";
import type { AiProvider } from "./ai/routing";

/**
 * A short legal walk to `recovered` from every open state.
 *
 * `backlog_requeued` cannot jump straight to `recovered`, and a walk that
 * always starts at `mitigating` leaves that row open after the provider has
 * already answered.
 */
const RECOVERY_PATH: Record<string, IncidentState[]> = {
  detected: ["provider_restored", "test_passed", "recovered"],
  mitigating: ["provider_restored", "test_passed", "recovered"],
  provider_restored: ["test_passed", "recovered"],
  test_passed: ["recovered"],
  backlog_requeued: ["backlog_draining", "recovered"],
  backlog_draining: ["recovered"],
  recovery_failed: ["provider_restored", "test_passed", "recovered"],
};

export async function resolveProviderIncidents(orgId: string, provider: AiProvider): Promise<number> {
  const slug = provider.toLowerCase();
  const rows = await query<{ id: string; state: string }>(
    `select id, state from automation_incidents
      where org_id = $1
        and state <> 'recovered'
        and (
          cause = any($2::text[])
          or cause = $3
        )
        and (provider is null or provider = $4)`,
    [orgId, [...PROVIDER_LATCH_CAUSES], `provider_refusal:${slug}`, slug]
  );
  let closed = 0;
  for (const row of rows) {
    const note = `${provider} accepted a request. The incident is closed.`;
    const path = RECOVERY_PATH[row.state] ?? RECOVERY_PATH.detected;
    let reached = false;
    for (const step of path) {
      try {
        await advance({
          incidentId: row.id,
          orgId,
          to: step,
          actor: "provider-call",
          detail: step === "recovered" ? note : undefined,
          set:
            step === "test_passed"
              ? { testRanAt: new Date(), testPassed: true, testDetail: note, lastProviderSuccessAt: new Date() }
              : step === "recovered"
                ? { recoveryNote: note, recoveryOwner: "provider-call", testPassed: true }
                : undefined,
        });
        if (step === "recovered") reached = true;
      } catch (error) {
        if (!(error instanceof IllegalTransition)) throw error;
      }
    }
    if (reached) closed += 1;
  }
  return closed;
}
