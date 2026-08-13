import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * House rule: no em dash (or en dash) ever reaches the screen or an email.
 *
 * Scanning source is what makes this stick. The rule kept being re-broken by
 * new copy because the only enforcement was a runtime sanitiser that literal
 * strings bypass, and by seed data whose text is copied into the database
 * once and then never re-read from the file.
 *
 * Code comments are exempt: they are never rendered.
 */
const ROOTS = ["app", "components", "lib", "db"];
const EXTS = [".ts", ".tsx", ".sql"];
// Files whose whole job is to talk about dashes.
const EXEMPT = new Set(["lib/sanitize.ts"]);
const EXEMPT_DIRS = ["lib/api-zod/dist", "node_modules"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (EXEMPT_DIRS.some((d) => full.includes(d))) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

/** Strip // line comments, block comments, and JSX {/* … *​/} comments. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, ""); // SQL comments
}

describe("no em dashes in anything a person can read", () => {
  it("has no em/en dash in source outside comments", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const rel = file.replace(/\\/g, "/");
        if (EXEMPT.has(rel)) continue;
        // Migrations that exist specifically to REMOVE dashes must contain
        // them in their regex patterns.
        if (/db\/migrations\/\d+_.*emdash.*\.sql$/.test(rel)) continue;
        const body = stripComments(readFileSync(file, "utf8"));
        body.split("\n").forEach((line, i) => {
          if (/[—–]/.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
        });
      }
    }
    expect(offenders, `em/en dashes found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
