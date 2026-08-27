import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { urgentSteps, type GuideStep } from "../lib/domain/page-guide";

/**
 * The four controls Guide Me is required to offer.
 *
 * Ask about this page and Why is this blocked existed. What changed and Show
 * only urgent work did not, and the interesting half of adding them was
 * deciding which of the two the AI should be anywhere near.
 */

function step(id: string, tone: GuideStep["tone"]): GuideStep {
  return {
    id,
    title: id,
    why: "because",
    cta: "Do it",
    tone,
    owner: "operator",
    kind: "open",
    source: "today",
  } as GuideStep;
}

describe("show only urgent work", () => {
  it("keeps the steps that will not wait", () => {
    const steps = [step("a", "action"), step("b", "warn"), step("c", "info")];
    const r = urgentSteps(steps);
    expect(r.steps.map((s) => s.id)).toEqual(["b"]);
    expect(r.anyUrgent).toBe(true);
  });

  it("shows everything, and says so, when nothing is urgent", () => {
    /*
     * A filter that empties this panel has answered "what should I do next"
     * with silence, which is the one answer it must never give.
     */
    const steps = [step("a", "action"), step("c", "info")];
    const r = urgentSteps(steps);
    expect(r.steps).toHaveLength(2);
    expect(r.anyUrgent).toBe(false);
  });

  it("resets the step pointer when the list it points into changes", () => {
    const src = readFileSync("components/guide-wizard.tsx", "utf8");
    const toggle = src.slice(src.indexOf("setUrgentOnly((v) => !v)"));
    expect(toggle.slice(0, 400)).toContain("setStepIndex(0)");
  });

  it("says which state it is in for a screen reader too", () => {
    const src = readFileSync("components/guide-wizard.tsx", "utf8");
    expect(src).toContain("aria-pressed={urgentOnly}");
  });
});

describe("what changed", () => {
  const wizard = readFileSync("components/guide-wizard.tsx", "utf8");
  const loader = readFileSync("lib/guide/load.ts", "utf8");
  const data = readFileSync("lib/data.ts", "utf8");

  it("is a list of records rather than a generated answer", () => {
    /*
     * "What changed" is a list of events with times. Handing that list to a
     * model to retell adds a place for the answer to be wrong and takes the
     * timestamps away, and the brief's rule is that AI explains structured
     * state rather than being it.
     */
    expect(wizard).toContain('mode === "changed"');
    expect(wizard).toContain("guide.recentChanges.map");
    expect(loader).toContain("guide.recentChanges = await recentChanges(");
  });

  it("tells a failed read from a quiet week", () => {
    // Two different sentences, because they are two different facts and only
    // one of them means the operator can stop looking.
    expect(wizard).toContain("guide.recentChanges == null");
    expect(wizard).toContain("could not be read");
    expect(wizard).toContain("Nothing has been recorded here");
  });

  it("scopes to the record when the panel is open on one", () => {
    // "What changed" on a bid means that bid, not the account.
    expect(loader).toContain("opportunityId: opportunity?.id ?? null");
  });

  it("marks what the platform did rather than a person", () => {
    expect(wizard).toContain("c.automatic &&");
  });

  it("leaves out work that was skipped", () => {
    // Skipped work did not change anything, and a list of non-events is how
    // "what changed" becomes noise nobody reads.
    const fn = data.slice(data.indexOf("export async function recentChanges"));
    expect(fn.slice(0, 1600)).toContain("<> 'skipped'");
  });
});
