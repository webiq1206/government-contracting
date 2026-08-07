import { describe, it, expect } from "vitest";
import { checkHardExclusions } from "@/lib/domain/scoring";
import { DEFAULT_PROFILE } from "@/db/seedData";
import type { Opportunity } from "@/lib/types";

/**
 * Production incident guard. Federal solicitations almost never publish an
 * estimated value (SAM only carries an award amount on AWARD notices), so an
 * unknown value must never be treated as "below the minimum". The
 * deterministic checker skips value rules when the figure is absent; the
 * scoring engine separately strips value-based keys the model may return.
 */
function opp(over: Partial<Opportunity>): Opportunity {
  return {
    id: "x",
    naics_code: DEFAULT_PROFILE.naics_codes[0],
    location_state: DEFAULT_PROFILE.service_areas[0],
    set_aside_type: "Total Small Business Set-Aside",
    value_estimated: null,
    deadline: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    description: "Routine grounds maintenance services.",
    title: "Grounds maintenance",
    ...over,
  } as Opportunity;
}

describe("value-based hard exclusions vs unknown value", () => {
  it("does NOT exclude when the value is unpublished", () => {
    const flags = checkHardExclusions(opp({ value_estimated: null }), DEFAULT_PROFILE);
    expect(flags).not.toContain("value_below_min");
    expect(flags).not.toContain("unrestricted_under_threshold");
  });

  it("still excludes a genuinely too-small published value", () => {
    const flags = checkHardExclusions(opp({ value_estimated: 1_000 }), DEFAULT_PROFILE);
    expect(flags).toContain("value_below_min");
  });

  it("accepts a published value inside the target range", () => {
    const flags = checkHardExclusions(opp({ value_estimated: 200_000 }), DEFAULT_PROFILE);
    expect(flags).not.toContain("value_below_min");
  });
});
