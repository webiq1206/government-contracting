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
    expect(c.items.find((i) => i.key === "gmail")!.done).toBe(false);
  });

  it("points profile steps and integration steps at the right pages", () => {
    const c = computeSetupChecklist(allOff);
    expect(c.items.find((i) => i.key === "naics")!.href).toBe("/settings/profile");
    expect(c.items.find((i) => i.key === "sam")!.href).toBe("/settings/integrations");
  });
});
