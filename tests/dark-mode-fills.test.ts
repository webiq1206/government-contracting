/**
 * Nothing may put white on a status fill.
 *
 * The status tokens lighten in dark mode so they can carry text on a dark
 * page, which is correct and is why they exist. It breaks anything using one
 * as a FILL under white type: `bg-pursue text-white` measures 5.75:1 in light
 * and 2.88:1 in dark, and those are the Pursue and Pass buttons, the two most
 * important controls in the product.
 *
 * Nothing had measured it because the accessibility sweep only ever ran the
 * light theme. It now runs both, and the first dark pass returned 23 findings
 * on a run that had been reporting 0.
 *
 * `--on-status` is the foreground for a status fill and flips with it: white
 * in light, ink in dark. This scan is here because the failure is invisible
 * to anybody working in light mode, which is most of the time.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, globSync } from "node:fs";

/** Tokens whose value differs between the two themes. */
const FLIPPING_FILLS = ["pursue", "risk", "review", "accent"];

describe("text on a status fill", () => {
  it("never hard-codes white", () => {
    const offenders: string[] = [];
    for (const file of [...globSync("components/**/*.tsx"), ...globSync("app/**/*.tsx")]) {
      // The marketing pages paint their own dark hero and do not use the
      // operator palette, so their white-on-dark is deliberate and stable.
      if (file.includes("/marketing/")) continue;
      const src = readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        if (!/text-white(\/\d+)?\b/.test(line)) continue;
        for (const fill of FLIPPING_FILLS) {
          // Same className string: a fill and a hard white foreground.
          if (new RegExp(`bg-${fill}(-strong)?\\b`).test(line)) {
            offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses the token in the two button classes", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("bg-risk text-on-status");
    expect(css).toContain("bg-pursue text-on-status");
  });

  it("defines the token in both themes", () => {
    /*
     * A token defined only in light would resolve to nothing in dark and
     * inherit whatever was above it, which is a subtler version of the same
     * bug.
     */
    const css = readFileSync("app/globals.css", "utf8");
    expect(css.match(/--on-status:/g)?.length).toBe(2);
  });

  it("is exposed to Tailwind, or the class silently does nothing", () => {
    const cfg = readFileSync("tailwind.config.ts", "utf8");
    expect(cfg).toContain('"on-status": "rgb(var(--on-status)');
  });
});

describe("the sweep that would have caught it", () => {
  it("measures both themes", () => {
    const sweep = readFileSync("scripts/a11y-sweep.ts", "utf8");
    expect(sweep).toContain('const THEMES = ["light", "dark"]');
    // The class, not just the media query: the theme provider writes a class
    // and remembers the choice, so a page loaded without it renders light
    // whatever prefers-color-scheme says.
    expect(sweep).toContain('classList.add("dark")');
  });
});
