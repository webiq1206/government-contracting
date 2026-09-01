/**
 * What a restart is allowed to kick off, and when it must refuse.
 *
 * Restart is not resume. Resume reuses packets as they stand. Restart
 * rechecks the notice first and does not send outreach until a person
 * approves the rebuilt packets. The agent list is named here so the API
 * and the tests cannot drift into enqueueing a send.
 */

export const RESTART_REQUEUE_AGENTS = [
  "scoring-engine",
  "solicitation-analyst",
  "pricing-research",
] as const;

export const RESTART_MUST_NOT_QUEUE = ["outreach", "call-prep", "outreach-followup"] as const;

export function restartMayProceed(facts: {
  status?: string | null;
  stage?: string | null;
  deadline?: string | Date | null;
  now?: Date;
}): { ok: true } | { ok: false; error: string } {
  const stage = (facts.stage ?? "").toLowerCase();
  if (stage === "won" || stage === "lost") {
    return {
      ok: false,
      error: "This bid already has a result. Start a new opportunity rather than restarting it.",
    };
  }
  if ((facts.status ?? "open") !== "open" && stage !== "dismissed") {
    return {
      ok: false,
      error: "This opportunity is closed. Restore it first if it should be worked again.",
    };
  }
  if (["submitted", "won", "lost"].includes(stage)) {
    return { ok: true };
  }
  if (!facts.deadline) return { ok: true };
  const deadline = facts.deadline instanceof Date ? facts.deadline : new Date(facts.deadline);
  if (!Number.isFinite(deadline.getTime())) return { ok: true };
  const now = facts.now ?? new Date();
  if (deadline.getTime() < now.getTime()) {
    return {
      ok: false,
      error:
        "The submission deadline has already passed. This bid cannot be restarted.",
    };
  }
  return { ok: true };
}
