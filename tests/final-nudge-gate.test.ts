/**
 * The third outreach email, and the two gates that were missing.
 *
 * `lastCallForOrg` sends a deadline-driven third message to a subcontractor
 * who has already had the initial packet and one follow-up. It is built from a
 * hardcoded string inside the follow-up agent: no Content Library entry, no
 * version, no preview, no approval, no metrics, no packet, no threading, and
 * it quotes the government bid deadline where every other subcontractor-facing
 * message quotes the quote deadline.
 *
 * Two separate problems, pinned here:
 *
 * 1. It sent unconditionally. There was no way for an operator to stop it.
 * 2. It ignored `followup_max`. `followUpForOrg` returns early when that is
 *    zero, which is the operator having said "never chase"; the nudge call sat
 *    on the next line, outside the check. The setting said one thing and the
 *    product did another, to somebody else's business, over the operator's
 *    name.
 */
import { describe, it, expect } from "vitest";
import { normalizeRules, DEFAULT_RULES, type AutomationRules } from "../lib/domain/intake";

/** The condition the agent applies before it will send a third message. */
function nudgeWouldSend(rules: AutomationRules): boolean {
  return rules.final_nudge_enabled && rules.followup_max > 0;
}

describe("the final-nudge rule", () => {
  it("is off by default", () => {
    expect(DEFAULT_RULES.final_nudge_enabled).toBe(false);
  });

  it("stays off for a config written before the key existed", () => {
    /*
     * The important asymmetry. `calls_enabled` defaults to ON when the key is
     * absent, because an existing install must keep the calling workflow it
     * already has. This one must default OFF, because the absent key is
     * exactly the state of every account that was sending the message
     * unvalidated. Silence is not consent here.
     */
    const legacy = normalizeRules({ followup_hours: 48, followup_max: 1 });
    expect(legacy.final_nudge_enabled).toBe(false);
    expect(legacy.calls_enabled).toBe(true);
  });

  it("requires an explicit true, not merely a truthy value", () => {
    expect(normalizeRules({ final_nudge_enabled: 1 as unknown as boolean }).final_nudge_enabled).toBe(false);
    expect(normalizeRules({ final_nudge_enabled: "yes" as unknown as boolean }).final_nudge_enabled).toBe(false);
    expect(normalizeRules({ final_nudge_enabled: true }).final_nudge_enabled).toBe(true);
  });

  it("survives a round trip without flipping on", () => {
    const once = normalizeRules(null);
    expect(normalizeRules(once).final_nudge_enabled).toBe(false);
  });
});

describe("the gate the agent applies", () => {
  const on = (over: Partial<AutomationRules> = {}) =>
    normalizeRules({ final_nudge_enabled: true, ...over });

  it("does not send while the rule is off, however the account is configured", () => {
    expect(nudgeWouldSend(normalizeRules({ followup_max: 5 }))).toBe(false);
  });

  it("does not send when the operator said never chase", () => {
    // followup_max: 0 is "never chase". followUpForOrg already returns early
    // on it; this is the line that did not.
    expect(nudgeWouldSend(on({ followup_max: 0 }))).toBe(false);
  });

  it("sends only when the rule is on and chasing is allowed", () => {
    expect(nudgeWouldSend(on({ followup_max: 1 }))).toBe(true);
  });

  it("treats the two gates as independent, so neither alone is enough", () => {
    expect(nudgeWouldSend(normalizeRules({ final_nudge_enabled: false, followup_max: 1 }))).toBe(false);
    expect(nudgeWouldSend(on({ followup_max: 0 }))).toBe(false);
    expect(nudgeWouldSend(on({ followup_max: 2 }))).toBe(true);
  });
});
