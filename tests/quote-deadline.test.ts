/**
 * The date a subcontractor is actually given.
 *
 * One rule matters more than the rest and is asserted from several
 * directions: the quote deadline is never on or after the government bid
 * deadline. An email that breaks it is asking a subcontractor to be late, and
 * the failure is invisible -- the email reads perfectly well.
 */
import { describe, it, expect } from "vitest";
import {
  computeQuoteDeadline,
  formatQuoteDueLabel,
  resolveTimeZone,
} from "@/lib/domain/quote-deadline";

const TZ = "America/Denver";

/** A Thursday, so the five-business-day walk-back crosses a weekend. */
const NOW = new Date("2026-08-06T16:00:00Z");

describe("resolveTimeZone", () => {
  it("speaks in the sender's zone, because it is the sender's deadline", () => {
    expect(resolveTimeZone({ senderState: "CO", projectState: "VA" })).toEqual({
      timeZone: "America/Denver",
      derivedFrom: "sender",
    });
  });

  it("falls back to where the work is when the sender has no state", () => {
    expect(resolveTimeZone({ senderState: "", projectState: "VA" })).toEqual({
      timeZone: "America/New_York",
      derivedFrom: "project",
    });
  });

  it("still returns a zone when it knows neither", () => {
    // Named in the label either way, so a wrong guess is at least checkable.
    expect(resolveTimeZone({}).derivedFrom).toBe("fallback");
  });

  it("is case and whitespace tolerant, because state fields are typed by hand", () => {
    expect(resolveTimeZone({ senderState: " co " }).timeZone).toBe("America/Denver");
  });
});

describe("formatQuoteDueLabel", () => {
  it("writes the date, the time, and the zone", () => {
    const at = new Date("2026-08-22T21:00:00Z"); // 3pm MDT
    expect(formatQuoteDueLabel(at, TZ)).toBe("August 22, 2026 at 3:00 PM MDT");
  });

  it("names the zone the reader is in, not the server's", () => {
    const at = new Date("2026-08-22T21:00:00Z");
    expect(formatQuoteDueLabel(at, "America/New_York")).toContain("EDT");
    expect(formatQuoteDueLabel(at, "America/Los_Angeles")).toContain("PDT");
  });
});

describe("computeQuoteDeadline", () => {
  it("lands five business days early, at 3pm, when there is room", () => {
    const r = computeQuoteDeadline({
      deadline: "2026-09-04T20:00:00Z",
      timeZone: TZ,
      now: NOW,
    });
    expect(r.basis).toBe("target");
    expect(r.warning).toBeNull();
    // Sep 4 is a Friday; five business days back is Friday Aug 28.
    expect(r.label).toBe("August 28, 2026 at 3:00 PM MDT");
  });

  it("never returns a date on or after the bid deadline", () => {
    /*
     * The invariant, swept across the whole range where a date is possible at
     * all. This is the failure that cannot be spotted by reading the email.
     */
    for (let hours = 40; hours <= 24 * 45; hours += 7) {
      const deadline = new Date(NOW.getTime() + hours * 3_600_000);
      const r = computeQuoteDeadline({ deadline, timeZone: TZ, now: NOW });
      if (!r.at) continue;
      expect(new Date(r.at).getTime()).toBeLessThan(deadline.getTime());
    }
  });

  it("never asks for a quote in the past, or within a day", () => {
    for (let hours = 40; hours <= 24 * 45; hours += 7) {
      const deadline = new Date(NOW.getTime() + hours * 3_600_000);
      const r = computeQuoteDeadline({ deadline, timeZone: TZ, now: NOW });
      if (!r.at) continue;
      expect(new Date(r.at).getTime()).toBeGreaterThanOrEqual(
        NOW.getTime() + 24 * 3_600_000 - 1000
      );
    }
  });

  it("compresses rather than gives up when the bid is a few days out", () => {
    const r = computeQuoteDeadline({
      deadline: new Date(NOW.getTime() + 5 * 86_400_000),
      timeZone: TZ,
      now: NOW,
    });
    expect(r.basis).toBe("compressed");
    // The operator is told, because there is no room to chase a replacement.
    expect(r.warning).toMatch(/close/i);
    expect(r.at).toBeTruthy();
  });

  it("refuses to invent a date when the bid is imminent", () => {
    /*
     * Under a day and a half there is no split that leaves the sub time to
     * price and us time to package. A made-up date would read fine and be
     * unmeetable by both parties.
     */
    const r = computeQuoteDeadline({
      deadline: new Date(NOW.getTime() + 20 * 3_600_000),
      timeZone: TZ,
      now: NOW,
    });
    expect(r.basis).toBe("impossible");
    expect(r.at).toBeNull();
    expect(r.label).toBe("");
    expect(r.warning).toBeTruthy();
  });

  it("says so when there is no deadline to work back from", () => {
    const r = computeQuoteDeadline({ deadline: null, timeZone: TZ, now: NOW });
    expect(r.basis).toBe("no_deadline");
    expect(r.at).toBeNull();
    expect(r.warning).toMatch(/no bid deadline/i);
  });

  it("treats an unreadable deadline as no deadline, not as now", () => {
    // Parsing "sometime in September" to Invalid Date and carrying on would
    // produce a quote date computed from NaN.
    const r = computeQuoteDeadline({
      deadline: "sometime in September",
      timeZone: TZ,
      now: NOW,
    });
    expect(r.at).toBeNull();
    expect(r.basis).toBe("no_deadline");
  });

  it("holds the 3pm local time across a daylight-saving boundary", () => {
    // US DST ends Nov 1 2026. A deadline just after it, walked back to just
    // before it, is the case a date built from parts gets wrong by an hour.
    const r = computeQuoteDeadline({
      deadline: "2026-11-06T20:00:00Z",
      timeZone: TZ,
      now: new Date("2026-10-01T16:00:00Z"),
    });
    expect(r.basis).toBe("target");
    expect(r.label).toContain("3:00 PM");
    expect(r.label).toContain("October 30, 2026");
  });
});
