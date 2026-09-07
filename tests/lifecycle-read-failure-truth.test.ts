import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lifecycle database failure truth", () => {
  it("does not convert quote-completeness failures into empty or complete state", () => {
    const source = readFileSync("lib/domain/advance-stage.ts", "utf8");
    expect(source).not.toContain(".catch(() => [])");
    expect(source).not.toContain('.catch(() => [{ n: "0" }])');
  });

  it("does not turn reply outcome lookup or follow-up failures into success", () => {
    const source = readFileSync("lib/domain/reply-outcome.ts", "utf8");
    const apply = source.slice(source.indexOf("export async function applyOutcomeToSolicitation"));
    expect(apply).not.toContain(".catch(() => [])");
    expect(apply).not.toContain(".catch(() => {})");
  });

  it("clears accumulated call work atomically", () => {
    const source = readFileSync("lib/skip-call.ts", "utf8");
    const clear = source.slice(source.indexOf("export async function clearCallWorkForOrg"));
    expect(clear).toContain("transaction(async (client)");
    expect(clear).not.toContain(".catch(() => [])");
  });

  it("does not hide reply-poll transition and exhaustion check failures", () => {
    const source = readFileSync("lib/agents/maintenance.ts", "utf8");
    expect(source).not.toContain("advanceIfQuotesComplete(opportunityId).catch(() => null)");
    expect(source).not.toContain("closeIfSubsExhausted(opportunityId).catch(() => null)");
  });

  it("never shows a fabricated zero-impact outreach stop after a failed read", () => {
    const source = readFileSync("lib/suppressions.ts", "utf8");
    const impact = source.slice(source.indexOf("export async function stopImpact"));
    expect(impact).not.toContain('.catch(() => [{ n: "0" }])');
    expect(impact).not.toContain(".catch(() => [])");
  });
});
