import { describe, it, expect } from "vitest";
import { computeSetupChecklist, type SetupInputs } from "@/lib/domain/setup";
import { defaultCompanyProfile } from "@/lib/domain/default-profile";

/**
 * The rule these guard: a saved key is not a working key.
 *
 * The checklist this replaces marked a step done the moment a credential was
 * typed into a form, which meant a typo, an expired key and a live key on an
 * account with no credit all read as finished while the pipeline did nothing.
 * A step that depends on a service is complete only when the service has
 * answered, and until then the step says which of "never tried" and "it
 * failed" applies.
 */

const allOff: SetupInputs = {
  profile: null,
  integrations: { sam: false, claude: false, googleMaps: false, gmail: false },
};

const worked = { configured: true, lastSuccessAt: "2026-08-20T00:00:00Z" };

const allOn: SetupInputs = {
  orgName: "Brost Co",
  profile: {
    uei: "ABC123",
    cage_code: "1A2B3",
    naics_codes: ["561720"],
    service_areas: ["Idaho"],
    certifications: ["Small Business"],
    owner_name: "Pat Brost",
    legal_name: "Brost Co",
    phone: "208-555-0100",
    outreach_email: "bids@brostco.test",
  },
  integrations: { sam: true, claude: true, googleMaps: true, gmail: true },
  proof: { sam: worked, claude: worked, googleMaps: worked, gmail: worked },
  rules: { reviewed: true, outreachBatchLimit: 50, followupHours: 48 },
  access: { level: "full" },
  firstRun: { opportunities: 12, scored: 12, outreachSent: 4 },
};

const item = (i: SetupInputs, key: string) =>
  computeSetupChecklist(i).items.find((it) => it.key === key)!;

describe("computeSetupChecklist", () => {
  it("covers the whole workflow, not only the credentials", () => {
    const keys = computeSetupChecklist(allOn).items.map((i) => i.key);
    expect(keys).toContain("rules");
    expect(keys).toContain("access");
    expect(keys).toContain("first_opportunity");
    expect(keys).toContain("sender_identity");
  });

  it("puts every item in exactly one of the four states", () => {
    const states = new Set(["complete", "current", "blocked", "optional"]);
    for (const i of computeSetupChecklist(allOff).items) {
      expect(states.has(i.state), `${i.key} is ${i.state}`).toBe(true);
      expect(i.done).toBe(i.state === "complete");
    }
  });

  it("counts nothing but the account itself for an empty setup", () => {
    const c = computeSetupChecklist(allOff);
    expect(c.complete).toBe(false);
    // Signing in is the one step that is finished by definition.
    expect(c.items.filter((i) => i.done).map((i) => i.key)).toEqual(["account"]);
  });

  it("is complete when everything is present and proven", () => {
    const c = computeSetupChecklist(allOn);
    expect(c.done).toBe(c.total);
    expect(c.complete).toBe(true);
    expect(c.requiredRemaining).toBe(0);
  });

  it("requires BOTH uei and cage for the identity step", () => {
    expect(item({ ...allOn, profile: { ...allOn.profile, cage_code: "" } }, "identity").done).toBe(
      false
    );
  });

  it("says exactly which federal identifier is still missing", () => {
    expect(item({ ...allOn, profile: { ...allOn.profile, cage_code: "" } }, "identity").label).toBe(
      "Add your CAGE code"
    );
    expect(item({ ...allOn, profile: { ...allOn.profile, uei: null } }, "identity").label).toBe(
      "Add your UEI"
    );
    expect(
      item({ ...allOn, profile: { ...allOn.profile, uei: "", cage_code: "" } }, "identity").label
    ).toBe("Add your UEI and CAGE code");
  });

  it("treats empty arrays as not done", () => {
    const c = { ...allOn, profile: { ...allOn.profile, naics_codes: [], service_areas: [] } };
    expect(item(c, "naics").done).toBe(false);
    expect(item(c, "service_areas").done).toBe(false);
    expect(computeSetupChecklist(c).complete).toBe(false);
  });

  it("points each step at the page that finishes it", () => {
    const c = computeSetupChecklist(allOff);
    expect(c.items.find((i) => i.key === "naics")!.href).toBe("/settings/profile");
    expect(c.items.find((i) => i.key === "sam")!.href).toBe("/settings/integrations");
    expect(c.items.find((i) => i.key === "email")!.href).toBe("/settings/integrations");
    expect(c.items.find((i) => i.key === "rules")!.href).toBe("/settings/rules");
  });
});

describe("a saved key is not a working key", () => {
  const saved: SetupInputs = {
    ...allOff,
    integrations: { ...allOff.integrations, sam: true },
  };

  it("keeps the step outstanding while nothing has used the key", () => {
    const s = item({ ...saved, proof: { sam: { configured: true } } }, "sam");
    expect(s.done).toBe(false);
    expect(s.state).toBe("current");
    expect(s.hint).toMatch(/nothing has used it yet/);
  });

  it("finishes it once the credential did real work, and says when", () => {
    const s = item({ ...saved, proof: { sam: worked } }, "sam");
    expect(s.done).toBe(true);
    expect(s.evidence).toBe("It did real work on 2026-08-20.");
  });

  it("finishes it on a test too, and says that is what it was", () => {
    const s = item(
      { ...saved, proof: { sam: { configured: true, lastTestedAt: "2026-08-01T00:00:00Z" } } },
      "sam"
    );
    expect(s.done).toBe(true);
    expect(s.evidence).toBe("Tested on 2026-08-01.");
  });

  it("carries the refusal into the step rather than ticking it", () => {
    const s = item(
      {
        ...saved,
        proof: { sam: { configured: true, lastError: "401 Unauthorized: invalid API key" } },
      },
      "sam"
    );
    expect(s.done).toBe(false);
    expect(s.hint).toContain("401 Unauthorized");
  });

  it("keeps the old meaning for a caller that supplies no proof at all", () => {
    // Never accuse a working account of being untested because the caller
    // could not read the integration records.
    expect(item(saved, "sam").done).toBe(true);
  });
});

describe("setup order follows the dependency chain", () => {
  /**
   * The monitor polls SAM once per NAICS code and skips federal ingestion
   * entirely when either the key or the codes are missing. Those two steps
   * therefore decide whether the product does anything at all.
   */
  it("puts the account first, then SAM.gov and NAICS together", () => {
    const keys = computeSetupChecklist(allOff).items.map((i) => i.key);
    expect(keys.slice(0, 3)).toEqual(["account", "sam", "naics"]);
  });

  /**
   * Required means the product does not work without it. The connected inbox
   * joined this list: no mailbox means no outreach can send at all, which is
   * as load-bearing as the SAM key, and it was previously filed alongside
   * "list your certifications".
   */
  it("marks the load-bearing steps as required", () => {
    const required = computeSetupChecklist(allOff)
      .items.filter((i) => i.required)
      .map((i) => i.key);
    expect(required).toEqual([
      "account",
      "sam",
      "naics",
      "email",
      "sender_identity",
      "claude",
      "googleMaps",
    ]);
  });

  it("leaves the merely-helpful steps optional", () => {
    const optional = computeSetupChecklist(allOff)
      .items.filter((i) => !i.required)
      .map((i) => i.key);
    expect(optional).toEqual([
      "service_areas",
      "identity",
      "certifications",
      "rules",
      "first_opportunity",
    ]);
  });

  it("counts the required steps still outstanding", () => {
    expect(computeSetupChecklist(allOff).requiredRemaining).toBe(6);
    expect(computeSetupChecklist(allOn).requiredRemaining).toBe(0);
  });
});

describe("blocked is not the same as outstanding", () => {
  it("blocks the first opportunity until discovery can run", () => {
    const first = item({ ...allOff, firstRun: { opportunities: 0 } }, "first_opportunity");
    expect(first.state).toBe("blocked");
    expect(first.blocker).toContain("SAM.gov is connected");
  });

  it("stops blocking it once discovery is ready, and asks for nothing", () => {
    const ready = item(
      {
        ...allOff,
        profile: { naics_codes: ["561720"] },
        integrations: { ...allOff.integrations, sam: true },
        proof: { sam: worked },
        firstRun: { opportunities: 0 },
      },
      "first_opportunity"
    );
    expect(ready.state).toBe("optional");
    expect(ready.hint).toContain("Nothing else is needed from you");
  });

  it("does not report an empty pipeline when nobody counted one", () => {
    const unknown = item(allOff, "first_opportunity");
    expect(unknown.hint).toBe("Not counted yet.");
    expect(unknown.hint).not.toMatch(/\b0\b/);
  });

  it("blocks the inbox when the deployment cannot offer one", () => {
    const e = item(
      { ...allOn, gmailOffered: false },
      "email"
    );
    expect(e.state).toBe("blocked");
    expect(e.done).toBe(false);
    expect(e.blocker).toContain("no Google connection configured");
    expect(computeSetupChecklist({ ...allOn, gmailOffered: false }).blocked).toBe(1);
  });
});

describe("who the emails come from", () => {
  it("names every missing piece rather than saying the profile is incomplete", () => {
    const s = item(
      { ...allOn, profile: { ...allOn.profile, phone: null, owner_name: null } },
      "sender_identity"
    );
    expect(s.label).toContain("who signs the emails");
    expect(s.label).toContain("a callback number");
    expect(s.done).toBe(false);
  });

  it("accepts either address field, because the templates do", () => {
    const s = item(
      { ...allOn, profile: { ...allOn.profile, outreach_email: null, email: "bids@brostco.test" } },
      "sender_identity"
    );
    expect(s.done).toBe(true);
  });
});

describe("the connected-but-searchless trap", () => {
  const samNoNaics: SetupInputs = {
    profile: { uei: "ABC123", cage_code: "1A2B3", naics_codes: [], service_areas: [], certifications: [] },
    integrations: { sam: true, claude: false, googleMaps: false, gmail: false },
  };

  it("flags a connected SAM key with no NAICS codes", () => {
    expect(computeSetupChecklist(samNoNaics).discoveryStalled).toBe(true);
  });

  it("says why, in the NAICS step itself", () => {
    expect(item(samNoNaics, "naics").hint).toContain("SAM.gov is connected");
  });

  it("does not flag a stall before SAM is connected", () => {
    expect(computeSetupChecklist(allOff).discoveryStalled).toBe(false);
  });

  it("does not flag a stall once both are in place", () => {
    expect(computeSetupChecklist(allOn).discoveryStalled).toBe(false);
  });
});

describe("borrowed keys during the trial", () => {
  const trialing: SetupInputs = { ...allOff, onTrial: true };

  it("does not demand the borrowed keys while the trial is live", () => {
    const required = computeSetupChecklist(trialing)
      .items.filter((i) => i.required)
      .map((i) => i.key);
    expect(required).not.toContain("claude");
    expect(required).not.toContain("googleMaps");
  });

  it("still demands SAM, which is never lent", () => {
    // Lending SAM would exhaust a shared daily quota and stop our own
    // pipeline along with every other trial.
    expect(item(trialing, "sam").required).toBe(true);
  });

  it("says when the borrowed keys are due", () => {
    expect(item(trialing, "claude").label).toMatch(/before the trial ends/);
  });

  it("demands them once the trial is over", () => {
    const required = computeSetupChecklist({ ...allOff, onTrial: false })
      .items.filter((i) => i.required)
      .map((i) => i.key);
    expect(required).toContain("claude");
    expect(required).toContain("googleMaps");
  });
});

describe("the connected inbox step", () => {
  const base: SetupInputs = {
    profile: null,
    integrations: { sam: true, claude: true, googleMaps: true, gmail: false },
  };

  it("is outstanding when this account has no mailbox connected", () => {
    expect(item(base, "email").done).toBe(false);
  });

  it("is done only when a mailbox is actually connected", () => {
    expect(item({ ...base, integrations: { ...base.integrations, gmail: true } }, "email").done).toBe(
      true
    );
  });

  it("treats an absent gmailOffered as offered, which every live deployment is", () => {
    expect(item({ ...base, integrations: { ...base.integrations, gmail: true } }, "email").done).toBe(
      true
    );
  });
});

describe("access and contact limits", () => {
  it("leaves the access step off entirely when nobody supplied the facts", () => {
    expect(computeSetupChecklist(allOff).items.some((i) => i.key === "access")).toBe(false);
  });

  it("does not press a live trial, and does press a locked account", () => {
    const trial = item({ ...allOff, access: { level: "trial", trialDaysLeft: 9 } }, "access");
    expect(trial.state).toBe("optional");
    expect(trial.hint).toContain("9 days left");

    const locked = item({ ...allOff, access: { level: "none" } }, "access");
    expect(locked.state).toBe("current");
    expect(locked.required).toBe(true);
  });

  it("says a comped account has nothing to pay rather than showing a plan step", () => {
    const comped = item({ ...allOff, access: { level: "full", comped: true } }, "access");
    expect(comped.done).toBe(true);
    expect(comped.evidence).toBe("Full access, no billing required.");
  });

  it("quotes the limits back once somebody has set them", () => {
    const r = item(
      { ...allOff, rules: { reviewed: true, outreachBatchLimit: 25, followupHours: 72 } },
      "rules"
    );
    expect(r.done).toBe(true);
    expect(r.hint).toContain("up to 25 subcontractors");
    expect(r.hint).toContain("after 72 hours");
  });

  it("says the limits are this platform's opinion until somebody looks", () => {
    const r = item({ ...allOff, rules: { reviewed: false, outreachBatchLimit: 50 } }, "rules");
    expect(r.done).toBe(false);
    expect(r.hint).toContain("defaults until you look at them");
  });
});

/**
 * The step that could never be finished.
 *
 * "Add your company name" sat on every account's setup list as Required,
 * permanently, whatever anybody typed into the profile editor. The checklist
 * read `company_name`; the company profile has always called that field
 * `legal_name`, and nothing has ever written `company_name` into it. The key
 * was blank on every account that has ever existed.
 *
 * The tests did not catch it because the fixture above had invented the same
 * field the code invented: the two agreed with each other and disagreed with
 * the product. So these build the profile with the function the application
 * itself builds one with, rather than by hand. A fixture written from the real
 * record cannot quietly grow a field the record does not have.
 */
describe("the sender identity reads the profile the product actually saves", () => {
  const saved = (over: Partial<ReturnType<typeof defaultCompanyProfile>> = {}) => ({
    ...defaultCompanyProfile({
      legalName: "Brost Co Holdings",
      email: "bids@brostco.test",
      ownerName: "Pat Brost",
    }),
    phone: "208-555-0100",
    ...over,
  });

  const senderStep = (profile: SetupInputs["profile"]) =>
    item({ ...allOff, profile }, "sender_identity");

  it("is finished by a profile saved through the editor", () => {
    const s = senderStep(saved());
    expect(s.done).toBe(true);
    expect(s.label).toBe("Say who the emails come from");
  });

  it("asks for the company name only when the legal name is genuinely blank", () => {
    const s = senderStep(saved({ legal_name: "" }));
    expect(s.done).toBe(false);
    expect(s.label).toBe("Add your company name");
  });

  it("does not read a key the company profile has never had", () => {
    /*
     * The exact regression. A record carrying `company_name` and nothing in
     * `legal_name` is not a filled-in profile, and must not read as one; the
     * inverse -- the shape every real account has -- must.
     */
    const wrongKey = { ...saved({ legal_name: "" }), company_name: "Brost Co Holdings" };
    expect(senderStep(wrongKey as SetupInputs["profile"]).done).toBe(false);
    expect(senderStep(saved()).done).toBe(true);
  });
});
