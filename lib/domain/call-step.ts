/**
 * The call step, and what the pipeline looks like without it.
 *
 * Calling is optional (Settings → Automation Rules → Calls). With it off the
 * platform is email-only: outreach still sends, follow-ups still send, replies
 * are still captured, but no call card is ever prepared and the call stage is
 * not part of the journey. An opportunity whose outreach email has gone out
 * moves straight to collecting quotes instead of waiting for a call that is
 * never going to be made.
 *
 * Pure module: every rule about which stage follows which lives here so the
 * agents, the API, and the journey UI cannot each answer it differently.
 */

/** The pipeline stage that exists only to hold calls. */
export const CALL_STAGE = "call_queue";

/** Where an opportunity goes when the call step is skipped. */
export const STAGE_AFTER_CALLS = "quote_entry";

/**
 * Stages an opportunity may sit in when its outreach email has been sent but
 * the call step has not moved it on. These are the ones the skip advances.
 */
export const PRE_QUOTE_STAGES = ["outreach", CALL_STAGE] as const;

/**
 * The stage an opportunity should be in once its email step is done and
 * calling is off, or null when the record is somewhere the skip must not
 * touch. Never drags a record backwards: an opportunity already at quote
 * entry or beyond has moved past the call step under its own power.
 */
export function stageWhenCallsDisabled(stage: string): string | null {
  return (PRE_QUOTE_STAGES as readonly string[]).includes(stage)
    ? STAGE_AFTER_CALLS
    : null;
}

/** True when this stage should be hidden from journeys, boards, and counts. */
export function stageIsCallOnly(stage: string, callsEnabled: boolean): boolean {
  return !callsEnabled && stage === CALL_STAGE;
}

/**
 * Drop the call step from an ordered stage list when calling is off, so the
 * journey tracker, the pipeline board, and the Today rail all show the same
 * (shorter) path the opportunity will actually take.
 */
export function withoutCallStage<T extends string>(
  stages: readonly T[],
  callsEnabled: boolean
): T[] {
  return callsEnabled ? [...stages] : stages.filter((s) => s !== CALL_STAGE);
}

/** Why a call was not prepared, for agent logs and card notes. */
export const CALLS_DISABLED_REASON =
  "Calling is turned off for this account, so no call was prepared. Emails and follow-ups continue as normal.";
