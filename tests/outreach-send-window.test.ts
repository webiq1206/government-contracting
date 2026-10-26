/**
 * America/Boise is the product clock for outreach sends.
 *
 * These cases pass absolute instants to Intl. They do not read the process
 * zone, Date#getHours, or America/Denver. The two instants that would disagree
 * with a UTC hour check or a fixed MDT offset are the proof the zone is forced:
 * Monday 14:59 UTC is still 8:59 AM in Boise, and the Tuesday after the 2026
 * fall-back, 15:00 UTC is 8:00 AM MST.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OUTREACH_SEND_TIME_ZONE,
  evaluateOutreachSendWindow,
  isOutreachWindowHold,
  outreachSendTimeZone,
  outreachWindowRefusal,
} from "../lib/domain/outreach-send-window";

describe("America/Boise weekday business hours", () => {
  it("resolves the product zone, not the process zone", () => {
    expect(OUTREACH_SEND_TIME_ZONE).toBe("America/Boise");
    expect(outreachSendTimeZone()).toBe("America/Boise");
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
    expect(isOutreachWindowHold({ error: "Gmail is paused.", disabled: true })).toBe(false);
    expect(isOutreachWindowHold(null)).toBe(false);
  });
});

describe("the zone is written down, not inherited", () => {
  const windowSource = readFileSync("lib/domain/outreach-send-window.ts", "utf8");

  it("pins Intl to America/Boise and does not consult the host clock", () => {
    const code = windowSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(windowSource).toContain('export const OUTREACH_SEND_TIME_ZONE = "America/Boise"');
    expect(code).toContain("timeZone: OUTREACH_SEND_TIME_ZONE");
    expect(code).not.toContain("getHours(");
    expect(code).not.toContain("getUTCHours(");
    expect(code).not.toContain("getDay(");
    expect(code).not.toContain("getTimezoneOffset");
    expect(code).not.toContain("America/Denver");
    expect(code).not.toContain("DEFAULT_TIMEZONE");
    expect(code).not.toContain("process.env.TZ");
    expect(code).not.toContain("date-fns");
  });

  it("checks the window inside gmail.send, before the provider, and exempts only transactional mail", () => {
    const gmail = readFileSync("lib/integrations/gmail.ts", "utf8");
    const send = gmail.slice(gmail.indexOf("async send("));
    const gate = send.indexOf("outreachWindowRefusal");
    const client = send.indexOf("gmailClient(");
    expect(send).toContain("if (!params.transactional)");
    expect(gate).toBeGreaterThan(-1);
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
    expect(followup.indexOf("outreachWindowRefusal")).toBeGreaterThan(-1);
    expect(followup.indexOf("outreachWindowRefusal")).toBeLessThan(followup.indexOf("orgsToSweep"));

    const recovery = maintenance.slice(
      maintenance.indexOf("export const outreachRecoverySweep"),
      maintenance.indexOf("export const reviewExpirySweep")
    );
    expect(recovery.indexOf("outreachWindowRefusal")).toBeGreaterThan(-1);
    expect(recovery.indexOf("outreachWindowRefusal")).toBeLessThan(recovery.indexOf('orgsToSweep("outreach-recovery-sweep")'));

    const backlink = maintenance.slice(maintenance.indexOf("async function backlinkSweepForOrg"));
    expect(backlink.indexOf("outreachWindowRefusal")).toBeLessThan(backlink.indexOf("sendPendingApproved"));

    const onboarding = readFileSync("lib/agents/sub-onboarding.ts", "utf8");
    const handler = onboarding.slice(onboarding.indexOf("export const subOnboarding"));
    expect(handler.indexOf("outreachWindowRefusal")).toBeGreaterThan(-1);
    expect(handler.indexOf("outreachWindowRefusal")).toBeLessThan(handler.indexOf("loadAwardCompliance"));

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
