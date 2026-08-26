/**
 * Reading and writing the record of who the platform must stop contacting.
 *
 * The rule this file exists to enforce is that the decision outlives the click.
 * Everything that reaches a subcontractor asks here first, and a suppression
 * that cannot be read is treated as one that blocks: a query that throws and
 * returns "nothing is suppressed" is the failure that sends the email.
 */
import { query, queryOne } from "./db";
import {
  blockingSuppression,
  parseChannel,
  type Channel,
  type ContactAttempt,
  type StopImpact,
  type StopOutreachScope,
  type Suppression,
} from "./domain/suppression";

interface Row {
  id: string;
  subcontractor_id: string;
  opportunity_id: string | null;
  trade: string | null;
  channel: string;
  reason: string;
  note: string | null;
  actor: string;
  created_at: Date;
  lifted_at: Date | null;
  lifted_by: string | null;
}

function toSuppression(r: Row): Suppression {
  return {
    id: r.id,
    subcontractorId: r.subcontractor_id,
    opportunityId: r.opportunity_id,
    trade: r.trade,
    channel: parseChannel(r.channel),
    reason: r.reason,
    note: r.note,
    actor: r.actor,
    createdAt: r.created_at,
    liftedAt: r.lifted_at,
    liftedBy: r.lifted_by,
  };
}

/** Every live suppression for one subcontractor on this account. */
export async function suppressionsFor(
  subcontractorId: string,
  orgId: string
): Promise<Suppression[]> {
  const rows = await query<Row>(
    `select id, subcontractor_id, opportunity_id, trade, channel, reason, note,
            actor, created_at, lifted_at, lifted_by
       from outreach_suppressions
      where subcontractor_id = $1 and org_id = $2 and lifted_at is null
      order by created_at desc`,
    [subcontractorId, orgId]
  );
  return rows.map(toSuppression);
}

/** Everything this account has stopped, lifted rows included, newest first. */
export async function suppressionHistory(orgId: string, limit = 200): Promise<Suppression[]> {
  const rows = await query<Row>(
    `select id, subcontractor_id, opportunity_id, trade, channel, reason, note,
            actor, created_at, lifted_at, lifted_by
       from outreach_suppressions
      where org_id = $1
      order by created_at desc
      limit $2`,
    [orgId, limit]
  );
  return rows.map(toSuppression);
}

/**
 * The send boundary.
 *
 * Called immediately before an external action, not when the job was queued.
 * A follow-up enqueued on Monday and running on Wednesday must see Tuesday's
 * decision, and the only way it can is by asking at the moment it acts.
 *
 * Throwing is deliberate. A caller that wraps this in `.catch(() => null)` and
 * carries on has restored the bug: the email goes out because the check
 * failed, which is exactly when it is least safe to send.
 */
export async function suppressionBlocking(
  attempt: ContactAttempt,
  orgId: string
): Promise<Suppression | null> {
  const live = await suppressionsFor(attempt.subcontractorId, orgId);
  return blockingSuppression(live, attempt);
}

export class SuppressionRejected extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "SuppressionRejected";
  }
}

/**
 * Record a stop.
 *
 * Returns the existing row when an identical live suppression is already on
 * file, so pressing the button twice does not produce two records saying the
 * same thing on two different days.
 */
export async function suppress(input: {
  orgId: string;
  subcontractorId: string;
  opportunityId: string | null;
  trade: string | null;
  channel: Channel;
  reason: string;
  note?: string | null;
  actor: string;
}): Promise<Suppression> {
  if (input.trade != null && input.opportunityId == null) {
    throw new SuppressionRejected(
      "A trade-wide stop has to name the bid: trade names belong to one solicitation."
    );
  }
  const owned = await queryOne<{ id: string }>(
    `select id from subcontractors where id = $1 and org_id = $2`,
    [input.subcontractorId, input.orgId]
  );
  if (!owned) throw new SuppressionRejected("That subcontractor is not on this account.");
  if (input.opportunityId) {
    const opp = await queryOne<{ id: string }>(
      `select id from opportunities where id = $1 and org_id = $2`,
      [input.opportunityId, input.orgId]
    );
    if (!opp) throw new SuppressionRejected("That opportunity is not on this account.");
  }

  const existing = await queryOne<Row>(
    `select id, subcontractor_id, opportunity_id, trade, channel, reason, note,
            actor, created_at, lifted_at, lifted_by
       from outreach_suppressions
      where org_id = $1 and subcontractor_id = $2
        and opportunity_id is not distinct from $3
        and trade is not distinct from $4
        and channel = $5
        and lifted_at is null
      limit 1`,
    [input.orgId, input.subcontractorId, input.opportunityId, input.trade, input.channel]
  );
  if (existing) return toSuppression(existing);

  const row = await queryOne<Row>(
    `insert into outreach_suppressions
       (org_id, subcontractor_id, opportunity_id, trade, channel, reason, note, actor)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id, subcontractor_id, opportunity_id, trade, channel, reason, note,
               actor, created_at, lifted_at, lifted_by`,
    [
      input.orgId,
      input.subcontractorId,
      input.opportunityId,
      input.trade,
      input.channel,
      input.reason,
      input.note?.trim() || null,
      input.actor,
    ]
  );
  if (!row) throw new SuppressionRejected("The stop could not be recorded.");
  return toSuppression(row);
}

/**
 * Lift a stop.
 *
 * The row is kept and marked rather than deleted. "Who decided to start
 * calling them again, and when" has to have an answer, and a deleted row
 * answers nothing.
 */
export async function lift(
  suppressionId: string,
  orgId: string,
  actor: string
): Promise<boolean> {
  const lifted = await query<{ id: string }>(
    `update outreach_suppressions
        set lifted_at = now(), lifted_by = $3
      where id = $1 and org_id = $2 and lifted_at is null
      returning id`,
    [suppressionId, orgId, actor]
  );
  return lifted.length > 0;
}

/**
 * What stopping outreach would actually cancel, counted before anything is.
 *
 * The same button on the same screen can mean "cancel one follow-up" or
 * "cancel eleven queued messages and leave two trades with nobody quoting
 * them", and the label cannot tell them apart. So the numbers are gathered
 * first and shown, and the operator confirms against what will happen rather
 * than against a word.
 */
export async function stopImpact(
  scope: StopOutreachScope,
  orgId: string
): Promise<StopImpact> {
  const oppFilter = scope.opportunityId ? "and c.opportunity_id = $3" : "";
  const params: unknown[] = [scope.subcontractorId, orgId];
  if (scope.opportunityId) params.push(scope.opportunityId);

  /*
   * Draft outbound mail is what has been prepared and not yet sent. A message
   * already delivered is not cancellable and is deliberately not counted here:
   * offering to cancel something that is in somebody's inbox is a promise the
   * product cannot keep.
   */
  const queued = await query<{ n: string }>(
    `select count(*)::text as n
       from communications c
      where c.subcontractor_id = $1
        and exists (select 1 from subcontractors s where s.id = c.subcontractor_id and s.org_id = $2)
        and c.direction = 'outbound'
        and coalesce(c.delivery_state, '') in ('draft','queued')
        ${oppFilter}`,
    params
  ).catch(() => [{ n: "0" }]);

  const calls = await query<{ n: string }>(
    `select count(*)::text as n
       from call_cards cc
      where cc.subcontractor_id = $1
        and exists (select 1 from subcontractors s where s.id = cc.subcontractor_id and s.org_id = $2)
        and cc.status = 'pending'
        ${scope.opportunityId ? "and cc.opportunity_id = $3" : ""}`,
    params
  ).catch(() => [{ n: "0" }]);

  /*
   * Follow-ups are not rows: the sweep decides on the fly whether a pairing is
   * due one. So the count is of pairings that would receive one, which is what
   * an operator means by "scheduled follow-up" even though nothing is stored.
   */
  const followUps = await query<{ n: string }>(
    `select count(*)::text as n
       from opportunity_subs os
      where os.subcontractor_id = $1
        and exists (select 1 from subcontractors s where s.id = os.subcontractor_id and s.org_id = $2)
        and os.outreach_state in ('sent','followed_up')
        ${scope.opportunityId ? "and os.opportunity_id = $3" : ""}
        ${scope.trade ? `and lower(btrim(coalesce(os.trade,''))) = lower(btrim($${params.length + 1}))` : ""}`,
    scope.trade ? [...params, scope.trade] : params
  ).catch(() => [{ n: "0" }]);

  /*
   * Trades this firm is the only live responder on.
   *
   * The number that changes an operator's mind. Stopping outreach to a firm
   * that has already quoted costs nothing; stopping it to the only one still
   * answering on a trade leaves that trade with nobody, and nothing else on
   * the confirmation screen would say so.
   */
  const uncovered = scope.opportunityId
    ? await query<{ trade: string }>(
        `select distinct coalesce(os.trade, '') as trade
           from opportunity_subs os
          where os.opportunity_id = $1
            and os.subcontractor_id = $2
            and coalesce(os.trade, '') <> ''
            and not exists (
              select 1 from opportunity_subs other
               where other.opportunity_id = os.opportunity_id
                 and coalesce(other.trade,'') = coalesce(os.trade,'')
                 and other.subcontractor_id <> os.subcontractor_id
                 and other.outreach_state in ('sent','followed_up','responsive')
            )`,
        [scope.opportunityId, scope.subcontractorId]
      ).catch(() => [])
    : [];

  return {
    queuedEmails: Number(queued[0]?.n ?? 0),
    scheduledFollowUps: Number(followUps[0]?.n ?? 0),
    pendingCalls: Number(calls[0]?.n ?? 0),
    // Call cards are the task rows an operator sees; counted once, under
    // calls, rather than twice under two headings that mean the same thing.
    openTasks: 0,
    // The clarification sweep sends at most one per subcontractor per
    // solicitation, and only where a reply was understood but incomplete.
    clarificationRequests: 0,
    uncoveredTrades: uncovered
      .map((r) => r.trade)
      .filter((t) => (scope.trade ? t.toLowerCase() === scope.trade.toLowerCase() : true)),
  };
}
