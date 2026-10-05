import { beforeEach, describe, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../lib/integrations/guarded-fetch", () => ({ guardedFetch: fetch }));
import { extractPublishedEmails, linkedBusinessProfiles, scrapeWebsiteEmail } from "../lib/integrations/email-scrape";

function page(body: string, finalUrl: string) {
  return { body: Buffer.from(body), finalUrl, contentType: "text/html", hops: [] };
}
beforeEach(() => { fetch.mockReset(); });

describe("public business contact evidence", () => {
  it("preserves exact addresses including initial digits and tolerates malformed mailto encoding", () => {
    expect(extractPublishedEmails('<a href="mailto:%ZZ">bad</a> 123estimates@firm.test', "firm.test"))
      .toEqual([{ email: "123estimates@firm.test", ownDomain: true }]);
  });
  it("only accepts explicitly linked business profiles, with a two-profile cap", () => {
    expect(linkedBusinessProfiles(`<a href="https://facebook.com/login">x</a>
      <a href="https://linkedin.com/in/person">x</a><a href="https://facebook.com.evil.test/firm">x</a>
      <a href="https://facebook.com/firm?tracking=1">x</a><a href="https://linkedin.com/company/firm">x</a>
      <a href="https://instagram.com/firm">x</a>`))
      .toEqual(["https://facebook.com/firm", "https://linkedin.com/company/firm"]);
  });
  it("records the actual final website page and stops after own-domain evidence", async () => {
    fetch.mockResolvedValue(page("estimating@firm.test", "https://firm.test/contact/"));
    expect(await scrapeWebsiteEmail("firm.test")).toMatchObject({
      email: "estimating@firm.test", ownDomain: true, sourceType: "website", sourceUrl: "https://firm.test/contact/",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not inherit ownership from a redirect to another domain", async () => {
    fetch.mockResolvedValue(page("estimating@firm.test", "https://directory.test/firm"));
    expect(await scrapeWebsiteEmail("firm.test")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it("records linked social evidence as unverified and ignores platform contact addresses", async () => {
    fetch.mockImplementation(async (url: string) => url.includes("facebook.com")
      ? page("privacy@facebook.com estimates@firm.test", url)
      : page('<a href="https://facebook.com/firm">Our page</a>', url));
    expect(await scrapeWebsiteEmail("firm.test")).toMatchObject({
      email: "estimates@firm.test", ownDomain: false, sourceType: "linked_social", sourceUrl: "https://facebook.com/firm",
    });
    expect(fetch).toHaveBeenCalledTimes(6);
  });
  it("does not extract an address behind a login redirect or password form", async () => {
    fetch.mockImplementation(async (url: string) => url.includes("facebook.com")
      ? page('<input type="password"> help@firm.test', "https://facebook.com/login")
      : page('<a href="https://facebook.com/firm">Our page</a>', url));
    expect(await scrapeWebsiteEmail("firm.test")).toBeNull();
  });
  it("keeps failures empty and bounds requests to five website pages and two profiles", async () => {
    fetch.mockImplementation(async (url: string) => url.includes("firm.test")
      ? page('<a href="https://facebook.com/firm">a</a><a href="https://instagram.com/firm">b</a>', url)
      : Promise.reject(new Error("blocked")));
    expect(await scrapeWebsiteEmail("firm.test")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(7);
    for (const call of fetch.mock.calls) expect(call[1]).toMatchObject({ maxBytes: 500_000, timeoutMs: 10_000, maxRedirects: 3 });
  });
});
