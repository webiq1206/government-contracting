import { describe, it, expect } from "vitest";
import { flagLabel, flagSummary } from "@/lib/flag-labels";

describe("flagLabel", () => {
  it("uses friendly overrides where defined", () => {
    expect(flagLabel("naics_not_in_active_list")).toBe("NAICS not in your list");
    expect(flagLabel("out_of_service_area")).toBe("Outside your service area");
    expect(flagLabel("value_over_max")).toBe("Value over your ceiling");
  });
  it("humanizes unknown keys generically", () => {
    expect(flagLabel("some_new_flag")).toBe("Some new flag");
  });
  it("labels stalled-stage flags with plain-English descriptions", () => {
    expect(flagLabel("stalled_sub_research")).toBe("Stuck finding subs");
    expect(flagLabel("stalled_outreach")).toBe("Stalled: no sub replies");
  });
});

describe("flagSummary", () => {
  it("joins a short list with middots", () => {
    expect(flagSummary(["deadline_too_soon", "value_over_max"])).toBe(
      "Deadline too soon · Value over your ceiling"
    );
  });
  it("truncates a long list with +N more", () => {
    const many = [
      "value_above_target_range",
      "naics_not_in_active_list",
      "missing_scope_of_work",
      "missing_solicitation_number",
      "no_submission_instructions",
    ];
    const out = flagSummary(many, 3);
    expect(out).toBe(
      "Value above target range · NAICS not in your list · Missing scope of work · +2 more"
    );
  });
  it("empty list → empty string", () => {
    expect(flagSummary([])).toBe("");
  });
});
