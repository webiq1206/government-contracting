import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { LandingPage } from "@/components/marketing/landing-page";
import { HOME_SECTIONS, PUBLIC_ROUTES } from "@/lib/domain/public-routes";
import { JsonLd } from "@/components/marketing/json-ld";
import { HOME_FAQ } from "@/components/marketing/site-content";
const props = {
  promoActive: false,
  promoEndsAt: null,
  standardMonthly: 1997,
  foundingMonthly: 497,
  signupHref: "/signup?plan=standard",
};
const html = renderToStaticMarkup(<LandingPage {...props} />);
const { document } = parseHTML(html);
describe("public visitor journey", () => {
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
