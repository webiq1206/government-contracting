import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "@/lib/db";

/**
 * Folding two records of the same firm into one, without losing anything.
 *
 * A roster built partly by hand and partly by a sourcing agent accumulates the
 * same firm twice: "Ridgeline Mechanical" and "Ridgeline Mechanical LLC", one
 * with the phone number and one with the email, half the history on each. The
 * only tool for that was deleting one, which takes its emails, quotes,
 * pairings, documents and compliance records with it, and those are the record
 * of who was approached for a federal bid.
 *
 * Two things make this safe rather than merely careful.
 *
 * The first is that the list of tables to repoint is read from the database's
 * own catalog rather than written down here. Sixteen columns across fourteen
 * tables reference a subcontractor today, and a fifteenth added next month
 * would silently lose its history if this module held a hand-written list that
 * somebody forgot to extend. A test asserts the catalog and the code agree.
 *
 * The second is that nothing is deleted. The losing record stays as a
 * tombstone pointing at the survivor, so an old link still resolves and an old
 * id in somebody's notes still means something.
 */

/** Above this, the moved ids are not recorded and the merge cannot be undone. */
export const UNDO_ROW_LIMIT = 5_000;

export interface MergeChildTable {
  table: string;
  column: string;
  /** True when a duplicate would violate a unique constraint on merge. */
  mayCollide: boolean;
}

/*
 * The unique constraints that a merge can collide with.
 *
 * Both are "one row per (opportunity, subcontractor, trade)". Merging two
 * firms that were both paired to the same trade on the same bid produces two
 * rows that cannot coexist, and the honest resolution is to keep the
 * survivor's and record that the other was folded in rather than to fail the
 * whole merge over a pairing row.
 */
const COLLIDING = new Set(["opportunity_subs.subcontractor_id", "quotes.subcontractor_id"]);

/**
 * Every column in this database that points at a subcontractor.
 *
 * Read from the catalog, not written down. The names are real identifiers
 * from `information_schema`, not anything a request supplied, and they are
 * quoted before they reach a statement.
 */
export async function subcontractorChildTables(): Promise<MergeChildTable[]> {
  const rows = await query<{ table_name: string; column_name: string }>(
    `select tc.table_name, kcu.column_name
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name
        and kcu.constraint_schema = tc.constraint_schema
       join information_schema.constraint_column_usage ccu
         on ccu.constraint_name = tc.constraint_name
        and ccu.constraint_schema = tc.constraint_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = 'public'
        and ccu.table_name = 'subcontractors'
        and ccu.column_name = 'id'
        -- The tombstone pointer is the merge's own output, not history to move.
        and not (tc.table_name = 'subcontractors' and kcu.column_name = 'merged_into')
      order by tc.table_name, kcu.column_name`
  );
  return rows.map((r) => ({
    table: r.table_name,
    column: r.column_name,
    mayCollide: COLLIDING.has(`${r.table_name}.${r.column_name}`),
  }));
}

/**
 * A safety net over identifiers that already came from the catalog.
 *
 * They cannot contain anything dangerous, and the check is here so that a
 * future change feeding this function from somewhere else fails loudly rather
 * than quietly building a statement out of a string.
 */
function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to build SQL around ${JSON.stringify(name)}.`);
  }
  return `"${name}"`;
}

export interface MergePlanRow {
  table: string;
  column: string;
  /** Rows that will move to the survivor. */
  moving: number;
  /** Rows that cannot move because the survivor already has the equivalent. */
  colliding: number;
}

export interface MergePlan {
  survivorId: string;
  mergedId: string;
  survivorName: string;
  mergedName: string;
  rows: MergePlanRow[];
  totalMoving: number;
  totalColliding: number;
  reversible: boolean;
  irreversibleReason: string | null;
  /** Fields where the two records disagree, so a person can choose. */
  conflicts: { field: string; survivor: string | null; merged: string | null }[];
}

/** Fields an operator is offered a choice about. */
const CHOOSABLE = [
  "company_name",
  "owner_name",
  "email",
  "phone",
  "website",
  "address",
  "city",
  "state",
  "license_number",
  "license_status",
  "notes",
] as const;

type Choosable = (typeof CHOOSABLE)[number];

/**
 * What a merge would do, before it does it.
 *
 * Built as its own step so the confirmation an operator sees is the same
 * arithmetic the merge runs, rather than an estimate of it. A dialog that says
 * "moves 40 emails" and then moves 38 teaches somebody not to read the dialog.
 */
export async function planMerge(
  orgId: string,
  survivorId: string,
  mergedId: string
): Promise<MergePlan | null> {
  if (survivorId === mergedId) return null;
  const both = await query<Record<string, unknown>>(
    `select * from subcontractors where org_id = $1 and id = any($2::uuid[])`,
    [orgId, [survivorId, mergedId]]
  );
  const survivor = both.find((r) => r.id === survivorId);
  const merged = both.find((r) => r.id === mergedId);
  if (!survivor || !merged) return null;

  const tables = await subcontractorChildTables();
  const rows: MergePlanRow[] = [];
  for (const t of tables) {
    if (t.table === "subcontractors") continue;
    const counted = await countFor(t, survivorId, mergedId);
    rows.push(counted);
  }

  const totalMoving = rows.reduce((a, r) => a + r.moving, 0);
  const totalColliding = rows.reduce((a, r) => a + r.colliding, 0);

  const conflicts = CHOOSABLE.filter((f) => {
    const a = text(survivor[f]);
    const b = text(merged[f]);
    return b != null && a !== b;
  }).map((f) => ({
    field: f,
    survivor: text(survivor[f]),
    merged: text(merged[f]),
  }));

  return {
    survivorId,
    mergedId,
    survivorName: String(survivor.company_name ?? ""),
    mergedName: String(merged.company_name ?? ""),
    rows: rows.filter((r) => r.moving > 0 || r.colliding > 0),
    totalMoving,
    totalColliding,
    reversible: totalMoving <= UNDO_ROW_LIMIT,
    irreversibleReason:
      totalMoving > UNDO_ROW_LIMIT
        ? `${totalMoving} records would move, which is more than can be written down for an undo. The merge can still go ahead, and it cannot be reversed afterwards.`
        : null,
    conflicts,
  };
}

async function countFor(
  t: MergeChildTable,
  survivorId: string,
  mergedId: string
): Promise<MergePlanRow> {
  const table = ident(t.table);
  const col = ident(t.column);

  if (!t.mayCollide) {
    const row = await queryOne<{ n: string }>(
      `select count(*)::text as n from ${table} where ${col} = $1`,
      [mergedId]
    );
    return { table: t.table, column: t.column, moving: Number(row?.n ?? 0), colliding: 0 };
  }

  /*
   * A colliding table is unique on (opportunity, subcontractor, trade). A row
   * whose (opportunity, trade) the survivor already occupies cannot move, and
   * the survivor's is the one that stands.
   */
  const row = await queryOne<{ moving: string; colliding: string }>(
    `select
       count(*) filter (where not exists (
         select 1 from ${table} s
          where s.${col} = $1
            and s.opportunity_id = m.opportunity_id
            and coalesce(s.trade,'') = coalesce(m.trade,'')
       ))::text as moving,
       count(*) filter (where exists (
         select 1 from ${table} s
          where s.${col} = $1
            and s.opportunity_id = m.opportunity_id
            and coalesce(s.trade,'') = coalesce(m.trade,'')
       ))::text as colliding
     from ${table} m where m.${col} = $2`,
    [survivorId, mergedId]
  );
  return {
    table: t.table,
    column: t.column,
    moving: Number(row?.moving ?? 0),
    colliding: Number(row?.colliding ?? 0),
  };
}

function text(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s ? s : null;
}

export type MergeResult =
  | { ok: true; mergeId: string; moved: number; reversible: boolean }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * Do the merge.
 *
 * One transaction, so a failure part-way leaves the roster exactly as it was
 * rather than with half a firm's history on each record.
 *
 * `keep` names the field choices. Anything not named keeps the survivor's
 * value, which is the safe default: a merge that silently preferred the newer
 * record could overwrite a phone number somebody corrected by hand.
 */
export async function mergeSubcontractors(input: {
  orgId: string;
  survivorId: string;
  mergedId: string;
  /** field -> "survivor" | "merged". Absent means keep the survivor's. */
  keep?: Partial<Record<Choosable, "survivor" | "merged">>;
  actorId: string | null;
  actorEmail: string | null;
}): Promise<MergeResult> {
  const plan = await planMerge(input.orgId, input.survivorId, input.mergedId);
  if (!plan) {
    return { ok: false, status: 404, error: "One of those records is not on this roster." };
  }

  const alreadyMerged = await queryOne<{ merged_into: string | null }>(
    `select merged_into from subcontractors where id = $1 and org_id = $2`,
    [input.mergedId, input.orgId]
  );
  if (alreadyMerged?.merged_into) {
    return {
      ok: false,
      status: 409,
      error: "That record has already been folded into another one.",
    };
  }

  const tables = (await subcontractorChildTables()).filter((t) => t.table !== "subcontractors");
  const moved: Record<string, string[]> = {};
  let movedTotal = 0;

  await transaction(async (c: PoolClient) => {
    for (const t of tables) {
      const table = ident(t.table);
      const col = ident(t.column);

      /*
       * Ids first, then the move. Recording what moved is what makes an undo
       * real rather than a promise: putting the record back is easy, and
       * putting its emails back with it is only possible if somebody wrote
       * down which ones.
       */
      if (plan.reversible) {
        const ids = await c.query<{ id: string }>(
          `select id::text from ${table} where ${col} = $1 limit ${UNDO_ROW_LIMIT}`,
          [input.mergedId]
        );
        if (ids.rows.length > 0) moved[`${t.table}.${t.column}`] = ids.rows.map((r) => r.id);
      }

      if (t.mayCollide) {
        const res = await c.query(
          `update ${table} m set ${col} = $1
            where m.${col} = $2
              and not exists (
                select 1 from ${table} s
                 where s.${col} = $1
                   and s.opportunity_id = m.opportunity_id
                   and coalesce(s.trade,'') = coalesce(m.trade,'')
              )`,
          [input.survivorId, input.mergedId]
        );
        movedTotal += res.rowCount ?? 0;
        /*
         * What is left cannot move: the survivor already holds that
         * (opportunity, trade). Left on the losing record rather than deleted,
         * so the pairing that was made is still readable, and the tombstone
         * carries it.
         */
      } else {
        const res = await c.query(
          `update ${table} set ${col} = $1 where ${col} = $2`,
          [input.survivorId, input.mergedId]
        );
        movedTotal += res.rowCount ?? 0;
      }
    }

    // Field choices. Only the ones explicitly asked for; everything else keeps
    // the survivor's value.
    const chosen = Object.entries(input.keep ?? {}).filter(([, side]) => side === "merged");
    if (chosen.length > 0) {
      const sets = chosen.map(([field], i) => `${ident(field)} = $${i + 3}`);
      const values = chosen.map(([field]) => {
        const c2 = plan.conflicts.find((x) => x.field === field);
        return c2?.merged ?? null;
      });
      await c.query(
        `update subcontractors set ${sets.join(", ")} where id = $1 and org_id = $2`,
        [input.survivorId, input.orgId, ...values]
      );
    }

    await c.query(
      `update subcontractors
          set merged_into = $2,
              archived_at = now(),
              archived_reason = $3,
              archived_by = $4::uuid
        where id = $1 and org_id = $5`,
      [
        input.mergedId,
        input.survivorId,
        `Folded into ${plan.survivorName}.`,
        input.actorId,
        input.orgId,
      ]
    );

    const snapshot = await c.query<Record<string, unknown>>(
      `select * from subcontractors where id = $1`,
      [input.mergedId]
    );

    await c.query(
      `insert into subcontractor_merges
         (org_id, survivor_id, merged_id, merged_snapshot, field_decisions, moved,
          reversible, irreversible_reason, actor_id, actor_email)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9::uuid,$10)`,
      [
        input.orgId,
        input.survivorId,
        input.mergedId,
        JSON.stringify(snapshot.rows[0] ?? {}),
        JSON.stringify(input.keep ?? {}),
        JSON.stringify(moved),
        plan.reversible,
        plan.irreversibleReason,
        input.actorId,
        input.actorEmail,
      ]
    );
  });

  const created = await queryOne<{ id: string }>(
    `select id from subcontractor_merges
      where org_id = $1 and merged_id = $2 order by at desc limit 1`,
    [input.orgId, input.mergedId]
  );

  return {
    ok: true,
    mergeId: created?.id ?? "",
    moved: movedTotal,
    reversible: plan.reversible,
  };
}

/**
 * Put a merge back.
 *
 * Only what was written down moves back, which is why the ids are recorded at
 * merge time. A merge that moved more than could be written down was marked
 * irreversible before the operator committed to it, and this refuses it here
 * rather than half-restoring a firm.
 */
export async function undoMerge(input: {
  orgId: string;
  mergeId: string;
  actorId: string | null;
}): Promise<MergeResult> {
  const rec = await queryOne<{
    id: string;
    merged_id: string;
    reversible: boolean;
    moved: Record<string, string[]>;
    undone_at: Date | null;
  }>(
    `select id, merged_id, reversible, moved, undone_at
       from subcontractor_merges where id = $1 and org_id = $2`,
    [input.mergeId, input.orgId]
  );
  if (!rec) return { ok: false, status: 404, error: "No such merge." };
  if (rec.undone_at) {
    return { ok: false, status: 409, error: "That merge has already been undone." };
  }
  if (!rec.reversible) {
    return {
      ok: false,
      status: 409,
      error:
        "That merge moved more history than could be written down, so it cannot be put back automatically.",
    };
  }

  let movedBack = 0;
  await transaction(async (c: PoolClient) => {
    for (const [key, ids] of Object.entries(rec.moved ?? {})) {
      const [table, column] = key.split(".");
      if (!table || !column || ids.length === 0) continue;
      const res = await c.query(
        `update ${ident(table)} set ${ident(column)} = $1 where id = any($2::uuid[])`,
        [rec.merged_id, ids]
      );
      movedBack += res.rowCount ?? 0;
    }
    await c.query(
      `update subcontractors
          set merged_into = null, archived_at = null, archived_reason = null, archived_by = null
        where id = $1 and org_id = $2`,
      [rec.merged_id, input.orgId]
    );
    await c.query(
      `update subcontractor_merges set undone_at = now(), undone_by = $3::uuid
        where id = $1 and org_id = $2`,
      [input.mergeId, input.orgId, input.actorId]
    );
  });

  return { ok: true, mergeId: rec.id, moved: movedBack, reversible: true };
}

/**
 * Put a subcontractor aside without losing them.
 *
 * Not the same as blocking. "We do not work with these any more" and "do not
 * use, here is why" are different statements about a firm, and a roster that
 * renders them identically is one where somebody eventually emails the wrong
 * one.
 */
export async function archiveSubcontractor(input: {
  orgId: string;
  subcontractorId: string;
  reason: string;
  actorId: string | null;
}): Promise<MergeResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, status: 400, error: "Say why it is being put aside." };
  }
  const rows = await query<{ id: string }>(
    `update subcontractors
        set archived_at = now(), archived_reason = $3, archived_by = $4::uuid
      where id = $2 and org_id = $1 and archived_at is null
      returning id`,
    [input.orgId, input.subcontractorId, reason, input.actorId]
  );
  return rows.length > 0
    ? { ok: true, mergeId: "", moved: 0, reversible: true }
    : { ok: false, status: 404, error: "No such subcontractor, or it is already put aside." };
}

/** Bring one back. A merged record has to be un-merged instead. */
export async function restoreSubcontractor(input: {
  orgId: string;
  subcontractorId: string;
}): Promise<MergeResult> {
  const row = await queryOne<{ merged_into: string | null }>(
    `select merged_into from subcontractors where id = $1 and org_id = $2`,
    [input.subcontractorId, input.orgId]
  );
  if (!row) return { ok: false, status: 404, error: "No such subcontractor." };
  if (row.merged_into) {
    return {
      ok: false,
      status: 409,
      error: "This record was folded into another one. Undo the merge to bring it back.",
    };
  }
  await query(
    `update subcontractors
        set archived_at = null, archived_reason = null, archived_by = null
      where id = $1 and org_id = $2`,
    [input.subcontractorId, input.orgId]
  );
  return { ok: true, mergeId: "", moved: 0, reversible: true };
}
