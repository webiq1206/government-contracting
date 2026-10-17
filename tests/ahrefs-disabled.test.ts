import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ahrefsLogExclusion } from "../lib/automation-status";

afterEach(() => {
  delete process.env.AHREFS_ENABLED;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("Ahrefs stays off", () => {
  it("drops historical Ahrefs failures from the health window only while the integration is off", () => {
    expect(ahrefsLogExclusion(false)).toContain("agent <> 'backlink-scout'");
    expect(ahrefsLogExclusion(false)).toContain("not ilike '%ahrefs%'");
    expect(ahrefsLogExclusion(true)).toBe("");
  });

  it("does not call Ahrefs from the connection test while the integration is off", async () => {
    delete process.env.AHREFS_ENABLED;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { VALIDATORS } = await import("../lib/integration-validators");
    const result = await VALIDATORS.ahrefs({ AHREFS_API_KEY: "saved-key" });
    expect(result).toEqual({ ok: false, message: "Ahrefs is turned off. No request was sent." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the scout and the outreach sweep before any provider or send work", () => {
    const scout = readFileSync("lib/agents/backlink-scout.ts", "utf8");
    const scoutOff = scout.indexOf("!config.ahrefs.integrationEnabled");
    expect(scoutOff).toBeGreaterThan(-1);
    expect(scoutOff).toBeLessThan(scout.indexOf("ahrefs.authoritySnapshot"));
    expect(scout).toContain("retireAhrefsIncidents(orgId)");

    const sweep = readFileSync("lib/agents/maintenance.ts", "utf8");
    const sweepStart = sweep.indexOf("export const backlinkOutreachSweep");
    const sweepBody = sweep.slice(sweepStart, sweep.indexOf("async function backlinkSweepForOrg"));
    const sweepOff = sweepBody.indexOf("!config.ahrefs.integrationEnabled");
    expect(sweepOff).toBeGreaterThan(-1);
    expect(sweepOff).toBeLessThan(sweepBody.indexOf("backlinkSweepForOrg"));
    expect(sweepBody).toContain("retireAhrefsIncidents");
  });

  it("closes an Ahrefs incident as turned off and leaves every other provider alone", () => {
    const src = readFileSync("lib/incidents.ts", "utf8");
    expect(src).toContain("lower(provider) = 'ahrefs'");
    const approve = readFileSync("app/api/authority/outreach/[id]/route.ts", "utf8");
    expect(approve.indexOf("!config.ahrefs.integrationEnabled")).toBeLessThan(
      approve.indexOf("await sendApprovedOutreach")
    );
    expect(src).toContain('to: "retired"');
    expect(src).toContain("state not in ('recovered', 'retired')");
    const recovery = readFileSync("lib/recovery.ts", "utf8");
    const gate = recovery.indexOf('incident.provider === "ahrefs" && !config.ahrefs.integrationEnabled');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(recovery.indexOf("const test = await testIncidentDependency"));
  });

  it("adds the closed state without deleting rows", () => {
    const sql = readFileSync("db/migrations/138_ahrefs_retired_incidents.sql", "utf8").toLowerCase();
    expect(sql).toContain("'retired'");
    expect(sql).not.toMatch(/\bdelete\b/);
    expect(sql).not.toMatch(/\btruncate\b/);
    expect(sql).not.toMatch(/drop table/);
  });
});
