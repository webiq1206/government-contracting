/**
 * Requirement tracking against a real database.
 *
 * Three things here cannot be tested against a fake. The audit trail is
 * append-only because a trigger says so, and a trigger is only real if
 * something tries to break it. The reason attached to a blocked item is
 * required because a check constraint says so, and a constraint that nothing
 * has ever violated is a comment. And the tenant boundary lives inside the
 * writing statement rather than in a branch above it, which means the only way
 * to prove it holds is to point a real write at another organization's
 * opportunity and watch nothing happen.
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

d("requirement states (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let mod: typeof import("../lib/requirement-states");

  const mine = { id: "" };
  const theirs = { id: "" };
  const dana = { id: "" };
  const outsider = { id: "" };
  const opp = { id: "" };
  const theirOpp = { id: "" };

  const person = () => ({ kind: "person" as const, id: dana.id, label: "dana@x.invalid" });
  const robot = { kind: "automation" as const, label: "solicitation-analyst" };

  function asOrg(id: string) {
    CURRENT = {
      id: dana.id,
      email: "dana@x.invalid",
      name: "Dana",
      role: "member",
      orgRole: "owner",
      organizationId: id,
      subscriptionStatus: "active",
      planKey: "pro",
      trialEndsAt: null,
    } as SessionUser;
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    mod = await import("../lib/requirement-states");

    for (const org of [mine, theirs]) {
      const o = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`req-${randomUUID()}`]
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
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [
      mine.id,
      dana.id,
    ]);
    await query(`insert into organization_members (org_id, user_id, role) values ($1,$2,'owner')`, [
      theirs.id,
      outsider.id,
    ]);

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
      // Delete the opportunities and let the cascade take the states and the
      // events with them. Deleting the events first is refused by the
      // append-only trigger, which is the point of it: the only way an audit
      // row goes away is with the record it describes.
      await query(`delete from opportunities where org_id=$1`, [org.id]);
      await query(`delete from organization_members where org_id=$1`, [org.id]);
      await query(`delete from organizations where id=$1`, [org.id]);
    }
    for (const u of [dana, outsider]) {
      if (u.id) await query(`delete from users where id=$1`, [u.id]);
    }
    vi.restoreAllMocks();
  });

  it("records a state, reads it back, and writes an event", async () => {
    asOrg(mine.id);
    const id = `sf1449-${randomUUID()}`;
    const res = await mod.updateRequirement(opp.id, id, { state: "in_progress" }, person());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.state).toBe("in_progress");

    const states = await mod.requirementStates(opp.id);
    expect(states.get(id)?.state).toBe("in_progress");

    const history = await mod.requirementHistory(opp.id, id);
    expect(history).toHaveLength(1);
    // The first event has no from-state, because there was nothing before it.
    // Recording one would be inventing a decision nobody made.
    expect(history[0].fromState).toBeNull();
    expect(history[0].toState).toBe("in_progress");
    expect(history[0].actorKind).toBe("person");
  });

  it("records the owner and the due date, and says so in the trail", async () => {
    asOrg(mine.id);
    const id = `bond-${randomUUID()}`;
    const due = new Date(Date.now() + 5 * 86_400_000);
    const res = await mod.updateRequirement(
      opp.id,
      id,
      { state: "in_progress", ownerId: dana.id, dueAt: due },
      person()
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.owner).toEqual({ id: dana.id, name: "Dana Reyes" });
    expect(res.record.dueAt?.getTime()).toBe(due.getTime());

    const history = await mod.requirementHistory(opp.id, id);
    expect(history[0].note).toContain("Owner changed");
    expect(history[0].note).toContain("Due date set");
  });

  it("keeps a change that moves nothing but the owner in the trail", async () => {
    asOrg(mine.id);
    const id = `reps-${randomUUID()}`;
    await mod.updateRequirement(opp.id, id, { state: "in_progress" }, person());
    await mod.updateRequirement(opp.id, id, { ownerId: dana.id }, person());

    const history = await mod.requirementHistory(opp.id, id);
    // Two events, not one. A trail that only records state changes would show
    // this requirement as untouched since Tuesday while it changed hands.
    expect(history).toHaveLength(2);
    expect(history[0].note).toBe("Owner changed");
    expect(history[0].fromState).toBe("in_progress");
    expect(history[0].toState).toBe("in_progress");
  });

  it("refuses blocked with no reason, and the row is unchanged", async () => {
    asOrg(mine.id);
    const id = `blocked-${randomUUID()}`;
    await mod.updateRequirement(opp.id, id, { state: "in_progress" }, person());

    const res = await mod.updateRequirement(opp.id, id, { state: "blocked" }, person());
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);

    const states = await mod.requirementStates(opp.id);
    expect(states.get(id)?.state).toBe("in_progress");
  });

  it("refuses needs_clarification with a reason that is only whitespace", async () => {
    asOrg(mine.id);
    const id = `unclear-${randomUUID()}`;
    const res = await mod.updateRequirement(
      opp.id,
      id,
      { state: "needs_clarification", blockingReason: "   " },
      person()
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(400);
  });

  it("the database refuses a blocked row with no reason even without the service", async () => {
    // The check in updateRequirement makes the refusal readable. This is what
    // makes it true: a caller that bypasses the service still cannot write the
    // row. Remove the constraint and this test is the one that goes red.
    await expect(
      query(
        `insert into requirement_states (org_id, opportunity_id, requirement_id, state)
         values ($1,$2,$3,'blocked')`,
        [mine.id, opp.id, `raw-${randomUUID()}`]
      )
    ).rejects.toThrow();
  });

  it("will not let automation close an item that needs a signature", async () => {
    asOrg(mine.id);
    const id = `sig-${randomUUID()}`;
    await mod.updateRequirement(
      opp.id,
      id,
      { state: "in_progress", verification: "signature" },
      person()
    );

    const res = await mod.updateRequirement(opp.id, id, { state: "done" }, robot);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
    expect(res.error).toMatch(/signature/i);

    const states = await mod.requirementStates(opp.id);
    expect(states.get(id)?.state).toBe("in_progress");
  });

  it("will not let automation close an unconfirmed extraction even when nothing has to be proved", async () => {
    asOrg(mine.id);
    const id = `auto-${randomUUID()}`;
    await mod.updateRequirement(
      opp.id,
      id,
      { state: "in_progress", verification: "none" },
      person()
    );

    const refused = await mod.updateRequirement(opp.id, id, { state: "done" }, robot);
    expect(refused.ok).toBe(false);

    // With a person's confirmation that the extraction was read correctly,
    // and nothing to prove, automation may close it.
    await mod.updateRequirement(opp.id, id, { humanVerified: true }, person());
    const allowed = await mod.updateRequirement(opp.id, id, { state: "done" }, robot);
    expect(allowed.ok).toBe(true);
  });

  it("will not let automation decide a requirement does not apply", async () => {
    asOrg(mine.id);
    const id = `na-${randomUUID()}`;
    await mod.updateRequirement(
      opp.id,
      id,
      { state: "in_progress", verification: "none", humanVerified: true },
      person()
    );
    const res = await mod.updateRequirement(opp.id, id, { state: "not_applicable" }, robot);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(409);
  });

  it("cannot touch an opportunity in another organization", async () => {
    asOrg(mine.id);
    const id = `cross-${randomUUID()}`;
    const res = await mod.updateRequirement(opp.id, id, { state: "in_progress" }, person());
    expect(res.ok).toBe(true);

    // Same requirement id, their opportunity. 404 rather than 403: a record in
    // another organization must not be distinguishable from one that does not
    // exist.
    const across = await mod.updateRequirement(theirOpp.id, id, { state: "done" }, person());
    expect(across.ok).toBe(false);
    if (across.ok) return;
    expect(across.status).toBe(404);

    const leaked = await queryOne<{ n: string }>(
      `select count(*)::text as n from requirement_states where opportunity_id=$1`,
      [theirOpp.id]
    );
    expect(leaked?.n).toBe("0");
  });

  it("does not read another organization's states", async () => {
    asOrg(theirs.id);
    const states = await mod.requirementStates(opp.id);
    expect(states.size).toBe(0);
  });

  it("keeps the audit trail append-only", async () => {
    asOrg(mine.id);
    const id = `immutable-${randomUUID()}`;
    await mod.updateRequirement(opp.id, id, { state: "in_progress" }, person());
    const row = await queryOne<{ id: string }>(
      `select id from requirement_state_events where opportunity_id=$1 and requirement_id=$2`,
      [opp.id, id]
    );
    expect(row).toBeTruthy();

    await expect(
      query(`update requirement_state_events set to_state='done' where id=$1`, [row!.id])
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      query(`delete from requirement_state_events where id=$1`, [row!.id])
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("fills untouched requirements with a state that says nobody has said anything", async () => {
    asOrg(mine.id);
    const touched = `touched-${randomUUID()}`;
    const never = `never-${randomUUID()}`;
    await mod.updateRequirement(opp.id, touched, { state: "in_progress" }, person());

    const views = await mod.requirementViews(opp.id, [
      { id: touched, producedByPlatform: false },
      { id: never, producedByPlatform: false },
      { id: `${never}-signed`, needsSignature: true, producedByPlatform: false },
      { id: `${never}-auto`, producedByPlatform: true },
    ]);

    expect(views.states[touched].untouched).toBe(false);
    expect(views.states[never].untouched).toBe(true);
    // Nobody has said anything, so the default is the strict one: a document
    // is needed until somebody says otherwise.
    expect(views.states[never].verification).toBe("upload");
    expect(views.states[`${never}-signed`].verification).toBe("signature");
    // The platform produces it, so the platform can check it.
    expect(views.states[`${never}-auto`].verification).toBe("none");
  });
});
