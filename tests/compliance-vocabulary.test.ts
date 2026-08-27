import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { COMPLIANCE_STATES } from "@/lib/domain/compliance-state";

/**
 * The vocabulary existed as SQL string literals in six places across five
 * files, and nothing tied them together.
 *
 * When it changed, three of those were missed, and every one of them failed
 * silently: a `status in ('warning','critical','blocked')` clause against rows
 * that now say `expired` matches nothing, so the Today counter, the guide
 * pulse and the action centre each reported zero compliance alerts on an
 * account with a lapsed registration. A wrong number is worse than an error,
 * because nobody goes looking for it.
 */

const OLD = ["'ok'", "'warning'", "'critical'", "'resolved'"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !p.includes("api-zod") && !p.includes("api-client")) out.push(p);
  }
  return out;
}

describe("the compliance vocabulary, everywhere it is written", () => {
  const files = ["lib", "app", "components"].flatMap((d) => walk(join(process.cwd(), d)));

  it("has no query still filtering compliance rows on the old severities", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      /*
       * Only compliance filters. job_runs and several other tables have a
       * `status` column with a vocabulary of their own, and `('ok','error')`
       * on a job run is correct.
       */
      const re = /(status_override|compliance)[^;]{0,200}?status[^\n]{0,80}in \(([^)]*)\)/gs;
      for (const m of src.matchAll(re)) {
        const list = m[2];
        if (OLD.some((w) => list.includes(w))) {
          offenders.push(`${f.replace(process.cwd() + "/", "")}: ${m[0].slice(0, 90)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the database constraint and the module in step", () => {
    const sql = readFileSync(
      join(process.cwd(), "db/migrations/091_compliance_fields_and_history.sql"),
      "utf8"
    );
    for (const state of COMPLIANCE_STATES) {
      expect(sql).toContain(`'${state}'`);
    }
  });

  it("has no user-facing label anywhere that still says On track", () => {
    /*
     * A page-local label map is how "On track" survived being banned once
     * already: nothing that checked the approved terminology could see it.
     * The occurrences left are comments explaining its removal, which is
     * why this looks for it in quotes rather than anywhere in the file.
     */
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes("domain/terminology.ts")) continue; // the ban list itself
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/["'`]([^"'`\n]*On track[^"'`\n]*)["'`]/g)) {
        offenders.push(`${f.replace(process.cwd() + "/", "")}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
