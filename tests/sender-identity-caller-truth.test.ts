import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A sender refusal is data, not an exception. Every caller that performs
 * optional platform mail has to inspect that data or a job can report success
 * after systemMail deliberately prevented an unintended From address.
 */
describe("platform sender refusal callers", () => {
  it.each([
    ["analytics", "lib/agents/analytics-engine.ts", "weekly-digest-unsent"],
    ["learning", "lib/agents/learning-loop.ts", "weekly-digest-unsent"],
    ["compliance", "lib/agents/compliance-sweep.ts", "compliance-digest-unsent"],
  ])("makes the %s digest failure part of the run outcome", (_name, path, action) => {
    const source = readFileSync(path, "utf8");

    expect(source).toContain("delivery.disabled || delivery.error");
    expect(source).toContain(`action: "${action}"`);
    expect(source).toContain("status: \"error\"");
    expect(source).toMatch(/ok: .*mailFailures === 0|ok: .*digestFailures === 0/);
  });

  it("returns invitation delivery separately so the saved row is not shown as a green send", () => {
    const service = readFileSync("lib/admin/invitations.ts", "utf8");
    const route = readFileSync("app/api/admin/invitations/route.ts", "utf8");
    const form = readFileSync("components/admin/invitation-form.tsx", "utf8");

    expect(service).toContain("mailSent: mail.sent");
    expect(service).toContain('("disabled" in res && res.disabled) || res.error');
    expect(service).toContain('action: "invitation_email_unsent"');
    expect(route).toContain("mailSent: result.mailSent ?? false");
    expect(form).toContain('tone: data.mailSent ? "success" : "warning"');
  });

  it("turns an unreadable recap-test sender into an actionable 503", () => {
    const source = readFileSync("app/api/recap/test/route.ts", "utf8");
    const readiness = source.slice(
      source.indexOf("let mailReady = false"),
      source.indexOf("const body =", source.indexOf("let mailReady = false"))
    );

    expect(readiness).toContain("try {");
    expect(readiness).toContain("platform sender identity could not be checked");
    expect(readiness).toContain("{ status: 503 }");
  });
});
