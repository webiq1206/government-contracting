/**
 * "No accounts" and "I could not find out" are different sentences.
 *
 * Fourteen places asked which organizations to work on, and every one of them
 * ended in `.catch(() => [])`. Six then fell back to the founding
 * organization, which is right for a genuinely empty list (a deployment before
 * its first customer still has our own work to do) and wrong for a query that
 * threw: a database hiccup on that one statement meant every customer was
 * skipped, the agent ran against the founding org alone, and the run reported
 * success. The other eight reported over zero accounts, and sub-onboarding
 * turned it into a positive claim: "No active contracts with subcontractors
 * attached."
 *
 * Verified by shadowing the organizations table with a view that throws:
 * analytics-engine, learning-loop, compliance-monitor, compliance-sweep and
 * opportunity-monitor all returned ok=false with the reason, and each wrote an
 * org-list-failed log at error status. Before the change all five returned
 * ok=true.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, globSync } from "node:fs";

const logged: { action: string; status?: string }[] = [];
let listBehaviour: () => Promise<{ id: string }[]> = async () => [{ id: "org-1" }];

vi.mock("@/lib/organizations", () => ({
  listActiveOrganizations: () => listBehaviour(),
}));
vi.mock("@/lib/logger", () => ({
  logAgent: vi.fn(async (e: { action: string; status?: string }) => {
    logged.push(e);
  }),
}));

const { orgsToSweep, fanoutNote } = await import("@/lib/agents/org-fanout");

beforeEach(() => {
  logged.length = 0;
  listBehaviour = async () => [{ id: "org-1" }];
});

describe("choosing the accounts to sweep", () => {
  it("returns the accounts when the lookup works", async () => {
    const r = await orgsToSweep("some-agent");
    expect(r.orgs.map((o) => o.id)).toEqual(["org-1"]);
    expect(r.error).toBeNull();
    expect(r.soloFallback).toBe(false);
    expect(logged).toEqual([]);
  });

  it("falls back to the founding org only when the list is genuinely empty", async () => {
    listBehaviour = async () => [];
    const r = await orgsToSweep("some-agent");
    expect(r.orgs).toHaveLength(1);
    expect(r.error).toBeNull();
    expect(r.soloFallback).toBe(true);
    // Not a failure: this is what a deployment looks like before its first
    // customer, and it still has our own work to do.
    expect(logged).toEqual([]);
  });

  it("does NOT fall back when the lookup threw", async () => {
    listBehaviour = async () => {
      throw new Error("account list unavailable");
    };
    const r = await orgsToSweep("some-agent");
    // The whole defect in one assertion: running the founding org alone and
    // calling it a successful sweep of the platform.
    expect(r.orgs).toEqual([]);
    expect(r.soloFallback).toBe(false);
    expect(r.error).toBe("account list unavailable");
  });

  it("logs the failure at error status, so the health page counts it", async () => {
    listBehaviour = async () => {
      throw new Error("account list unavailable");
    };
    await orgsToSweep("some-agent");
    expect(logged).toHaveLength(1);
    expect(logged[0].action).toBe("org-list-failed");
    expect(logged[0].status).toBe("error");
  });

  it("gives the agent a sentence to put in its summary", async () => {
    listBehaviour = async () => {
      throw new Error("boom");
    };
    const r = await orgsToSweep("some-agent");
    expect(fanoutNote(r)).toContain("No accounts were processed");
    expect(fanoutNote(r)).toContain("boom");
  });

  it("has nothing to add when the lookup worked", async () => {
    expect(fanoutNote(await orgsToSweep("some-agent"))).toBeNull();
  });
});

describe("nowhere still swallows the account lookup", () => {
  it("no agent catches listActiveOrganizations into an empty list", () => {
    const offenders = globSync("lib/**/*.ts")
      .filter((f) => !f.endsWith("org-fanout.ts"))
      .filter((f) => /listActiveOrganizations\(\)\s*\.catch/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
