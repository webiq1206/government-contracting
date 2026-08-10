import { describe, expect, it } from "vitest";
import { extractSearchResultUrls } from "../lib/integrations/website-finder";

describe("extractSearchResultUrls", () => {
  it("pulls absolute hrefs in order, deduped by host, skipping engine-internal links", () => {
    const html = `
      <a href="https://search.brave.com/settings">settings</a>
      <a class="result" href="https://sweptcleandc.com/">Swept Clean</a>
      <a href="https://sweptcleandc.com/about-us/">About</a>
      <a href="https://www.yelp.com/biz/swept-clean-washington">Yelp</a>
      <a href="https://cdn.brave.com/logo.png">logo</a>
      <a href="/relative/path">rel</a>
    `;
    expect(extractSearchResultUrls(html)).toEqual([
      "https://sweptcleandc.com/",
      "https://www.yelp.com/biz/swept-clean-washington",
    ]);
  });

  it("decodes &amp; entities and ignores malformed URLs", () => {
    const html = `<a href="https://example.com/?a=1&amp;b=2">x</a><a href="https://">bad</a>`;
    expect(extractSearchResultUrls(html)).toEqual(["https://example.com/?a=1&b=2"]);
  });
});
