-- One quote per (opportunity, subcontractor, trade) enforced at the database
-- level so concurrent writers (reply-poll auto-capture, quote API) cannot
-- create duplicates. Dedupe first, keeping the most recent row.
delete from quotes q
 using quotes newer
 where q.opportunity_id = newer.opportunity_id
   and q.subcontractor_id = newer.subcontractor_id
   and coalesce(q.trade, '') = coalesce(newer.trade, '')
   and (newer.created_at, newer.id) > (q.created_at, q.id);

create unique index if not exists quotes_opp_sub_trade_uniq
  on quotes (opportunity_id, subcontractor_id, (coalesce(trade, '')));
