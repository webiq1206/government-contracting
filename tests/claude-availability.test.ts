/**
 * A key that exists is not a key that works.
 *
 * The whole point of describeClaudeFailure is to separate "the AI account
 * cannot serve us" (an owner can fix that: add credits, replace the key, wait)
 * from "we sent a bad request" (a bug in us, and dressing it up as an outage
 * sends the owner off to top up an account that was never the problem).
 */
import { describe, it, expect } from "vitest";
import { describeClaudeFailure } from "@/lib/ai/claude";

/** Shaped like the SDK's APIError: a status plus the parsed error body. */
function apiError(status: number | null, message: string, type = "invalid_request_error") {
  return {
    status: status ?? undefined,
    message: `${status ?? ""} ${message}`,
    error: { type: "error", error: { type, message } },
  };
}

describe("describeClaudeFailure", () => {
  it("names an account that is out of credits, and calls it unfixable by waiting", () => {
    const d = describeClaudeFailure(
      apiError(400, "Your credit balance is too low to access the Anthropic API.")
    );
    expect(d).not.toBeNull();
    expect(d!.reason).toMatch(/credit balance is too low/);
    expect(d!.reason).toMatch(/console\.anthropic\.com/);
    expect(d!.retryable).toBe(false);
  });

  it("names a rejected key", () => {
    const d = describeClaudeFailure(apiError(401, "invalid x-api-key", "authentication_error"));
    expect(d!.reason).toMatch(/rejected the API key/);
    expect(d!.retryable).toBe(false);
  });

  it("treats rate limits and Anthropic outages as worth retrying", () => {
    expect(describeClaudeFailure(apiError(429, "rate limited", "rate_limit_error"))!.retryable).toBe(true);
    expect(describeClaudeFailure(apiError(529, "overloaded", "overloaded_error"))!.retryable).toBe(true);
  });

  it("recognises a request that never reached Anthropic", () => {
    const d = describeClaudeFailure(new TypeError("fetch failed"));
    expect(d!.reason).toMatch(/Could not reach Anthropic/);
    expect(d!.retryable).toBe(true);
  });

  it("returns null for our own bad request, which is a bug and not an outage", () => {
    expect(
      describeClaudeFailure(apiError(400, "messages: at least one message is required"))
    ).toBeNull();
  });

  it("returns null for anything that is not an API failure at all", () => {
    expect(describeClaudeFailure(new Error("no JSON found in response"))).toBeNull();
  });
});
