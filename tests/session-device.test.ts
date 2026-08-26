import { describe, expect, it } from "vitest";
import {
  describeDevice,
  sanitizeUserAgent,
  sessionSummary,
  sessionView,
  sortSessions,
  type SessionRow,
} from "@/lib/domain/session-device";

const NOW = new Date("2026-03-10T12:00:00Z");

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 Edg/133.0.0.0",
  firefoxLinux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36",
  curl: "curl/8.4.0",
};

describe("naming a device", () => {
  it("reads the common browsers on the common platforms", () => {
    expect(describeDevice(UA.chromeMac)).toBe("Chrome on macOS");
    expect(describeDevice(UA.safariIphone)).toBe("Safari on iPhone");
    expect(describeDevice(UA.firefoxLinux)).toBe("Firefox on Linux");
  });

  /**
   * Every one of these claims to be something else in its user agent, which is
   * why the order of the table matters. Edge says Chrome, Chrome says Safari,
   * and Android says Linux.
   */
  it("does not mistake Edge for Chrome", () => {
    expect(describeDevice(UA.edgeWindows)).toBe("Edge on Windows");
  });

  it("does not mistake Chrome for Safari", () => {
    expect(describeDevice(UA.chromeMac)).not.toContain("Safari");
  });

  it("prefers Android over the Linux it also claims", () => {
    expect(describeDevice(UA.chromeAndroid)).toBe("Chrome on Android");
  });

  it("says not recorded rather than guessing", () => {
    expect(describeDevice(null)).toBe("Not recorded");
    expect(describeDevice("")).toBe("Not recorded");
    expect(describeDevice("   ")).toBe("Not recorded");
    // A real agent from something that is not a browser. Naming it "Other"
    // would be a category; this is genuinely unknown.
    expect(describeDevice(UA.curl)).toBe("Not recorded");
  });

  /**
   * "HeadlessChrome/" has no word boundary before Chrome, so a leading \b sent
   * it through to the Safari row and every automated session in the list read
   * "Safari on Linux". Found by looking at the rendered page rather than at
   * the table.
   */
  it("recognises a prefixed Chrome token", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/133.0.0.0 Safari/537.36"
      )
    ).toBe("Chrome on Linux");
  });

  it("still puts the impostors ahead of it", () => {
    expect(describeDevice(UA.edgeWindows)).toBe("Edge on Windows");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36 OPR/119.0.0.0"
      )
    ).toBe("Opera on Windows");
  });

  it("names what it can when it only recognises half", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0)")).toBe("Windows");
    expect(describeDevice("Firefox/126.0")).toBe("Firefox");
  });
});

describe("storing a user agent", () => {
  it("is a header, so it is bounded and stripped of control characters", () => {
    expect(sanitizeUserAgent("a\u0000b\u001fc")).toBe("a b c");
    expect(sanitizeUserAgent("x".repeat(900))?.length).toBe(400);
  });

  it("is null when there is nothing to store", () => {
    expect(sanitizeUserAgent(null)).toBeNull();
    expect(sanitizeUserAgent("   ")).toBeNull();
  });
});

function row(over: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "s1",
    createdAt: "2026-03-01T12:00:00Z",
    expiresAt: "2026-03-31T12:00:00Z",
    lastSeenAt: "2026-03-10T11:30:00Z",
    userAgent: UA.chromeMac,
    impersonatorEmail: null,
    ...over,
  };
}

describe("one session, read as a person would", () => {
  it("says when it was last used and when it runs out", () => {
    const v = sessionView(row(), "s1", NOW);
    expect(v.current).toBe(true);
    expect(v.lastSeen).toBe("30 minutes ago");
    expect(v.signedIn).toBe("9 days ago");
    expect(v.expires).toBe("in 21 days");
  });

  /**
   * A session created before the column existed has no last-seen. Falling back
   * to its creation time would claim activity that was never recorded, on the
   * one screen somebody reads when they suspect their account has been used.
   */
  it("does not substitute the sign-in time for a missing last-seen", () => {
    const v = sessionView(row({ lastSeenAt: null }), "s1", NOW);
    expect(v.lastSeen).toBe("Not recorded");
    expect(v.signedIn).toBe("9 days ago");
  });

  it("marks a session that is not this one", () => {
    expect(sessionView(row({ id: "other" }), "s1", NOW).current).toBe(false);
    // No current session at all (the env operator holds a signed token, not a
    // row) must not silently mark the first one as current.
    expect(sessionView(row(), null, NOW).current).toBe(false);
  });

  it("calls out a support session, because it is somebody else signed in as you", () => {
    const v = sessionView(row({ impersonatorEmail: "help@brostco.test" }), "s1", NOW);
    expect(v.support).toContain("help@brostco.test");
  });

  it("says an expired session is expired rather than counting backwards", () => {
    const v = sessionView(row({ expiresAt: "2026-03-01T00:00:00Z" }), "s1", NOW);
    expect(v.expires).toBe("already expired");
  });

  it("survives an unparsable timestamp without inventing one", () => {
    const v = sessionView(row({ lastSeenAt: "not a date", expiresAt: "also not" }), "s1", NOW);
    expect(v.lastSeen).toBe("Not recorded");
    expect(v.expires).toBe("at an unrecorded time");
  });
});

describe("the list", () => {
  it("puts your own device first so you know which one to skip", () => {
    const views = [
      sessionView(row({ id: "a" }), "b", NOW),
      sessionView(row({ id: "b" }), "b", NOW),
      sessionView(row({ id: "c" }), "b", NOW),
    ];
    expect(sortSessions(views).map((v) => v.id)).toEqual(["b", "a", "c"]);
  });

  it("counts the others, not the total", () => {
    const one = [sessionView(row({ id: "a" }), "a", NOW)];
    expect(sessionSummary(one)).toContain("only device");

    const two = [
      sessionView(row({ id: "a" }), "a", NOW),
      sessionView(row({ id: "b" }), "a", NOW),
    ];
    expect(sessionSummary(two)).toContain("1 other device is");

    const three = [
      sessionView(row({ id: "a" }), "a", NOW),
      sessionView(row({ id: "b" }), "a", NOW),
      sessionView(row({ id: "c" }), "a", NOW),
    ];
    expect(sessionSummary(three)).toContain("2 other devices are");
  });

  it("does not claim a device count for an empty list", () => {
    expect(sessionSummary([])).toContain("should not happen");
  });
});
