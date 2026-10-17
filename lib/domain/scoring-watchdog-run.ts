/**
 * One alert when scoring stalls, and one when it resumes.
 *
 * The claim is the same as an outage alert: the first caller to set the
 * column sends, and every later tick finds it already set.
 */
import { scoringWatchDecision } from "./scoring-watchdog";

export interface ScoringWatchDeps {
  counts: (orgId: string) => Promise<{ completedScores: number; arrived: number }>;
  incidentOpen: (orgId: string) => Promise<{ id: string } | null>;
  openIncident: (orgId: string) => Promise<{ id: string }>;
  claimAlert: (orgId: string, incidentId: string, kind: "start" | "end") => Promise<boolean>;
  sendAlert: (input: { orgId: string; kind: "start" | "end"; subject: string; text: string }) => Promise<void>;
  markRecovered: (orgId: string, incidentId: string, note: string) => Promise<void>;
}

export async function watchScoring(
  orgId: string,
  deps: ScoringWatchDeps
): Promise<{ alerted: boolean; resolved: boolean }> {
  const counts = await deps.counts(orgId);
  const open = await deps.incidentOpen(orgId);
  const decision = scoringWatchDecision({ ...counts, incidentOpen: Boolean(open) });
  if (decision === "quiet") return { alerted: false, resolved: false };
  if (decision === "alert") {
    const incident = open ?? (await deps.openIncident(orgId));
    if (await deps.claimAlert(orgId, incident.id, "start")) {
      await deps.sendAlert({
        orgId,
        kind: "start",
        subject: "Scoring has stopped",
        text:
          `${counts.arrived} solicitation(s) arrived in the last 24 hours and none received a finished score. ` +
          "This is the only alert for this stall.",
      });
      return { alerted: true, resolved: false };
    }
    return { alerted: false, resolved: false };
  }
  if (!open) return { alerted: false, resolved: false };
  const note = "A score finished. This stall is closed.";
  if (await deps.claimAlert(orgId, open.id, "end")) {
    await deps.sendAlert({
      orgId,
      kind: "end",
      subject: "Scoring resumed",
      text: note,
    });
  }
  await deps.markRecovered(orgId, open.id, note);
  return { alerted: false, resolved: true };
}
