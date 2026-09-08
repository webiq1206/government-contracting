import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("lib/agents/outreach.ts", "utf8");

describe("initial outreach context safety", () => {
  it("derives one account from the opportunity and subcontractor", () => {
    expect(source).toMatch(
      /select o\.org_id[\s\S]*join subcontractors s on s\.id = \$2 and s\.org_id = o\.org_id[\s\S]*where o\.id = \$1/
    );
    expect(source).toContain("ambientOrgId !== orgId");
  });

  it("requires exactly one active trade when the job omitted its trade", () => {
    expect(source).toMatch(/select distinct os\.trade[\s\S]*os\.removed_at is null/);
    expect(source).toContain("activePairs.length > 1");
    expect(source).toContain("Choose the trade and retry outreach");
  });

  it("fails closed when duplicate protection cannot be read", () => {
    const prior = source.slice(
      source.indexOf("const priorSend"),
      source.indexOf("if (priorSend)")
    );
    expect(prior).toContain("org_id = $4");
    expect(prior).not.toContain(".catch");
  });

  it("passes and persists the tenant, provider id, thread id, and RFC id", () => {
    expect(source).toMatch(/sendOutreachEmail\(\{[\s\S]*orgId,[\s\S]*opportunityId/);
    expect(source).toMatch(
      /insert into communications[\s\S]*\(org_id,[\s\S]*gmail_message_id, gmail_thread_id[\s\S]*rfc822_message_id/
    );
  });
});
