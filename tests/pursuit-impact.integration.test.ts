/**
 * What an abort stops, and what it cannot undo.
 *
 * A confirmation that only asks "are you sure?" is a speed bump. The question
 * an operator is actually asking is what happens if they do this, and the two
 * halves of the answer serve different purposes: what stops tells them what
 * they are giving up, what stands stops them being surprised later.
 *
 * The second half is the one products get wrong. Messages already sent cannot
 * be recalled. Those subcontractors are expecting an answer, and a summary
 * that implied the emails had been pulled back would leave somebody believing
 * a thing that is not true about other people's inboxes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("the abort impact summary", () => {
  let query: typeof import("../lib/db").query;
  let pursuitImpact: typeof import("../lib/pursuit-impact").pursuitImpact;

  const org = randomUUID();
  const busy = randomUUID();
  const quiet = randomUUID();
  const sub = randomUUID();

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ pursuitImpact } = await import("../lib/pursuit-impact"));

    await query(
      `insert into organizations (id, name, subscription_status, billing_exempt)
       values ($1,'Impact Probe','active',true) on conflict (id) do nothing`,
      [org]
    );
    await query(
      `insert into subcontractors (id, org_id, company_name, trade_categories, state, email, email_verified)
       values ($1,$2,'Rivera Mechanical','{"hvac"}','TX','r@probe.invalid',true)
       on conflict (id) do nothing`,
      [sub, org]
    );
    await query(
      `insert into opportunities (id, org_id, title, solicitation_number, source, status, stage, deadline)
       values ($1,$2,'Roof replacement, Building 402','W912DR-26-R-0042','test','open','outreach', now() + interval '10 days')
       on conflict (id) do nothing`,
      [busy, org]
    );
    await query(
      `insert into opportunities (id, org_id, title, source, status, stage)
       values ($1,$2,'Nothing has happened yet','test','open','monitoring')
       on conflict (id) do nothing`,
      [quiet, org]
    );

    // Two quote requests out and unanswered, one reply in, one quote saved.
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'hvac','sent')`,
      [busy, sub]
    );
    for (const dir of ["outbound", "outbound", "inbound"]) {
      await query(
        `insert into communications (org_id, opportunity_id, subcontractor_id, channel, direction, subject, body)
         values ($1,$2,$3,'email',$4,'Quote request','...')`,
        [org, busy, sub, dir]
      );
    }
    await query(
      `insert into quotes (org_id, opportunity_id, subcontractor_id, trade, quote_amount)
       values ($1,$2,$3,'hvac',42000)`,
      [org, busy, sub]
    );
  });

  afterAll(async () => {
    for (const t of ["quotes", "communications", "opportunity_subs"]) {
      await query(`delete from ${t} where opportunity_id = any($1::uuid[])`, [[busy, quiet]]).catch(() => {});
    }
    await query(`delete from opportunities where id = any($1::uuid[])`, [[busy, quiet]]).catch(() => {});
    await query(`delete from subcontractors where id = $1`, [sub]).catch(() => {});
    await query(`delete from organizations where id = $1`, [org]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("counts what would stop", async () => {
    const i = (await pursuitImpact(busy))!;
    const stops = i.stops.find((s) => s.label.includes("follow-up"));
    expect(stops?.count).toBe(1);
  });

  it("says the sent messages cannot be recalled, in those words", async () => {
    /*
     * The half that matters most. Two emails are in somebody's inbox and are
     * staying there; an abort does not reach into another company's mail.
     */
    const i = (await pursuitImpact(busy))!;
    const sent = i.stands.find((s) => s.label.includes("cannot be recalled"));
    expect(sent?.count).toBe(2);
  });

  it("names the subcontractor still waiting on us", async () => {
    const i = (await pursuitImpact(busy))!;
    expect(i.stands.some((s) => s.label.includes("still waiting"))).toBe(true);
  });

  it("lists what is retained, so an abort does not read as a delete", async () => {
    const i = (await pursuitImpact(busy))!;
    const text = i.retained.join(" | ");
    expect(text).toMatch(/1 reply received/);
    expect(text).toMatch(/1 quote/);
    expect(text).toMatch(/every email, note and log line/);
  });

  it("asks for the solicitation number, not the word ABORT", async () => {
    /*
     * Typing "ABORT" is muscle memory and proves nothing about which
     * opportunity is being looked at. The solicitation number is on the screen
     * and is specific to this record.
     */
    const i = (await pursuitImpact(busy))!;
    expect(i.confirmPhrase).toBe("W912DR-26-R-0042");
  });

  it("falls back to a short, typable piece of the title", async () => {
    /*
     * Short enough to type, and specific enough to identify the record. The UI
     * displays the exact phrase, so a truncated title is unambiguous rather
     * than a guessing game: the operator types what is shown.
     */
    const i = (await pursuitImpact(quiet))!;
    expect(i.title).toBe("Nothing has happened yet");
    expect(i.confirmPhrase).toBe("Nothing has happened");
    expect(i.confirmPhrase.split(/\s+/).length).toBeLessThanOrEqual(3);
    expect(i.title!.startsWith(i.confirmPhrase)).toBe(true);
  });

  it("never asks for an empty phrase", async () => {
    // An empty confirmation target would make the typed check pass on an
    // empty box, which is no check at all.
    for (const id of [busy, quiet]) {
      const i = (await pursuitImpact(id))!;
      expect(i.confirmPhrase.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows no lines at all when nothing has happened", async () => {
    // "0 calls will stop" is noise that makes the two lines that matter harder
    // to find, in the moment somebody is deciding.
    const i = (await pursuitImpact(quiet))!;
    expect(i.stops).toHaveLength(0);
    expect(i.stands).toHaveLength(0);
  });

  it("returns null for an opportunity that does not exist", async () => {
    expect(await pursuitImpact(randomUUID())).toBeNull();
  });
});
