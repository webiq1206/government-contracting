import { describe, expect, it } from "vitest";
import { eligibleForFailover, retryTime, withRetryTime } from "../lib/ai/failover-policy";

describe("provider refusal routing boundary", () => {
  it("allows established credit refusals and explicit capacity refusals", () => {
    expect(eligibleForFailover("OpenAI", 429, "OpenAI reached its billing quota or account allowance. Review Billing.")).toBe(true);
    expect(eligibleForFailover("OpenAI", 429, "The OpenAI account has insufficient credit (its billing quota is used up). Nothing will run.")).toBe(true);
    expect(eligibleForFailover("Anthropic", 400, "The Anthropic credit balance is too low. Review Billing.")).toBe(true);
    expect(eligibleForFailover("Anthropic", 529, "Anthropic temporarily refused this request because the API is overloaded.")).toBe(true);
  });
  it.each([401, 403, 400, 404, 422, 500, 503, 504, null])("does not switch around unknown, access, validation or ambiguous status %s", status => {
    expect(eligibleForFailover("OpenAI", status, "OpenAI reached its billing quota or account allowance.")).toBe(false);
  });
  it("does not evade explicitly configured provider spend limits or a generic billing complaint", () => {
    expect(eligibleForFailover("OpenAI", 429, "OpenAI reached its project spend limit.")).toBe(false);
    expect(eligibleForFailover("Anthropic", 400, "The Anthropic credit balance is too low or billing allowance has been exhausted.")).toBe(false);
    expect(eligibleForFailover("Anthropic", 529, "Anthropic returned a server error (HTTP 529).")).toBe(false);
  });
  it("keeps a durable minimum cooldown and honors longer provider delays", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(retryTime(withRetryTime("Rate limited.", 0, now))).toBe(now + 60000);
    expect(retryTime(withRetryTime("Rate limited.", 600, now))).toBe(now + 600000);
    expect(retryTime("An arbitrary provider date 2026-10-11T12:00:00.000Z")).toBeNull();
  });
});
