import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextualQuestion } from "@/components/contextual-question";
import { ProductVideo } from "@/components/marketing/product-video";
import { activityFilterLabels } from "@/lib/domain/activity-filters";
import { GUIDE_ASK_SYSTEM } from "@/lib/domain/guide-ask";
const css = readFileSync("app/globals.css", "utf8");
function luminance(rgb: number[]) {
  return rgb.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; })
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
function contrast(a: number[], b: number[]) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
function token(block: string, name: string) {
  const value = block.match(new RegExp(`--${name}:\\s*(\\d+) (\\d+) (\\d+)`));
  if (!value) throw new Error(`Missing ${name}`);
  return value.slice(1).map(Number);
}
describe("approved BrostCo semantic system", () => {
  const light = css.slice(css.indexOf(":root"), css.indexOf('.dark {'));
  it("keeps Petrol, not Brass or Aqua, as the action color", () => {
    expect(css).toContain("--action: 14 111 117");
    expect(css).toContain("--automation: 107 174 170");
    expect(css).toContain("--attention: 200 156 67");
    expect(css.match(/\.btn-primary\s*\{[^}]+/s)?.[0]).toContain("--action");
  });
  it("keeps the shared button group intact", () => {
    expect(css).toMatch(/\.btn,\s*\.btn-primary,\s*\.btn-ghost,\s*\.btn-danger,\s*\.btn-success\s*\{[^}]*min-h-11/s);
  });
  it("keeps dark text and input boundaries readable", () => {
    const dark = css.slice(css.indexOf(".dark {"), css.indexOf("html,"));
    for (const surface of ["background", "surface"]) {
      expect(contrast(token(dark, "foreground"), token(dark, surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(dark, "muted-foreground"), token(dark, surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(dark, "control-border"), token(dark, surface))).toBeGreaterThanOrEqual(3);
    }
  });
  it("keeps small essential text readable on the light surfaces", () => {
    for (const surface of ["background", "surface"]) {
      expect(contrast(token(light, "foreground"), token(light, surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(light, "muted-foreground"), token(light, surface))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token(light, "control-border"), token(light, surface))).toBeGreaterThanOrEqual(3);
    }
  });
  it("keeps primary and destructive button labels readable", () => {
    expect(contrast([14,111,117], [255,255,255])).toBeGreaterThanOrEqual(4.5);
    expect(contrast([163,58,49], [255,255,255])).toBeGreaterThanOrEqual(4.5);
  });
  it("uses the approved type families and reduced motion", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("family=Inter");
    expect(readFileSync("app/layout.tsx", "utf8")).toContain("family=Manrope");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
describe("visible ledger constraints", () => {
  it("does not mistake pagination or default sorting for filters", () => {
    expect(activityFilterLabels({ page: "2", pageSize: "25", sort: "newest", format: "csv" })).toEqual([]);
  });
  it("distinguishes draft and sent records and preserves typed search text", () => {
    expect(activityFilterLabels({ status: "draft", q: "Example@Company.com", page: "1" })).toEqual([
      { key: "status", label: "Status: Draft" }, { key: "q", label: "Search: Example@Company.com" },
    ]);
    expect(activityFilterLabels({ status: "sent" })[0].label).toBe("Status: Sent");
  });
  it("shows attention and non-default ordering", () => {
    expect(activityFilterLabels({ attention: "1", sort: "oldest" })).toEqual([
      { key: "attention", label: "Needs attention" }, { key: "sort", label: "Oldest first" },
    ]);
  });
});
describe("contextual help and media", () => {
  it("does not generate AI requests on render or imply an outbound action", () => {
    const markup = renderToStaticMarkup(<ContextualQuestion path="/opportunity/example" />);
    expect(markup).toContain("Ask about this opportunity");
    expect(markup).toContain("Read only");
    expect(markup).toContain("never sends messages or submits a bid");
    expect(markup).toContain('maxLength="500"');
  });
  it("bounds AI answers to facts instead of fabricating document review or completed work", () => {
    expect(GUIDE_ASK_SYSTEM).toContain("read-only");
    expect(GUIDE_ASK_SYSTEM).toContain("not completed actions");
    expect(GUIDE_ASK_SYSTEM).toContain("not the full source files");
    expect(GUIDE_ASK_SYSTEM).toContain("untrusted");
  });
  it("provides captions, transcript fallback, native controls, and no autoplay", () => {
    const markup = renderToStaticMarkup(<ProductVideo slug="pipeline" poster="/demos/pipeline-desktop.jpg" title="Find opportunities" />);
    expect(markup).toContain('controls=""');
    expect(markup).toContain('kind="captions"');
    expect(markup).toContain('preload="none"');
    expect(markup).toContain('/demos/pipeline.txt');
    expect(markup.toLowerCase()).not.toContain("autoplay");
  });
});
