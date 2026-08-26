import { describe, it, expect } from "vitest";
import {
  credentialView,
  creditView,
  tokenTotals,
  allowanceView,
  formatTokens,
} from "@/lib/domain/provider-usage";

const now = new Date("2026-08-25T12:00:00Z");

describe("credentialView", () => {
  it("says who pays for each source", () => {
    expect(credentialView("own_key", null, now).explanation).toContain("your Anthropic account");
    expect(credentialView("granted", null, now).explanation).toContain("billed to us");
    expect(credentialView("trial", null, now).explanation).toContain("call allowance");
    expect(credentialView("none", null, now).label).toBe("No AI credential");
  });

  it("names the founding account's environment key rather than calling it absent", () => {
    // The resolver's last branch. Reporting "no credential" here would say
    // nothing is configured on the one account where everything is running.
    const v = credentialView("environment", null, now);
    expect(v.label).toBe("The platform's own key");
    expect(v.explanation).toContain("founding account");
  });

  it("has no expiry warning for a credential that does not expire", () => {
    expect(credentialView("own_key", null, now).expiry).toBeNull();
  });

  it("rounds a partial day up, so a grant with hours left is not shown as gone", () => {
    const e = credentialView("granted", new Date("2026-08-26T07:00:00Z"), now).expiry;
    expect(e?.daysLeft).toBe(1);
    expect(e?.urgency).toBe("soon");
  });

  it("warns inside a week and stays quiet beyond one", () => {
    expect(credentialView("granted", new Date("2026-08-31T12:00:00Z"), now).expiry?.urgency).toBe(
      "soon"
    );
    expect(credentialView("granted", new Date("2026-10-01T12:00:00Z"), now).expiry?.urgency).toBe(
      "later"
    );
  });

  it("marks an already-lapsed grant expired rather than merely urgent", () => {
    const e = credentialView("granted", new Date("2026-08-20T12:00:00Z"), now).expiry;
    expect(e?.urgency).toBe("expired");
    expect(e!.daysLeft).toBeLessThanOrEqual(0);
  });

  it("ignores an unparseable expiry rather than rendering an invalid date", () => {
    expect(credentialView("granted", "whenever", now).expiry).toBeNull();
  });
});

describe("creditView", () => {
  it("puts an exhausted balance ahead of everything else", () => {
    const v = creditView(["provider_rate_limit", "provider_credit"], 40);
    expect(v.state).toBe("out_of_credit");
  });

  it("distinguishes a rejected key from an empty balance", () => {
    expect(creditView(["provider_auth"], 10).state).toBe("key_rejected");
  });

  it("says throttling needs nobody, because retries handle it", () => {
    const v = creditView(["provider_rate_limit"], 10);
    expect(v.state).toBe("throttled");
    expect(v.detail).toContain("retries");
  });

  it("refuses to claim health when nothing called the provider", () => {
    const v = creditView([], 0);
    expect(v.state).toBe("unmeasured");
    expect(v.label).toBe("Nothing measured");
  });

  it("says calls are being accepted only when calls were actually made", () => {
    const v = creditView([], 12);
    expect(v.state).toBe("accepting");
    expect(v.detail).toContain("12 model calls");
  });

  it("counts one call in the singular", () => {
    expect(creditView([], 1).detail).toContain("1 model call recorded");
  });
});

describe("tokenTotals", () => {
  it("returns nothing at all when no call was recorded", () => {
    expect(tokenTotals([])).toBeNull();
  });

  it("adds up what was recorded", () => {
    const t = tokenTotals([
      { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 3000 },
      { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 800 },
    ]);
    expect(t).toMatchObject({ calls: 2, input: 1500, output: 300, cacheRead: 3000, cacheWrite: 800 });
  });

  it("computes a cache hit rate over everything that went in", () => {
    const t = tokenTotals([{ input_tokens: 1000, cache_read_input_tokens: 3000 }]);
    expect(t?.cacheHitRate).toBe(75);
  });

  it("has no cache hit rate when nothing went in", () => {
    expect(tokenTotals([{ output_tokens: 50 }])?.cacheHitRate).toBeNull();
  });

  it("treats absent, negative and non-numeric counts as nothing rather than throwing", () => {
    const t = tokenTotals([{ input_tokens: -5, output_tokens: "40", cache_read_input_tokens: null }]);
    expect(t).toMatchObject({ calls: 1, input: 0, output: 40, cacheRead: 0 });
  });
});

describe("allowanceView", () => {
  it("draws no bar when there is no cap to draw it against", () => {
    expect(allowanceView(40, null)).toBeNull();
    expect(allowanceView(40, 0)).toBeNull();
  });

  it("reports use against a real cap", () => {
    expect(allowanceView(250, 1000)).toMatchObject({
      used: 250,
      remaining: 750,
      pctUsed: 25,
      nearLimit: false,
      exhausted: false,
    });
  });

  it("warns from four fifths of the way through", () => {
    expect(allowanceView(800, 1000)?.nearLimit).toBe(true);
    expect(allowanceView(799, 1000)?.nearLimit).toBe(false);
  });

  it("calls a spent allowance exhausted rather than merely near", () => {
    const v = allowanceView(1200, 1000);
    expect(v?.exhausted).toBe(true);
    expect(v?.nearLimit).toBe(false);
    expect(v?.remaining).toBe(0);
    expect(v?.pctUsed).toBe(100);
  });
});

describe("formatTokens", () => {
  it("keeps small numbers exact and compresses large ones", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(940)).toBe("940");
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });
});
