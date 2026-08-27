import { queryOne } from "./db";
import { currentOrg } from "./data";
import type { AutomationRules } from "./domain/intake";
import type { RuleFacts } from "./domain/rule-impact";

/**
 * Count what a proposed rule change would touch.
 *
 * One query rather than nine, because this runs while somebody is still typing
 * in the form and a preview that lags the field it describes is one people
 * stop reading. Every count is scoped to the caller's organization and to
 * records that are actually live: the question is "what happens to my board
 * tonight", not "what has ever happened".
 */
export async function ruleFacts(
  current: AutomationRules,
  proposed: AutomationRules
): Promise<RuleFacts> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `with open_opps as (
       select o.id, o.deadline, o.created_at, o.tier, o.stage, o.pursuit_changed_at
         from opportunities o
        where o.org_id = $1
          and o.status = 'open'
          and o.stage not in ('dismissed','lost')
     ),
     dated as (
       select *,
              /*
               * Lead time as the rule measures it: days between the record
               * arriving here and the government's deadline. Not days
               * remaining, which is a different number and would make the
               * preview drift every hour without any rule changing.
               */
              extract(epoch from (deadline - created_at)) / 86400.0 as lead_days,
              extract(epoch from (deadline - now())) / 86400.0 as days_left
         from open_opps
        where deadline is not null
     ),
     /*
      * Deliberately the same predicate the retention sweep runs, down to the
      * coalesce and the third exclusion.
      *
      * The first version of this counted any non-open status, aged records off
      * updated_at alone, and forgot quotes. All three overstate the loss on
      * the one setting that destroys data, which is the opposite of what a
      * preview is for.
      */
     archived as (
       select o.id, coalesce(o.deadline, o.updated_at::date)::timestamptz as ages_from
         from opportunities o
        where o.org_id = $1
          and o.status = 'archived'
          and not exists (select 1 from bids      b where b.opportunity_id = o.id)
          and not exists (select 1 from contracts c where c.opportunity_id = o.id)
          and not exists (select 1 from quotes    q where q.opportunity_id = o.id)
     )
     select
       (select count(*) from dated where lead_days < $2)::int as below_proposed_lead,
       (select count(*) from dated where lead_days < $3)::int as below_current_lead,
       (select count(*) from dated)::int as dated_open,
       (select count(*) from dated where days_left >= 0 and days_left <= $4)::int
         as within_proposed_approaching,
       (select count(*) from dated where days_left >= 0 and days_left <= $5)::int
         as within_proposed_urgent,
       (select count(*) from archived
         where $6 > 0 and ages_from < now() - make_interval(days => $6))::int
         as archived_beyond_proposed,
       (select count(*) from archived
         where $7 > 0 and ages_from < now() - make_interval(days => $7))::int
         as archived_beyond_current,
       (select count(*) from communications c
         where c.org_id = $1 and c.follow_up_at is not null)::int as follow_ups_scheduled,
       (select count(*) from (
          select os.opportunity_id, os.subcontractor_id
            from opportunity_subs os
            join opportunities o2 on o2.id = os.opportunity_id and o2.org_id = $1
           where os.removed_at is null
           group by 1, 2
          having count(*) filter (where true) >= 0
        ) pairs
         where (
           select count(*) from communications c2
            where c2.org_id = $1
              and c2.opportunity_id = pairs.opportunity_id
              and c2.subcontractor_id = pairs.subcontractor_id
              and c2.direction = 'outbound'
         ) > $8)::int as at_proposed_followup_cap,
       (select count(*) from opportunity_subs os
          join opportunities o3 on o3.id = os.opportunity_id and o3.org_id = $1
         where os.removed_at is null and os.outreach_state = 'contacted'
           and o3.stage = 'call_queue')::int as calls_pending,
       (select count(*) from open_opps
         where tier = 'review' and pursuit_changed_at is null)::int as review_undecided`,
    [
      orgId,
      proposed.min_lead_days,
      current.min_lead_days,
      proposed.approaching_days,
      proposed.urgent_days,
      proposed.retention_days,
      current.retention_days,
      // The cap counts follow-ups, which are the sends after the first.
      proposed.followup_max,
    ]
  );

  const n = (v: unknown): number => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : 0;
  };

  return {
    belowProposedLead: n(r?.below_proposed_lead),
    belowCurrentLead: n(r?.below_current_lead),
    datedOpen: n(r?.dated_open),
    withinProposedApproaching: n(r?.within_proposed_approaching),
    withinProposedUrgent: n(r?.within_proposed_urgent),
    archivedBeyondProposed: n(r?.archived_beyond_proposed),
    archivedBeyondCurrent: n(r?.archived_beyond_current),
    followUpsScheduled: n(r?.follow_ups_scheduled),
    atProposedFollowUpCap: n(r?.at_proposed_followup_cap),
    callsPending: n(r?.calls_pending),
    reviewUndecided: n(r?.review_undecided),
  };
}
