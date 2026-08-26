import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every source file under a directory, walked rather than globbed.
 *
 * `globSync` from `node:fs` arrived in Node 22. It works locally and does not
 * exist on the Node 20 that CI runs, so three scanning tests passed here and
 * failed there, which is the worst place to learn it. The repo already had
 * this walk written out in `agent-scoping`, `agent-cadence` and
 * `a11y-coverage`; it lives here now so the next scanning test has something
 * to reach for that is known to run in both places.
 */
const SKIP = new Set(["node_modules", ".next", "dist", ".git", "coverage"]);

export function sourceFiles(
  dir: string,
  extensions: readonly string[] = [".ts", ".tsx"],
  out: string[] = []
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // A directory that does not exist contributes nothing. Callers pass a
    // fixed list of roots, and one of them being absent in a partial checkout
    // should not fail an unrelated assertion.
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, extensions, out);
    else if (extensions.some((e) => entry.endsWith(e))) out.push(path);
  }
  return out;
}
