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

import { accountOutreachTimeZone, setAccountTimeZone } from "../lib/domain/account-timezone";
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
      isOutreachWindowHold({ error: "Held for America/Boise weekday business hours (Monday–Friday, 9:00 AM–5:00 PM local)." })
    ).toBe(true);
    expect(
      isOutreachWindowHold({ error: "Held for America/New_York weekday business hours (Monday–Friday, 9:00 AM–5:00 PM local)." })
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
    const zoneRead = send.indexOf("await accountOutreachTimeZone");
    const gate = send.indexOf("outreachWindowRefusal(new Date()");
    const client = send.indexOf("gmailClient(");
    expect(send).toContain("if (!params.transactional)");
    expect(zoneRead).toBeGreaterThan(-1);
    expect(zoneRead).toBeLessThan(gate);
    expect(gate).toBeLessThan(client);
    expect(send.indexOf("beforeProviderSend")).toBeGreaterThan(gate);
  });

  it("lets only platform system mail set the transactional exemption", () => {
    const hits = walk("lib").concat(walk("worker")).filter((file) =>
      readFileSync(file, "utf8").includes("transactional: true")
    );
    expect(hits).toEqual(["lib/integrations/system-mail.ts"]);
  });

  it("returns the night sweeps before they claim or re-queue work", () => {
    const maintenance = readFileSync("lib/agents/maintenance.ts", "utf8");
    const followup = maintenance.slice(
      maintenance.indexOf("export const outreachFollowup"),
      maintenance.indexOf("export async function lastCallForOrg")
    );
    expect(followup.indexOf("orgsToSweep")).toBeLessThan(followup.indexOf("accountOutreachTimeZone"));
    expect(followup.indexOf("outreachWindowRefusal")).toBeGreaterThan(-1);
    expect(followup.indexOf("outreachWindowRefusal")).toBeLessThan(followup.indexOf("followUpForOrg"));

    const recovery = maintenance.slice(
      maintenance.indexOf("export const outreachRecoverySweep"),
      maintenance.indexOf("export const reviewExpirySweep")
    );
    expect(recovery.indexOf('orgsToSweep("outreach-recovery-sweep")')).toBeLessThan(recovery.indexOf("outreachWindowRefusal"));
    expect(recovery.indexOf("outreachWindowRefusal")).toBeLessThan(recovery.indexOf("outreach_state in"));

    const backlink = maintenance.slice(maintenance.indexOf("async function backlinkSweepForOrg"));
    expect(backlink.indexOf("accountOutreachTimeZone")).toBeLessThan(backlink.indexOf("outreachWindowRefusal"));
    expect(backlink.indexOf("outreachWindowRefusal")).toBeLessThan(backlink.indexOf("sendPendingApproved"));

    const onboarding = readFileSync("lib/agents/sub-onboarding.ts", "utf8");
    const handler = onboarding.slice(onboarding.indexOf("export const subOnboarding"));
    expect(handler.indexOf("accountOutreachTimeZone")).toBeGreaterThan(-1);
    expect(handler.indexOf("outreachWindowRefusal")).toBeGreaterThan(-1);
    expect(handler.indexOf("outreachWindowRefusal")).toBeLessThan(handler.indexOf("chase(row"));

    const registry = readFileSync("lib/agents/registry.ts", "utf8");
    expect(registry).not.toContain("35 6 * * *");
    expect(registry).toContain('{ agent: subOnboarding, cron: "*/30 * * * *" }');
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
