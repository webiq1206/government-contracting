/**
 * Artwork that swaps with the theme must keep its name in both themes.
 *
 * `ThemeWordmark` renders the light-theme and dark-theme marks as two images
 * and lets CSS show one. The name lived only on the light-theme image, so in
 * dark mode `display: none` took the name out of the accessibility tree with
 * it and the wordmark had no accessible name at all.
 *
 * That is the brand link in the nav and the only <h1> on every signed-out
 * page -- login, signup, both password flows, setup, invite, the vendor
 * portal. A screen-reader user in dark mode met an unnamed heading on the
 * first page of the product.
 *
 * The accessibility sweep could not catch it: its dark pass reports contrast
 * only, on the reasoning that accessible names do not change with the theme.
 * They do when the artwork is theme-swapped. This test covers that specific
 * gap, statically, so it holds without a browser and without a second full
 * sweep pass.
 *
 * The rule is not "every image must have alt". It is narrower and it is the
 * one that broke: within a component that renders theme-swapped variants,
 * EVERY variant must be named, because any of them may be the only one in the
 * tree.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full.includes("node_modules") || full.includes("/.next")) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** One <img ... /> tag, whole. */
const IMG = /<img\b[\s\S]*?\/>/g;
/** Shown only in dark, or hidden in dark: the theme-swap signature. */
const THEME_SWAPPED = /dark:hidden|dark:block|dark:inline/;

function altOf(tag: string): string | null {
  const m = tag.match(/\balt=(?:"([^"]*)"|\{([^}]*)\})/);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}
function isAriaHidden(tag: string): boolean {
  return /\baria-hidden(?:\s|=\{?true\}?|=("true")|\/|>)/.test(tag);
}

describe("theme-swapped artwork keeps its accessible name", () => {
  const files = [...walk("components"), ...walk("app")];

  it("finds the components it is supposed to be checking", () => {
    // A guard on the guard: if the scan stops matching, every assertion below
    // would pass while measuring nothing.
    const swapped = files.flatMap((f) =>
      (readFileSync(f, "utf8").match(IMG) ?? []).filter((t) => THEME_SWAPPED.test(t))
    );
    expect(swapped.length, "no theme-swapped images found; the scan is broken").toBeGreaterThan(0);
  });

  it("names every theme variant, so neither theme loses the name", () => {
    const unnamed: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const tag of src.match(IMG) ?? []) {
        if (!THEME_SWAPPED.test(tag)) continue;
        const alt = altOf(tag);
        if (isAriaHidden(tag) || alt === null || alt.trim() === "") {
          const src9 = (tag.match(/src="([^"]*)"/) ?? [])[1] ?? "?";
          unnamed.push(
            `${file}: theme-swapped <img src="${src9}"> is ${
              isAriaHidden(tag) ? "aria-hidden" : `alt=${JSON.stringify(alt)}`
            }; the other theme then has no accessible name`
          );
        }
      }
    }
    expect(unnamed, unnamed.join("\n  ")).toEqual([]);
  });
});
