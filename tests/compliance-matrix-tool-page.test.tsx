import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import Page, { metadata } from "@/app/(marketing)/tools/compliance-matrix/page";
import { PUBLIC_ROUTES } from "@/lib/domain/public-routes";

describe("proposal compliance matrix tool page", () => {
  const html = renderToStaticMarkup(<Page />);
  const { document } = parseHTML(html);

  it("answers the title with a concise, specific opening", () => {
    const title = document.querySelector("h1")?.textContent || "";
    const intro = document.querySelector("h1 + p")?.textContent || "";

    expect(title).toBe("Free proposal compliance matrix: 5 fields");
    expect(title.length).toBeGreaterThanOrEqual(30);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(intro.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(60);
    expect(intro).toContain("BrostCo");
    expect(intro).toContain("5 fields");
    expect(intro).toContain("100 rows");
  });

  it("keeps metadata, schema and public inventory aligned", () => {
    const schemas = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    ).flatMap((script) => JSON.parse(script.textContent || "")["@graph"] || []);
    const application = schemas.find((schema) => schema["@type"] === "WebApplication");
    const breadcrumb = schemas.find((schema) => schema["@type"] === "BreadcrumbList");
    const route = PUBLIC_ROUTES.find((item) => item.path === "/tools/compliance-matrix");

    expect(metadata.title).toBe("Free proposal compliance matrix: 5 fields");
    expect(String(metadata.description).length).toBeGreaterThanOrEqual(120);
    expect(String(metadata.description).length).toBeLessThanOrEqual(155);
    expect(application?.name).toBe("Free proposal compliance matrix: 5 fields");
    expect(application?.description).toContain("5 fields per requirement");
    expect(breadcrumb?.itemListElement).toHaveLength(3);
    expect(route?.summary).toContain("100 rows as CSV");
    expect(route?.lastModified).toBe("2026-10-20");
  });
});
