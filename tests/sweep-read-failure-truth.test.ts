import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("scheduled sweep read failures", () => {
  it("does not resend onboarding mail when the cooldown ledger is unavailable", () => {
    const source = readFileSync("lib/agents/sub-onboarding.ts", "utf8");
    const cooldown = source.slice(
      source.indexOf("async function chasedRecently"),
      source.indexOf("function missingList")
    );
    expect(cooldown).not.toContain(".catch");
    expect(cooldown).toContain("stop before the provider boundary");
  });

  it("surfaces an unrecorded onboarding provider result and suppresses blind retry", () => {
    const source = readFileSync("lib/agents/sub-onboarding.ts", "utf8");
    expect(source).toContain("paperwork-delivery-unconfirmed");
    expect(source).toContain("Check the Gmail thread before retrying");
    expect(source).toContain("unrecorded.length === 0");
    const chase = source.slice(source.indexOf("async function chase"), source.indexOf("export const subOnboarding"));
    expect(chase).not.toContain(".catch(() => {})");
  });

  it("does not describe an unreadable compliance roster as empty", () => {
    const source = readFileSync("lib/agents/compliance-sweep.ts", "utf8");
    const load = source.slice(source.indexOf("async function loadDocuments"), source.indexOf("function fmt"));
    expect(load).not.toContain(".catch(() => [])");
  });

  it("does not describe an unreadable trial roster as no live trials", () => {
    const source = readFileSync("lib/agents/trial-sweep.ts", "utf8");
    const load = source.slice(source.indexOf("async function loadLiveTrials"), source.indexOf("function warningCopy"));
    expect(load).not.toContain(".catch(() => [])");
  });

  it("checks live trial-warning delivery and fails visibly when a warning is unsent", () => {
    const source = readFileSync("lib/agents/trial-sweep.ts", "utf8");
    expect(source).toContain("systemMail.deliverable()");
    expect(source).toContain("delivery.disabled || delivery.error");
    expect(source).toContain("unsent === 0");
  });

  it("marks a compliance monitor run failed when any tenant was not checked", () => {
    const source = readFileSync("lib/agents/compliance-monitor.ts", "utf8");
    expect(source).toContain("ok: fanout.error == null && failed.length === 0");
  });

  it("does not hide concession database or Stripe verification failures", () => {
    const source = readFileSync("lib/agents/concession-sweep.ts", "utf8");
    expect(source).not.toContain("[orgId]\n  ).catch(() => null)");
    expect(source).toContain("Stripe is not configured, so granted discounts cannot be verified");
    expect(source).toContain("ok: passFailures === 0 && operationFailures === 0");
    expect(source).toContain("humanActionRequired:");
  });
});
