import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A total that covers an unknown fraction of its records must say so.
 *
 * Federal notices frequently publish no dollar figure, and `sum()` over a
 * mostly-null column returns a small number that looks authoritative.
 * "Pipeline value $245,600" across 41 opportunities where 39 published
 * nothing is not a small pipeline, it is an unmeasured one, and the two are
 * indistinguishable on screen. Worse, `coalesce(sum(...), 0)` renders the
 * all-null case as a confident $0.
 *
 * The queries therefore carry a count of how many rows actually contributed,
 * and the UI is required to use it.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("value totals disclose their coverage", () => {
  it("counts how many opportunities carry an estimate", () => {
    const src = read("lib/data.ts");
    expect(src, "headline KPI does not report coverage").toMatch(/as pipeline_valued/);
    expect(src, "stage table does not report coverage").toMatch(/count\(value_estimated\)::int as valued/);
  });

  it("never prints a bare $0 for an unmeasured pipeline", () => {
    const page = read("app/(dash)/analytics/page.tsx");
    /*
     * The all-null case must branch away from the currency formatter and say
     * why, rather than formatting zero. Matched on the guard and on a stated
     * reason rather than on one exact sentence: the wording is allowed to
     * improve, and pinning it made this fail for a change that made the card
     * more honest, not less.
     */
    expect(page, "the zero case is not guarded before currency()").toMatch(
      /pipelineValued === 0 \? null : currency\(pipelineValue\)/
    );
    expect(page, "the zero case gives no reason").toMatch(
      /pipelineValued === 0\s*\?\s*"[^"]*publishes? a value/
    );
    expect(page).toMatch(/s\.valued === 0 \? \(/);
  });

  it("tells the reader what fraction the total covers", () => {
    const page = read("app/(dash)/analytics/page.tsx");
    expect(page).toMatch(/that publish one/);
    expect(page).toMatch(/Value known for/);
  });

  it("keeps the caption honest about what the number is", () => {
    // It previously claimed to be "the total estimated value of everything
    // still in play", which is false whenever a notice omits a figure.
    const page = read("app/(dash)/analytics/page.tsx");
    expect(page).not.toMatch(/total\s+estimated value of everything still in play/);
    expect(page).toMatch(/floor rather than a forecast/);
  });
});
