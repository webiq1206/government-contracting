import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, normalizeRules } from "@/lib/domain/intake";
import { decideRfqVolume, secondsUntilNextUtcDay } from "@/lib/domain/rfq-volume";

describe("outbound RFQ volume", () => {
  it("defaults to 100 a day and 5 subcontractors per trade, and stays on until turned off", () => {
    expect(DEFAULT_RULES.rfq_daily_cap).toBe(100);
    expect(DEFAULT_RULES.rfq_subs_per_trade).toBe(5);
    expect(DEFAULT_RULES.rfq_outbound_enabled).toBe(true);
    expect(normalizeRules({}).rfq_daily_cap).toBe(100);
    expect(normalizeRules({}).rfq_subs_per_trade).toBe(5);
    expect(normalizeRules({}).rfq_outbound_enabled).toBe(true);
    expect(normalizeRules({ rfq_outbound_enabled: false }).rfq_outbound_enabled).toBe(false);
    expect(normalizeRules({ rfq_daily_cap: 0 }).rfq_daily_cap).toBe(1);
    expect(normalizeRules({ rfq_daily_cap: 900 }).rfq_daily_cap).toBe(500);
    expect(normalizeRules({ rfq_subs_per_trade: 0 }).rfq_subs_per_trade).toBe(1);
    expect(normalizeRules({ rfq_subs_per_trade: 80 }).rfq_subs_per_trade).toBe(50);
  });

  it("sends inside both caps", () => {
    expect(decideRfqVolume({
      outboundEnabled: true,
      sentToday: 99,
      dailyCap: DEFAULT_RULES.rfq_daily_cap,
      sentForTrade: 4,
      perTradeCap: DEFAULT_RULES.rfq_subs_per_trade,
    })).toEqual({ send: true, reason: null, resumeAfterSeconds: null });
    expect(decideRfqVolume({
      outboundEnabled: true,
      sentToday: DEFAULT_RULES.rfq_daily_cap,
      dailyCap: DEFAULT_RULES.rfq_daily_cap,
      sentForTrade: 0,
      perTradeCap: DEFAULT_RULES.rfq_subs_per_trade,
    }).reason).toBe("daily_cap");
  });

  it("holds the next request until the next UTC day and does not reschedule a paused account", () => {
    const now = new Date("2026-10-16T15:00:00.000Z");
    expect(secondsUntilNextUtcDay(now)).toBe(9 * 60 * 60);
    expect(decideRfqVolume({
      outboundEnabled: true,
      sentToday: 25,
      dailyCap: 25,
      sentForTrade: 0,
      perTradeCap: 5,
      now,
    })).toEqual({ send: false, reason: "daily_cap", resumeAfterSeconds: 9 * 60 * 60 });
    expect(decideRfqVolume({
      outboundEnabled: true,
      sentToday: 1,
      dailyCap: 25,
      sentForTrade: 5,
      perTradeCap: 5,
      now,
    })).toEqual({ send: false, reason: "trade_cap", resumeAfterSeconds: 9 * 60 * 60 });
    const almostMidnight = new Date("2026-10-16T23:59:30.000Z");
    expect(decideRfqVolume({
      outboundEnabled: true,
      sentToday: 25,
      dailyCap: 25,
      sentForTrade: 0,
      perTradeCap: 5,
      now: almostMidnight,
    }).resumeAfterSeconds).toBe(60);
    expect(decideRfqVolume({
      outboundEnabled: false,
      sentToday: 0,
      dailyCap: 25,
      sentForTrade: 0,
      perTradeCap: 5,
      now,
    })).toEqual({ send: false, reason: "kill_switch", resumeAfterSeconds: null });
  });

  it("is enforced before a quote request is sent, and only overflow is queued for the next day", () => {
    const source = readFileSync("lib/agents/outreach.ts", "utf8");
    const hold = source.indexOf("const volumeHold = await holdOutboundRfq");
    const send = source.indexOf("const res = await sendOutreachEmail");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(send);
    expect(source).toContain("human_action_required = true");
    expect(source).toContain('action: "rfq-held"');
    expect(source).toContain("rfq-next-day:");
    expect(source).toContain("startAfterSeconds: decision.resumeAfterSeconds");
    expect(source).toContain("permanent: true");
    const holdFn = source.slice(source.indexOf("async function holdOutboundRfq"));
    expect(holdFn).toContain("resumeAfterSeconds != null");
    expect(holdFn).toContain("decline_thank_you");
  });
});
