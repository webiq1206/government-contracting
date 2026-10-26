/**
 * Each account's outreach clock is its own IANA zone. America/Boise is only
 * the fallback when organizations.timezone is unset or unusable.
 *
 * These cases pass absolute instants to Intl. They do not read the process
 * zone or Date#getHours. The same UTC instant is open in New York and closed
 * in Los Angeles. The Boise fallback still disagrees with a UTC hour check
 * and with a fixed MDT offset.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null as { timezone: string | null } | null),
}));
vi.mock("../lib/db", () => ({ query: db.query, queryOne: db.queryOne }));

import { accountOutreachTimeZone, outreachSendZoneFor, setAccountTimeZone } from "../lib/domain/account-timezone";
import {
  recipientTimeZoneFromLocation,
  resolveHybridOutreachZone,
} from "../lib/domain/recipient-timezone";
import {
  OUTREACH_SEND_FALLBACK_TIME_ZONE,
  evaluateOutreachSendWindow,
  isOutreachWindowHold,
  outreachSendTimeZone,
  outreachWindowRefusal,
  resolveOutreachSendTimeZone,
} from "../lib/domain/outreach-send-window";

describe("America/Boise weekday business hours", () => {
  it("resolves the fallback zone, not the process zone", () => {
    expect(OUTREACH_SEND_FALLBACK_TIME_ZONE).toBe("America/Boise");
    expect(outreachSendTimeZone()).toBe("America/Boise");
    expect(outreachSendTimeZone(null)).toBe("America/Boise");
    expect(outreachSendTimeZone("")).toBe("America/Boise");
    expect(outreachSendTimeZone("Not/AZone")).toBe("America/Boise");
    expect(resolveOutreachSendTimeZone("America/New_York")).toBe("America/New_York");
    expect(outreachSendTimeZone("America/Los_Angeles")).toBe("America/Los_Angeles");
  });

  it.each([
    ["Monday 08:59 MDT", "2026-10-26T14:59:00.000Z", false],
    ["Monday 09:00 MDT", "2026-10-26T15:00:00.000Z", true],
    ["Monday 16:59 MDT", "2026-10-26T22:59:00.000Z", true],
    ["Monday 17:00 MDT", "2026-10-26T23:00:00.000Z", false],
    ["Friday 16:59 MDT", "2026-10-30T22:59:00.000Z", true],
    ["Friday 17:00 MDT", "2026-10-30T23:00:00.000Z", false],
    ["Saturday 10:00 MDT", "2026-10-24T16:00:00.000Z", false],
    ["Sunday 10:00 MDT", "2026-10-25T16:00:00.000Z", false],
    // 2026-11-01 is the US fall-back. A fixed UTC-6 offset would call 15:00Z 9:00.
    ["Tuesday 08:00 MST after fall-back", "2026-11-03T15:00:00.000Z", false],
    ["Tuesday 09:00 MST after fall-back", "2026-11-03T16:00:00.000Z", true],
  ])("%s (%s) open=%s", (_label, iso, open) => {
    const at = new Date(iso);
    const decision = evaluateOutreachSendWindow(at);
    expect(decision.timeZone).toBe("America/Boise");
    expect(decision.open).toBe(open);
    const refusal = outreachWindowRefusal(at);
    if (open) {
      expect(refusal).toBeNull();
    } else {
      expect(refusal).toMatchObject({
        disabled: true,
        retryable: true,
        outcome: "not_attempted",
        heldForSendWindow: true,
      });
      expect(refusal?.error).toContain("America/Boise");
      expect(refusal?.error.startsWith("Held for America/Boise weekday business hours")).toBe(true);
      expect(isOutreachWindowHold(refusal)).toBe(true);
    }
  });

  it("recognizes a hold from the flag or the reason prefix", () => {
    expect(isOutreachWindowHold({ heldForSendWindow: true })).toBe(true);
    expect(
      isOutreachWindowHold({ error: "Held for America/Boise weekday business hours (Monday-Friday, 9:00 AM-5:00 PM local)." })
    ).toBe(true);
    expect(
      isOutreachWindowHold({ error: "Held for America/New_York weekday business hours (Monday-Friday, 9:00 AM-5:00 PM local)." })
    ).toBe(true);
    expect(isOutreachWindowHold({ error: "Gmail is paused.", disabled: true })).toBe(false);
    expect(isOutreachWindowHold(null)).toBe(false);
  });
});

describe("the same UTC instant, two accounts", () => {
  // Monday 26 Oct 2026. Eastern is UTC-4, Pacific is UTC-7, Boise is UTC-6.
  const morning = new Date("2026-10-26T14:30:00.000Z");
  const evening = new Date("2026-10-26T21:30:00.000Z");

  it("is open in New York and closed in Los Angeles at 14:30Z", () => {
    const east = evaluateOutreachSendWindow(morning, "America/New_York");
    const west = evaluateOutreachSendWindow(morning, "America/Los_Angeles");
    expect(east.timeZone).toBe("America/New_York");
    expect(east.open).toBe(true);
    expect(east.hour).toBe(10);
    expect(west.timeZone).toBe("America/Los_Angeles");
    expect(west.open).toBe(false);
    expect(west.hour).toBe(7);
    expect(outreachWindowRefusal(morning, "America/New_York")).toBeNull();
    expect(outreachWindowRefusal(morning, "America/Los_Angeles")?.heldForSendWindow).toBe(true);
  });

  it("is closed in New York and open in Los Angeles at 21:30Z", () => {
    const east = evaluateOutreachSendWindow(evening, "America/New_York");
    const west = evaluateOutreachSendWindow(evening, "America/Los_Angeles");
    expect(east.open).toBe(false);
    expect(east.hour).toBe(17);
    expect(west.open).toBe(true);
    expect(west.hour).toBe(14);
  });

  it("uses America/Boise when the account zone is unset, including after the fall-back", () => {
    expect(evaluateOutreachSendWindow(morning, null).open).toBe(false);
    expect(evaluateOutreachSendWindow(morning, null).timeZone).toBe("America/Boise");
    expect(evaluateOutreachSendWindow(new Date("2026-11-03T15:00:00.000Z"), null).open).toBe(false);
    expect(evaluateOutreachSendWindow(new Date("2026-11-03T16:00:00.000Z"), "America/Boise").open).toBe(true);
  });
});

describe("organizations.timezone", () => {
  beforeEach(() => {
    db.query.mockClear();
    db.queryOne.mockReset();
  });

  it("reads the stored zone and falls back to America/Boise when it is unset or invalid", async () => {
    db.queryOne.mockResolvedValue({ timezone: "America/Chicago" });
    expect(await accountOutreachTimeZone("org-1")).toBe("America/Chicago");
    expect(String(db.queryOne.mock.calls[0][0])).toContain("timezone");
    expect(db.queryOne.mock.calls[0][1]).toEqual(["org-1"]);

    db.queryOne.mockResolvedValue({ timezone: null });
    expect(await accountOutreachTimeZone("org-1")).toBe("America/Boise");
    db.queryOne.mockResolvedValue({ timezone: "Not/AZone" });
    expect(await accountOutreachTimeZone("org-1")).toBe("America/Boise");
    expect(await accountOutreachTimeZone(null)).toBe("America/Boise");
  });

  it("stores a recognised zone and refuses a name Intl does not accept", async () => {
    expect(await setAccountTimeZone("org-1", " America/Los_Angeles ")).toBe("America/Los_Angeles");
    expect(String(db.query.mock.calls[0][0])).toContain("update organizations set timezone");
    expect(db.query.mock.calls[0][1]).toEqual(["org-1", "America/Los_Angeles"]);
    expect(String(db.query.mock.calls[0][0])).not.toContain("drop");
    await expect(setAccountTimeZone("org-1", "Not/AZone")).rejects.toThrow(/not an IANA time zone/);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("adds the column without dropping anything", () => {
    const sql = readFileSync("db/migrations/141_organization_timezone.sql", "utf8");
    expect(sql.toLowerCase()).not.toContain("drop");
    expect(sql).toContain("alter table organizations add column if not exists timezone text");
    expect(sql).toContain("America/Boise");
  });
});

describe("the zone is written down, not inherited", () => {
  const windowSource = readFileSync("lib/domain/outreach-send-window.ts", "utf8");

  it("passes the account zone to Intl and does not consult the host clock", () => {
    const code = windowSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(windowSource).toContain('OUTREACH_SEND_FALLBACK_TIME_ZONE = "America/Boise"');
    expect(code).toContain("formatToParts");
    expect(code).toContain("timeZone");
    expect(code).not.toContain("getHours(");
    expect(code).not.toContain("getUTCHours(");
    expect(code).not.toContain("getDay(");
    expect(code).not.toContain("getTimezoneOffset");
    expect(code).not.toContain("safeTimeZone");
    expect(code).not.toContain("DEFAULT_TIMEZONE");
    expect(code).not.toContain("process.env.TZ");
    expect(code).not.toContain("date-fns");
    const account = readFileSync("lib/domain/account-timezone.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(account).toContain("select timezone from organizations");
    expect(account).not.toContain("safeTimeZone");
    expect(account).not.toContain("DEFAULT_TIMEZONE");
  });

  it("checks the window inside gmail.send, before the provider, and exempts only transactional mail", () => {
    const gmail = readFileSync("lib/integrations/gmail.ts", "utf8");
    const send = gmail.slice(gmail.indexOf("async send("));
    const zoneRead = send.indexOf("await outreachSendZoneFor");
    const gate = send.indexOf("outreachWindowRefusal(new Date()");
    const client = send.indexOf("gmailClient(");
    expect(send).toContain("if (!params.transactional)");
    expect(send).toContain("subcontractorId: params.subcontractorId");
    expect(zoneRead).toBeGreaterThan(-1);
    expect(zoneRead).toBeLessThan(gate);
    expect(gate).toBeLessThan(client);
    expect(send.indexOf("beforeProviderSend")).toBeGreaterThan(gate);
    const transport = readFileSync("lib/integrations/email-transport.ts", "utf8");
    const transportSend = transport.slice(transport.indexOf("res = await gmail.send"));
    expect(transportSend).toContain("subcontractorId: params.subcontractorId");
  });

  it("lets only platform system mail set the transactional exemption", () => {
    const hits = walk("lib").concat(walk("worker")).filter((file) =>
      readFileSync(file, "utf8").includes("transactional: true")
    );
    expect(hits).toEqual(["lib/integrations/system-mail.ts"]);
  });

  it("resolves each recipient before a follow-up is claimed or a draft is re-queued", () => {
    const maintenance = readFileSync("lib/agents/maintenance.ts", "utf8");
    const followUp = maintenance.slice(
      maintenance.indexOf("async function followUpForOrg"),
      maintenance.indexOf("export const outreachRecoverySweep")
    );
    const followGate = followUp.indexOf("outreachWindowRefusal");
    const claim = followUp.indexOf("set follow_up_at = now() + interval '15 minutes'");
    expect(followUp).toContain("outreachSendZoneFor");
    expect(followUp).toContain("state: row.sub_state");
    expect(followUp).toContain("city: row.sub_city");
    expect(followUp).toContain("s.state as sub_state");
    expect(followGate).toBeGreaterThan(-1);
    expect(followGate).toBeLessThan(claim);

    const lastCall = maintenance.slice(
      maintenance.indexOf("export async function lastCallForOrg"),
      maintenance.indexOf("async function followUpForOrg")
    );
    expect(lastCall.indexOf("outreachSendZoneFor")).toBeLessThan(lastCall.indexOf("sendOutreachEmail"));
    expect(lastCall.indexOf("outreachWindowRefusal")).toBeLessThan(lastCall.indexOf("sendOutreachEmail"));

    const recovery = maintenance.slice(
      maintenance.indexOf("export const outreachRecoverySweep"),
      maintenance.indexOf("export const reviewExpirySweep")
    );
    expect(recovery.indexOf("outreach_state in")).toBeLessThan(recovery.indexOf("outreachSendZoneFor"));
    expect(recovery.indexOf("outreachWindowRefusal")).toBeLessThan(recovery.indexOf("singletonKey"));
    expect(recovery).toContain("their recovery work was left unchanged");

    const backlink = maintenance.slice(maintenance.indexOf("async function backlinkSweepForOrg"));
    expect(backlink.indexOf("outreachSendZoneFor")).toBeLessThan(backlink.indexOf("outreachWindowRefusal"));
    expect(backlink.indexOf("outreachWindowRefusal")).toBeLessThan(backlink.indexOf("sendPendingApproved"));

    const onboarding = readFileSync("lib/agents/sub-onboarding.ts", "utf8");
    const handler = onboarding.slice(onboarding.indexOf("export const subOnboarding"));
    expect(handler.indexOf("outreachSendZoneFor")).toBeGreaterThan(-1);
    expect(handler.indexOf("outreachWindowRefusal")).toBeGreaterThan(-1);
    expect(handler.indexOf("outreachWindowRefusal")).toBeLessThan(handler.indexOf("chase(row"));

    const registry = readFileSync("lib/agents/registry.ts", "utf8");
    expect(registry).not.toContain("35 6 * * *");
    expect(registry).toContain('{ agent: subOnboarding, cron: "*/30 * * * *" }');

    const map = readFileSync("lib/domain/recipient-timezone.ts", "utf8");
    expect(map).not.toContain("location_text");
    expect(map).not.toContain("quote-deadline");
    expect(map).not.toContain("safeTimeZone");
    expect(map).not.toContain("website");
  });
});

describe("recipient location, then account, then America/Boise", () => {
  const morning = new Date("2026-10-26T14:30:00.000Z");

  it("maps a single-zone state and an exact split-state city, and does not guess the rest", () => {
    expect(recipientTimeZoneFromLocation({ state: "NY" })).toBe("America/New_York");
    expect(recipientTimeZoneFromLocation({ state: "New York", city: "Buffalo" })).toBe("America/New_York");
    expect(recipientTimeZoneFromLocation({ state: "CA" })).toBe("America/Los_Angeles");
    expect(recipientTimeZoneFromLocation({ state: "tx" })).toBeNull();
    expect(recipientTimeZoneFromLocation({ state: "TX", city: "Houston" })).toBe("America/Chicago");
    expect(recipientTimeZoneFromLocation({ state: "TX", city: "El Paso" })).toBe("America/Denver");
    expect(recipientTimeZoneFromLocation({ state: "TX", city: "near Houston" })).toBeNull();
    expect(recipientTimeZoneFromLocation({ state: "FL", city: "Miami" })).toBe("America/New_York");
    expect(recipientTimeZoneFromLocation({ state: "FL", city: "Pensacola" })).toBe("America/Chicago");
    expect(recipientTimeZoneFromLocation({ state: "FL" })).toBeNull();
    expect(recipientTimeZoneFromLocation({ state: "ID", city: "Boise" })).toBe("America/Boise");
    expect(recipientTimeZoneFromLocation({ state: "ID", city: "Coeur d'Alene" })).toBe("America/Los_Angeles");
    expect(recipientTimeZoneFromLocation({ state: "ID" })).toBeNull();
    expect(recipientTimeZoneFromLocation({ state: "based in New York" })).toBeNull();
    expect(recipientTimeZoneFromLocation({ state: null, city: "Houston" })).toBeNull();
    expect(recipientTimeZoneFromLocation(null)).toBeNull();
  });

  it("opens a New York recipient and holds a Los Angeles recipient at one UTC instant", () => {
    const east = resolveHybridOutreachZone({
      recipientZone: recipientTimeZoneFromLocation({ state: "NY" }),
      accountZone: "America/Los_Angeles",
    });
    const west = resolveHybridOutreachZone({
      recipientZone: recipientTimeZoneFromLocation({ state: "CA" }),
      accountZone: "America/New_York",
    });
    expect(east).toBe("America/New_York");
    expect(west).toBe("America/Los_Angeles");
    expect(evaluateOutreachSendWindow(morning, east).open).toBe(true);
    expect(evaluateOutreachSendWindow(morning, east).hour).toBe(10);
    expect(evaluateOutreachSendWindow(morning, west).open).toBe(false);
    expect(evaluateOutreachSendWindow(morning, west).hour).toBe(7);
    expect(outreachWindowRefusal(morning, east)).toBeNull();
    expect(outreachWindowRefusal(morning, west)?.heldForSendWindow).toBe(true);
  });

  it("uses the account zone when the recipient is unknown, and America/Boise when that is unset", () => {
    expect(recipientTimeZoneFromLocation({ state: null, city: null })).toBeNull();
    const chicago = resolveHybridOutreachZone({ recipientZone: null, accountZone: "America/Chicago" });
    const fallback = resolveHybridOutreachZone({ recipientZone: null, accountZone: null });
    const invalid = resolveHybridOutreachZone({ recipientZone: null, accountZone: "Not/AZone" });
    expect(chicago).toBe("America/Chicago");
    expect(fallback).toBe("America/Boise");
    expect(invalid).toBe("America/Boise");
    expect(evaluateOutreachSendWindow(morning, chicago).open).toBe(true);
    expect(evaluateOutreachSendWindow(morning, chicago).hour).toBe(9);
    expect(evaluateOutreachSendWindow(morning, fallback).open).toBe(false);
    expect(evaluateOutreachSendWindow(morning, fallback).hour).toBe(8);
  });

  it("keeps the recipient zone across the fall-back instead of a fixed offset", () => {
    const boise = recipientTimeZoneFromLocation({ state: "ID", city: "Boise" });
    const zone = resolveHybridOutreachZone({
      recipientZone: boise,
      accountZone: "America/New_York",
    });
    expect(zone).toBe("America/Boise");
    const beforeOpen = evaluateOutreachSendWindow(new Date("2026-11-03T15:00:00.000Z"), zone);
    const atOpen = evaluateOutreachSendWindow(new Date("2026-11-03T16:00:00.000Z"), zone);
    expect(beforeOpen.open).toBe(false);
    expect(beforeOpen.hour).toBe(8);
    expect(atOpen.open).toBe(true);
    expect(atOpen.hour).toBe(9);
    const newYork = evaluateOutreachSendWindow(
      new Date("2026-11-03T14:00:00.000Z"),
      recipientTimeZoneFromLocation({ state: "NY" })
    );
    expect(newYork.open).toBe(true);
    expect(newYork.hour).toBe(9);
    expect(evaluateOutreachSendWindow(new Date("2026-11-03T13:00:00.000Z"), "America/New_York").open).toBe(false);
  });

  it("loads stored state and city for the org, then the account zone", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("from subcontractors")) return { state: "NY", city: "Albany" };
      if (text.includes("from organizations")) return { timezone: "America/Los_Angeles" };
      return null;
    });
    expect(await outreachSendZoneFor({ orgId: "org-1", subcontractorId: "sub-1" })).toBe("America/New_York");
    expect(String(db.queryOne.mock.calls[0][0])).toContain("state, city");
    expect(db.queryOne.mock.calls[0][1]).toEqual(["sub-1", "org-1"]);
    expect(db.queryOne.mock.calls.some((call) => String(call[0]).includes("from organizations"))).toBe(false);

    db.queryOne.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.includes("from subcontractors")) return { state: "TX", city: null };
      if (text.includes("from organizations")) return { timezone: "America/Chicago" };
      return null;
    });
    expect(await outreachSendZoneFor({ orgId: "org-1", subcontractorId: "sub-2" })).toBe("America/Chicago");

    db.queryOne.mockResolvedValue(null);
    expect(await outreachSendZoneFor({ orgId: "org-1" })).toBe("America/Boise");
    expect(
      await outreachSendZoneFor({
        orgId: "org-1",
        state: "CA",
        city: null,
        locationLoaded: true,
      })
    ).toBe("America/Los_Angeles");
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}
