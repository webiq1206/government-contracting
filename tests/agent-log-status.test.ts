/**
 * An error an agent logs has to reach the Automation Health page.
 *
 * `automation-status` classifies each run by its `status` column, not its
 * `level`: `status: r.status === "error" ? "error" : "ok"`. `logAgent`
 * defaults status to "ok". So seven logs written at `level: "error"` were
 * counted as healthy runs, including a failed Gmail poll, a failed per-account
 * run of the opportunity monitor, and all four passes of the concession
 * sweep. The operator opens Automation Health precisely to find out whether
 * anything is broken, and those were the things that were broken.
 *
 * Discovered by scanning rather than by reading, which is why the scan is the
 * test: the pairing is easy to leave out and impossible to see at the call
 * site.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFiles } from "./helpers/source-files";

const FILES = [...sourceFiles("lib", [".ts"]), ...sourceFiles("app", [".ts"])];

describe("error logs and the health page", () => {
  it("every level error also sets status error", () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/logAgent\(\{(.*?)\}\)/gs)) {
        const body = m[1];
        if (!/level:\s*"error"/.test(body)) continue;
        if (/status:\s*"error"/.test(body)) continue;
        const action = /action:\s*[`"]([^`"]+)/.exec(body)?.[1] ?? "?";
        offenders.push(`${file} action=${action}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still reads status as the field that decides, so the rule stays true", () => {
    /*
     * If automation-status ever classifies on level instead, this whole
     * pairing becomes unnecessary and should be dropped rather than kept
     * because it is already written.
     */
    const status = readFileSync("lib/automation-status.ts", "utf8");
    expect(status).toContain('r.status === "error"');
  });

  it("leaves warn alone", () => {
    // A warning is not a failed run, and health is a binary. Forcing warns to
    // status error would fill the page with things that are working.
    const logger = readFileSync("lib/logger.ts", "utf8");
    expect(logger).toContain('entry.status ?? "ok"');
  });
});
