/**
 * Regression guard: nothing inside a scrolling page area should add its own
 * tab-bar clearance.
 *
 * The app shell (.page-main) reserves the space once for all pages:
 *   padding-bottom: calc(4rem + env(safe-area-inset-bottom, 0px))   (mobile)
 *   padding-bottom: 0                                                (≥ md)
 *
 * A sticky bar inside the scroll area that also sets bottom-16 (4rem) on
 * mobile parks itself 8rem above the bottom edge — in the middle of the form
 * rather than at its foot. The correct value for a bar that should sit at the
 * foot of a scrollable section is bottom-0, because the shell already cleared
 * the tab bar above it.
 *
 * Fixed elements that float above the tab bar (BulkActionBar, the tab bar
 * itself, contact popovers, Guide Me) are pinned to the *screen*, not a
 * scroll area, so they keep their own clearance and are not flagged here.
 *
 * If you need a sticky bar that genuinely must sit at a non-zero offset, add
 * its path to KNOWN_EXCEPTIONS below with a comment explaining why.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const ROOT = process.cwd();

/** Directories that contain components rendered inside .page-main. */
const SCAN_DIRS = ["app/(dash)", "app/(account)", "components"];

/**
 * Matches `sticky` followed (anywhere on the same className string up to the
 * closing delimiter) by `bottom-16`. Covers both:
 *   - `sticky bottom-16`
 *   - `sticky ... bottom-16 ... md:bottom-0`  (the broken pattern: still 4rem
 *     on mobile even though md overrides it, which proves the intent was to
 *     clear the tab bar twice)
 */
const STICKY_BOTTOM_16 = /sticky[^"'`]*bottom-16/;

/** Files with a documented reason why they are exempt. */
const KNOWN_EXCEPTIONS: string[] = [
  // none yet — add as "relative/path/from/workspace/root" with a comment
];

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  try {
    return readdirSync(abs).flatMap((entry) => {
      const full = join(abs, entry);
      const rel = join(dir, entry);
      return statSync(full).isDirectory() ? walk(rel) : [rel];
    });
  } catch {
    return [];
  }
}

const files = SCAN_DIRS.flatMap(walk).filter(
  (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes(".test.")
);

describe("no double tab-bar offset inside scrolling page areas", () => {
  it("finds no sticky element that re-clears the tab bar height (bottom-16)", () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const rel of files) {
      if (KNOWN_EXCEPTIONS.includes(rel)) continue;

      const src = readFileSync(join(ROOT, rel), "utf8");
      src.split("\n").forEach((line, idx) => {
        if (STICKY_BOTTOM_16.test(line)) {
          violations.push({ file: rel, line: idx + 1, text: line.trim() });
        }
      });
    }

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.text}`)
        .join("\n");

      expect.fail(
        `Found ${violations.length} sticky element(s) that offset by the tab-bar height (bottom-16).\n\n` +
          `The app shell (.page-main) already reserves tab-bar space on mobile, so\n` +
          `a sticky bar inside a scrolling area must use bottom-0 instead.\n\n` +
          report
      );
    }
  });
});
