-- One bid per opportunity, enforced by the database.
--
-- The bid builder reads "is there a bid for this opportunity?" and then either
-- updates it or inserts a new one. With nothing stopping two of those from
-- interleaving, a genuine concurrency test produced TWO bid rows for one
-- opportunity: both builds read no existing row, both inserted. The prime_only
-- path inserts unconditionally, so a re-run there duplicated too.
--
-- Every reader takes `order by created_at desc limit 1`, so the app keeps
-- working off the newest row -- but the stale duplicate is a real hazard: the
-- requirements fingerprint and the operator's "I signed this" confirmations
-- live on a specific row, and a second row can strand them, so a package that
-- was ready silently reads as not-ready (or vice versa) depending on which row
-- wins. "One bid per opportunity" is the builder's own stated invariant; this
-- makes the database hold it, which also makes the builder's upsert atomic.
--
-- Existing duplicates (from before this guard) are collapsed first: the newest
-- bid per opportunity is kept, its children are repointed off the losers, and
-- the losers are deleted. documents.bid_id cascades on delete, so repointing
-- BEFORE deleting is what keeps a real generated document from vanishing.

do $$
declare
  has_dupes boolean;
begin
  select exists (
    select 1 from bids group by opportunity_id having count(*) > 1
  ) into has_dupes;

  if has_dupes then
    -- keeper = newest bid per opportunity
    create temporary table _bid_keepers on commit drop as
      select distinct on (opportunity_id) opportunity_id, id as keep_id
        from bids
       order by opportunity_id, created_at desc, id desc;

    -- map every losing bid to its opportunity's keeper
    create temporary table _bid_losers on commit drop as
      select b.id as lose_id, k.keep_id
        from bids b
        join _bid_keepers k on k.opportunity_id = b.opportunity_id
       where b.id <> k.keep_id;

    -- repoint children off the losers (documents would otherwise cascade-delete)
    update documents  d set bid_id = l.keep_id from _bid_losers l where d.bid_id = l.lose_id;
    update contracts  c set bid_id = l.keep_id from _bid_losers l where c.bid_id = l.lose_id;
    update agent_logs a set bid_id = l.keep_id from _bid_losers l where a.bid_id = l.lose_id;

    delete from bids b using _bid_losers l where b.id = l.lose_id;
  end if;
end $$;

create unique index if not exists bids_one_per_opportunity
  on bids (opportunity_id);
