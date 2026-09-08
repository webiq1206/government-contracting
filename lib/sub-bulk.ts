import { query, transaction } from "@/lib/db";
import { enqueue } from "@/lib/queue";
import type { PoolClient } from "pg";
import {
  BULK_LIMIT,
  BULK_REVERSIBLE,
  normalizeTag,
  type BulkKind,
  type BulkOutcome,
  type BulkSkip,
} from "@/lib/domain/sub-bulk";

/**
 * Bulk changes to the roster, each one recorded so it can be taken back.
 *
 * The batch is the unit. Every write stores exactly which rows it changed and
 * which it left alone with the reason, so an undo replays what happened rather
 * than guessing from the selection: a batch that asked for two hundred and
 * changed a hundred and seventy-three must not offer to undo two hundred.
 *
 * Every statement is org-scoped inside itself, so an id from another tenant is
 * a row that does not match rather than a row somebody else owns.
 */

export type BulkResult =
  | ({ ok: true } & BulkOutcome)
  | { ok: false; status: number; error: string };

interface Common {
  orgId: string;
  actorId: string | null;
  ids: string[];
}

export async function bulkVerify(input: Common): Promise<BulkResult> {
  const guard = check(input.ids);
  if (guard) return guard;

  /*
   * Which of the named rows can actually be re-checked, decided in the
   * database rather than assumed. A firm with no website and no address has
   * nothing for Sub Verify to look at, and queueing a job that will find
   * nothing is churn the operator later reads as a broken agent.
   */
  const rows = await query<{ id: string; checkable: boolean; blocked: boolean; merged: boolean }>(
    `select id,
            (coalesce(btrim(website), '') <> '' or coalesce(btrim(email), '') <> '') as checkable,
            blacklisted as blocked,
            merged_into is not null as merged
       from subcontractors
      where org_id = $1 and id = any($2::uuid[])`,
    [input.orgId, input.ids]
  );

  const found = new Map(rows.map((r) => [r.id, r]));
  const skipped: BulkSkip[] = [];
  const target: string[] = [];
  for (const id of input.ids) {
    const row = found.get(id);
    if (!row) { skipped.push({ id, reason: "not_found" }); continue; }
    if (row.merged) { skipped.push({ id, reason: "merged" }); continue; }
    if (row.blocked) { skipped.push({ id, reason: "blocked" }); continue; }
    if (!row.checkable) { skipped.push({ id, reason: "nothing_to_check" }); continue; }
    target.push(id);
  }

  const queued: string[] = [];
  for (const id of target) {
    /*
     * enqueue returns null rather than throwing when automation is paused, so
     * the return value decides whether this row counts. A row that was never
     * queued must not be reported as queued: the operator would go looking
     * for results that are not coming.
     *
     * A queue outage affecting one job also should not lose the other hundred
     * and seventy-two. It is caught per row, but kept distinct from a deliberate
     * pause so the operator knows whether to resume automation or retry later.
     */
    try {
      const jobId = await enqueue("sub-verify", {
        subcontractorId: id,
        enqueuedByOrgId: input.orgId,
      });
      if (jobId) queued.push(id);
      else skipped.push({ id, reason: "automation_paused" });
    } catch {
      skipped.push({ id, reason: "queue_failed" });
    }
  }

  // A queue job cannot share a transaction with its ledger row, but a request
  // is never reported as successful unless that row was durably written.
  const batchId = await transaction((client) =>
    record(client, {
      orgId: input.orgId, kind: "verify", actorId: input.actorId,
      affected: queued, skipped, detail: null,
    })
  );
  return { ok: true, kind: "verify", changed: queued.length, skipped, batchId };
}

export async function bulkTag(
  input: Common & { tag: string; remove?: boolean }
): Promise<BulkResult> {
  const guard = check(input.ids);
  if (guard) return guard;
  const tag = normalizeTag(input.tag);
  if (!tag) return { ok: false, status: 400, error: "A tag has to be between 1 and 40 characters." };

  return transaction(async (client) => {
    const kind: BulkKind = input.remove ? "untag" : "tag";
    const changed = input.remove
      ? (await client.query<{ subcontractor_id: string }>(
          `delete from subcontractor_tags
            where org_id = $1 and subcontractor_id = any($2::uuid[]) and lower(tag) = lower($3)
            returning subcontractor_id`,
          [input.orgId, input.ids, tag]
        )).rows
      : (await client.query<{ subcontractor_id: string }>(
          /*
           * Sourced from the subcontractor row rather than from the request, so
           * the tenant guard is inside the statement that writes. An id from
           * another organization matches nothing and inserts nothing.
           */
          `insert into subcontractor_tags (org_id, subcontractor_id, tag, created_by)
           select s.org_id, s.id, $3, $4::uuid
             from subcontractors s
            where s.org_id = $1 and s.id = any($2::uuid[])
           on conflict (subcontractor_id, lower(tag)) do nothing
           returning subcontractor_id`,
          [input.orgId, input.ids, tag, input.actorId]
        )).rows;

    const touched = new Set(changed.map((r) => r.subcontractor_id));
    const skipped: BulkSkip[] = input.ids
      .filter((id) => !touched.has(id))
      // Already carrying the tag, or not on this roster. Both read as "left
      // alone" to the operator, and both are named rather than counted.
      .map((id) => ({ id, reason: "already" as const }));

    const batchId = await record(client, {
      orgId: input.orgId, kind, actorId: input.actorId,
      affected: [...touched], skipped, detail: tag,
    });
    return { ok: true, kind, changed: touched.size, skipped, batchId };
  });
}

export async function bulkArchive(
  input: Common & { reason: string }
): Promise<BulkResult> {
  const guard = check(input.ids);
  if (guard) return guard;
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, status: 400, error: "Say why they are being put aside." };
  }

  return transaction(async (client) => {
    const rows = (await client.query<{ id: string }>(
      `update subcontractors
          set archived_at = now(), archived_reason = $3, archived_by = $4::uuid
        where org_id = $1 and id = any($2::uuid[])
          and archived_at is null and merged_into is null
        returning id`,
      [input.orgId, input.ids, reason, input.actorId]
    )).rows;
    const touched = new Set(rows.map((r) => r.id));
    const skipped: BulkSkip[] = input.ids
      .filter((id) => !touched.has(id))
      .map((id) => ({ id, reason: "already" as const }));

    const batchId = await record(client, {
      orgId: input.orgId, kind: "archive", actorId: input.actorId,
      affected: [...touched], skipped, detail: reason,
    });
    return { ok: true, kind: "archive", changed: touched.size, skipped, batchId };
  });
}

/**
 * Take a batch back.
 *
 * Only the rows the batch actually changed, and only once. Undoing twice
 * would remove a tag somebody deliberately re-added afterwards, which is the
 * failure mode an undo is meant to prevent rather than cause.
 */
export async function undoBulk(input: {
  orgId: string;
  batchId: string;
  actorId: string | null;
}): Promise<{ ok: true; restored: number } | { ok: false; status: number; error: string }> {
  return transaction(async (client) => {
    const found = await client.query<{
      kind: BulkKind; detail: string | null; affected: string[]; undone_at: string | null;
    }>(
      `select kind, detail, affected, undone_at
         from subcontractor_bulk_actions
        where id = $1 and org_id = $2
        for update`,
      [input.batchId, input.orgId]
    );
    const batch = found.rows[0];
    if (!batch) return { ok: false as const, status: 404, error: "No such change." };
    if (batch.undone_at) {
      return { ok: false as const, status: 409, error: "That has already been taken back." };
    }
    if (!BULK_REVERSIBLE[batch.kind]) {
      return {
        ok: false as const,
        status: 409,
        // Says why rather than just refusing. Restoring a stale verification
        // result would be worse than the fresh one, whichever way it went.
        error: "A re-check cannot be undone. It wrote down what it found, and the old answer was older.",
      };
    }
    const ids = Array.isArray(batch.affected) ? batch.affected : [];
    if (ids.length === 0) return { ok: false as const, status: 409, error: "That change touched nothing." };

    let restored = 0;
    if (batch.kind === "archive") {
      const r = await client.query(
        `update subcontractors
            set archived_at = null, archived_reason = null, archived_by = null
          where org_id = $1 and id = any($2::uuid[]) and merged_into is null
          returning id`,
        [input.orgId, ids]
      );
      restored = r.rowCount ?? 0;
    } else if (batch.kind === "tag") {
      const r = await client.query(
        `delete from subcontractor_tags
          where org_id = $1 and subcontractor_id = any($2::uuid[]) and lower(tag) = lower($3)
          returning id`,
        [input.orgId, ids, batch.detail ?? ""]
      );
      restored = r.rowCount ?? 0;
    } else if (batch.kind === "untag") {
      const r = await client.query(
        `insert into subcontractor_tags (org_id, subcontractor_id, tag, created_by)
         select s.org_id, s.id, $3, $4::uuid
           from subcontractors s
          where s.org_id = $1 and s.id = any($2::uuid[])
         on conflict (subcontractor_id, lower(tag)) do nothing
         returning id`,
        [input.orgId, ids, batch.detail ?? "", input.actorId]
      );
      restored = r.rowCount ?? 0;
    }

    await client.query(
      `update subcontractor_bulk_actions set undone_at = now(), undone_by = $3::uuid where id = $1 and org_id = $2`,
      [input.batchId, input.orgId, input.actorId]
    );
    return { ok: true as const, restored };
  });
}

/** Tags on one firm, and the whole roster's tag list for the filter. */
export async function tagsOf(orgId: string, subcontractorId: string): Promise<string[]> {
  const rows = await query<{ tag: string }>(
    `select tag from subcontractor_tags
      where org_id = $1 and subcontractor_id = $2 order by lower(tag)`,
    [orgId, subcontractorId]
  );
  return rows.map((r) => r.tag);
}

export async function allTags(orgId: string): Promise<{ tag: string; n: number }[]> {
  return query<{ tag: string; n: number }>(
    `select min(tag) as tag, count(*)::int as n
       from subcontractor_tags where org_id = $1
      group by lower(tag) order by lower(min(tag))`,
    [orgId]
  );
}

function check(ids: string[]): { ok: false; status: number; error: string } | null {
  if (ids.length === 0) return { ok: false, status: 400, error: "Nothing was selected." };
  if (ids.length > BULK_LIMIT) {
    return {
      ok: false,
      status: 400,
      error: `That is more than ${BULK_LIMIT} at once. A change that big is one nobody has read the list for.`,
    };
  }
  return null;
}

async function record(client: PoolClient, input: {
  orgId: string;
  kind: BulkKind;
  actorId: string | null;
  affected: string[];
  skipped: BulkSkip[];
  detail: string | null;
}): Promise<string> {
  const result = await client.query<{ id: string }>(
    `insert into subcontractor_bulk_actions (org_id, kind, detail, affected, skipped, actor_id)
     values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::uuid) returning id`,
    [
      input.orgId, input.kind, input.detail,
      JSON.stringify(input.affected), JSON.stringify(input.skipped), input.actorId,
    ]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("The bulk action ledger did not return a batch id.");
  return id;
}
