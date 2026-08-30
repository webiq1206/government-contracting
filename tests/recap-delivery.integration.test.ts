/**
 * One recap per recipient per morning, and one account's history stays its own.
 *
 * Duplicate prevention here is not a nicety: the agent runs every fifteen
 * minutes, and every run asks the same question of the same recipients. If the
 * claim were advisory rather than enforced by the database, a slow send or two
 * workers overlapping would put four copies of the same morning in somebody's
 * inbox. These tests run the real statements against a real database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("recap delivery (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let delivery: typeof import("../lib/recap/delivery");

  const orgA = { id: "" };
  const orgB = { id: "" };
  const email = `recap-${randomUUID()}@example.test`;
  const day = "2026-08-29";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    delivery = await import("../lib/recap/delivery");
    for (const org of [orgA, orgB]) {
      const row = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`recap-${randomUUID()}`]
      );
      org.id = row!.id;
    }
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      if (!org.id) continue;
      await query(`delete from recap_deliveries where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from recap_urgent_items where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    }
    await query(`delete from recap_deliveries where scope='platform' and recipient_email=$1`, [
      email,
    ]).catch(() => {});
  });

  function claim(over: Partial<Parameters<typeof delivery.claimDelivery>[0]> = {}) {
    return delivery.claimDelivery({
      orgId: orgA.id,
      userId: null,
      recipientEmail: email,
      scope: "org",
      localDate: day,
      timezone: "America/Denver",
      dueAt: new Date("2026-08-30T12:00:00Z"),
      late: false,
      ...over,
    });
  }

  it("gives the morning to the first caller and refuses the second", async () => {
    const first = await claim();
    expect(first.delivery).not.toBeNull();
    await delivery.markSent(first.delivery!.id, {
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      quiet: false,
      urgentCount: 2,
    });

    const second = await claim();
    expect(second.delivery).toBeNull();
    expect(second.reason).toBe("already-sent");
  });

  it("stands down rather than racing a send that is still in flight", async () => {
    const other = `inflight-${randomUUID()}@example.test`;
    const first = await claim({ recipientEmail: other });
    expect(first.delivery).not.toBeNull();
    // Left pending, as if the first worker were still talking to the provider.
    const second = await claim({ recipientEmail: other });
    expect(second.delivery).toBeNull();
    expect(second.reason).toBe("in-flight");
  });

  it("survives two workers claiming the same morning at the same instant", async () => {
    const other = `race-${randomUUID()}@example.test`;
    const results = await Promise.all([
      claim({ recipientEmail: other }),
      claim({ recipientEmail: other }),
      claim({ recipientEmail: other }),
    ]);
    expect(results.filter((r) => r.delivery !== null)).toHaveLength(1);

    const rows = await query<{ n: number }>(
      `select count(*)::int n from recap_deliveries
        where org_id=$1 and lower(recipient_email)=lower($2) and local_date=$3::date and test=false`,
      [orgA.id, other, day]
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("lets a failed morning be claimed again, because a failure is not a send", async () => {
    const other = `failed-${randomUUID()}@example.test`;
    const first = await claim({ recipientEmail: other });
    await delivery.markFailed(first.delivery!.id, "provider refused", {
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      quiet: false,
      urgentCount: 0,
    });

    const again = await claim({ recipientEmail: other });
    expect(again.delivery).not.toBeNull();
    expect(again.delivery!.attempts).toBeGreaterThan(1);
  });

  it("picks up a stalled send that never reached the mail service", async () => {
    /*
     * A worker that died before handing the mail over left no mail behind, so
     * finishing the job later cannot produce a second copy.
     */
    const other = `stalled-clean-${randomUUID()}@example.test`;
    const first = await claim({ recipientEmail: other });
    await query(
      `update recap_deliveries set updated_at = now() - interval '40 minutes' where id=$1`,
      [first.delivery!.id]
    );

    const again = await claim({ recipientEmail: other });
    expect(again.delivery).not.toBeNull();
    expect(again.delivery!.id).toBe(first.delivery!.id);
  });

  it("leaves a stalled send alone once the mail service has been handed the mail", async () => {
    /*
     * The dangerous half of the same situation: the provider may already have
     * accepted this and sent it. Guessing wrong here means a second copy of
     * the same recap, which is the one mistake nothing can take back, so the
     * row waits for a person instead.
     */
    const other = `stalled-sent-${randomUUID()}@example.test`;
    const first = await claim({ recipientEmail: other });
    await delivery.markAttempting(first.delivery!.id);
    await query(
      `update recap_deliveries set updated_at = now() - interval '40 minutes' where id=$1`,
      [first.delivery!.id]
    );

    const again = await claim({ recipientEmail: other });
    expect(again.delivery).toBeNull();
    expect(again.reason).toBe("in-flight");

    // But a person looking at the history can still decide to send it again.
    expect(await delivery.reopenForRetry(first.delivery!.id, orgA.id)).toBe(true);
  });

  it("stops re-attempting an address that keeps failing", async () => {
    // Otherwise a permanently broken address is retried every quarter of an
    // hour, all morning, forever.
    const other = `hopeless-${randomUUID()}@example.test`;
    const first = await claim({ recipientEmail: other });
    await query(
      `update recap_deliveries set status='failed', attempts=$2, error='provider refused' where id=$1`,
      [first.delivery!.id, delivery.MAX_AUTOMATIC_ATTEMPTS]
    );

    const again = await claim({ recipientEmail: other });
    expect(again.delivery).toBeNull();
  });

  it("refuses a platform recap that claims to belong to an account", async () => {
    /*
     * Enforced by the database, not by the code that happens to write these
     * rows: a platform recap is built from every tenant, so one carrying an
     * org_id is a cross-account leak wearing the right shape.
     */
    await expect(
      query(
        `insert into recap_deliveries (org_id, recipient_email, scope, local_date, timezone, status)
         values ($1, $2, 'platform', $3::date, 'America/Denver', 'pending')`,
        [orgA.id, `bad-scope-${randomUUID()}@example.test`, day]
      )
    ).rejects.toThrow();
  });

  it("does not let a rehearsal consume the real morning", async () => {
    const other = `test-send-${randomUUID()}@example.test`;
    const rehearsal = await claim({ recipientEmail: other, test: true });
    expect(rehearsal.delivery).not.toBeNull();
    const second = await claim({ recipientEmail: other, test: true });
    expect(second.delivery).not.toBeNull();

    // And the real one is still available.
    const real = await claim({ recipientEmail: other });
    expect(real.delivery).not.toBeNull();
  });

  it("keeps the platform's own send in a lane of its own", async () => {
    const platform = await delivery.claimDelivery({
      orgId: null,
      userId: null,
      recipientEmail: email,
      scope: "platform",
      localDate: day,
      timezone: "America/Denver",
      dueAt: new Date("2026-08-30T12:00:00Z"),
      late: false,
    });
    // The same address already has an account recap for this day; the platform
    // copy must not collide with it.
    expect(platform.delivery).not.toBeNull();
    expect(platform.delivery!.orgId).toBeNull();
  });
});

d("recap history and retry (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let delivery: typeof import("../lib/recap/delivery");
  const orgA = { id: "" };
  const orgB = { id: "" };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    delivery = await import("../lib/recap/delivery");
    for (const org of [orgA, orgB]) {
      const row = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`recap-hist-${randomUUID()}`]
      );
      org.id = row!.id;
    }
  });

  afterAll(async () => {
    for (const org of [orgA, orgB]) {
      if (!org.id) continue;
      await query(`delete from recap_deliveries where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from recap_urgent_items where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    }
  });

  it("shows an account only its own deliveries", async () => {
    for (const org of [orgA, orgB]) {
      const c = await delivery.claimDelivery({
        orgId: org.id,
        userId: null,
        recipientEmail: `hist-${randomUUID()}@example.test`,
        scope: "org",
        localDate: "2026-08-28",
        timezone: "America/Denver",
        dueAt: new Date(),
        late: false,
      });
      await delivery.markSent(c.delivery!.id, {
        subject: "s",
        html: "<p>h</p>",
        text: "t",
        quiet: true,
        urgentCount: 0,
      });
    }

    const forA = await delivery.deliveryHistory({ orgId: orgA.id });
    expect(forA).toHaveLength(1);
    expect(forA.every((row) => row.orgId === orgA.id)).toBe(true);
  });

  it("refuses to retry another account's delivery", async () => {
    const c = await delivery.claimDelivery({
      orgId: orgA.id,
      userId: null,
      recipientEmail: `retry-${randomUUID()}@example.test`,
      scope: "org",
      localDate: "2026-08-27",
      timezone: "America/Denver",
      dueAt: new Date(),
      late: false,
    });
    await delivery.markFailed(c.delivery!.id, "provider refused", {
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      quiet: false,
      urgentCount: 1,
    });

    expect(await delivery.reopenForRetry(c.delivery!.id, orgB.id)).toBe(false);
    expect(await delivery.reopenForRetry(c.delivery!.id, orgA.id)).toBe(true);
  });

  it("will not retry something that already went out", async () => {
    const c = await delivery.claimDelivery({
      orgId: orgA.id,
      userId: null,
      recipientEmail: `sent-${randomUUID()}@example.test`,
      scope: "org",
      localDate: "2026-08-26",
      timezone: "America/Denver",
      dueAt: new Date(),
      late: false,
    });
    await delivery.markSent(c.delivery!.id, {
      subject: "s",
      html: "<p>h</p>",
      text: "t",
      quiet: false,
      urgentCount: 0,
    });
    expect(await delivery.reopenForRetry(c.delivery!.id, orgA.id)).toBe(false);
  });

  it("keeps the sent copy, so a retry resends the day that was promised", async () => {
    const c = await delivery.claimDelivery({
      orgId: orgA.id,
      userId: null,
      recipientEmail: `copy-${randomUUID()}@example.test`,
      scope: "org",
      localDate: "2026-08-25",
      timezone: "America/Denver",
      dueAt: new Date(),
      late: false,
    });
    await delivery.markFailed(c.delivery!.id, "provider refused", {
      subject: "Yesterday's subject",
      html: "<p>the body as it was</p>",
      text: "the body as it was",
      quiet: false,
      urgentCount: 3,
    });
    const stored = await delivery.getDelivery(c.delivery!.id);
    expect(stored?.subject).toBe("Yesterday's subject");
    expect(stored?.html).toContain("the body as it was");
    expect(stored?.urgentCount).toBe(3);
  });
});

d("how long an item has been urgent (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let delivery: typeof import("../lib/recap/delivery");
  const org = { id: "" };
  const other = { id: "" };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    delivery = await import("../lib/recap/delivery");
    for (const o of [org, other]) {
      const row = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`recap-age-${randomUUID()}`]
      );
      o.id = row!.id;
    }
  });

  afterAll(async () => {
    for (const o of [org, other]) {
      if (!o.id) continue;
      await query(`delete from recap_urgent_items where org_id=$1`, [o.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [o.id]).catch(() => {});
    }
  });

  it("counts from the morning an item first appeared", async () => {
    const first = await delivery.recordUrgentItems(org.id, ["deadline:x"], "2026-08-25");
    expect(first["deadline:x"]).toBe(0);

    const later = await delivery.recordUrgentItems(org.id, ["deadline:x"], "2026-08-29");
    expect(later["deadline:x"]).toBe(4);
  });

  it("does not age an item just because somebody opened the page", async () => {
    await delivery.recordUrgentItems(org.id, ["deadline:page"], "2026-08-25");
    const viewed = await delivery.urgentAges(org.id, ["deadline:page"], "2026-08-29");
    expect(viewed["deadline:page"]).toBe(4);
    // Reading it again reports the same age: no write happened.
    const again = await delivery.urgentAges(org.id, ["deadline:page"], "2026-08-29");
    expect(again["deadline:page"]).toBe(4);
    const row = await queryOne<{ first_seen: string }>(
      `select to_char(first_seen_on, 'YYYY-MM-DD') as first_seen
         from recap_urgent_items where org_id=$1 and item_key='deadline:page'`,
      [org.id]
    );
    expect(row!.first_seen).toBe("2026-08-25");
  });

  it("never reads another account's ages, even for an identically named item", async () => {
    await delivery.recordUrgentItems(org.id, ["deadline:shared"], "2026-08-20");
    const theirs = await delivery.urgentAges(other.id, ["deadline:shared"], "2026-08-29");
    expect(theirs["deadline:shared"]).toBeUndefined();
  });
});
