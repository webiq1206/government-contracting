/**
 * What an integration is actually doing.
 *
 * The card said `Connected` whenever a key had been saved, and the page's own
 * comment already admitted the cost: it said `Connected` through a day in
 * which Anthropic refused every request for want of credits. A saved key and a
 * working service are different facts, and this panel exists to answer the
 * second one.
 */
import { describe, it, expect } from "vitest";
import {
  integrationState,
  stateTone,
  INTEGRATION_STATE_LABEL,
  INTEGRATION_STATE_MEANING,
  VALIDATION_STALE_DAYS,
  type IntegrationFacts,
} from "@/lib/domain/integration-state";

const NOW = new Date("2026-08-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function facts(over: Partial<IntegrationFacts> = {}): IntegrationFacts {
  return { configured: true, lastError: null, lastValidatedAt: daysAgo(2), ...over };
}

describe("integrationState", () => {
  it("never says working about something nobody has tested", () => {
    /*
     * The whole point. "We have not checked" is a true thing to say; "it is
     * working" is not, and it was what the card said.
     */
    const v = integrationState(facts({ lastValidatedAt: null }), NOW);
    expect(v.state).toBe("configured");
    expect(INTEGRATION_STATE_LABEL[v.state]).toBe("Saved, never tested");
    expect(v.nextAction).toContain("Test it");
  });

  it("stops believing a check that is too old", () => {
    const fresh = integrationState(facts({ lastValidatedAt: daysAgo(VALIDATION_STALE_DAYS - 1) }), NOW);
    expect(fresh.state).toBe("healthy");
    const stale = integrationState(facts({ lastValidatedAt: daysAgo(VALIDATION_STALE_DAYS + 1) }), NOW);
    expect(stale.state).toBe("configured");
    expect(stale.reason).toContain("too long to still count");
  });

  it("calls a credit refusal blocked, and says nothing here will fix it", () => {
    const v = integrationState(
      facts({ lastError: "Your credit balance is too low to access the Anthropic API" }),
      NOW
    );
    expect(v.state).toBe("blocked");
    expect(v.cause).toBe("provider_credit");
    expect(v.nextAction).toContain("Nothing here will fix it");
  });

  it("calls a rejected key blocked rather than degraded", () => {
    for (const err of ["401 unauthorized", "invalid api key", "the key was revoked"]) {
      expect(integrationState(facts({ lastError: err }), NOW).state).toBe("blocked");
    }
  });

  it("calls a rate limit degraded, because work retries", () => {
    const v = integrationState(facts({ lastError: "429 too many requests" }), NOW);
    expect(v.state).toBe("degraded");
    expect(v.nextAction).toContain("retries on its own");
  });

  it("calls a lapsed connection expired, ahead of whatever error it caused", () => {
    /*
     * The error is usually a symptom of the lapse. Reporting the symptom sends
     * somebody to replace a key that is fine.
     */
    const v = integrationState(
      facts({ connectionLive: false, lastError: "401 unauthorized" }),
      NOW
    );
    expect(v.state).toBe("expired");
    expect(v.nextAction).toBe("Reconnect it.");
  });

  it("reports nothing saved before anything else", () => {
    const v = integrationState(
      facts({ configured: false, lastError: "429 too many requests", connectionLive: false }),
      NOW
    );
    expect(v.state).toBe("not_configured");
  });

  it("degrades on an error it cannot classify rather than guessing", () => {
    const v = integrationState(facts({ lastError: "something went sideways" }), NOW);
    expect(v.state).toBe("degraded");
    expect(v.nextAction).toContain("Test it below");
  });

  it("survives an unparseable validation date", () => {
    const v = integrationState(facts({ lastValidatedAt: "whenever" }), NOW);
    expect(v.state).toBe("configured");
  });
});

describe("the state vocabulary", () => {
  it("labels and explains all six", () => {
    for (const s of Object.keys(INTEGRATION_STATE_LABEL) as (keyof typeof INTEGRATION_STATE_LABEL)[]) {
      expect(INTEGRATION_STATE_LABEL[s]).toBeTruthy();
      expect(INTEGRATION_STATE_MEANING[s].length).toBeGreaterThan(20);
    }
  });

  it("never uses the word this panel is not allowed to use", () => {
    /*
     * "Connected" is banned by name: it describes a saved credential and reads
     * as a working service.
     */
    const all = [
      ...Object.values(INTEGRATION_STATE_LABEL),
      ...Object.values(INTEGRATION_STATE_MEANING),
    ].join(" ");
    expect(all).not.toMatch(/\bConnected\b/);
  });

  it("gives blocked and expired the same stop colour", () => {
    expect(stateTone("blocked")).toBe("red");
    expect(stateTone("expired")).toBe("red");
    expect(stateTone("degraded")).toBe("amber");
    expect(stateTone("healthy")).toBe("green");
    expect(stateTone("configured")).toBe("slate");
    expect(stateTone("not_configured")).toBe("slate");
  });
});
