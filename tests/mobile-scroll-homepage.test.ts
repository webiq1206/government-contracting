import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shell = readFileSync("app/simplified-shell.css", "utf8");
const globals = readFileSync("app/globals.css", "utf8");
const landing = readFileSync("components/marketing/landing-page.tsx", "utf8");

const homeCss = readFileSync("components/marketing/site.css", "utf8");

describe("mobile dashboard scrolling", () => {
  it("overrides the legacy authenticated html/body lock with document scrolling", () => {
    expect(globals).toContain("html:has([data-app-shell])");
    expect(shell).toContain("html:has([data-app-shell]) body");
    expect(shell).toContain("overflow-y: auto");
    expect(shell).toContain("height: auto");
  });

  it("does not make page main or page shell a vertical mobile scroll trap", () => {
    expect(shell).toContain("[data-app-shell] .page-main");
    expect(shell).toContain("overflow-y: visible !important");
    expect(shell).toContain("[data-app-shell] .page-shell");
    expect(shell).toContain("overflow: visible !important");
  });
});

describe("AI-first homepage", () => {
  it("leads with the audience, concrete outcome, and free trial CTA", () => {
    expect(landing).toContain("AI Government Procurement Platform");
    expect(landing).toContain("AI that finds government contracts");
    expect(landing).toContain("and prepares your bids.");
    expect(landing).toContain("Start free trial");
  });
  it("uses an on-demand product illustration and reduced-motion transitions", () => {
    expect(landing).toContain("bco-hero-centered");
    expect(landing).toContain("HeroBackgroundVideo");
    expect(landing).toContain("WorkflowDemo");
    expect(homeCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
