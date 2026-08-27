import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `window.confirm` is not the final interface for anything in this product.
 *
 * The native dialog is tempting and wrong for three separate reasons.
 *
 * It cannot say what the action costs. It takes one string, so a question that
 * needs a count, a list of what is kept, or a warning about what cannot be
 * recalled gets flattened into a sentence, and the operator agrees to a word
 * rather than to an outcome.
 *
 * It cannot be made to belong to the record it is about. On a phone it appears
 * at the top of the viewport attached to the origin, which is the browser's
 * identity rather than the product's.
 *
 * And it blocks the main thread, so nothing behind it can load, update or
 * announce anything while it is open.
 *
 * Ten call sites were converted at once. This exists so the eleventh cannot be
 * added quietly: a reviewer will not spot one `window.confirm` in a large
 * diff, and it is exactly the shortcut somebody reaches for at the end of a
 * long change.
 */

const ROOTS = ["components", "app"];
const SKIP = new Set(["node_modules", ".next", "dist"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
      yield full;
    }
  }
}

/**
 * Comments are stripped before matching.
 *
 * Half a dozen files explain in prose why they do NOT use `window.confirm`,
 * and a check that failed on those would be one somebody deletes rather than
 * satisfies.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

describe("the browser's own dialogs", () => {
  it("are never the final interface", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = code(readFileSync(file, "utf8"));
        if (/\bwindow\.(confirm|alert|prompt)\s*\(/.test(src)) {
          offenders.push(file);
        }
      }
    }
    expect(offenders, `use ConfirmDialog instead: ${offenders.join(", ")}`).toEqual([]);
  });

  it("catches a bare confirm() call as well as a qualified one", () => {
    // `confirm("...")` is the same global with the object left off, and it is
    // how three of the ten converted call sites were written.
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const src = code(readFileSync(file, "utf8"));
        // A bare call, not a property access and not a prop or variable named
        // `confirm` being read.
        if (/(^|[^.\w$])confirm\s*\(\s*["'`]/.test(src)) offenders.push(file);
      }
    }
    expect(offenders, `use ConfirmDialog instead: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("the dialog that replaced them", () => {
  it("traps focus, restores it, and closes on Escape", () => {
    const src = readFileSync("components/confirm-dialog.tsx", "utf8");
    // Each of these is one line and each is the line that makes the dialog
    // usable without a mouse. All three look like decoration in a diff.
    expect(src).toContain('aria-modal="true"');
    expect(src).toContain('role="dialog"');
    expect(src).toContain('e.key === "Escape"');
    // The half people forget: focus going back where it came from.
    expect(src).toContain("opener.current?.focus?.()");
  });

  it("names the act rather than saying OK", () => {
    const src = readFileSync("components/confirm-dialog.tsx", "utf8");
    expect(src).toContain("confirmLabel");
  });
});
