import { query } from "./db";
import { currentOrg } from "./data";
import { diffProfiles, describeVersion, type ProfileChange } from "./domain/profile-diff";
import type { CompanyProfileJson } from "./types";

/**
 * The versions the profile has always kept and never showed.
 *
 * company_profile has carried a version number and an is_active flag since the
 * beginning, so every past profile is still on disk. Nothing read them, which
 * meant "who widened the service area in March" had nowhere to be answered
 * from, and a bad edit could only be undone by remembering what was there.
 */

export interface ProfileVersion {
  id: string;
  version: number;
  active: boolean;
  updatedAt: string;
  /** Who saved it, or null when the account is gone. */
  updatedBy: string | null;
  changes: ProfileChange[];
  summary: string;
}

export async function profileHistory(limit = 20): Promise<ProfileVersion[]> {
  const orgId = await currentOrg();
  const rows = await query<{
    id: string;
    version: number;
    is_active: boolean;
    profile_json: CompanyProfileJson;
    updated_at: string;
    who: string | null;
    raw_by: string | null;
  }>(
    /*
     * updated_by is text, not a uuid foreign key: it holds a user id on an
     * operator save and an agent name on an automated one. So the join
     * compares the user id cast to text rather than casting the column, which
     * would throw the moment it met a row saved by an agent.
     *
     * The raw value comes back too, so a save by "learning-loop" is reported
     * as that rather than as nobody.
     */
    `select p.id, p.version, p.is_active, p.profile_json,
            p.updated_at::text as updated_at,
            p.updated_by as raw_by,
            (select coalesce(nullif(btrim(u.name), ''), u.email)
               from users u where u.id::text = p.updated_by) as who
       from company_profile p
      where p.org_id = $1
      order by p.version desc
      limit $2`,
    [orgId, Math.min(50, Math.max(1, limit))]
  );

  /*
   * Each version is diffed against the one below it, so the newest entry
   * describes what the newest save did. The oldest row in the window has
   * nothing below it and is described as the starting point rather than
   * diffed against an empty profile, which would report every field as a
   * change and bury the entries that matter.
   */
  return rows.map((r, i) => {
    const older = rows[i + 1];
    const changes = older ? diffProfiles(older.profile_json, r.profile_json) : [];
    return {
      id: r.id,
      version: r.version,
      active: r.is_active,
      updatedAt: r.updated_at,
      /*
       * A name, then whatever was recorded, then nothing. An agent name is
       * information; "account since removed" for an agent save would be wrong.
       */
      updatedBy: r.who ?? (r.raw_by && !r.raw_by.includes("-") ? r.raw_by : null),
      changes,
      summary: older
        ? describeVersion(changes)
        : r.version === 1
          ? "The first profile on this account."
          : "Earliest version shown here. Older ones exist above the window.",
    };
  });
}

/** One stored version's JSON, scoped to the caller's organization. */
export async function profileVersionJson(
  versionId: string
): Promise<CompanyProfileJson | null> {
  const orgId = await currentOrg();
  const rows = await query<{ profile_json: CompanyProfileJson }>(
    `select profile_json from company_profile where id = $1 and org_id = $2`,
    [versionId, orgId]
  );
  return rows[0]?.profile_json ?? null;
}
