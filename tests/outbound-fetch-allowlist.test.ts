import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * One place fetches URLs this platform did not choose.
 *
 * Solicitation attachment links, subcontractor websites, prospect homepages:
 * all of them arrive as data, from SAM.gov notices, from search results, from
 * an operator typing into a field. A bare `fetch()` on any of them points a
 * process holding every credential this platform has at an address a stranger
 * picked, follows redirects to wherever it is sent, and pulls the whole
 * response into memory before asking how big it is.
 *
 * lib/integrations/guarded-fetch.ts is the answer to all three. This test is
 * what keeps it the only answer.
 *
 * It exists because a second implementation is how the last hole survived:
 * email-scrape.ts carried its own SSRF guard whose IPv6 branch tested the
 * spelling `::ffff:127.0.0.1` when URL parsing had already rewritten it to
 * `::ffff:7f00:1`. It returned true for the cloud metadata endpoint. Two
 * copies of a rule means one of them is wrong and nobody knows which, so the
 * rule is now: server code calls fetch here, or it is named below with its
 * reason.
 */

/** Server-side directories. Browser code talks to our own origin. */
const ROOTS = ["lib", "app/api", "worker", "scripts"];

const ALLOWED = new Map<string, string>([
  [
    "lib/integrations/guarded-fetch.ts",
    "The guard itself. Something has to make the actual request.",
  ],
  [
    "lib/integrations/http.ts",
    "fetchJson, used only for provider endpoints this codebase names as constants (Anthropic, SAM, BLS, USAspending). No caller passes it a URL that came from outside.",
  ],
  [
    "lib/integration-validators.ts",
    "Connection tests against provider endpoints written as constants here. The one exception is the Supabase URL, which an operator types into their own settings and which must be allowed to reach their own host: that is a URL the account chose, not one a notice supplied.",
  ],
  [
    "lib/agents/compliance-monitor.ts",
    "The FAR rule-change feed, a constant in this file.",
  ],
  [
    "lib/integrations/website-finder.ts",
    "The search endpoint, a constant in this file. Every result it finds is then fetched through safeFetchPage, which is guarded.",
  ],
  [
    "lib/client-analytics.ts",
    "Runs in the browser and posts to /api/analytics on this same origin.",
  ],
  [
    "scripts/a11y-sweep.ts",
    "Signs in to the local server this script started. The URL is this process's own.",
  ],
  [
    "scripts/perf-sweep.ts",
    "Measures the local server this script started. The URL is this process's own.",
  ],
]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Strip comments so a fetch described in prose is not read as a fetch made. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("outbound fetch", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("finds the server files to check", () => {
    // A scan that silently covers nothing passes forever.
    expect(files.length).toBeGreaterThan(100);
  });

  it("happens through the guard, or is named here with a reason", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const body = code(readFileSync(file, "utf8"));
      if (!/(?<![.\w])fetch\s*\(/.test(body)) continue;
      if (!ALLOWED.has(file)) offenders.push(file);
    }
    expect(offenders, `these call fetch directly: ${offenders.join(", ")}`).toEqual([]);
  });

  it("keeps the allowlist honest: every entry still calls fetch", () => {
    // An entry that stops being true is an exemption nobody is watching.
    const stale: string[] = [];
    for (const file of ALLOWED.keys()) {
      let body: string;
      try {
        body = code(readFileSync(file, "utf8"));
      } catch {
        stale.push(`${file} (gone)`);
        continue;
      }
      if (!/(?<![.\w])fetch\s*\(/.test(body)) stale.push(`${file} (no longer calls fetch)`);
    }
    expect(stale, `stale allowlist entries: ${stale.join(", ")}`).toEqual([]);
  });

  it("gives a reason for every exemption", () => {
    for (const [file, reason] of ALLOWED) {
      expect(reason.length, `${file} has no reason`).toBeGreaterThan(40);
    }
  });
});
