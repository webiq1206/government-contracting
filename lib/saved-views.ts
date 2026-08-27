import { query, queryOne } from "@/lib/db";
import {
  canDeleteView,
  checkViewName,
  type SavedViewRecord,
  type ViewScope,
} from "@/lib/domain/saved-views";

/**
 * Reading and writing saved views.
 *
 * Every query is scoped by organization, and personal views are additionally
 * scoped by owner: a colleague's personal shortcut is not something this
 * account's other members should be able to enumerate, let alone open.
 */

interface Row {
  id: string;
  name: string;
  query: string;
  scope: ViewScope;
  owner_id: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_email: string | null;
}

/**
 * The views this person can see on this page.
 *
 * Team views for the organization, plus this reader's own personal ones.
 * Ordered team-first because a shared filter is the one a new member should
 * find without being told it exists.
 */
export async function savedViewsFor(
  orgId: string,
  viewer: { id: string; canManageTeam: boolean },
  pageKey: string
): Promise<SavedViewRecord[]> {
  const rows = await query<Row>(
    `select v.id, v.name, v.query, v.scope, v.owner_id, v.created_by,
            u.name as created_by_name, u.email as created_by_email
       from saved_views v
       left join users u on u.id = v.created_by
      where v.org_id = $1 and v.page_key = $2
        and (v.scope = 'team' or v.owner_id = $3)
      order by (v.scope = 'personal'), lower(v.name)`,
    [orgId, pageKey, viewer.id]
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    query: r.query,
    scope: r.scope,
    createdBy:
      r.scope === "team"
        ? // Named on team views so a colleague knows whose filter it is, and
          // never an email address, which is a name's place being used for an
          // address on a screen other people can see.
          r.created_by_name?.trim() || r.created_by_email?.split("@")[0] || null
        : null,
    canDelete: canDeleteView(
      { scope: r.scope, ownerId: r.owner_id, createdBy: r.created_by },
      viewer
    ),
  }));
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "name" | "duplicate" };

export async function saveView(input: {
  orgId: string;
  userId: string;
  pageKey: string;
  name: string;
  query: string;
  scope: ViewScope;
}): Promise<SaveResult> {
  const checked = checkViewName(input.name);
  if (!checked.ok) return { ok: false, reason: "name" };
  /*
   * The duplicate is caught by the index rather than by a read first.
   * Two people naming a team view "Due this week" at the same moment is
   * exactly the race a check-then-insert loses, and the loser's view would
   * silently overwrite or vanish.
   */
  try {
    const row = await queryOne<{ id: string }>(
      `insert into saved_views (org_id, page_key, name, query, scope, created_by, owner_id)
       values ($1,$2,$3,$4,$5,$6, case when $5 = 'personal' then $6::uuid else null end)
       returning id`,
      [input.orgId, input.pageKey, checked.name, input.query, input.scope, input.userId]
    );
    return { ok: true, id: row!.id };
  } catch (e) {
    if (String((e as Error).message).includes("saved_views_")) {
      return { ok: false, reason: "duplicate" };
    }
    throw e;
  }
}

/**
 * Remove one view.
 *
 * Returns false when it is not there or not this reader's to remove, which the
 * caller answers as 404: whether a colleague has a personal view called
 * "Mine" is not something another member should be able to learn from a
 * status code.
 */
export async function deleteView(
  orgId: string,
  viewer: { id: string; canManageTeam: boolean },
  id: string
): Promise<boolean> {
  const row = await queryOne<{ scope: ViewScope; owner_id: string | null; created_by: string | null }>(
    `select scope, owner_id, created_by from saved_views where id = $1 and org_id = $2`,
    [id, orgId]
  );
  if (!row) return false;
  if (!canDeleteView({ scope: row.scope, ownerId: row.owner_id, createdBy: row.created_by }, viewer)) {
    return false;
  }
  const gone = await query<{ id: string }>(
    `delete from saved_views where id = $1 and org_id = $2 returning id`,
    [id, orgId]
  );
  return gone.length > 0;
}
