/**
 * Who does the work, read and written for one opportunity.
 *
 * The pure rules are in lib/domain/work-mode.ts. This file is the database
 * side: what mode a record is in right now, what switching outreach off
 * would stop, and the switch itself, which also stops the work already in
 * motion (scheduled follow-ups and prepared calls) without touching quotes,
 * documents, deadlines or anything already sent.
 */
import { query, queryOne, transaction } from "./db";
import { getWorkExecution } from "./app-settings";
import { runWithOrg } from "./tenant-context";
import { logAgent } from "./logger";
import {
  effectiveWorkMode,
  outreachAllowed,
  parseWorkMode,
  type OutreachStopCounts,
  type WorkMode,
} from "./domain/work-mode";

interface Row {
  id: string;
  org_id: string;
  work_mode: string | null;
  self_performed_trades: string[] | null;
  stage: string;
}

async function loadRow(opportunityId: string): Promise<Row | null> {
  return queryOne<Row>(
    `select id, org_id, work_mode, self_performed_trades, stage from opportunities where id=$1`,
    [opportunityId]
  );
}

export interface OpportunityWorkMode {
  mode: WorkMode;
  /** True when the record follows the company default rather than its own setting. */
  inherited: boolean;
  orgDefault: WorkMode;
  selfPerformedTrades: string[];
  outreachAllowed: boolean;
}

/** The mode in force for a record, resolved against its own organization's rules. */
export async function opportunityWorkMode(opportunityId: string): Promise<OpportunityWorkMode | null> {
  const row = await loadRow(opportunityId);
  // No record, or a record with no owner, is not something this gate can
  // judge; the agents' own tenant checks refuse an ownerless record.
  if (!row || !row.org_id) return null;
  const orgDefault = await runWithOrg(row.org_id, () => getWorkExecution());
  return {
    mode: effectiveWorkMode(orgDefault, row),
    inherited: parseWorkMode(row.work_mode) == null,
    orgDefault,
    selfPerformedTrades: row.self_performed_trades ?? [],
    outreachAllowed: outreachAllowed(orgDefault, row),
  };
}

/**
 * Whether subcontractor sourcing, outreach and follow-ups may run for this
 * record. A missing record is not gated (there is nothing to protect). A
 * read failure is thrown, not swallowed: the caller's job then fails visibly
 * and is retried, rather than either emailing a firm the company said not to
 * contact or quietly dropping the work as "off".
 */
export async function opportunityOutreachAllowed(opportunityId: string): Promise<boolean> {
  const mode = await opportunityWorkMode(opportunityId);
  return mode ? mode.outreachAllowed : true;
}

/** What switching outreach off would stop, counted right now. */
export async function outreachStopCounts(orgId: string, opportunityId: string): Promise<OutreachStopCounts> {
  const row = await queryOne<{ calls: number; followups: number; sent: number; subs: number }>(
    `select
       (select count(*)::int from call_cards cc
         where cc.opportunity_id=$2 and cc.org_id=$1 and cc.status='pending') as calls,
       (select count(*)::int from communications c
         where c.org_id=$1 and c.opportunity_id=$2 and c.follow_up_at is not null and c.replied_at is null) as followups,
       (select count(*)::int from communications c
         where c.org_id=$1 and c.opportunity_id=$2 and c.direction='outbound' and c.provider is not null) as sent,
       (select count(*)::int from opportunity_subs os
         where os.opportunity_id=$2 and os.removed_at is null) as subs`,
    [orgId, opportunityId]
  );
  return {
    pendingCalls: row?.calls ?? 0,
    followUpsDue: row?.followups ?? 0,
    sentMessages: row?.sent ?? 0,
    subsPaired: row?.subs ?? 0,
  };
}

export interface StopOutreachResult {
  followUpsStopped: number;
  callsCleared: number;
}

/**
 * Stop the outreach automation already in motion for these records: unschedule
 * follow-ups and clear prepared calls. Nothing sent is touched; nothing about
 * quotes, documents or deadlines changes. Idempotent.
 */
export async function stopOutreachWork(orgId: string, opportunityIds: string[]): Promise<StopOutreachResult> {
  const ids = opportunityIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return { followUpsStopped: 0, callsCleared: 0 };
  return transaction(async (db) => {
    const f = await db.query<{ id: string }>(
      `update communications set follow_up_at = null
        where org_id=$1 and opportunity_id = any($2::uuid[]) and follow_up_at is not null
        returning id`,
      [orgId, ids]
    );
    const c = await db.query<{ id: string }>(
      `update call_cards
          set status='skipped',
              response_json = coalesce(response_json,'{}'::jsonb) || '{"outcome":"skipped","notes":"Subcontractor outreach was turned off for this opportunity."}'::jsonb
        where org_id=$1 and opportunity_id = any($2::uuid[]) and status='pending'
        returning id`,
      [orgId, ids]
    );
    // A record parked on the call step has nothing to wait for now.
    await db.query(
      `update opportunities set stage='quote_entry', human_action_required=true, updated_at=now()
        where org_id=$1 and id = any($2::uuid[]) and status='open' and stage in ('sub_research','outreach','call_queue')`,
      [orgId, ids]
    );
    return { followUpsStopped: f.rowCount ?? 0, callsCleared: c.rowCount ?? 0 };
  });
}

export interface SetWorkModeInput {
  /** null returns the record to the company default. */
  mode: WorkMode | null;
  selfPerformedTrades?: string[];
  by: string;
}

export interface SetWorkModeResult {
  ok: true;
  before: OpportunityWorkMode;
  after: OpportunityWorkMode;
  stopped: StopOutreachResult | null;
}

/** Change one record's mode, stopping in-flight outreach when it goes off. */
export async function setOpportunityWorkMode(
  orgId: string,
  opportunityId: string,
  input: SetWorkModeInput
): Promise<SetWorkModeResult | { ok: false; error: string; status: number }> {
  const owned = await queryOne<{ id: string; status: string }>(
    `select id, status from opportunities where id=$1 and org_id=$2`,
    [opportunityId, orgId]
  );
  if (!owned) return { ok: false, error: "No such opportunity.", status: 404 };
  const before = await opportunityWorkMode(opportunityId);
  if (!before) return { ok: false, error: "No such opportunity.", status: 404 };

  const trades = (input.selfPerformedTrades ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 120)
    .slice(0, 40);

  await query(
    `update opportunities
        set work_mode=$2, self_performed_trades=$3, work_mode_changed_at=now(), work_mode_changed_by=$4, updated_at=now()
      where id=$1 and org_id=$5`,
    [opportunityId, input.mode, trades, input.by, orgId]
  );
  const after = (await opportunityWorkMode(opportunityId))!;

  let stopped: StopOutreachResult | null = null;
  if (before.outreachAllowed && !after.outreachAllowed) {
    stopped = await stopOutreachWork(orgId, [opportunityId]);
  }
  await runWithOrg(orgId, () =>
    logAgent({
      agent: "operator",
      action: "work-mode-changed",
      level: "info",
      opportunityId,
      message: `${input.by} set this opportunity to ${after.mode === "self" ? "self-performed" : after.mode === "mixed" ? `mixed (self-performing ${trades.join(", ") || "no scopes yet"})` : "subcontracted"}${input.mode == null ? " (company default)" : ""}.${
        stopped ? ` Stopped ${stopped.followUpsStopped} scheduled follow-up(s) and cleared ${stopped.callsCleared} prepared call(s). Messages already sent are kept.` : ""
      }${!before.outreachAllowed && after.outreachAllowed ? " Subcontractor outreach can now be started from the record; nothing was sent automatically." : ""}`,
    })
  );
  return { ok: true, before, after, stopped };
}

/**
 * When the company default moves to self-performed, every record that follows
 * the default stops its outreach automation too. Records with their own
 * setting are left alone.
 */
export async function stopInheritedOutreachForOrg(orgId: string): Promise<StopOutreachResult & { opportunities: number }> {
  const rows = await query<{ id: string }>(
    `select id from opportunities
      where org_id=$1 and status='open' and work_mode is null
        and stage in ('sub_research','outreach','call_queue','quote_entry','bid_building')`,
    [orgId]
  );
  const ids = rows.map((r) => r.id);
  const stopped = await stopOutreachWork(orgId, ids);
  return { ...stopped, opportunities: ids.length };
}
