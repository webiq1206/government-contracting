/**
 * Today's headline must count work, not the size of a capped query.
 *
 * The original defect: several of Today's queries were capped because they
 * rendered a preview strip as well as feeding a number -- `limit 8`,
 * `limit 10`, `limit 20` -- and passing such a list's `.length` into the work
 * ledger reported the cap. An account with thirty borderline opportunities was
 * told it had ten. A number that is wrong in the safe direction is still a
 * number somebody plans a morning around.
 *
 * The shape has since changed completely. Today no longer assembles eleven
 * bucket counts and hands them to `buildWorkLedger`; it takes one deduplicated
 * list from `workQueue()`, drops what is waiting on somebody else, and counts
 * what is left. The old guard read the arguments of a call that no longer
 * exists, and said so when it failed rather than passing silently, which is
 * the one thing a source-scanning test must get right.
 *
 * The risk did not go away with the call. It moved: the headline is now only
 * as honest as the queries behind `workQueue()`, and a `limit` added to any of
 * them would undercount the headline in exactly the old way, silently. So this
 * guards the new path instead.
 *
 * Read from source rather than mocked, because the defect was never in any
 * function's logic: each function was correct and the wrong one was being
 * called. Only the call site shows that.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = readFileSync(join(process.cwd(), "lib/data.ts"), "utf8");
const TODAY = readFileSync(join(process.cwd(), "app/(dash)/today/page.tsx"), "utf8");

/** The body of `workQueue()`, which is where every headline item comes from. */
function workQueueSource(): string {
  const at = DATA.indexOf("export async function workQueue(");
  if (at === -1) {
    throw new Error("workQueue() moved or was renamed; these guards need updating");
  }
  const next = DATA.indexOf("\nexport ", at + 1);
  return DATA.slice(at, next === -1 ? DATA.length : next);
}

/**
 * The value of a shared SQL fragment, e.g. `TRIAGE_WHERE_SQL`.
 *
 * The queries are assembled from named constants -- `${TRIAGE_WHERE_SQL}`,
 * `${ACTIVE_PURSUIT_SQL}` -- so reading the template literal alone would let a
 * `limit` hide one level down, in a fragment several queries share, where it
 * would be least visible and do the most damage.
 */
function sqlFragment(name: string): string {
  const m = new RegExp(`\\bconst ${name}\\s*=\\s*\`([^\`]*)\``).exec(DATA);
  return m ? m[1] : "";
}

/**
 * The table a query is actually reading, as opposed to one it merely mentions.
 *
 * `outreach_state` was the discriminator once, and it stopped being unique the
 * moment the fragments above were inlined: the call-card query's own filter
 * reaches into `opportunity_subs` too. The first FROM is the row this query
 * returns, which is the thing being asked about.
 */
function mainTable(sql: string): string {
  /*
   * At paren depth zero. Taking the first FROM in the text finds the one
   * inside a correlated subselect in the SELECT list -- the awaiting-reply
   * query reads `communications` that way to get a send time -- and names the
   * wrong table for the row being returned.
   */
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (c === "f" || c === "F")) {
      const m = /^from\s+([a-z_][a-z0-9_]*)/i.exec(sql.slice(i));
      // Only at a word boundary, so "...as from_addr" is not a FROM clause.
      if (m && !/[a-z0-9_]/i.test(sql[i - 1] ?? " ")) return m[1].toLowerCase();
    }
  }
  return "";
}

/** Every SQL literal inside it, with its shared fragments inlined. */
function queueQueries(): string[] {
  const found = [...workQueueSource().matchAll(/`([^`]*)`/g)]
    .map((m) => m[1])
    .filter((q) => /\bselect\b/i.test(q) && /\bfrom\b/i.test(q))
    .map((q) => q.replace(/\$\{(\w+)\}/g, (_, name: string) => ` ${sqlFragment(name)} `));
  if (found.length === 0) {
    throw new Error("no SQL found in workQueue(); these guards need updating");
  }
  return found;
}

describe("the queries behind Today's headline", () => {
  it("caps only the bucket that is not part of the headline", () => {
    /*
     * One legitimate cap. `awaitingReply` is outreach that has gone out and
     * not come back: nothing is wrong and nobody should act, so those rows
     * carry `waitingOn` and `needsYou()` drops them before anything is
     * counted. Capping a list nobody counts costs nothing.
     *
     * A `limit` on any OTHER query is the original bug returning by a new
     * route: the row would be missing from the headline AND from the list,
     * with no sign that the number was a floor rather than a count.
     */
    const capped = queueQueries().filter((q) => /\blimit\s+\d+/i.test(q));
    expect(
      capped.map((q) => q.replace(/\s+/g, " ").trim().slice(0, 80)),
      "only the awaiting-reply query may be capped"
    ).toHaveLength(1);
    expect(mainTable(capped[0])).toBe("opportunity_subs");
  });

  it("still caps that one, so the rule above is guarding something real", () => {
    /*
     * If somebody lifts the limit, the assertion above starts passing for a
     * reason that has nothing to do with the rule and this file becomes
     * folklore. Fail loudly instead, so the comment gets corrected rather
     * than quietly outliving its reason.
     */
    const awaiting = queueQueries().find((q) => mainTable(q) === "opportunity_subs");
    expect(awaiting, "the awaiting-reply query moved").toBeDefined();
    expect(awaiting!).toMatch(/\blimit\s+\d+/i);
  });

  it("keeps that bucket out of the headline by marking it waiting on somebody", () => {
    /*
     * The cap is only harmless while these rows are excluded, and they are
     * excluded because `stateOf()` reads `waitingOn` first. Drop that field
     * and the capped bucket walks straight into the count.
     */
    const src = workQueueSource();
    const at = src.indexOf("...awaitingReply.map");
    expect(at, "the awaiting-reply rows moved").toBeGreaterThan(-1);
    expect(src.slice(at, src.indexOf("})),", at))).toMatch(/waitingOn:\s*\{/);
  });
});

describe("what Today prints", () => {
  it("counts only work that still needs a person", () => {
    // needsYou() first, then the count. Counting the raw queue would put every
    // in-flight quote request into the headline as an action.
    expect(TODAY).toMatch(/needsYou\(queueItems\)/);
    expect(TODAY).toMatch(/queueCounts\(actionable\)/);
    expect(TODAY).toMatch(/totalActions\s*=\s*counts\.total/);
  });

  it("prints that one number and does not recompute it from a rendered list", () => {
    /*
     * The headline, the queue card and the counters were three separate sums
     * once, and they disagreed. Whatever is shown must come from the single
     * total; a `.length` of something the page has already sliced for display
     * is the old defect wearing new clothes.
     */
    const at = TODAY.indexOf("const totalActions");
    expect(at).toBeGreaterThan(-1);
    const line = TODAY.slice(at, TODAY.indexOf("\n", at));
    expect(line).not.toMatch(/\.length/);
  });
});
