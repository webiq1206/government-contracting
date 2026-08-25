/**
 * The variables that go into a subcontractor's email.
 *
 * Two classes of failure are pinned here. The first is embarrassing and
 * obvious once seen: "Hi Precision Mechanical LLC," or "Hi null,". The second
 * is invisible and expensive: the government's bid deadline handed to a
 * subcontractor as though it were theirs, or a whole-project scope sent to a
 * firm that holds one trade.
 */
import { describe, it, expect } from "vitest";
import {
  OUTREACH_VARS,
  OUTREACH_VAR_KEYS,
  referencedVars,
  unknownVars,
  resolveGreetingName,
  resolveCityState,
  resolveStartDate,
  resolveOutreachVars,
  VAR_CATEGORIES,
} from "@/lib/domain/outreach-vars";

const NOW = new Date("2026-08-06T16:00:00Z");

const BASE = {
  sub: { owner_name: "Marcus Rivera" },
  opportunity: {
    title: "HVAC Maintenance Services, Building 36C",
    agency: "US Army Corps of Engineers",
    solicitation_number: "W912DR-26-R-0042",
    location_state: "VA",
    location_text: "Richmond, VA 23219",
    deadline: "2026-09-04T20:00:00Z",
  },
  analysis: {
    trade_scopes: [
      {
        trade: "HVAC",
        work:
          "Remove 12 existing rooftop units in Buildings 3 and 4.\n" +
          "Furnish and install 12 replacement units, 5 tons each.\n" +
          "Test and balance all air distribution before closeout.",
      },
    ],
    qualifications: { licenses: ["State mechanical contractor licence"] },
    site_visit: { required: true, details: "August 14, 2026, 9:00 AM" },
    questions_for_subs: ["Can your crew work the 7:00 AM to 3:30 PM window?"],
    key_dates: [
      { label: "Award date", date: "September 20, 2026" },
      { label: "Notice to proceed", date: "October 1, 2026" },
    ],
    period_of_performance: "180 calendar days from notice to proceed",
    location: "Richmond, VA",
  },
  profile: {
    legal_name: "BROSTCO Holdings LLC",
    outreach_display_name: "Jared",
    phone: "(800) 555-0199",
    entity_state: "CO",
  },
  trade: "HVAC",
  deadlineLabel: "September 4, 2026 at 2:00 PM EDT",
  now: NOW,
};

describe("the catalogue", () => {
  it("gives every variable a source, an example and a fallback", () => {
    // The editor renders these. A blank column there is a variable an operator
    // cannot reason about.
    for (const v of OUTREACH_VARS) {
      expect(v.dataSource, v.key).toBeTruthy();
      expect(v.description, v.key).toBeTruthy();
      expect(v.fallback, v.key).toBeTruthy();
      expect(VAR_CATEGORIES.map((c) => c.id)).toContain(v.category);
    }
  });

  it("has no duplicate keys", () => {
    expect(new Set(OUTREACH_VAR_KEYS).size).toBe(OUTREACH_VAR_KEYS.length);
  });

  it("carries exactly the names the templates are allowed to use", () => {
    expect([...OUTREACH_VAR_KEYS].sort()).toEqual(
      [
        "agency", "company_name", "deadline", "estimated_start_date",
        "location_city_state", "location_state", "opportunity_title", "owner_name",
        "phone", "project_duration", "questions", "quote_due_date", "scope_summary",
        "sender_name", "solicitation_number", "subcontractor_requirements",
        "trade", "trade_scope_requirements",
      ].sort()
    );
  });
});

describe("unknown variables", () => {
  it("finds a name the system cannot fill", () => {
    const found = unknownVars("Hi {{owner_name}}, see {{invoice_total}}.");
    expect(found.map((f) => f.key)).toEqual(["invoice_total"]);
    expect(found[0].message).toMatch(/raw text/);
  });

  it("points a retired name at its replacement instead of just rejecting it", () => {
    /*
     * "Unknown variable" tells an operator they are wrong. Naming the
     * replacement tells them what to type, which is the difference between a
     * fixable error and a mystifying one.
     */
    const found = unknownVars("Hi {{contact_first_name_or_there}},");
    expect(found[0].useInstead).toBe("owner_name");
    expect(found[0].message).toContain("{{owner_name}}");
  });

  it("explains that documents are attached rather than linked", () => {
    const found = unknownVars("Docs: {{documents_url}}");
    expect(found[0].useInstead).toBeNull();
    expect(found[0].message).toMatch(/attached to the email automatically/i);
  });

  it("passes a template that only uses real variables", () => {
    expect(unknownVars("Hi {{owner_name}}, {{trade}} by {{quote_due_date}}.")).toEqual([]);
  });

  it("reads each name once however often it appears", () => {
    expect(referencedVars("{{trade}} {{trade}} {{phone}}")).toEqual(["trade", "phone"]);
  });
});

describe("resolveGreetingName", () => {
  it("uses the first name, tidied", () => {
    expect(resolveGreetingName("Marcus Rivera")).toBe("Marcus");
    expect(resolveGreetingName("MARCUS")).toBe("Marcus");
    expect(resolveGreetingName("  rivera, marcus")).toBe("Rivera");
  });

  it("says there rather than greeting a company", () => {
    // "Hi Precision Mechanical LLC," announces bulk mail in four words.
    expect(resolveGreetingName("Precision Mechanical LLC")).toBe("there");
    expect(resolveGreetingName("Ace Roofing Services")).toBe("there");
  });

  it("says there rather than greeting an email address", () => {
    expect(resolveGreetingName("info@example.com")).toBe("there");
  });

  it("never emits the shapes of a broken record", () => {
    for (const bad of ["", "   ", null, undefined, "null", "undefined", "N/A", "unknown"]) {
      expect(resolveGreetingName(bad)).toBe("there");
    }
  });

  it("says there rather than greeting a job title or a mailbox name", () => {
    for (const bad of ["Estimator", "office", "sales", "Owner"]) {
      expect(resolveGreetingName(bad)).toBe("there");
    }
  });

  it("rejects a scraped token carrying digits", () => {
    expect(resolveGreetingName("Contact1 Smith")).toBe("there");
  });

  it("keeps a real name that happens to be short or hyphenated", () => {
    expect(resolveGreetingName("Jo Nguyen")).toBe("Jo");
    expect(resolveGreetingName("Anne-Marie Dubois")).toBe("Anne-marie");
  });
});

describe("resolveCityState", () => {
  it("writes the city and the state in full", () => {
    expect(resolveCityState({ analysisLocation: "Richmond, VA" })).toEqual({
      value: "Richmond, Virginia",
      cityKnown: true,
    });
  });

  it("finds the pair inside a longer facility name", () => {
    expect(
      resolveCityState({ analysisLocation: "Defense Supply Center Richmond, Virginia" }).value
    ).toContain("Virginia");
  });

  it("ignores a zip code hanging off the end", () => {
    expect(resolveCityState({ locationText: "Richmond, VA 23219" })).toEqual({
      value: "Richmond, Virginia",
      cityKnown: true,
    });
  });

  it("falls back to the state alone and says the city is unknown", () => {
    expect(resolveCityState({ locationState: "VA" })).toEqual({
      value: "Virginia",
      cityKnown: false,
    });
  });

  it("returns nothing when it knows nothing, rather than guessing", () => {
    expect(resolveCityState({ analysisLocation: "Not specified" }).value).toBe("");
  });
});

describe("resolveStartDate", () => {
  it("takes notice to proceed as the start", () => {
    expect(
      resolveStartDate([{ label: "Notice to proceed", date: "October 1, 2026" }])
    ).toBe("October 1, 2026");
  });

  it("does not treat the award date as a start date", () => {
    /*
     * Award and start are different dates, often months apart. Presenting one
     * as the other puts a promise in the email the solicitation never made.
     */
    expect(resolveStartDate([{ label: "Award date", date: "September 20, 2026" }])).toBe("");
  });

  it("returns nothing when no date is named", () => {
    expect(resolveStartDate([])).toBe("");
    expect(resolveStartDate(null)).toBe("");
  });
});

describe("resolveOutreachVars", () => {
  it("fills every required variable from a complete record", () => {
    const r = resolveOutreachVars(BASE);
    expect(r.missingRequired).toEqual([]);
    expect(r.vars.owner_name).toBe("Marcus");
    expect(r.vars.location_city_state).toBe("Richmond, Virginia");
    expect(r.vars.sender_name).toBe("Jared");
    expect(r.vars.project_duration).toBe("180 calendar days from notice to proceed");
    expect(r.vars.estimated_start_date).toBe("October 1, 2026");
  });

  it("keeps the two deadlines apart, and puts the quote first", () => {
    /*
     * The whole reason quote_due_date exists. If these are ever the same
     * value, a subcontractor has been told to deliver on the day the bid is
     * already gone.
     */
    const r = resolveOutreachVars(BASE);
    expect(r.vars.deadline).toBe("September 4, 2026 at 2:00 PM EDT");
    expect(r.vars.quote_due_date).toBe("August 28, 2026 at 3:00 PM MDT");
    expect(r.vars.quote_due_date).not.toBe(r.vars.deadline);
    expect(new Date(r.quote.at!).getTime()).toBeLessThan(
      new Date(BASE.opportunity.deadline).getTime()
    );
  });

  it("writes the quote deadline in the sender's timezone, with the zone named", () => {
    // Two firms in two states reading "3:00 PM" do not read the same time.
    expect(resolveOutreachVars(BASE).vars.quote_due_date).toMatch(/\bMDT\b/);
  });

  it("bounds the scope to this trade and says so", () => {
    const r = resolveOutreachVars(BASE);
    expect(r.vars.scope_summary).toMatch(/rooftop units/i);
    expect(r.vars.scope_summary).toMatch(/price the HVAC scope only/i);
  });

  it("warns, and widens the wording, when the scope is not trade-specific", () => {
    const r = resolveOutreachVars({
      ...BASE,
      trade: "Roofing",
      analysis: { ...BASE.analysis, trade_scopes: [] },
      description: "Replace mechanical equipment across the installation.",
    });
    expect(r.vars.scope_summary).toMatch(/other trades are being quoted separately/i);
    expect(r.warnings.join(" ")).toMatch(/no scope written specifically for Roofing/i);
  });

  it("renders the scope and requirement lists as bullets", () => {
    const r = resolveOutreachVars(BASE);
    expect(r.vars.trade_scope_requirements.split("\n").every((l) => l.startsWith("- "))).toBe(true);
    expect(r.vars.subcontractor_requirements).toMatch(/- License: State mechanical contractor licence \(required\)/);
    expect(r.vars.subcontractor_requirements).toMatch(/Site visit.*\(required\)/);
  });

  it("lists only the questions that were actually written", () => {
    expect(resolveOutreachVars(BASE).vars.questions).toBe(
      "- Can your crew work the 7:00 AM to 3:30 PM window?"
    );
  });

  it("reports the required variables a thin record cannot fill", () => {
    const r = resolveOutreachVars({
      ...BASE,
      opportunity: { ...BASE.opportunity, title: "", agency: "", solicitation_number: "" },
      profile: { legal_name: "", outreach_display_name: "", phone: "" },
    });
    expect(r.missingRequired).toEqual(
      expect.arrayContaining([
        "opportunity_title", "agency", "solicitation_number",
        "sender_name", "company_name", "phone",
      ])
    );
  });

  it("treats a quote deadline it cannot honestly compute as missing", () => {
    // The bid is tomorrow: there is no date that leaves room for both sides.
    const r = resolveOutreachVars({
      ...BASE,
      opportunity: { ...BASE.opportunity, deadline: "2026-08-07T12:00:00Z" },
    });
    expect(r.vars.quote_due_date).toBe("");
    expect(r.missingRequired).toContain("quote_due_date");
  });

  it("leaves the optional schedule lines empty rather than guessing them", () => {
    const r = resolveOutreachVars({
      ...BASE,
      analysis: { ...BASE.analysis, key_dates: [], period_of_performance: "Not specified" },
    });
    expect(r.vars.estimated_start_date).toBe("");
    expect(r.vars.project_duration).toBe("");
    // Optional, so they do not block the send.
    expect(r.missingRequired).not.toContain("estimated_start_date");
    expect(r.missingRequired).not.toContain("project_duration");
  });

  it("never leaves owner_name empty, so a greeting is never blank", () => {
    const r = resolveOutreachVars({ ...BASE, sub: { owner_name: null } });
    expect(r.vars.owner_name).toBe("there");
    expect(r.missingRequired).not.toContain("owner_name");
  });

  it("never emits null or undefined as text for any variable", () => {
    /*
     * Every one of these has reached a real inbox in some product. The
     * resolver is the only place that can guarantee it does not happen here.
     */
    const r = resolveOutreachVars({
      ...BASE,
      sub: null,
      analysis: undefined,
      profile: {},
      opportunity: { deadline: null },
      deadlineLabel: "",
    });
    for (const [key, value] of Object.entries(r.vars)) {
      expect(typeof value, key).toBe("string");
      expect(value, key).not.toMatch(/\bnull\b|\bundefined\b|\[object/i);
    }
  });

  it("does not use the sender's surname even when only a full name is set", () => {
    const r = resolveOutreachVars({
      ...BASE,
      profile: { ...BASE.profile, outreach_display_name: "", owner_name: "Jared Brost" },
    });
    expect(r.vars.sender_name).toBe("Jared");
  });
});
