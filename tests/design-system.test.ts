/**
 * The parts of docs/design-system.md a machine can hold.
 *
 * Written conventions decay. The ones that survive are the ones something
 * fails on, which is why the em-dash rule outlived every other style note in
 * this repository. These are the design-system rules that can be checked
 * statically and are worth checking: spacing off the scale, raw colours that
 * dodge the theme, and font sizes that break the hierarchy.
 *
 * Contrast, focus order and touch-target size are deliberately NOT here. They
 * depend on what actually renders, a static scan of them produces confident
 * nonsense, and scripts/a11y-sweep.ts measures them in a browser instead.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["app", "components"];
/** Theme QA renders deliberate extremes; marketing is its own visual system. */
const SKIP = /theme-qa|components\/marketing|\.test\.tsx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => walk(join(process.cwd(), r))).filter((f) => !SKIP.test(f));

function scan(re: RegExp): string[] {
  const hits: string[] = [];
  for (const file of FILES) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        for (const m of line.matchAll(re)) {
          hits.push(`${relative(process.cwd(), file)}:${i + 1} ${m[0]}`);
        }
      });
  }
  return hits;
}

describe("the design system holds", () => {
  it("has files to scan", () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it("keeps spacing on the 4/8/12/16/24/32 scale", () => {
    /*
     * One exception, documented: a decorative connector aligned to the optical
     * centre of the node beside it, where the correct number is dictated by
     * that node rather than by the scale. Forcing it onto the scale would
     * misalign the line, which is a worse outcome than an off-scale value.
     */
    const ALLOWED = new Set(["components/pipeline-strip.tsx:145 mt-[21px]"]);
    const hits = scan(/\b[pm][xytblr]?-\[[0-9.]+(?:px|rem)\]/g).filter((h) => !ALLOWED.has(h));
    expect(hits).toEqual([]);
  });

  it("does not write raw colours that dodge the theme", () => {
    /*
     * A hex or a stock Tailwind palette colour cannot swap between light and
     * dark, so it survives the theme toggle as a stain. `text-emerald-700` for
     * success and `bg-amber-500` for a warning were doing exactly that, beside
     * `text-risk` doing the same job correctly two lines away.
     *
     * The one exception is the browser-chrome theme colour in the root
     * layout's metadata: that is consumed by the operating system, not by CSS,
     * so it cannot be a variable and has to state both values literally.
     */
    const ALLOWED = new Set(["app/layout.tsx:48 #f1ece3", "app/layout.tsx:49 #090a09"]);
    const hits = scan(
      /(?:text|bg|border)-(?:red|green|blue|yellow|orange|purple|pink|indigo|teal|cyan|emerald|lime|amber|rose|violet|fuchsia|sky|stone|zinc|neutral|gray)-\d{2,3}\b|#[0-9a-fA-F]{6}\b/g
    ).filter((h) => !ALLOWED.has(h));
    expect(hits).toEqual([]);
  });

  it("keeps application type at or below text-4xl", () => {
    /*
     * The cap, not a ban. `text-3xl` and `text-4xl` earn their place on the
     * one hero element a screen is allowed: the day's greeting, a bid cover
     * page, a single readiness figure. Above that the type stops being a
     * hierarchy level and starts being decoration, and on a phone it costs a
     * line of actual content.
     *
     * An earlier draft of this rule banned 3xl outright and would have forced
     * six deliberate hero elements down a level to satisfy a rule invented
     * after they were built.
     */
    const hits = scan(/\btext-(?:6xl|7xl|8xl|9xl)\b/g);
    expect(hits).toEqual([]);
  });

  it("reserves the very large sizes for a lone figure", () => {
    /*
     * Above text-4xl the only thing that still reads well is a number on its
     * own: the count on Today, the 404. Those are data displays, not a
     * hierarchy level, and they are marked as such by `.num` -- which is also
     * what gives them tabular numerals.
     *
     * Checked as "the same element or its child carries num" rather than by
     * exempting the two files, so a third one has to earn it the same way.
     */
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (!/\btext-(?:5xl|6xl|7xl|8xl|9xl)\b/.test(line)) return;
        // The figure may sit on this element or on a span just inside it.
        const window = lines.slice(i, i + 3).join(" ");
        if (!/\bnum\b/.test(window)) {
          offenders.push(`${relative(process.cwd(), file)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
