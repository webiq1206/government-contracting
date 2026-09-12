import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const shell = readFileSync("app/simplified-shell.css", "utf8");
const globals = readFileSync("app/globals.css", "utf8");
const landing = readFileSync("components/marketing/landing-page.tsx", "utf8");
const hero = readFileSync("components/marketing/hero-background-video.tsx", "utf8");
const homeCss = readFileSync("components/marketing/homepage-v2.css", "utf8");

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
  it("leads with a concrete AI value proposition and free trial CTA", () => {
    expect(landing).toContain("AI infrastructure for government contractors");
    expect(landing).toContain("BrostCo is an AI platform");
    expect(landing).toContain("Start your free trial");
  });

  it("uses resilient muted looping product motion with reduced-motion fallback", () => {
    expect(hero).toContain("autoPlay");
    expect(hero).toContain("muted");
    expect(hero).toContain("loop");
    expect(hero).toContain("playsInline");
    expect(hero).toContain("prefers-reduced-motion: reduce");
    expect(hero).toContain("/demos/hero-preview.mp4");
    expect(homeCss).toContain("prefers-reduced-motion: reduce");
    expect(homeCss).toContain("/demos/today-desktop.jpg");
  });
});
