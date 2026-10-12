import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { ContractorGuidePage } from "@/components/marketing/contractor-guide";
import { PUBLIC_ROUTES } from "@/lib/domain/public-routes";

describe("proposal compliance matrix guide", () => {
  const html = renderToStaticMarkup(
    <ContractorGuidePage slug="proposal-compliance-matrix" />,
  );
  const { document } = parseHTML(html);

  it("answers the title with a concise, specific opening", () => {
    const title = document.querySelector("h1")?.textContent || "";
    const intro = document.querySelector("h1 + p")?.textContent || "";

    expect(title).toBe("Proposal compliance matrix: 8 core columns");
    expect(title.length).toBeGreaterThanOrEqual(30);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(intro.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(60);
    expect(intro).toContain("proposal compliance matrix");
    expect(intro).toContain("8 core columns");
  });

  it("keeps visible copy, Article schema and sitemap dates aligned", () => {
    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).flatMap((script) => JSON.parse(script.textContent || "")["@graph"] || []);
    const article = schemas.find((schema) => schema["@type"] === "Article");
    const route = PUBLIC_ROUTES.find(
      (item) => item.path === "/resources/proposal-compliance-matrix",
    );

    expect(html).toContain("Updated October 12, 2026");
    expect(html).toContain("Source links checked September 26, 2026");
    expect(article?.headline).toBe("Proposal compliance matrix: 8 core columns");
    expect(article?.dateModified).toBe("2026-10-12");
    expect(route?.lastModified).toBe("2026-10-12");
  });
});
