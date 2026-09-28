import { describe, expect, it } from "vitest";
import { looksLikeSitemapUrlSet } from "@/lib/domain/sitemap-shape";

/**
 * The regression this file exists for.
 *
 * The check shipped as `/<urlset[\\s>]/`, which reads as "urlset followed by
 * whitespace or >" and is not: inside a regex literal `\\` is an escaped
 * backslash, so the class was {backslash, "s", ">"}. It matched a bare
 * `<urlset>` and rejected every sitemap Next actually renders, which all carry
 * an xmlns attribute and therefore a space after the tag name.
 *
 * The failure mode is the nasty one. The guard sat in front of IndexNow
 * submission, so it never raised an alarm -- it just refused to submit,
 * permanently, and looked like prudence while doing it. A guard that always
 * fails is worse than no guard at all.
 *
 * So the first case below is the exact string Next emits. If someone
 * re-tightens this expression, that case is what has to keep passing.
 */
describe("sitemap shape check", () => {
  it("accepts the sitemap Next actually renders", () => {
    // Attributes present, so a space follows the tag name. This is the case the
    // original expression got wrong.
    expect(
      looksLikeSitemapUrlSet(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://brostco.com</loc></url></urlset>',
      ),
    ).toBe(true);
  });

  it("accepts a url set with no attributes", () => {
    expect(looksLikeSitemapUrlSet("<urlset><url><loc>https://brostco.com</loc></url></urlset>")).toBe(true);
  });

  it("accepts a newline or tab after the tag name", () => {
    expect(looksLikeSitemapUrlSet("<urlset\n  xmlns='x'>")).toBe(true);
    expect(looksLikeSitemapUrlSet("<urlset\txmlns='x'>")).toBe(true);
  });

  it("rejects an error page served with a 200", () => {
    // The reason the guard exists: a deployment can answer 200 with anything.
    expect(looksLikeSitemapUrlSet("Internal Server Error")).toBe(false);
    expect(looksLikeSitemapUrlSet("<!DOCTYPE html><html><body>Not found</body></html>")).toBe(false);
    expect(looksLikeSitemapUrlSet("")).toBe(false);
  });

  it("rejects a tag that merely starts with the same letters", () => {
    expect(looksLikeSitemapUrlSet("<urlsetfoo>")).toBe(false);
  });

  it("rejects a sitemap index, which is not a url set", () => {
    expect(
      looksLikeSitemapUrlSet('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></sitemapindex>'),
    ).toBe(false);
  });
});
