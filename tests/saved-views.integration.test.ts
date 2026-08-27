/**
 * Saved views, and who can see which.
 *
 * They lived in localStorage, which was right for one of the two kinds and
 * wrong for the other. A personal view is somebody's own shortcut. A team view
 * is how an office agrees what "the work" means this month, and it is useless
 * if it exists only in the browser of the person who made it.
 *
 * The rule this test exists for is the one a mistake here breaks: a
 * colleague's personal shortcut is not something another member of the account
 * should be able to enumerate, let alone open.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: () => new Map(),
}));

d("saved views (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let v: typeof import("../lib/saved-views");

  const org = { id: "" };
  const other = { id: "" };
  const dana = { id: "" };
  const sam = { id: "" };
  const admin = { id: "" };

  const asDana = () => ({ id: dana.id, canManageTeam: false });
  const asSam = () => ({ id: sam.id, canManageTeam: false });
  const asAdmin = () => ({ id: admin.id, canManageTeam: true });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    v = await import("../lib/saved-views");
    for (const o of [org, other]) {
      const row = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`views-${randomUUID()}`]
      );
      o.id = row!.id;
    }
    for (const [who, name] of [
      [dana, "Dana"],
      [sam, "Sam"],
      [admin, "Admin"],
    ] as const) {
      const row = await queryOne<{ id: string }>(
        `insert into users (email, password_hash, name, role) values ($1,'x',$2,'operator') returning id`,
        [`${name.toLowerCase()}-${randomUUID()}@x.invalid`, name]
      );
      who.id = row!.id;
      await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [
        org.id,
        who.id,
      ]);
    }
  });

  afterAll(async () => {
    for (const o of [org, other]) {
      if (!o.id) continue;
      await query(`delete from saved_views where org_id=$1`, [o.id]);
      await query(`delete from organization_members where org_id=$1`, [o.id]);
      await query(`delete from organizations where id=$1`, [o.id]);
    }
    for (const u of [dana, sam, admin]) {
      if (u.id) await query(`delete from users where id=$1`, [u.id]);
    }
    vi.restoreAllMocks();
  });

  it("keeps a personal view to its author", async () => {
    const saved = await v.saveView({
      orgId: org.id,
      userId: dana.id,
      pageKey: "opportunities",
      name: "Mine this week",
      query: "due=7",
      scope: "personal",
    });
    expect(saved.ok).toBe(true);

    const hers = await v.savedViewsFor(org.id, asDana(), "opportunities");
    expect(hers.map((x) => x.name)).toContain("Mine this week");

    const his = await v.savedViewsFor(org.id, asSam(), "opportunities");
    expect(his.map((x) => x.name)).not.toContain("Mine this week");
  });

  it("shows a team view to everybody, with its author's name", async () => {
    await v.saveView({
      orgId: org.id,
      userId: dana.id,
      pageKey: "opportunities",
      name: "Due this week",
      query: "due=7",
      scope: "team",
    });
    const his = await v.savedViewsFor(org.id, asSam(), "opportunities");
    const shared = his.find((x) => x.name === "Due this week");
    expect(shared?.scope).toBe("team");
    // A shared view with no author is a rule from nowhere, and the first
    // question about one is always who set it.
    expect(shared?.createdBy).toBe("Dana");
  });

  it("never leaks a view across organizations", async () => {
    await v.saveView({
      orgId: other.id,
      userId: dana.id,
      pageKey: "opportunities",
      name: "Somebody else entirely",
      query: "stage=analysis",
      scope: "team",
    });
    const ours = await v.savedViewsFor(org.id, asDana(), "opportunities");
    expect(ours.map((x) => x.name)).not.toContain("Somebody else entirely");
  });

  it("refuses a second team view with the same name", async () => {
    /*
     * Two views called "Due this week" showing different things is how a
     * shared filter stops being shared. Caught by the index rather than a read
     * first, because two people naming one at the same moment is exactly the
     * race a check-then-insert loses.
     */
    const again = await v.saveView({
      orgId: org.id,
      userId: sam.id,
      pageKey: "opportunities",
      name: "due this WEEK",
      query: "due=14",
      scope: "team",
    });
    expect(again).toEqual({ ok: false, reason: "duplicate" });
  });

  it("lets two people keep personal views of the same name", async () => {
    // They are different people's shortcuts and never appear side by side.
    const his = await v.saveView({
      orgId: org.id,
      userId: sam.id,
      pageKey: "opportunities",
      name: "Mine this week",
      query: "due=3",
      scope: "personal",
    });
    expect(his.ok).toBe(true);
  });

  it("lets the author delete, and a colleague not", async () => {
    const saved = await v.saveView({
      orgId: org.id,
      userId: dana.id,
      pageKey: "subs",
      name: "Preferred only",
      query: "preferred=1",
      scope: "personal",
    });
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.id : "";
    expect(await v.deleteView(org.id, asSam(), id)).toBe(false);
    // Not even an administrator: a personal view is a shortcut, not a record.
    expect(await v.deleteView(org.id, asAdmin(), id)).toBe(false);
    expect(await v.deleteView(org.id, asDana(), id)).toBe(true);
  });

  it("lets an administrator remove a team view whose author has gone", async () => {
    const saved = await v.saveView({
      orgId: org.id,
      userId: dana.id,
      pageKey: "subs",
      name: "Everyone's list",
      query: "state=TX",
      scope: "team",
    });
    const id = saved.ok ? saved.id : "";
    // A shared filter whose author has left would otherwise be permanent.
    expect(await v.deleteView(org.id, asAdmin(), id)).toBe(true);
  });
});
