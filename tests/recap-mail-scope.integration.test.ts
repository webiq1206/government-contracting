import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecapView } from "@/components/recap-view";
import { renderRecapEmail } from "@/lib/domain/recap/email";
import { DEFAULT_RECAP_SETTINGS, type Recap } from "@/lib/domain/recap/types";

const d = process.env.DATABASE_URL ? describe : describe.skip;
const DAY = "2026-10-10";
const NOW = new Date("2026-10-11T12:00:00Z");
const ARRIVAL = "2026-10-11T00:15:02.089553Z";

// Real rows in the disposable database distinguish an empty mailbox fixture
// from an unmatched arrival. The recap deliberately sees neither as a stored
// communication reply; its wording must not turn that into a mailbox claim.
d("recap mail scope (integration)", () => {
  let query: typeof import("@/lib/db").query;
  let queryOne: typeof import("@/lib/db").queryOne;
  let buildRecapFor: typeof import("@/lib/recap/build").buildRecapFor;
  let orgId: string;

  beforeAll(async () => {
    ({ query, queryOne } = await import("@/lib/db"));
    ({ buildRecapFor } = await import("@/lib/recap/build"));
  });
  beforeEach(async () => {
    orgId = randomUUID();
    await query("insert into organizations (id, name) values ($1, 'Recap scope fixture')", [orgId]);
  });
  afterEach(async () => {
    for (const table of ["unmatched_inbound", "quotes", "communications", "agent_logs", "opportunities", "recap_urgent_items"]) {
      await query(`delete from ${table} where org_id=$1`, [orgId]);
    }
    await query("delete from organizations where id=$1", [orgId]);
  });

  const build = (localDate = DAY, now = NOW) => buildRecapFor({
    orgId, localDate, timezone: "America/Denver", now,
    settings: DEFAULT_RECAP_SETTINGS, recordAges: false,
  });
  const total = (recap: Recap, label: string) =>
    recap.sections.find(s => s.key === "totals")!.totals.find(t => t.label === label)!;
  async function addOpportunity(createdAt: string) {
    const row = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, source, stage, created_at)
       values ($1, 'Synthetic recap opportunity', 'test', 'discovered', $2) returning id`,
      [orgId, createdAt]
    );
    return row!.id;
  }
  async function addUnmatched(subject: string) {
    await query(
      `insert into unmatched_inbound
         (org_id, from_email, subject, snippet, message_id, received_at, created_at)
       values ($1, 'sender@example.invalid', $2, 'Our quote is $5000.67', $3, $4, $4)`,
      [orgId, subject, randomUUID(), ARRIVAL]
    );
  }
  function expectScopedOutput(recap: Recap) {
    const mail = renderRecapEmail(recap, { appUrl: "https://app.example.test" });
    const page = renderToStaticMarkup(createElement(RecapView, { recap }));
    for (const rendered of [mail.html, mail.text, page]) {
      expect(rendered).toMatch(/unmatched inbox messages[^<\n]*excluded/i);
      expect(rendered).toMatch(/template test sends[^<\n]*excluded/i);
      expect(rendered).not.toMatch(/nobody wrote back|nothing needed you|nothing needed a person|a full record of the day/i);
      if (recap.quiet) expect(rendered).toContain("records covered by this recap");
      else expect(rendered).toContain("No outreach sends or processed replies are listed for this day.");
    }
  }

  it("keeps a genuinely empty day at zero without inventing arrivals", async () => {
    const { recap } = await build();
    expect(recap.quiet).toBe(true);
    expect(total(recap, "Replies received").value).toBe(0);
    expect(total(recap, "Quotes recorded").value).toBe(0);
    const rows = await queryOne<{ n: number }>("select count(*)::int n from unmatched_inbound where org_id=$1", [orgId]);
    expect(rows!.n).toBe(0);
    expectScopedOutput(recap);
  });

  it.each(["Re: Pricing request", "Re: [TEST] [SYNTHETIC] recap fixture"])(
    "distinguishes a stored unmatched arrival from zero communication replies: %s", async subject => {
      await addUnmatched(subject);
      const rows = await queryOne<{ n: number }>(
        `select count(*)::int n from unmatched_inbound where org_id=$1
           and created_at >= '2026-10-10T06:00:00Z' and created_at < '2026-10-11T06:00:00Z'`,
        [orgId]
      );
      expect(rows!.n).toBe(1);
      const quiet = await build();
      expect(quiet.recap.quiet).toBe(true);
      expect(quiet.facts.totals.repliesReceived).toBe(0);
      expect(quiet.facts.totals.quotesRecorded).toBe(0);
      expectScopedOutput(quiet.recap);

      // Exercise the normal renderer too; the quiet renderer hides sections.
      await addOpportunity(ARRIVAL);
      const normal = await build();
      expect(normal.recap.quiet).toBe(false);
      expect(total(normal.recap, "Replies received")).toMatchObject({
        value: 0, note: expect.stringContaining("Communication history only"),
      });
      expect(total(normal.recap, "Quotes recorded").value).toBe(0);
      expectScopedOutput(normal.recap);
      const saved = await queryOne<{ replies: number; quotes: number; unmatched: number }>(
        `select (select count(*)::int from communications where org_id=$1) replies,
                (select count(*)::int from quotes where org_id=$1) quotes,
                (select count(*)::int from unmatched_inbound where org_id=$1) unmatched`, [orgId]
      );
      expect(saved).toEqual({ replies: 0, quotes: 0, unmatched: 1 });
    }
  );

  it("excludes template-test audit receipts and synthetic unmatched text from business outcomes", async () => {
    await query(
      `insert into agent_logs (org_id, agent, action, level, message, output_json, created_at)
       values ($1, 'operator', 'template-test-send', 'info', 'Controlled sample fixture',
               '{"mode":"sample","messageId":"synthetic-provider-receipt"}'::jsonb, $2)`,
      [orgId, ARRIVAL]
    );
    await addUnmatched("Re: [TEST] [SYNTHETIC] controlled template sample");
    const { recap, facts } = await build();
    expect(facts.totals).toMatchObject({ outreachSent: 0, repliesReceived: 0, quotesRecorded: 0, bidsSubmitted: 0 });
    expect(total(recap, "Outreach emails sent").note).toContain("template test sends are excluded");
    expectScopedOutput(recap);
    const rows = await queryOne<{ n: number }>("select count(*)::int n from quotes where org_id=$1", [orgId]);
    expect(rows!.n).toBe(0);
  });

  it("counts saved replies by provenance, not a test-looking subject, and requires a saved quote", async () => {
    const opportunityId = await addOpportunity("2026-01-01T00:00:00Z");
    await query(
      `insert into communications (org_id, opportunity_id, direction, channel, subject, body, created_at)
       values ($1, $2, 'inbound', 'email', 'Re: [TEST] material testing request', 'Our quote is $5000.67', $3)`,
      [orgId, opportunityId, ARRIVAL]
    );
    const before = await build();
    expect(before.facts.totals).toMatchObject({ repliesReceived: 1, quotesRecorded: 0 });
    await query(
      "insert into quotes (org_id, opportunity_id, quote_amount, created_at) values ($1,$2,5000.67,$3)",
      [orgId, opportunityId, ARRIVAL]
    );
    const after = await build();
    expect(after.facts.totals).toMatchObject({ repliesReceived: 1, quotesRecorded: 1 });
    expect(total(after.recap, "Quotes recorded").note).toContain("Saved quote records only");
  });

  it.each([
    { day: DAY, start: "2026-10-10T06:00:00Z", before: "2026-10-10T05:59:59.999999Z", evening: ARRIVAL,
      last: "2026-10-11T05:59:59.999999Z", end: "2026-10-11T06:00:00Z", now: "2026-10-11T12:00:00Z" },
    { day: "2026-03-08", start: "2026-03-08T07:00:00Z", before: "2026-03-08T06:59:59.999999Z", evening: "2026-03-09T00:15:00Z",
      last: "2026-03-09T05:59:59.999999Z", end: "2026-03-09T06:00:00Z", now: "2026-03-09T12:00:00Z" },
    { day: "2026-11-01", start: "2026-11-01T06:00:00Z", before: "2026-11-01T05:59:59.999999Z", evening: "2026-11-02T00:15:00Z",
      last: "2026-11-02T06:59:59.999999Z", end: "2026-11-02T07:00:00Z", now: "2026-11-02T13:00:00Z" },
  ])("uses the half-open Denver day for stored replies and quotes: $day", async boundary => {
    // Fixed instants are independent of dayWindow(). Preserve PostgreSQL's
    // microseconds instead of rounding the exclusive boundary through Date.
    const opportunityId = await addOpportunity("2026-01-01T00:00:00Z");
    for (const [label, at, expected] of [
      ["before start", boundary.before, 0],
      ["inclusive start", boundary.start, 1],
      ["next UTC date, same local day", boundary.evening, 1],
      ["last microsecond", boundary.last, 1],
      ["exclusive end", boundary.end, 0],
    ] as const) {
      // Independent membership checks prevent an incorrect (start,end]
      // window from passing by exchanging the two endpoint records.
      await query(
        `insert into communications (org_id, opportunity_id, direction, channel, subject, body, created_at, meta)
         values ($1, $2, 'inbound', 'email', 'Stored reply fixture', 'Price is 42', $3,
           '{"original_date_header":"Wed, 01 Jan 2025 00:00:00 +0000"}'::jsonb)`,
        [orgId, opportunityId, at]
      );
      await query(
        "insert into quotes (org_id, opportunity_id, quote_amount, created_at) values ($1,$2,42,$3)",
        [orgId, opportunityId, at]
      );
      const { facts } = await build(boundary.day, new Date(boundary.now));
      expect(facts.totals.repliesReceived, label).toBe(expected);
      expect(facts.totals.quotesRecorded, label).toBe(expected);
      await query("delete from quotes where org_id=$1", [orgId]);
      await query("delete from communications where org_id=$1", [orgId]);
    }
  });
});
