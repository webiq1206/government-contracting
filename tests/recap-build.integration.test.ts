/**
 * The recap counts what is in the records, and only this account's records.
 *
 * The email and the page both come through `buildRecapFor`, so proving the
 * numbers here proves both. The isolation case is the one that matters most:
 * a recap names opportunities, subcontractors and failures, and a leak between
 * accounts would put one contractor's pipeline in another's inbox.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { DEFAULT_RECAP_SETTINGS } from "@/lib/domain/recap/types";
import { dayWindow } from "@/lib/domain/recap/day-window";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const TZ = "America/Denver";
const DAY = "2026-08-29";

d("building a recap from real rows (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let buildRecapFor: typeof import("../lib/recap/build").buildRecapFor;
  let renderRecapEmail: typeof import("../lib/domain/recap/email").renderRecapEmail;

  const mine = { id: "", oppId: "" };
  const theirs = { id: "", oppId: "" };

  // A moment inside the day being summarised, so the rows land in the window.
  const inside = new Date(dayWindow(DAY, TZ).start.getTime() + 9 * 3600_000);
  // "Now" is the morning after, when the recap would be sent.
  const now = new Date(dayWindow(DAY, TZ).end.getTime() + 6 * 3600_000);

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ buildRecapFor } = await import("../lib/recap/build"));
    ({ renderRecapEmail } = await import("../lib/domain/recap/email"));

    for (const [org, label] of [
      [mine, "Mine"],
      [theirs, "Theirs"],
    ] as const) {
      const row = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`recap-build-${label}-${randomUUID()}`]
      );
      org.id = row!.id;

      const opp = await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, agency, stage, status, created_at, deadline)
         values ($1,'test',$2,'GSA','bidding','open',$3,$4) returning id`,
        [
          org.id,
          `${label} secret roof job`,
          inside.toISOString(),
          new Date(now.getTime() + 10 * 3600_000).toISOString(),
        ]
      );
      org.oppId = opp!.id;

      // Two emails out, one of which never reached a provider, and one reply in.
      await query(
        `insert into communications (org_id, direction, channel, subject, body, provider, delivery_state, created_at)
         values ($1,'outbound','email','Invitation to bid','body','resend','delivered',$2),
                ($1,'outbound','email','Invitation to bid','body',null,'sent',$2),
                ($1,'inbound','email','Re: Invitation','we are interested','resend','delivered',$2)`,
        [org.id, inside.toISOString()]
      );
    }
  });

  afterAll(async () => {
    for (const org of [mine, theirs]) {
      if (!org.id) continue;
      await query(`delete from communications where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from opportunities where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from recap_urgent_items where org_id=$1`, [org.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
    }
  });

  function build(orgId: string) {
    return buildRecapFor({
      orgId,
      localDate: DAY,
      timezone: TZ,
      settings: DEFAULT_RECAP_SETTINGS,
      now,
      recordAges: false,
    });
  }

  it("reports totals that reconcile with the rows behind them", async () => {
    const { recap } = await build(mine.id);
    const totals = recap.sections.find((s) => s.key === "totals")!.totals;
    const value = (label: string) => totals.find((t) => t.label === label)?.value;

    const counted = await queryOne<{ sent: number; replies: number; discovered: number }>(
      `select
         (select count(*) from communications
           where org_id=$1 and direction='outbound' and channel='email'
             and created_at >= $2 and created_at < $3)::int as sent,
         (select count(*) from communications
           where org_id=$1 and direction='inbound' and channel='email'
             and created_at >= $2 and created_at < $3)::int as replies,
         (select count(*) from opportunities
           where org_id=$1 and created_at >= $2 and created_at < $3)::int as discovered`,
      [mine.id, dayWindow(DAY, TZ).start.toISOString(), dayWindow(DAY, TZ).end.toISOString()]
    );

    expect(value("Outreach emails sent")).toBe(counted!.sent);
    expect(value("Replies received")).toBe(counted!.replies);
    expect(value("Solicitations found")).toBe(counted!.discovered);
  });

  it("counts a busy day in full, past the number of items the mail lists", async () => {
    /*
     * The lists in the recap are capped, because a mail with hundreds of lines
     * in it is not a summary. The totals must not inherit that cap: counting
     * the rows that survived it would report a twenty-seven bid day as twenty
     * five, and a number the reader cannot check is worse than no number.
     */
    // One bid per opportunity is a rule of the schema, so a busy day means a
    // busy pipeline: twenty-seven solicitations, each bid once.
    const busy = 27;
    const extras: string[] = [];
    for (let i = 0; i < busy; i += 1) {
      const opp = await queryOne<{ id: string }>(
        `insert into opportunities (org_id, source, title, agency, stage, status, created_at)
         values ($1,'test',$2,'GSA','bidding','open',$3) returning id`,
        [mine.id, `Busy day job ${i}`, inside.toISOString()]
      );
      extras.push(opp!.id);
      await query(
        `insert into bids (org_id, opportunity_id, bid_amount, submitted_at,
                           submission_method, submission_destination, sent_timezone)
         values ($1,$2,$3,$4,'email','bids@agency.test',$5)`,
        [mine.id, opp!.id, 1000 + i, inside.toISOString(), TZ]
      );
    }

    try {
      const { recap } = await build(mine.id);
      const total = recap.sections
        .find((s) => s.key === "totals")!
        .totals.find((t) => t.label === "Bids submitted")!.value;
      expect(total).toBe(busy);
    } finally {
      await query(`delete from bids where org_id=$1`, [mine.id]);
      await query(`delete from opportunities where id = any($1::uuid[])`, [extras]);
    }
  });

  it("counts a send that never reached a provider as a failure, not a success", async () => {
    const { recap } = await build(mine.id);
    const note = recap.sections
      .find((s) => s.key === "totals")!
      .totals.find((t) => t.label === "Outreach emails sent")?.note;
    expect(note).toContain("1");
    expect(note).toContain("failed");
  });

  it("never mentions another account's work", async () => {
    const { recap } = await build(mine.id);
    const rendered = renderRecapEmail(recap, { appUrl: "https://app.example.com" });
    expect(rendered.html).toContain("Mine secret roof job");
    expect(rendered.html).not.toContain("Theirs secret roof job");
    expect(rendered.text).not.toContain("Theirs secret roof job");
    expect(JSON.stringify(recap)).not.toContain(theirs.oppId);
  });

  it("gives each account its own recap from the same call", async () => {
    const a = await build(mine.id);
    const b = await build(theirs.id);
    expect(a.recap.orgId).toBe(mine.id);
    expect(b.recap.orgId).toBe(theirs.id);
    expect(JSON.stringify(b.recap)).not.toContain(mine.oppId);
  });

  it("hands the page and the email the very same recap object", async () => {
    const { recap } = await build(mine.id);
    const rendered = renderRecapEmail(recap, { appUrl: "https://app.example.com" });
    // Every urgent item in the object appears in the mail, by title.
    for (const item of recap.sections.find((s) => s.key === "urgent")!.items) {
      expect(rendered.text).toContain(item.title);
    }
    expect(rendered.subject).toContain(recap.dayLabel);
  });

  it("marks a day that has not finished yet as partial rather than final", async () => {
    const midday = new Date(dayWindow(DAY, TZ).start.getTime() + 12 * 3600_000);
    const { recap } = await buildRecapFor({
      orgId: mine.id,
      localDate: DAY,
      timezone: TZ,
      settings: DEFAULT_RECAP_SETTINGS,
      now: midday,
      recordAges: false,
    });
    expect(recap.partial).toBe(true);
  });

  it("does not age anything when the page builds the recap", async () => {
    await build(mine.id);
    await build(mine.id);
    const rows = await query<{ n: number }>(
      `select count(*)::int n from recap_urgent_items where org_id=$1`,
      [mine.id]
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("records ages only when a real send builds it", async () => {
    await buildRecapFor({
      orgId: mine.id,
      localDate: DAY,
      timezone: TZ,
      settings: DEFAULT_RECAP_SETTINGS,
      now,
      recordAges: true,
    });
    const rows = await query<{ n: number }>(
      `select count(*)::int n from recap_urgent_items where org_id=$1`,
      [mine.id]
    );
    expect(rows[0]!.n).toBeGreaterThan(0);
  });

  it("reads the same day differently for two zones, and says which it used", async () => {
    const denver = await build(mine.id);
    const { recap: auckland } = await buildRecapFor({
      orgId: mine.id,
      localDate: DAY,
      timezone: "Pacific/Auckland",
      settings: DEFAULT_RECAP_SETTINGS,
      now,
      recordAges: false,
    });
    expect(denver.recap.timezone).toBe(TZ);
    expect(auckland.timezone).toBe("Pacific/Auckland");
    /*
     * The rows were written at 09:00 on the 29th in Denver, which is already
     * the small hours of the 30th in Auckland. Asking for "the 29th" from
     * there is a genuinely different eighteen-hours-earlier window, and it
     * does not contain them. This is the bug the whole day-window module
     * exists to prevent: one reader's recap silently containing another
     * reader's day.
     */
    const sent = (r: typeof auckland) =>
      r.sections.find((s) => s.key === "totals")!.totals.find((t) => t.label === "Outreach emails sent")!
        .value;
    expect(sent(denver.recap)).toBeGreaterThan(0);
    expect(sent(auckland)).toBe(0);
  });
});
