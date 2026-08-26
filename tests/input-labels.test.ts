import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A visible label tied to nothing is not a label.
 *
 * The sign-in form rendered "Email" and "Password" above two inputs and
 * associated neither, so a screen reader announced two blank text boxes on the
 * page every customer has to pass through. The first-run setup form had the
 * same defect across four fields. Both looked correct to anyone who could see
 * them, and the accessibility sweep never caught either because it signed in
 * THROUGH that form before it started measuring.
 *
 * The sweep now covers the signed-out pages, which catches this at runtime on
 * the pages it can reach. This catches it in source, including on the three
 * screens it cannot reach without a live token or a fresh install.
 *
 * The rule: a `<label className="label">` with no htmlFor, sitting next to an
 * input, is a failure. Anything else about labelling is the sweep's job, since
 * only a browser can tell whether a name actually resolved.
 */

const ROOTS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", "dist"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * A label element that carries no htmlFor and does not wrap its control.
 *
 * Wrapping is the other valid association, so a `<label>` whose opening tag is
 * followed by an input before its closing tag is fine. Matched over the whole
 * file rather than line by line, because these are usually formatted across
 * several lines.
 */
const BARE_LABEL = /<label(?![^>]*\bhtmlFor=)[^>]*>(?:(?!<\/label>)[\s\S])*?<\/label>/g;

function bareLabels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(BARE_LABEL)) {
    // A label that wraps its own control is correctly associated, whether the
    // control is written inline or passed in as children by a wrapper
    // component.
    if (/<input|<select|<textarea|\{children\}/.test(m[0])) continue;
    out.push(m[0].replace(/\s+/g, " ").slice(0, 90));
  }
  return out;
}

describe("every visible label is tied to its control", () => {
  it("finds no label element without htmlFor that does not wrap its input", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const text = readFileSync(file, "utf8");
        for (const label of bareLabels(text)) offenders.push(`${file}: ${label}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognises the two valid shapes", () => {
    expect(bareLabels('<label htmlFor="x">Email</label>')).toEqual([]);
    expect(bareLabels("<label>Email<input /></label>")).toEqual([]);
    expect(bareLabels("<label>{label}<div>{children}</div></label>")).toEqual([]);
    expect(bareLabels('<label className="label">Email</label>')).toHaveLength(1);
  });
});
