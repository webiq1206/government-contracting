/**
 * What the lead-time sweep and the recovery probe would do with one row.
 *
 * Pure. The sweep and the dry-run script both use this so a preview cannot
 * describe a different set of rows than the write.
 */
import { addBusinessDays, PAST_BID_BUILDING } from "./review-lead";

export interface BacklogRow {
  id: string;
  title: string | null;
  deadline: string | null;
  status: string;
  tier: string | null;
  stage: string;
  riskFlags: readonly string[];
  sourcesSought?: boolean;
}

export interface BacklogDisposition {
  id: string;
  title: string;
  deadline: string | null;
  action: "archive" | "requeue" | "keep";
  reason: string;
}

const RESCORE_STAGES = new Set(["monitoring", "scoring"]);

export function leadCutoff(now: Date, businessDays: number): Date | null {
  if (!Number.isFinite(businessDays) || businessDays <= 0) return null;
  return addBusinessDays(now, businessDays);
}

export function classifyBacklogRow(
  row: BacklogRow,
  now: Date,
  businessDays: number
): BacklogDisposition {
  const title = row.title?.trim() || "Untitled";
  const base = { id: row.id, title, deadline: row.deadline };
  const protectedStage = (PAST_BID_BUILDING as readonly string[]).includes(row.stage);
  const cutoff = leadCutoff(now, businessDays);
  const deadlineMs = row.deadline ? new Date(row.deadline).getTime() : NaN;
  const dated = Number.isFinite(deadlineMs);
  const insideLead =
    cutoff != null && dated && deadlineMs < cutoff.getTime() && row.status === "open" && !row.sourcesSought;

  if (insideLead && !protectedStage && row.stage !== "dismissed") {
    const past = deadlineMs < now.getTime();
    return {
      ...base,
      action: "archive",
      reason: past
        ? "auto-pass: deadline already past"
        : `auto-pass: deadline inside ${businessDays} business days`,
    };
  }
  if (protectedStage && row.status === "open") {
    return {
      ...base,
      action: "keep",
      reason: "stage is at or past bid building, so the lead-time pass leaves it",
    };
  }
  const farEnough = cutoff != null && dated && deadlineMs >= cutoff.getTime();
  if (
    row.status === "open" &&
    row.tier === "review" &&
    RESCORE_STAGES.has(row.stage) &&
    row.riskFlags.includes("incomplete_scoring") &&
    farEnough
  ) {
    return {
      ...base,
      action: "requeue",
      reason: "incomplete scoring and the deadline is outside the minimum lead time",
    };
  }
  return {
    ...base,
    action: "keep",
    reason: "not inside the lead-time pass and not an incomplete score far enough out to re-score",
  };
}

export function classifyBacklog(
  rows: readonly BacklogRow[],
  now: Date,
  businessDays: number
): BacklogDisposition[] {
  return rows.map((row) => classifyBacklogRow(row, now, businessDays));
}
