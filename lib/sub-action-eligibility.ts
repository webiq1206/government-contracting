/** Read predicates shared by action lists, counts and their regression fixtures.
 * The caller must also scope o.org_id to the authenticated organization.
 */
export const OWNED_ACTIVE_PAIR_SQL = `s.org_id = o.org_id
  and os.removed_at is null
  and coalesce(os.outreach_state, '') not in ('declined', 'not_a_fit', 'unavailable')`;

/** A legacy outreach status or an unsent draft is not a contact receipt. */
export const RECORDED_CONTACT_SQL = `c.org_id = o.org_id
  and c.opportunity_id = os.opportunity_id
  and c.subcontractor_id = os.subcontractor_id
  and (c.channel = 'call' or (c.channel = 'email' and c.direction = 'outbound'
    and c.provider is not null and c.delivery_state in ('sent','delivered','deferred','bounced')))`;

export const FOLLOW_UP_ELIGIBLE_SQL = `${OWNED_ACTIVE_PAIR_SQL}
  and o.status = 'open' and coalesce(o.pursuit_state, 'active') <> 'aborted'
  and o.stage in ('outreach','call_queue','quote_entry','sub_research')
  and (o.snoozed_until is null or o.snoozed_until <= now())
  and os.outreach_state in ('followed_up','unresponsive')
  and exists (select 1 from communications c where ${RECORDED_CONTACT_SQL})
  and not exists (select 1 from quotes q
    where q.org_id = o.org_id and q.opportunity_id = os.opportunity_id
      and q.subcontractor_id = os.subcontractor_id and q.quote_amount > 0)
  and not exists (select 1 from call_cards cc
    where cc.org_id = o.org_id and cc.opportunity_id = os.opportunity_id
      and cc.subcontractor_id = os.subcontractor_id and cc.status = 'pending')`;

export const OWNED_CALL_CARD_SQL = `cc.org_id = o.org_id and s.org_id = o.org_id
  and not exists (select 1 from opportunity_subs os
    where os.opportunity_id = cc.opportunity_id and os.subcontractor_id = cc.subcontractor_id
      and (os.removed_at is not null or os.outreach_state in ('declined','not_a_fit','unavailable')))`;
