import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_RULES, normalizeRules } from "../lib/domain/intake";

/**
 * What happens to an opportunity nobody decides on.
 *
 * The sweep dismissed every expired review item on every account,
 * unconditionally and with no notice. An opportunity left over a weekend
 * vanished from the board, and the only record was a log line nobody reads
 * until something has already gone wrong.
 *
 * The brief's rule is exact: do not auto-dismiss unless the organization
 * explicitly enables it, and always warn and escalate before automatic action.
 */

describe("the setting", () => {
  it("is off by default", () => {
    // An operator who has not decided has not decided.
    expect(DEFAULT_RULES.auto_dismiss_review).toBe(false);
  });

  it("stays off for an account that predates it", () => {
    /*
     * The opposite of the calls rule, deliberately. A config written before
     * this setting existed has no key, and the honest reading of that silence
     * is that nobody chose to have records dismissed automatically.
     */
    expect(normalizeRules({}).auto_dismiss_review).toBe(false);
    expect(normalizeRules({ calls_enabled: true }).auto_dismiss_review).toBe(false);
    expect(normalizeRules(null).auto_dismiss_review).toBe(false);
  });

  it("turns on only for an explicit true", () => {
    expect(normalizeRules({ auto_dismiss_review: true }).auto_dismiss_review).toBe(true);
    // A truthy string from a form that lost its type is not consent.
    expect(
      normalizeRules({ auto_dismiss_review: "yes" as unknown as boolean }).auto_dismiss_review
    ).toBe(false);
  });

  it("clamps the warning window to something a person could act inside", () => {
    expect(normalizeRules({ auto_dismiss_warn_hours: 0 }).auto_dismiss_warn_hours).toBe(1);
    expect(normalizeRules({ auto_dismiss_warn_hours: 99999 }).auto_dismiss_warn_hours).toBe(336);
    expect(normalizeRules({}).auto_dismiss_warn_hours).toBe(24);
  });
});

describe("the sweep", () => {
  const SRC = readFileSync("lib/agents/maintenance.ts", "utf8");
  const sweep = SRC.slice(SRC.indexOf('name: "review-expiry-sweep"'), SRC.indexOf("stalledPipelineSweep"));

  it("never dismisses on the same pass that warned", () => {
    /*
     * The warning has to have been out for at least one interval, or "we
     * warned you" is something the log says and the operator never saw.
     */
    expect(sweep).toContain("review_warned_at is not null and review_warned_at < now()");
  });

  it("warns whether or not dismissal is on", () => {
    // The timer is the account's own measure of when a decision has gone
    // stale, and that is worth saying even when nothing will act on it.
    const warnBlock = sweep.slice(0, sweep.indexOf("if (!rules.auto_dismiss_review)"));
    expect(warnBlock).toContain("review_warned_at = now()");
  });

  it("says how many it held rather than reporting a quiet zero", () => {
    /*
     * An account with forty expired review items is looking at a queue nobody
     * is working, and a sweep that says "0 dismissed" without saying why reads
     * as a healthy account.
     */
    expect(sweep).toContain("kept for a person to decide");
  });

  it("reads the rule per organization", () => {
    // One account turning it on must not turn it on for the next one in the
    // loop.
    expect(sweep).toContain("runWithOrg(orgId, () => getAutomationRules())");
  });
});
