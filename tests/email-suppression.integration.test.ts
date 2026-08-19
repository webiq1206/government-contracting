/**
 * Do-not-contact.
 *
 * Someone who asked to be removed was closed out on that one solicitation and
 * then emailed again the moment the next one matched their trade. Mail after
 * an opt-out is what produces spam complaints, and complaints are what move a
 * whole sending domain into the spam folder for every tenant at once, so this
 * is a deliverability control as much as a courtesy.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readsAsOptOut } from "../lib/domain/email-suppression";

describe("readsAsOptOut", () => {
  it("catches explicit opt-out language", () => {
    for (const t of [
      "Please remove me from your list",
      "unsubscribe",
      "Take me off your mailing list please",
      "stop emailing me",
      "Do not contact me again",
      "Opt me out",
      "I no longer wish to receive these",
    ]) {
      expect(readsAsOptOut(t), t).toBe(true);
    }
  });

  it("does NOT treat an ordinary decline as an opt-out", () => {
    // Declining one solicitation is normal. Suppressing on it would silently
    // end the relationship over a routine "no thanks".
    for (const t of [
      "Not interested in this one, too far out",
      "We're booked through November, pass on this",
      "No thanks, not a fit for us this time",
      "Can't bid this, but send me the next one",
      "We are not able to quote this project",
    ]) {
      expect(readsAsOptOut(t), t).toBe(false);
    }
  });

  it("is safe on empty input", () => {
    expect(readsAsOptOut("")).toBe(false);
    expect(readsAsOptOut(undefined as never)).toBe(false);
  });
});

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("suppression list (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let sup: typeof import("../lib/domain/email-suppression");
  const orgA = { id: "" };
  const orgB = { id: "" };
  const addr = `stop-${randomUUID()}@example.com`;

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    sup = await import("../lib/domain/email-suppression");
    for (const o of [orgA, orgB]) {
      const r = await queryOne<{ id: string }>(
        `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
        [`sup-${randomUUID()}`]
      );
      o.id = r!.id;
    }
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      await query(`delete from email_suppressions where org_id=$1`, [o.id]).catch(() => {});
      await query(`delete from organizations where id=$1`, [o.id]).catch(() => {});
    }
  });

  it("suppresses, and is case-insensitive on the address", async () => {
    expect(await sup.isSuppressed(orgA.id, addr)).toBe(false);
    await sup.suppressEmail({ orgId: orgA.id, email: addr, source: "reply" });
    expect(await sup.isSuppressed(orgA.id, addr)).toBe(true);
    expect(await sup.isSuppressed(orgA.id, addr.toUpperCase())).toBe(true);
  });

  it("does not leak one tenant's opt-out into another", async () => {
    // Each tenant is a separate sender with its own relationship; org B has
    // no standing to see or inherit org A's opt-out.
    expect(await sup.isSuppressed(orgB.id, addr)).toBe(false);
  });

  it("is idempotent and keeps the original reason", async () => {
    await sup.suppressEmail({ orgId: orgA.id, email: addr, reason: "second try" });
    const rows = await query<{ reason: string | null }>(
      `select reason from email_suppressions where org_id=$1 and lower(email)=$2`,
      [orgA.id, addr.toLowerCase()]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).not.toBe("second try");
  });

  it("can be lifted", async () => {
    await sup.unsuppressEmail(orgA.id, addr);
    expect(await sup.isSuppressed(orgA.id, addr)).toBe(false);
  });
});
