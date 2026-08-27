import { describe, expect, it } from "vitest";
import {
  mayOverride,
  overrideProblem,
  overrideRisk,
  overrideSummary,
  OVERRIDE_PROBLEM_MESSAGE,
} from "../lib/domain/override";

/**
 * `force: true` was a boolean in a request body.
 *
 * It got a package past the submit-lead-hours rule and past a package not
 * marked ready, and left behind a log line saying somebody submitted. Nothing
 * recorded which warning was overridden, why, or what the person believed at
 * the time.
 *
 * That is the difference between a decision and a bypass. A contracting
 * officer asking six weeks later why a bid went out ninety minutes before
 * close has a fair question, and "somebody passed force" is not an answer.
 */

const req = (over: Partial<{ requirement: string; reason: string }> = {}) => ({
  requirement: "Submitting 1.4h before the deadline, inside the 2h policy",
  reason: "Spoke to the contracting officer, she confirmed the portal is open until 5pm.",
  ...over,
});

describe("what an override has to say", () => {
  it("accepts a real reason against a named warning", () => {
    expect(mayOverride(req())).toBe(true);
    expect(overrideProblem(req())).toBeNull();
  });

  it("refuses an override that does not name what it overrides", () => {
    // "The checks" is not a thing anybody can review later.
    expect(overrideProblem(req({ requirement: "  " }))).toBe("no_requirement");
  });

  it("refuses an empty reason", () => {
    expect(overrideProblem(req({ reason: "" }))).toBe("no_reason");
    expect(OVERRIDE_PROBLEM_MESSAGE.no_reason).toContain("bypass with a timestamp");
  });

  it.each(["ok", "fine", "n/a", "none", "test", "asdf", "...", "yes", "urgent", "approved"])(
    "refuses %s as a reason",
    (reason) => {
      /*
       * Not a spam filter and not exhaustive: it catches the reflex answers,
       * which is what it is for. Anybody determined to write nonsense will,
       * and the record will show they did.
       */
      expect(overrideProblem(req({ reason }))).toBe("reason_is_filler");
    }
  );

  it("refuses a reason too short to mean anything later", () => {
    expect(overrideProblem(req({ reason: "CO said fine" }))).toBe("reason_too_short");
    expect(OVERRIDE_PROBLEM_MESSAGE.reason_too_short).toContain("six weeks from now");
  });

  it("does not make overriding hard, only recorded", () => {
    // A person with a genuine reason types it in a few seconds.
    expect(mayOverride(req({ reason: "Portal confirmed open until 5pm today." }))).toBe(true);
  });
});

describe("how serious an override is", () => {
  it("treats a timing override as notable rather than serious", () => {
    // Cutting it fine is a judgement about the clock.
    expect(overrideRisk("Submitting 1.4h before the deadline")).toBe("notable");
    expect(overrideRisk("Lead hours policy")).toBe("notable");
  });

  it("treats anything about completeness as serious", () => {
    /*
     * Getting the clock wrong makes a bid tight. Sending something the checks
     * say is incomplete loses it outright.
     */
    expect(overrideRisk("Package is not marked ready")).toBe("serious");
    expect(overrideRisk("Compliance audit did not confirm the package")).toBe("serious");
  });
});

describe("the audit line", () => {
  it("still reads in six weeks", () => {
    const line = overrideSummary(req(), "info@webiq.co", new Date("2026-08-26T19:00:00Z"));
    expect(line).toContain("info@webiq.co");
    expect(line).toContain("Submitting 1.4h before the deadline");
    expect(line).toContain("the portal is open until 5pm");
    expect(line).toContain("2026-08-26T19:00:00.000Z");
  });
});
