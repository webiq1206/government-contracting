import { beforeEach, describe, expect, it, vi } from "vitest";
const fetch = vi.hoisted(() => vi.fn());
vi.mock("../lib/integrations/guarded-fetch", () => ({ guardedFetch: fetch }));
import { decodeCloudflareEmail, extractPublishedEmails, linkedBusinessProfiles, linkedContactPaths, scrapeWebsiteEmail, scrapeWebsiteEmailDetailed } from "../lib/integrations/email-scrape";

/** What Cloudflare's email protection publishes for an address. */
function cloudflare(email: string, key = 0x5a): string {
  return [key, ...Array.from(email, (c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
  it("reads addresses hidden by Cloudflare email protection and HTML entities", () => {
    const hex = cloudflare("estimating@firm.test");
    expect(decodeCloudflareEmail(hex)).toBe("estimating@firm.test");
    expect(extractPublishedEmails(`<a class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a>`, "firm.test"))
      .toEqual([{ email: "estimating@firm.test", ownDomain: true }]);
    expect(extractPublishedEmails(`<a href="/cdn-cgi/l/email-protection#${cloudflare("bids@firm.test", 0x13)}">Email</a>`, "firm.test"))
      .toEqual([{ email: "bids@firm.test", ownDomain: true }]);
    expect(extractPublishedEmails("office&#64;firm&#46;test", "firm.test")).toEqual([{ email: "office@firm.test", ownDomain: true }]);
    expect(decodeCloudflareEmail("zz")).toBeNull();
  });
  it("never offers site-builder, placeholder or font-licence addresses as a contact", () => {
    expect(extractPublishedEmails(`abc123@sentry-next.wixpress.com you@domain.com info@example.com
      licensing@latofonts.com user@email.com estimates@firm.test`, "firm.test"))
      .toEqual([{ email: "estimates@firm.test", ownDomain: true }]);
  });
  it("follows the site's own contact link when it is not a usual path", async () => {
    expect(linkedContactPaths(`<a href="/get-in-touch">Get in touch</a><a href="https://other.test/contact">x</a>
      <a href="/contact">Contact</a><a href="/pages/request-a-quote?x=1">Request a quote</a><a href="/blog">Blog</a>`,
      "https://firm.test/", "firm.test")).toEqual(["/get-in-touch", "/pages/request-a-quote?x=1"]);
    fetch.mockImplementation(async (url: string) => url.endsWith("/get-in-touch")
      ? page("Write to bids@firm.test", url)
      : page('<a href="/get-in-touch">Get in touch</a>', url));
    expect(await scrapeWebsiteEmail("firm.test")).toMatchObject({ email: "bids@firm.test", sourceUrl: "https://firm.test/get-in-touch" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("tells a site that publishes no email apart from one that could not be read", async () => {
    fetch.mockImplementation(async (url: string) => page("<p>Call us</p>", url));
    expect(await scrapeWebsiteEmailDetailed("firm.test")).toEqual({ email: null, pagesRead: 5 });
    fetch.mockReset();
    fetch.mockRejectedValue(new Error("timeout"));
    expect(await scrapeWebsiteEmailDetailed("firm.test")).toEqual({ email: null, pagesRead: 0 });
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
