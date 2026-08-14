import { describe, it, expect } from "vitest";
import { computeSetupChecklist, type SetupInputs } from "@/lib/domain/setup";

const allOff: SetupInputs = {
  profile: null,
  integrations: { sam: false, claude: false, googleMaps: false, gmail: false },
};

const allOn: SetupInputs = {
  profile: {
    uei: "ABC123",
    cage_code: "1A2B3",
    naics_codes: ["561720"],
    service_areas: ["Idaho"],
    certifications: ["Small Business"],
  },
  integrations: { sam: true, claude: true, googleMaps: true, gmail: true },
};

describe("computeSetupChecklist", () => {
  it("has 8 steps", () => {
    expect(computeSetupChecklist(allOff).total).toBe(8);
  });

  it("counts nothing done for an empty setup", () => {
    const c = computeSetupChecklist(allOff);
    expect(c.done).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.items.every((i) => !i.done)).toBe(true);
  });

  it("is complete when everything is present", () => {
    const c = computeSetupChecklist(allOn);
    expect(c.done).toBe(8);
    expect(c.complete).toBe(true);
  });

  it("requires BOTH uei and cage for the identity step", () => {
    const onlyUei = computeSetupChecklist({
      ...allOn,
      profile: { ...allOn.profile, cage_code: "" },
    });
    expect(onlyUei.items.find((i) => i.key === "identity")!.done).toBe(false);
  });

  it("says exactly which federal identifier is still missing", () => {
    const onlyUei = computeSetupChecklist({
      ...allOn,
      profile: { ...allOn.profile, cage_code: "" },
    });
    const ueiItem = onlyUei.items.find((i) => i.key === "identity")!;
    expect(ueiItem.label).toContain("CAGE");
    expect(ueiItem.label).toContain("UEI ✓");

    const onlyCage = computeSetupChecklist({
      ...allOn,
      profile: { ...allOn.profile, uei: null },
    });
    const cageItem = onlyCage.items.find((i) => i.key === "identity")!;
    expect(cageItem.label).toContain("UEI");
    expect(cageItem.label).toContain("CAGE ✓");

    const neither = computeSetupChecklist({
      ...allOn,
      profile: { ...allOn.profile, uei: "", cage_code: "" },
    });
    expect(neither.items.find((i) => i.key === "identity")!.label).toBe(
      "Add your UEI and CAGE code"
    );
  });

  it("treats empty arrays as not done", () => {
    const c = computeSetupChecklist({
      ...allOn,
      profile: { ...allOn.profile, naics_codes: [], service_areas: [] },
    });
    expect(c.items.find((i) => i.key === "naics")!.done).toBe(false);
    expect(c.items.find((i) => i.key === "service_areas")!.done).toBe(false);
    expect(c.complete).toBe(false);
  });

  it("reflects partial integration state", () => {
    const c = computeSetupChecklist({
      profile: allOn.profile,
      integrations: { sam: true, claude: true, googleMaps: false, gmail: false },
    });
    expect(c.done).toBe(6); // 4 profile + sam + claude
    expect(c.items.find((i) => i.key === "email")!.done).toBe(false);
  });

  it("completes the email step only once an inbox is connected", () => {
    const c = computeSetupChecklist({
      profile: allOn.profile,
      integrations: { ...allOn.integrations, gmail: true },
    });
    expect(c.items.find((i) => i.key === "email")!.done).toBe(true);
    expect(c.done).toBe(8);
    expect(c.complete).toBe(true);
  });

  it("points profile steps and integration steps at the right pages", () => {
    const c = computeSetupChecklist(allOff);
    expect(c.items.find((i) => i.key === "naics")!.href).toBe("/settings/profile");
    expect(c.items.find((i) => i.key === "sam")!.href).toBe("/settings/integrations");
    expect(c.items.find((i) => i.key === "email")!.href).toBe("/settings/integrations");
  });
});

/**
 * Ordering is a product decision with a technical reason behind it, so it is
 * pinned rather than left to whoever edits the array next.
 *
 * The monitor polls SAM once per NAICS code and skips federal ingestion
 * entirely when either the key or the codes are missing. Those two steps
 * therefore decide whether the product does anything at all; the rest only
 * change the quality of what arrives.
 */
describe("setup order follows the dependency chain", () => {
  it("puts SAM.gov first and NAICS immediately after it", () => {
    const keys = computeSetupChecklist(allOff).items.map((i) => i.key);
    expect(keys[0]).toBe("sam");
    expect(keys[1]).toBe("naics");
  });

  /**
   * Required means the product does not work without it, not merely that it
   * works better. SAM and NAICS decide whether anything is found at all;
   * Anthropic and Google Maps decide whether what is found gets scored,
   * briefed, and staffed. Without all four this is a list of notices.
   */
  it("marks the four load-bearing steps as required", () => {
    const required = computeSetupChecklist(allOff)
      .items.filter((i) => i.required)
      .map((i) => i.key);
    expect(required).toEqual(["sam", "naics", "claude", "googleMaps"]);
  });

  it("leaves the merely-helpful steps optional", () => {
    const optional = computeSetupChecklist(allOff)
      .items.filter((i) => !i.required)
      .map((i) => i.key);
    expect(optional).toEqual(["service_areas", "identity", "certifications", "email"]);
  });

  it("counts the required steps still outstanding", () => {
    expect(computeSetupChecklist(allOff).requiredRemaining).toBe(4);
    expect(computeSetupChecklist(allOn).requiredRemaining).toBe(0);
  });
});

describe("the connected-but-searchless trap", () => {
  const samNoNaics: SetupInputs = {
    profile: { uei: "ABC123", cage_code: "1A2B3", naics_codes: [], service_areas: [], certifications: [] },
    integrations: { sam: true, claude: false, googleMaps: false, gmail: false },
  };

  it("flags a connected SAM key with no NAICS codes", () => {
    // This combination looks finished and finds nothing: the customer sees a
    // connected integration and an empty pipeline with no link between them.
    expect(computeSetupChecklist(samNoNaics).discoveryStalled).toBe(true);
  });

  it("says why, in the NAICS step itself", () => {
    const naics = computeSetupChecklist(samNoNaics).items.find((i) => i.key === "naics")!;
    expect(naics.hint).toContain("SAM.gov is connected");
  });

  it("does not flag a stall before SAM is connected", () => {
    expect(computeSetupChecklist(allOff).discoveryStalled).toBe(false);
  });

  it("does not flag a stall once both are in place", () => {
    expect(computeSetupChecklist(allOn).discoveryStalled).toBe(false);
  });
});

/**
 * During the trial the platform lends its Anthropic and Google Maps keys, so
 * those steps are due before the trial ends rather than before anything works.
 * Marking them Required on day one would be false, and a checklist that
 * overstates urgency stops being read.
 */
describe("borrowed keys during the trial", () => {
  const trialing: SetupInputs = { ...allOff, onTrial: true };

  it("does not demand the borrowed keys while the trial is live", () => {
    const required = computeSetupChecklist(trialing)
      .items.filter((i) => i.required)
      .map((i) => i.key);
    expect(required).toEqual(["sam", "naics"]);
  });

  it("still demands SAM, which is never lent", () => {
    // Lending SAM would exhaust a shared daily quota and stop our own
    // pipeline along with every other trial.
    const sam = computeSetupChecklist(trialing).items.find((i) => i.key === "sam")!;
    expect(sam.required).toBe(true);
  });

  it("says when the borrowed keys are due", () => {
    const claude = computeSetupChecklist(trialing).items.find((i) => i.key === "claude")!;
    expect(claude.label).toMatch(/before the trial ends/);
  });

  it("demands them once the trial is over", () => {
    const required = computeSetupChecklist({ ...allOff, onTrial: false })
      .items.filter((i) => i.required)
      .map((i) => i.key);
    expect(required).toEqual(["sam", "naics", "claude", "googleMaps"]);
  });
});
