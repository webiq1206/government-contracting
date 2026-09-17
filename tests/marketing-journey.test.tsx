import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { LandingPage } from "@/components/marketing/landing-page";
import { HOME_SECTIONS, PUBLIC_ROUTES } from "@/lib/domain/public-routes";
import { JsonLd } from "@/components/marketing/json-ld";
import { INDUSTRIES } from "@/components/marketing/industry-content";
import { NAICS_CODES } from "@/lib/naics";
import { HOME_FAQ } from "@/components/marketing/site-content";
const props = {
  promoActive: false,
  promoEndsAt: null,
  standardMonthly: 497,
  foundingMonthly: 497,
  signupHref: "/signup?plan=standard",
};
const html = renderToStaticMarkup(<LandingPage {...props} />);
const { document } = parseHTML(html);
describe("public visitor journey", () => {
  it("places every feature tour beside its relevant homepage content", () => {
    const groups = { platform: ["pipeline", "review"], ai: ["subs", "communications"], "bid-review": ["opportunity", "activity"] };
    for (const [section, slugs] of Object.entries(groups)) {
      for (const slug of slugs) {
        const card = document.querySelector(`#${section} [data-feature-video="${slug}"]`)!;
        expect(card, `${slug} belongs in ${section}`).not.toBeNull();
        expect(card.querySelector(`source[src^="/demos/${slug}.mp4"]`)).not.toBeNull();
        expect(card.querySelector('video[controls][preload="none"]')).not.toBeNull();
        expect(card.querySelector(`a[href="/demos/${slug}.txt"]`)).not.toBeNull();
      }
    }
    expect(document.querySelectorAll('[data-feature-video]')).toHaveLength(6);
    expect(document.querySelectorAll('[data-feature-video]:not([hidden])')).toHaveLength(3);
    expect(document.querySelector('#interactive-workflow[open]')).toBeNull();
    expect(document.querySelectorAll('video[data-product-video]')).toHaveLength(8);
    expect(document.querySelector('#quick-preview[open]')).toBeNull();
    expect(document.querySelector('#quick-preview source[src^="/demos/hero-preview.mp4"]')).not.toBeNull();
    expect(document.querySelector('#proof source[src^="/demos/platform-walkthrough.mp4"]')).not.toBeNull();
  });
  it("has a destination for every advertised homepage section", () => {
    for (const section of HOME_SECTIONS)
      expect(document.querySelector(section.hash), section.hash).not.toBeNull();
  });
  it("keeps navigation paths public and anchors valid", () => {
    const publicPaths = new Set(PUBLIC_ROUTES.map((route) => route.path));
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      const href = anchor.getAttribute("href")!;
      if (!href.startsWith("/") && !href.startsWith("#")) continue;
      const url = new URL(href, "https://brostco.com");
      if (url.pathname === "/" && url.hash)
        expect(document.querySelector(url.hash), href).not.toBeNull();
      if (!url.pathname.startsWith("/demos/") && url.pathname !== "/login")
        expect(publicPaths.has(url.pathname), href).toBe(true);
    }
  });
  it("labels examples and leaves the hero media under the visitor's control", () => {
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(html).toContain("Illustrative sample");
    expect(html).toContain("No credit card required");
    expect(document.querySelectorAll("video[autoplay]")).toHaveLength(0);
    expect(document.querySelector('[role="tablist"]')).not.toBeNull();
  });
  it("covers every sector in the company industry catalog", () => {
    const prefixes = INDUSTRIES.flatMap((industry) => [...industry.codes]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const industry of NAICS_CODES)
      expect(prefixes, industry.code).toContain(industry.code.slice(0, 2));
    expect(document.querySelectorAll(".bco-industry-track:not([aria-hidden]) .bco-industry-card")).toHaveLength(
      INDUSTRIES.length,
    );
    expect(
      document.querySelector(".bco-industry-directory summary")?.textContent,
    ).toContain("View all industries");
  });
  it("builds confidence with inspectable product evidence, not invented testimony", () => {
    const proof = document.querySelector("#proof")!;
    expect(proof.querySelectorAll("blockquote, .bco-story-card")).toHaveLength(0);
    expect(proof.querySelectorAll(".bco-evidence-grid article")).toHaveLength(3);
    expect(proof.querySelector('video[controls][preload="none"]')).not.toBeNull();
    expect(proof.querySelector('track[kind="captions"]')).not.toBeNull();
    expect(proof.textContent).toContain("redesigned workspace with sample records");
    expect(proof.textContent).toContain("No external sends");
    expect(proof.querySelector('a[href="/security"]')).not.toBeNull();
    expect(proof.querySelector('a[href="/signup?plan=standard"]')).not.toBeNull();
  });
  it("shows the workflow before industries and keeps the hero concise", () => {
    expect(html.indexOf('id="platform"')).toBeLessThan(html.indexOf('id="industries"'));
    const lead = document.querySelector(".bco-hero .bco-lead")?.textContent || "";
    expect(lead.trim().split(/\s+/).length).toBeLessThan(30);
    expect(lead).toContain("final review");
    expect(document.querySelectorAll(".bco-hero .bco-button")).toHaveLength(1);
  });
  it("publishes the same FAQ in visible copy and structured data", () => {
    const { document: schemaDoc } = parseHTML(
      renderToStaticMarkup(<JsonLd {...props} />),
    );
    const schemas = Array.from(schemaDoc.querySelectorAll("script")).map(
      (script) => JSON.parse(script.textContent!),
    );
    const faq = schemas.find((schema) => schema["@type"] === "FAQPage");
    expect(faq.mainEntity.map((entry: { name: string }) => entry.name)).toEqual(
      HOME_FAQ.map(([name]) => name),
    );
    for (const [name] of HOME_FAQ)
      expect(document.textContent || html).toContain(
        name.replace(/&/g, "&amp;"),
      );
  });
});
