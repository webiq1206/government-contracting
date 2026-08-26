/**
 * What an analytics row is allowed to contain.
 *
 * The brief's rule: product analytics and error reporting must not expose
 * sensitive solicitations, contacts, messages, documents, or account data.
 * Nothing was sending any of it, and nothing was stopping it either.
 * `trackEvent` took `Record<string, unknown>` and an arbitrary path, and the
 * API route behind it passed both straight through from the request body. The
 * shape invited a subcontractor's email, a solicitation title, or a search
 * term, and the first one to arrive would have looked like all the others.
 *
 * These cases are the ones that would actually happen: somebody passes the
 * record they already have in scope, or the path they are already on.
 */
import { describe, expect, it } from "vitest";
import { safeMeta, safePath } from "@/lib/domain/analytics-safety";

describe("what an event may carry", () => {
  it("keeps the counts and flags a funnel is made of", () => {
    expect(safeMeta({ ended: 3, comped: true, plan: "founding" })).toEqual({
      ended: 3,
      comped: true,
      plan: "founding",
    });
  });

  it("keeps a short list of enumerated words", () => {
    // The billing config check reports which keys are missing by name.
    expect(safeMeta({ missing: ["STRIPE_SECRET_KEY", "PRICE_ID"] })).toEqual({
      missing: ["STRIPE_SECRET_KEY", "PRICE_ID"],
    });
  });

  it("drops an email address wherever it appears", () => {
    const out = safeMeta({ owner: "rivera@example.com", plan: "standard" });
    expect(out.owner).toBeUndefined();
    expect(out.plan).toBe("standard");
    expect(out.dropped_keys).toBe(1);
  });

  it("drops a phone number", () => {
    expect(safeMeta({ contact: "+1 (512) 555-0134" }).contact).toBeUndefined();
  });

  it("drops free text, which is where a solicitation title lives", () => {
    /*
     * This is the case that got through the first version of the filter. It
     * capped strings at 64 characters, and a probe put through the real route
     * showed a 62-character solicitation title landing in the table intact.
     * Whitespace, not length, is what separates a token from prose.
     */
    const title = "Roof Replacement and Associated Sheet Metal Work, Building 402";
    expect(title.length).toBeLessThan(64);
    expect(safeMeta({ title }).title).toBeUndefined();
  });

  it("drops a company name, which is two words and short", () => {
    expect(safeMeta({ company: "Rivera Roofing" }).company).toBeUndefined();
  });

  it("keeps a Stripe session id, which is long and has no spaces", () => {
    // The legitimate long value. Capping by length alone would lose it while
    // still letting the title above through.
    const id = "cs_test_" + "a1b2c3d4e5".repeat(5);
    expect(safeMeta({ session_id: id }).session_id).toBe(id);
  });

  it("keeps a long config key name", () => {
    expect(safeMeta({ missing: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"] })).toEqual({
      missing: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
    });
  });

  it("drops a whole record passed by mistake, rather than walking into it", () => {
    /*
     * Recursing would preserve exactly the thing this exists to remove. A
     * nested object in an analytics payload is almost always a row somebody
     * had in scope.
     */
    const out = safeMeta({ sub: { company_name: "Rivera Roofing", email: "a@b.com" } });
    expect(out.sub).toBeUndefined();
    expect(out.dropped_keys).toBe(1);
  });

  it("says something was dropped without saying what", () => {
    // A silently thinner payload teaches somebody the event never happened.
    const out = safeMeta({ a: 1, note: "x".repeat(200) });
    expect(out.a).toBe(1);
    expect(out.dropped_keys).toBe(1);
    expect(JSON.stringify(out)).not.toContain("xxx");
  });

  it("adds nothing when nothing was dropped", () => {
    expect(safeMeta({ a: 1 })).toEqual({ a: 1 });
  });

  it("refuses a payload that is not an object", () => {
    expect(safeMeta(null)).toEqual({});
    expect(safeMeta("rivera@example.com")).toEqual({});
    expect(safeMeta(["rivera@example.com"])).toEqual({});
  });

  it("caps how many keys one event can carry", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    const out = safeMeta(many);
    expect(Object.keys(out).length).toBeLessThanOrEqual(13); // 12 plus dropped_keys
    expect(out.dropped_keys).toBe(18);
  });
});

describe("what a path may say", () => {
  it("keeps the route", () => {
    expect(safePath("/settings/account")).toBe("/settings/account");
  });

  it("drops the query, which is where a search term lives", () => {
    expect(safePath("/subs?q=rivera%20roofing&state=TX")).toBe("/subs");
  });

  it("turns a record reference into a route", () => {
    // "somebody opened an opportunity" is the fact a funnel wants. Which
    // solicitation it was is not.
    expect(safePath("/opportunity/4b0e3eba-ccca-464f-9804-87f1a8c32057")).toBe(
      "/opportunity/:id"
    );
    expect(safePath("/subs/212bf745-15c3-4881-a177-10830ff8359a#activity")).toBe(
      "/subs/:id"
    );
  });

  it("hides an invite or reset token", () => {
    const t = safePath("/invite/aVeryLongOpaqueInviteToken1234567890");
    expect(t).toBe("/invite/:token");
  });

  it("refuses anything that is not a path", () => {
    // A full URL would carry another origin, and its query with it.
    expect(safePath("https://example.com/x?q=secret")).toBeNull();
    expect(safePath("")).toBeNull();
    expect(safePath(null)).toBeNull();
    expect(safePath(42)).toBeNull();
  });
});

describe("where the filter is applied", () => {
  it("runs inside trackEvent, not at the call sites", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/analytics.ts", "utf8");
    expect(src).toContain("safePath(input.path)");
    expect(src).toContain("safeMeta(input.meta)");
  });

  it("no longer claims to forward to a tag manager", async () => {
    /*
     * The comment said it forwarded to window dataLayer for GTM/GA. It never
     * did, and the only occurrence of the word in the repository was that
     * sentence. Nothing leaving is the right answer; a comment saying
     * otherwise sends a privacy audit looking for a configuration that does
     * not exist.
     */
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/analytics.ts", "utf8");
    expect(src).toContain("and nowhere else");
  });
});
