-- One-time backfill: purge stale archived opportunities using the operator's
-- CONFIGURED retention policy from app_settings, not a hard-coded value.
--
-- Guards:
--   • Reads retention_days from app_settings. Skips entirely if:
--       - No retention setting found (operator has never saved rules)
--       - retention_days = 0 (keep-forever mode)
--       - retention_days < 0 (invalid)
--   • Same eligibility predicates as the ongoing retentionSweep:
--       status=archived, deadline/updated_at older than retention_days,
--       no bids, no contracts, no quotes
--   • Correct ordering: snapshot paths → delete opportunities (CASCADE removes
--     documents) → delete only blobs with no remaining document reference
--     (shared-path safe)
--
-- The DO block is a single statement and runs inside psql's implicit
-- transaction, so the entire operation commits or rolls back atomically.
DO $$
DECLARE
  retention_days_cfg int;
  raw_json           text;
  opp_ids            uuid[];
  candidate_paths    text[];
  blob_bytes         bigint := 0;
  opp_count          int    := 0;
  blob_count         int    := 0;
BEGIN
  -- Read the operator's configured retention_days.
  SELECT value_json::text INTO raw_json
  FROM   app_settings
  WHERE  key = 'automation_rules';

  IF raw_json IS NULL THEN
    RAISE NOTICE 'retention-backfill: no automation_rules in app_settings; skipping.';
    RETURN;
  END IF;

  retention_days_cfg := (raw_json::jsonb ->> 'retention_days')::int;

  IF retention_days_cfg IS NULL OR retention_days_cfg <= 0 THEN
    RAISE NOTICE 'retention-backfill: retention disabled (retention_days=%); skipping.',
      coalesce(retention_days_cfg::text, 'null');
    RETURN;
  END IF;

  -- Collect candidate IDs — same predicate as the ongoing sweep.
  SELECT array_agg(o.id)
  INTO   opp_ids
  FROM   opportunities o
  WHERE  o.status = 'archived'
    AND  coalesce(o.deadline, o.updated_at::date)::timestamptz
         < now() - make_interval(days => retention_days_cfg)
    AND  NOT EXISTS (SELECT 1 FROM bids      b WHERE b.opportunity_id = o.id)
    AND  NOT EXISTS (SELECT 1 FROM contracts c WHERE c.opportunity_id = o.id)
    AND  NOT EXISTS (SELECT 1 FROM quotes    q WHERE q.opportunity_id = o.id);

  IF opp_ids IS NULL OR cardinality(opp_ids) = 0 THEN
    RAISE NOTICE 'retention-backfill: no stale archived opportunities found (window=% days); nothing to delete.',
      retention_days_cfg;
    RETURN;
  END IF;

  opp_count := cardinality(opp_ids);

  -- Snapshot storage paths BEFORE cascade removes the document rows.
  SELECT array_agg(DISTINCT d.storage_path)
  INTO   candidate_paths
  FROM   documents d
  WHERE  d.opportunity_id = ANY(opp_ids)
    AND  d.storage_path IS NOT NULL;

  -- Delete opportunity rows. CASCADE removes documents, quotes, call_cards,
  -- sub_opportunity_pairings, and communications.
  DELETE FROM opportunities WHERE id = ANY(opp_ids);

  -- After cascade: delete only blobs with no remaining document reference.
  -- Paths still referenced by other documents belong to surviving records.
  IF candidate_paths IS NOT NULL AND cardinality(candidate_paths) > 0 THEN
    SELECT COALESCE(SUM(octet_length(bytes)), 0)
    INTO   blob_bytes
    FROM   file_blobs
    WHERE  path = ANY(candidate_paths)
      AND  NOT EXISTS (
             SELECT 1 FROM documents d2 WHERE d2.storage_path = file_blobs.path
           );

    DELETE FROM file_blobs
    WHERE  path = ANY(candidate_paths)
      AND  NOT EXISTS (
             SELECT 1 FROM documents d2 WHERE d2.storage_path = file_blobs.path
           );
    GET DIAGNOSTICS blob_count = ROW_COUNT;
  END IF;

  RAISE NOTICE 'retention-backfill: deleted % opportunit%, % orphaned blob(s) removed, % bytes freed (window=% days).',
    opp_count,
    CASE WHEN opp_count = 1 THEN 'y' ELSE 'ies' END,
    blob_count,
    blob_bytes,
    retention_days_cfg;
END $$;
