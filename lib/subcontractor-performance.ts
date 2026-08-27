import { query, queryOne } from "@/lib/db";
import type { ReliabilityInputs } from "@/lib/domain/reliability";
import {
  isPerformanceKind,
  type PerformanceKind,
} from "@/lib/domain/sub-performance";

export * from "@/lib/domain/sub-performance";

/**
 * Recording and reading how the work actually went.
 *
 * The reliability score measured whether a firm answers email and whether they
 * have ever given a price. Both are real and neither is what anybody means by
 * reliable. This is where the answer to the question an operator actually asks
 * lives: did the last job go well.
 *
 * It cannot be inferred, so it is operator-entered. A contract closing says
 * the paperwork finished, not that the crew turned up.
 *
 * Every statement scopes by organization inside the SQL. A performance note is
 * one company's opinion of a subcontractor, and it is exactly the sort of
 * record that must not leak: another company reading "they walked off the Fort
 * Bliss job" would be reading a judgement they were never party to.
 */

export interface PerformanceEvent {
  id: string;
  subcontractorId: string;
  opportunityId: string | null;
  opportunityTitle: string | null;
  kind: PerformanceKind;
  note: string | null;
  recordedBy: string | null;
  at: Date;
  retractedAt: Date | null;
  retractedReason: string | null;
}

export type PerformanceResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 404; error: string };

/**
 * Record one thing that happened on a job.
 *
 * The note is required for anything other than a clean completion. A mark
 * against a firm with no reason attached is one nobody can check and nobody
 * can lift, and the database refuses it too, which is what makes the rule
 * real rather than a habit of this function.
 */
export async function recordPerformance(input: {
  orgId: string;
  subcontractorId: string;
  opportunityId?: string | null;
  kind: PerformanceKind;
  note?: string | null;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<PerformanceResult> {
  const note = (input.note ?? "").trim();
  if (input.kind !== "completed" && !note) {
    return {
      ok: false,
      status: 400,
      error:
        input.kind === "issue"
          ? "Say what went wrong. A mark against a firm with no reason is one nobody can check or lift."
          : "Say when and why they pulled out, so somebody reading this later can judge it.",
    };
  }

  /*
   * The subcontractor predicate is in the insert's own select rather than
   * checked beforehand: a firm belonging to another company yields no row to
   * insert from, and the guard cannot be removed without the statement
   * visibly changing.
   */
  const row = await queryOne<{ id: string }>(
    `insert into subcontractor_performance_events
       (org_id, subcontractor_id, opportunity_id, kind, note, recorded_by, recorded_by_email)
     select $1, s.id, $3, $4, $5, $6::uuid, $7
       from subcontractors s
      where s.id = $2 and s.org_id = $1
     returning id`,
    [
      input.orgId,
      input.subcontractorId,
      input.opportunityId ?? null,
      input.kind,
      note || null,
      input.actorId,
      input.actorEmail,
    ]
  );
  return row
    ? { ok: true, id: row.id }
    : { ok: false, status: 404, error: "No such subcontractor." };
}

/**
 * Withdraw a record without erasing it.
 *
 * A retraction is itself a fact: somebody wrote down a problem and later said
 * it was not one, and both halves matter when the firm asks why they stopped
 * being called.
 */
export async function retractPerformance(input: {
  orgId: string;
  eventId: string;
  reason: string;
  actorId: string | null;
}): Promise<PerformanceResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, status: 400, error: "Say why it is being withdrawn." };
  }
  const rows = await query<{ id: string }>(
    `update subcontractor_performance_events
        set retracted_at = now(), retracted_reason = $3, retracted_by = $4::uuid
      where id = $2 and org_id = $1 and retracted_at is null
      returning id`,
    [input.orgId, input.eventId, reason, input.actorId]
  );
  return rows.length > 0
    ? { ok: true, id: rows[0].id }
    : { ok: false, status: 404, error: "No such record, or it was already withdrawn." };
}

/** Everything recorded about one firm, withdrawals included, newest first. */
export async function performanceFor(
  orgId: string,
  subcontractorId: string
): Promise<PerformanceEvent[]> {
  const rows = await query<{
    id: string;
    subcontractor_id: string;
    opportunity_id: string | null;
    opportunity_title: string | null;
    kind: string;
    note: string | null;
    recorded_by_email: string | null;
    at: Date;
    retracted_at: Date | null;
    retracted_reason: string | null;
  }>(
    `select e.id, e.subcontractor_id, e.opportunity_id, o.title as opportunity_title,
            e.kind, e.note, e.recorded_by_email, e.at, e.retracted_at, e.retracted_reason
       from subcontractor_performance_events e
       left join opportunities o on o.id = e.opportunity_id and o.org_id = e.org_id
      where e.org_id = $1 and e.subcontractor_id = $2
      order by e.at desc
      limit 200`,
    [orgId, subcontractorId]
  );
  return rows.map((r) => ({
    id: r.id,
    subcontractorId: r.subcontractor_id,
    opportunityId: r.opportunity_id,
    opportunityTitle: r.opportunity_title,
    kind: (isPerformanceKind(r.kind) ? r.kind : "issue") as PerformanceKind,
    note: r.note,
    recordedBy: r.recorded_by_email,
    at: r.at,
    retractedAt: r.retracted_at,
    retractedReason: r.retracted_reason,
  }));
}

/**
 * The four counts the reliability score needs, for one firm.
 *
 * Withdrawn records are excluded from every one of them: a retracted problem
 * is not a problem, which is the whole point of being able to withdraw it.
 */
export async function performanceCounts(
  orgId: string,
  subcontractorId: string
): Promise<Pick<ReliabilityInputs, "jobsCompleted" | "jobsWithIssues" | "cancellations">> {
  const row = await queryOne<{ completed: string; issues: string; cancelled: string }>(
    `select
       count(*) filter (where kind = 'completed')::text as completed,
       count(*) filter (where kind = 'issue')::text as issues,
       count(*) filter (where kind = 'cancelled')::text as cancelled
     from subcontractor_performance_events
     where org_id = $1 and subcontractor_id = $2 and retracted_at is null`,
    [orgId, subcontractorId]
  );
  const completed = Number(row?.completed ?? 0);
  const issues = Number(row?.issues ?? 0);
  return {
    /*
     * A job with a problem is still a job that was done, so it counts in both.
     * Counting it only as a problem would make a firm with one bad job out of
     * five look identical to one with a single bad job and nothing else.
     */
    jobsCompleted: completed + issues,
    jobsWithIssues: issues,
    cancellations: Number(row?.cancelled ?? 0),
  };
}

/**
 * The quote timing and scope counts, for one firm.
 *
 * `quote_due_at` is stamped when outreach actually tells a subcontractor a
 * date, so lateness is measured against the promise that was made rather than
 * against a deadline worked out afterwards from an opportunity that may since
 * have moved.
 */
export async function quoteQualityCounts(
  orgId: string,
  subcontractorId: string
): Promise<
  Pick<
    ReliabilityInputs,
    "quotesWithDeadline" | "quotesOnTime" | "quotesScopeJudged" | "quotesFullScope"
  >
> {
  const row = await queryOne<{
    with_deadline: string;
    on_time: string;
    judged: string;
    full_scope: string;
  }>(
    `select
       count(*) filter (where os.quote_due_at is not null and os.quoted_at is not null)::text
         as with_deadline,
       count(*) filter (
         where os.quote_due_at is not null and os.quoted_at is not null
           and os.quoted_at <= os.quote_due_at
       )::text as on_time,
       count(*) filter (where os.quote_full_scope is not null)::text as judged,
       count(*) filter (where os.quote_full_scope)::text as full_scope
     from opportunity_subs os
     join opportunities o on o.id = os.opportunity_id
     where o.org_id = $1 and os.subcontractor_id = $2`,
    [orgId, subcontractorId]
  );
  return {
    quotesWithDeadline: Number(row?.with_deadline ?? 0),
    quotesOnTime: Number(row?.on_time ?? 0),
    quotesScopeJudged: Number(row?.judged ?? 0),
    quotesFullScope: Number(row?.full_scope ?? 0),
  };
}
