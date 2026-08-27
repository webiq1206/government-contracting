/**
 * How much of the company profile is actually filled in, and what it costs.
 *
 * The profile is read by scoring, by eligibility, by every generated document
 * and by every subcontractor email. A missing field there does not fail
 * loudly; it produces a lower score, a thinner bid, or an email with a gap in
 * it, and none of those points back at the empty box that caused them.
 *
 * So each field says what stops working without it, in the words of the thing
 * that stops working. "Bids cannot state your UEI" is actionable. "Field
 * incomplete" is not.
 *
 * The percentage is deliberately weighted by consequence rather than by field
 * count. A profile missing its legal name and missing its pricing philosophy
 * is not eighty per cent complete in any sense a person cares about.
 *
 * Pure.
 */

import type { CompanyProfileJson } from "../types";

export type ProfileSectionKey =
  | "identity"
  | "eligibility"
  | "target_work"
  | "service_areas"
  | "pricing"
  | "sub_standards"
  | "exclusions"
  | "standing_instructions";

export interface ProfileFieldDef {
  key: string;
  label: string;
  /**
   * How much this field matters, not how big it is.
   *
   *   3  something downstream is wrong or blocked without it
   *   2  something downstream is noticeably worse without it
   *   1  a nicety
   */
  weight: 1 | 2 | 3;
  /** What stops working while it is empty, in the words of what stops. */
  consequence: string;
  /** True when the profile carries a usable value. */
  filled: (p: CompanyProfileJson) => boolean;
  /** A problem with the value that is present, if there is one. */
  problem?: (p: CompanyProfileJson) => string | null;
}

export interface ProfileSectionDef {
  key: ProfileSectionKey;
  label: string;
  /** What this section is for, in one line. */
  purpose: string;
  fields: ProfileFieldDef[];
}

const text = (v: unknown): boolean => typeof v === "string" && v.trim() !== "";
const list = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const num = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);

/** A UEI is twelve alphanumeric characters. Anything else will be rejected. */
const UEI = /^[A-Z0-9]{12}$/i;
/** A CAGE code is five alphanumeric characters. */
const CAGE = /^[A-Z0-9]{5}$/i;

export const PROFILE_SECTIONS: ProfileSectionDef[] = [
  {
    key: "identity",
    label: "Identity",
    purpose: "The legal details that go on every bid and every registration.",
    fields: [
      {
        key: "legal_name",
        label: "Legal name",
        weight: 3,
        consequence: "Generated bids and cover letters have no company name to put on them.",
        filled: (p) => text(p.legal_name),
      },
      {
        key: "uei",
        label: "UEI",
        weight: 3,
        consequence: "A federal bid cannot be submitted without it.",
        filled: (p) => text(p.uei),
        /*
         * Checked rather than merely required. A UEI of the wrong length is
         * worse than an empty one: it looks filled in, and the bid it goes on
         * is rejected by the portal rather than by this page.
         */
        problem: (p) =>
          text(p.uei) && !UEI.test(p.uei!.trim())
            ? "A UEI is twelve letters and digits. This one will be rejected."
            : null,
      },
      {
        key: "cage_code",
        label: "CAGE code",
        weight: 2,
        consequence: "Some agencies will not accept a bid without one.",
        filled: (p) => text(p.cage_code),
        problem: (p) =>
          text(p.cage_code) && !CAGE.test(p.cage_code!.trim())
            ? "A CAGE code is five letters and digits."
            : null,
      },
      {
        key: "owner_name",
        label: "Who signs",
        weight: 2,
        consequence: "Bid documents have no signatory and emails have nobody to be from.",
        filled: (p) => text(p.owner_name),
      },
      {
        key: "outreach_email",
        label: "Outreach address",
        weight: 3,
        consequence: "No subcontractor email can be sent at all.",
        filled: (p) => text(p.outreach_email) || text(p.email),
      },
      {
        key: "phone",
        label: "Phone",
        weight: 2,
        consequence: "Subcontractors have no number to call back.",
        filled: (p) => text(p.phone),
      },
      {
        key: "physical_address",
        label: "Physical address",
        weight: 2,
        consequence: "Bids that must state a place of business cannot.",
        filled: (p) => text(p.physical_address),
      },
    ],
  },
  {
    key: "eligibility",
    label: "Eligibility",
    purpose: "What the company is allowed to bid on, and under which set-asides.",
    fields: [
      {
        key: "small_business",
        label: "Small business status",
        weight: 3,
        consequence: "Set-aside eligibility cannot be judged, so scoring guesses.",
        // A boolean is answered either way; false is a real answer.
        filled: (p) => typeof p.small_business === "boolean",
      },
      {
        key: "certifications",
        label: "Certifications",
        weight: 3,
        consequence:
          "Set-aside solicitations you actually qualify for are scored as though you do not.",
        filled: (p) => list(p.certifications),
      },
      {
        key: "entity_state",
        label: "State of registration",
        weight: 1,
        consequence: "State-level eligibility questions have nothing to check against.",
        filled: (p) => text(p.entity_state),
      },
      {
        key: "years_in_business",
        label: "Years in business",
        weight: 1,
        consequence: "Past-performance requirements cannot be checked before you bid.",
        filled: (p) => num(p.years_in_business),
      },
      {
        key: "bonding_capacity",
        label: "Bonding capacity",
        weight: 2,
        consequence:
          "Work needing a bond larger than you can obtain is scored as though you could take it.",
        filled: (p) => num(p.bonding_capacity),
      },
    ],
  },
  {
    key: "target_work",
    label: "Target work",
    purpose: "The codes and trades that decide what gets pulled in and scored.",
    fields: [
      {
        key: "naics_codes",
        label: "NAICS codes",
        weight: 3,
        consequence:
          "Nothing is found. The opportunity feed is filtered by these before anything is scored.",
        filled: (p) => list(p.naics_codes),
      },
      {
        key: "primary_trades",
        label: "Primary trades",
        weight: 3,
        consequence:
          "Subcontractor sourcing has no trade to search for, so a bid cannot be covered.",
        filled: (p) => list(p.primary_trades),
      },
      {
        key: "psc_codes",
        label: "PSC codes",
        weight: 1,
        consequence: "A second way of matching notices is unavailable.",
        filled: (p) => list(p.psc_codes),
      },
    ],
  },
  {
    key: "service_areas",
    label: "Service areas",
    purpose: "Where the company will actually work.",
    fields: [
      {
        key: "service_areas",
        label: "States and regions",
        weight: 3,
        consequence:
          "Work three states away scores the same as work down the road, and subcontractor searches have no place to look.",
        filled: (p) => list(p.service_areas),
      },
    ],
  },
  {
    key: "pricing",
    label: "Pricing",
    purpose: "How the Bid Builder turns subcontractor quotes into a bid.",
    fields: [
      {
        key: "target_margin_pct",
        label: "Target margin",
        weight: 3,
        consequence: "Every bid is priced on a default that is not yours.",
        filled: (p) => num(p.target_margin_pct),
      },
      {
        key: "min_margin_pct",
        label: "Minimum margin",
        weight: 3,
        consequence: "Nothing stops a bid being priced below what the work is worth.",
        filled: (p) => num(p.min_margin_pct),
        /*
         * A floor above the target is not a typo the platform can resolve: it
         * makes every bid violate its own floor, and the Bid Builder has to
         * pick one to ignore.
         */
        problem: (p) =>
          num(p.min_margin_pct) && num(p.target_margin_pct) && p.min_margin_pct > p.target_margin_pct
            ? "The floor is above the target, so every bid would break its own floor."
            : null,
      },
      {
        key: "max_markup_pct",
        label: "Maximum markup",
        weight: 2,
        consequence: "Nothing caps a markup that would price you out of the work.",
        filled: (p) => num(p.max_markup_pct),
      },
      {
        key: "pricing_philosophy",
        label: "Pricing notes",
        weight: 1,
        consequence: "Generated pricing narrative has nothing of yours to draw on.",
        filled: (p) => text(p.pricing_philosophy),
      },
    ],
  },
  {
    key: "sub_standards",
    label: "Subcontractor standards",
    purpose: "The bar a subcontractor clears before the platform will use them.",
    fields: [
      {
        key: "require_active_license",
        label: "License requirement",
        weight: 2,
        consequence: "Unlicensed firms can reach a bid package.",
        filled: (p) => typeof p.sub_standards?.require_active_license === "boolean",
      },
      {
        key: "require_not_sam_excluded",
        label: "Exclusion check",
        weight: 3,
        consequence:
          "A federally excluded firm can be put on federal work, which voids the award.",
        filled: (p) => typeof p.sub_standards?.require_not_sam_excluded === "boolean",
      },
      {
        key: "min_reviews",
        label: "Reputation floor",
        weight: 1,
        consequence: "Sourcing cannot rank an unknown firm against a known one.",
        filled: (p) => num(p.sub_standards?.min_reviews),
      },
    ],
  },
  {
    key: "exclusions",
    label: "Exclusions",
    purpose: "Work the company will never take, whatever it scores.",
    fields: [
      {
        key: "hard_exclusions",
        label: "Hard exclusions",
        weight: 2,
        consequence:
          "Work you would never take still reaches the review queue and takes somebody's time.",
        filled: (p) => list(p.hard_exclusions),
      },
      {
        key: "excluded_naics",
        label: "Excluded codes",
        weight: 1,
        consequence: "Codes you never want are still pulled in and scored.",
        filled: (p) => list(p.excluded_naics),
      },
    ],
  },
  {
    key: "standing_instructions",
    label: "Standing instructions",
    purpose: "Anything the platform should know that no field covers.",
    fields: [
      {
        key: "notes",
        label: "Standing instructions",
        weight: 1,
        consequence: "Nothing is lost; this is context, not configuration.",
        filled: (p) => text(p.notes),
      },
      {
        key: "legal_guardrails",
        label: "Legal guardrails",
        weight: 2,
        consequence: "Generated documents have no house rules to obey.",
        filled: (p) => list(p.legal_guardrails),
      },
    ],
  },
];

export interface FieldStatus {
  key: string;
  label: string;
  filled: boolean;
  weight: 1 | 2 | 3;
  /** Empty: what stops working. Present but wrong: what is wrong with it. */
  message: string | null;
  /** True when the value present is invalid, as distinct from absent. */
  invalid: boolean;
}

export interface SectionStatus {
  key: ProfileSectionKey;
  label: string;
  purpose: string;
  percent: number;
  fields: FieldStatus[];
  /** Fields that are empty and matter most, worst first. */
  missing: FieldStatus[];
  /** Fields carrying a value that will not work. */
  invalid: FieldStatus[];
}

export interface ProfileCompleteness {
  /** 0-100, weighted by what each field costs rather than by field count. */
  percent: number;
  sections: SectionStatus[];
  /** Every invalid value across the profile. These block before they warn. */
  invalid: FieldStatus[];
  /** The highest-cost empty fields, worst first, across every section. */
  nextUp: FieldStatus[];
}

export function assessProfile(p: CompanyProfileJson | null | undefined): ProfileCompleteness {
  const profile = (p ?? {}) as CompanyProfileJson;
  const sections: SectionStatus[] = [];
  let got = 0;
  let total = 0;
  const allInvalid: FieldStatus[] = [];
  const allMissing: FieldStatus[] = [];

  for (const def of PROFILE_SECTIONS) {
    const fields: FieldStatus[] = def.fields.map((f) => {
      let filled = false;
      try {
        filled = f.filled(profile);
      } catch {
        // A profile shape older than this field reads as empty, not as a crash.
        filled = false;
      }
      let problem: string | null = null;
      try {
        problem = f.problem?.(profile) ?? null;
      } catch {
        problem = null;
      }
      return {
        key: f.key,
        label: f.label,
        filled,
        weight: f.weight,
        invalid: problem != null,
        message: problem ?? (filled ? null : f.consequence),
      };
    });

    let sGot = 0;
    let sTotal = 0;
    for (const f of fields) {
      sTotal += f.weight;
      /*
       * An invalid value earns nothing. It is not partial credit: a UEI of
       * the wrong length is worse than a blank one, because the bid carrying
       * it is rejected by the portal rather than by this page.
       */
      if (f.filled && !f.invalid) sGot += f.weight;
    }
    got += sGot;
    total += sTotal;

    const missing = fields.filter((f) => !f.filled).sort((a, b) => b.weight - a.weight);
    const invalid = fields.filter((f) => f.invalid);
    allInvalid.push(...invalid);
    allMissing.push(...missing);

    sections.push({
      key: def.key,
      label: def.label,
      purpose: def.purpose,
      percent: sTotal === 0 ? 100 : Math.round((sGot / sTotal) * 100),
      fields,
      missing,
      invalid,
    });
  }

  return {
    percent: total === 0 ? 100 : Math.round((got / total) * 100),
    sections,
    invalid: allInvalid,
    nextUp: allMissing.sort((a, b) => b.weight - a.weight).slice(0, 5),
  };
}
