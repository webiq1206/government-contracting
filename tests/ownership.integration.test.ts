/**
 * Assignment against a real database.
 *
 * The rule worth testing here cannot be expressed as a foreign key: an owner
 * has to be somebody who can see the record. A key to `users` permits any user
 * on the platform, which would let one organization's bid name a person in
 * another company as its owner, and that name would then appear on a screen
 * they have no business appearing on. The constraint has to consult
 * organization_members, so it is a trigger, and a trigger is only real if
 * something tries to break it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";
import type { SessionUser } from "../lib/auth";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth")>();
  return { ...actual, currentUser: vi.fn(async () => CURRENT) };
});
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("record ownership (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let assignRecord: typeof import("../lib/ownership").assignRecord;
  let assignableMembers: typeof import("../lib/ownership").assignableMembers;
  let ownerOf: typeof import("../lib/ownership").ownerOf;

  const mine = { id: "" };
  const theirs = { id: "" };
  const dana = { id: "" };
  const outsider = { id: "" };
  const opp = { id: "" };
  const theirOpp = { id: "" };

  function asOrg(id: string) {
    CURRENT = {
      id: dana.id, email: "dana@x.invalid", name: "Dana", role: "member",
      orgRole: "owner",
      organizationId: id, subscriptionStatus: "active", planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ assignRecord, assignableMembers, ownerOf } = await import("../lib/ownership"));

    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`own-${randomUUID()}`]
      );
      org.id = o!.id;
    }
    const d1 = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role) values ($1,'x','Dana Reyes','operator') returning id`,
      [`dana-${randomUUID()}@x.invalid`]
    );
    dana.id = d1!.id;
    const o1 = await queryOne<{ id: string }>(
      `insert into users (email, password_hash, name, role) values ($1,'x','Outsider','operator') returning id`,
      [`out-${randomUUID()}@x.invalid`]
    );
    outsider.id = o1!.id;
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [mine.id, dana.id]);
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [theirs.id, outsider.id]);

    const op = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Fort Bliss HVAC','bid_building','open', now() + interval '30 days') returning id`,
      [mine.id]
    );
    opp.id = op!.id;
    const other = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, source, title, stage, status, deadline)
       values ($1,'test','Their job','bid_building','open', now() + interval '30 days') returning id`,
      [theirs.id]
    );
    theirOpp.id = other!.id;
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from opportunities where org_id=$1`, [org.id]);
      await query(`delete from organization_members where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
    for (const u of [dana, outsider]) {
      if (u.id) await query(`delete from users where id=$1`, [u.id]);
    }
    vi.restoreAllMocks();
  });

  it("assigns, reads back a name, and unassigns", async () => {
    asOrg(mine.id);
    expect(await assignRecord("opportunity", opp.id, dana.id, dana.id)).toBe(true);
    expect(await ownerOf("opportunity", opp.id)).toEqual({ id: dana.id, name: "Dana Reyes" });

    // Unassigning is a real answer, not a failure to answer.
    expect(await assignRecord("opportunity", opp.id, null, dana.id)).toBe(true);
    expect(await ownerOf("opportunity", opp.id)).toBeNull();
  });

  it("clears the trail when the owner is cleared", async () => {
    asOrg(mine.id);
    await assignRecord("opportunity", opp.id, dana.id, dana.id);
    await assignRecord("opportunity", opp.id, null, dana.id);
    const row = await queryOne<{ assigned_at: Date | null; assigned_by: string | null }>(
      `select assigned_at, assigned_by from opportunities where id=$1`,
      [opp.id]
    );
    // A record with no owner but a stamp saying when it was assigned is a row
    // that contradicts itself.
    expect(row?.assigned_at).toBeNull();
    expect(row?.assigned_by).toBeNull();
  });

  it("refuses somebody from another organization", async () => {
    asOrg(mine.id);
    await expect(assignRecord("opportunity", opp.id, outsider.id, dana.id)).rejects.toThrow(
      /must be a member/
    );
    expect(await ownerOf("opportunity", opp.id)).toBeNull();
  });

  it("cannot reach a record in another organization at all", async () => {
    asOrg(mine.id);
    // False rather than a throw: the API answers 404, and a record in another
    // organization must not be distinguishable from one that does not exist.
    expect(await assignRecord("opportunity", theirOpp.id, dana.id, dana.id)).toBe(false);
  });

  it("offers only this organization's people", async () => {
    asOrg(mine.id);
    const members = await assignableMembers();
    expect(members.map((m) => m.id)).toEqual([dana.id]);
    expect(JSON.stringify(members)).not.toContain(outsider.id);
  });
});
