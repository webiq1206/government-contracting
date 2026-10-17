import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isMailboxRateLimit,
  recapFailureCanRetry,
  recapGapMs,
  recapRetryDelayMs,
  RECAP_RATE_LIMIT_ATTEMPTS,
  RECAP_SENDS_PER_TICK,
} from "@/lib/domain/recap-send-pace";

const NOW = new Date("2026-10-16T15:00:00.000Z");

describe("recap send pace", () => {
  it("spaces sends and backs off a rate limit with jitter", () => {
    expect(RECAP_SENDS_PER_TICK).toBeLessThanOrEqual(8);
    expect(recapGapMs(0)).toBe(2000);
    expect(recapGapMs(1)).toBe(2800);
    const first = recapRetryDelayMs(1, 0);
    const later = recapRetryDelayMs(2, 0);
    expect(first).toBe(2 * 60_000);
    expect(later).toBe(first * 2);
    expect(recapRetryDelayMs(9, 0)).toBe(60 * 60_000);
    expect(recapRetryDelayMs(1, 1)).toBe(first + Math.floor(first * 0.25));
  });

  it("recognizes a Gmail rate limit and will not reclaim a message that already has an id", () => {
    expect(isMailboxRateLimit("Gmail user-rate limit exceeded")).toBe(true);
    expect(isMailboxRateLimit("HTTP 429")).toBe(true);
    expect(isMailboxRateLimit("mailbox unavailable")).toBe(false);
    expect(
      recapFailureCanRetry({
        providerAttemptedAt: NOW.toISOString(),
        providerMessageId: "<sent@mail>",
        error: "429 rate limit",
        nextRetryAt: null,
        now: NOW,
      })
    ).toBe(false);
    expect(
      recapFailureCanRetry({
        providerAttemptedAt: NOW.toISOString(),
        providerMessageId: null,
        error: "connection reset",
        nextRetryAt: null,
        now: NOW,
      })
    ).toBe(false);
    expect(
      recapFailureCanRetry({
        providerAttemptedAt: NOW.toISOString(),
        providerMessageId: null,
        error: "429 too many requests",
        nextRetryAt: new Date(NOW.getTime() + 60_000).toISOString(),
        now: NOW,
      })
    ).toBe(false);
    expect(
      recapFailureCanRetry({
        providerAttemptedAt: NOW.toISOString(),
        providerMessageId: null,
        error: "429 too many requests",
        nextRetryAt: NOW.toISOString(),
        now: NOW,
      })
    ).toBe(true);
  });

  it("lets a rate-limited row try longer than a dead address, and still requires no message id", () => {
    const sql = readFileSync("lib/recap/delivery.ts", "utf8");
    expect(sql).toContain("attempts < ${RECAP_RATE_LIMIT_ATTEMPTS}");
    expect(RECAP_RATE_LIMIT_ATTEMPTS).toBeGreaterThan(3);
    expect(sql).toContain("provider_message_id is null");
    expect(sql).toContain("next_retry_at");
    const sender = readFileSync("lib/agents/daily-recap.ts", "utf8");
    expect(sender).toContain("RECAP_SENDS_PER_TICK");
    expect(sender).toContain("recapGapMs()");
    expect(sender).toContain("rfc822MessageId ?? result.messageId");
    expect(sender).toContain("if (limited) return");
  });
});
