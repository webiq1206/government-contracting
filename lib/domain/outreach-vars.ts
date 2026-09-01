/**
 * Every variable an outreach template can use, declared once and resolved once.
 *
 * The old arrangement had the catalogue in one file (template-tokens.ts, for
 * the editor's palette) and the resolution in another (the outreach agent's
 * `vars` object literal), with the follow-up agent building a third, shorter
 * version of the same map. Nothing checked that the three agreed. A token the
 * palette advertised could resolve to nothing at send time, and a token the
 * agent filled could be missing from the palette, so an operator could neither
 * discover it nor be warned when it broke.
 *
 * Worse, the failure was silent in the direction that matters: renderTemplate
 * masks an unresolved token and repairs the sentence around it, so a variable
 * that quietly stopped resolving produced a shorter, plausible email rather
 * than an obviously broken one. "Please reply by ." is caught by eye.
 * A missing quote deadline that removes the whole sentence is not.
 *
 * So: one catalogue, carrying for each variable what it is, where its value
 * comes from, whether an email may be sent without it, and what it falls back
 * to. One resolver, used by the agent, the follow-up, the editor preview and
 * the test send, so what an operator previews is what a subcontractor gets.
 *
 * Pure. Callers do the database work and hand in plain values.
 */

import {
  buildOutreachRequirements,
  renderRequirementLines,
  type OutreachRequirements,
} from "./outreach-requirements";
import {
  computeQuoteDeadline,
  resolveTimeZone,
  type QuoteDeadline,
} from "./quote-deadline";
import { formatDeadlineLabel } from "./template-render";

export type VarCategory =
  | "subcontractor"
  | "project"
  | "scope"
  | "requirements"
  | "schedule"
  | "sender";

export const VAR_CATEGORIES: { id: VarCategory; label: string; blurb: string }[] = [
  {
    id: "subcontractor",
    label: "Subcontractor",
    blurb: "From the contact record of the firm being emailed.",
  },
  {
    id: "project",
    label: "Project",
    blurb: "From the solicitation this bid is for.",
  },
  {
    id: "scope",
    label: "Scope",
    blurb: "The work this particular subcontractor is being asked to price.",
  },
  {
    id: "requirements",
    label: "Requirements",
    blurb: "What they must hold, attend or submit in order to do the work.",
  },
  {
    id: "schedule",
    label: "Schedule",
    blurb: "Dates. Note that two different deadlines live here.",
  },
  {
    id: "sender",
    label: "Sender",
    blurb: "From your company profile and outreach settings.",
  },
];

export interface VarSpec {
  key: string;
  label: string;
  description: string;
  /** Where the value is read from, named so an operator can go and check it. */
  dataSource: string;
  example: string;
  /** Required: an email may not be sent while this is empty. */
  required: boolean;
  /** What happens when the value is missing. */
  fallback: string;
  category: VarCategory;
}

/**
 * The catalogue. This list IS the contract: a template may use these names and
 * no others, the editor renders this, and send-time validation reads it.
 */
export const OUTREACH_VARS: VarSpec[] = [
  {
    key: "owner_name",
    label: "Contact first name",
    description:
      "The first name of the person being emailed. Only a name that survived verification is used.",
    dataSource: "Subcontractor record, owner name",
    example: "Marcus",
    required: true,
    fallback: 'Resolves to "there", so the greeting reads "Hi there,".',
    category: "subcontractor",
  },
  {
    key: "opportunity_title",
    label: "Project title",
    description: "The title of the solicitation being bid.",
    dataSource: "Opportunity, title",
    example: "HVAC Maintenance Services, Building 36C",
    required: true,
    fallback: "None. Outreach is blocked, because the email cannot say what job this is.",
    category: "project",
  },
  {
    key: "solicitation_number",
    label: "Solicitation number",
    description: "The agency's own reference for this procurement.",
    dataSource: "Opportunity, solicitation number",
    example: "W912DR-26-R-0042",
    required: true,
    fallback: "None. Outreach is blocked.",
    category: "project",
  },
  {
    key: "agency",
    label: "Agency",
    description: "The government agency buying the work.",
    dataSource: "Opportunity, agency",
    example: "US Army Corps of Engineers",
    required: true,
    fallback: "None. Outreach is blocked.",
    category: "project",
  },
  {
    key: "location_state",
    label: "State",
    description: "The state the work is performed in, as a two-letter code.",
    dataSource: "Opportunity, location state",
    example: "VA",
    required: false,
    fallback: "Empty, and the sentence using it is dropped.",
    category: "project",
  },
  {
    key: "location_city_state",
    label: "City and state",
    description:
      "Where the work is actually performed, written out. Not the agency's address and not the subcontractor's.",
    dataSource: "Solicitation analysis location, then the opportunity's own location",
    example: "Richmond, Virginia",
    required: true,
    fallback:
      "Falls back to the state alone and flags the missing city for review. Outreach is blocked if neither is known.",
    category: "project",
  },
  {
    key: "trade",
    label: "Trade",
    description: "The trade this subcontractor is being asked to price.",
    dataSource: "The opportunity/subcontractor pairing",
    example: "HVAC",
    required: true,
    fallback: "None. Outreach is blocked.",
    category: "scope",
  },
  {
    key: "scope_summary",
    label: "Scope summary",
    description:
      "A short, trade-specific statement of what this subcontractor is pricing. Never the whole solicitation scope when they hold one trade.",
    dataSource: "Solicitation analysis, per-trade scope",
    example:
      "Replace 12 rooftop units across Buildings 3 and 4. This covers the mechanical work only; electrical feeders are covered separately.",
    required: true,
    fallback: "None. Outreach is blocked: there is nothing to quote.",
    category: "scope",
  },
  {
    key: "trade_scope_requirements",
    label: "Full trade scope",
    description:
      "The complete bullet list of work this subcontractor performs: labor, materials, quantities, locations, testing, cleanup and closeout.",
    dataSource: "Per-trade scope, the agency's bid schedule, and scope-shaped special requirements",
    example: "- Remove 12 existing rooftop units in Buildings 3 and 4\n- Test and balance before closeout",
    required: true,
    fallback: "None. Outreach is blocked.",
    category: "scope",
  },
  {
    key: "subcontractor_requirements",
    label: "Requirements on the sub",
    description:
      "Everything affecting their ability to perform or price: licenses, insurance, bonding, wage determinations, site visits, hours, permits, quote validity.",
    dataSource: "Solicitation qualifications, special requirements, site visit and acceptance period",
    example: "- License: State mechanical contractor license (required)\n- Site visit: August 14, 2099 (required)",
    required: false,
    fallback:
      "Empty when the solicitation states no conditions, and the section is left out rather than shown blank.",
    category: "requirements",
  },
  {
    key: "questions",
    label: "Questions for this sub",
    description:
      "Only the questions that apply to this trade and this opportunity, as a bullet list.",
    dataSource: "Solicitation analysis, questions for subs",
    example: "- Can your crew work the 7:00 AM to 3:30 PM window?",
    required: false,
    fallback: "Empty, and the questions section is left out.",
    category: "requirements",
  },
  {
    key: "deadline",
    label: "Government bid deadline",
    description:
      "When OUR bid is due to the agency. Never present this to a subcontractor as their own deadline.",
    dataSource: "Opportunity, deadline",
    example: "August 29, 2099 at 2:00 PM EDT",
    required: true,
    fallback: "None. Outreach is blocked.",
    category: "schedule",
  },
  {
    key: "quote_due_date",
    label: "Subcontractor quote due",
    description:
      "When this subcontractor's price must be back with us. Always earlier than the government deadline, by enough time to review, chase a replacement, apply markup and assemble the package.",
    dataSource: "Calculated back from the government deadline",
    example: "August 22, 2099 at 3:00 PM MDT",
    required: true,
    fallback:
      "None. If the bid is too close for any honest date, outreach is blocked rather than given a date nobody can meet.",
    category: "schedule",
  },
  {
    key: "estimated_start_date",
    label: "Estimated start",
    description: "When work is expected to begin, only when the solicitation says so.",
    dataSource: "Solicitation key dates",
    example: "October 1, 2099",
    required: false,
    fallback: "The line is left out entirely. Never estimated.",
    category: "schedule",
  },
  {
    key: "project_duration",
    label: "Project duration",
    description: "How long the work runs, only when the solicitation says so.",
    dataSource: "Solicitation period of performance",
    example: "180 calendar days from notice to proceed",
    required: false,
    fallback: "The line is left out entirely. Never guessed.",
    category: "schedule",
  },
  {
    key: "sender_name",
    label: "Your name",
    description:
      "The outreach name you send under. A first name or preferred public name, never a full legal name.",
    dataSource: "Company profile, outreach display name",
    example: "Jared",
    required: true,
    fallback: "None. Outreach is blocked rather than sent unsigned.",
    category: "sender",
  },
  {
    key: "company_name",
    label: "Your company",
    description: "Your company's name as the subcontractor should see it.",
    dataSource: "Company profile, legal name",
    example: "BROSTCO Holdings LLC",
    required: true,
    fallback: "None. Outreach is blocked.",
    category: "sender",
  },
  {
    key: "phone",
    label: "Your phone",
    description: "The number a subcontractor can call you back on.",
    dataSource: "Company profile, phone",
    example: "(800) 555-0199",
    required: true,
    fallback: "None. Outreach is blocked: a quote request with no way to reach us is not one.",
    category: "sender",
  },
];

export const OUTREACH_VAR_KEYS: readonly string[] = OUTREACH_VARS.map((v) => v.key);

const BY_KEY = new Map(OUTREACH_VARS.map((v) => [v.key, v]));

export function varSpec(key: string): VarSpec | undefined {
  return BY_KEY.get(key);
}

/**
 * Names that used to exist, or that read as though they should.
 *
 * Kept as a named list so the editor can say "use {{owner_name}}, it already
 * does that" instead of "unknown variable", which is the difference between a
 * fixable error and a mystifying one.
 */
export const RETIRED_VARS: Record<string, string> = {
  contact_first_name_or_there: "owner_name",
  scope_summary_short: "scope_summary",
  documents_url: "",
  reply_deadline_time_zone: "quote_due_date",
};

/** Every {{token}} a template body references, in order, deduplicated. */
export function referencedVars(template: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const m of template.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(key);
  }
  return found;
}

export interface UnknownVar {
  key: string;
  /** Set when the name is a known former one with a live replacement. */
  useInstead: string | null;
  message: string;
}

/** Variables a template uses that the system cannot fill. */
export function unknownVars(template: string): UnknownVar[] {
  return referencedVars(template)
    .filter((key) => !BY_KEY.has(key))
    .map((key) => {
      const replacement = RETIRED_VARS[key];
      if (replacement) {
        return {
          key,
          useInstead: replacement,
          message: `{{${key}}} is not a variable. Use {{${replacement}}}, which already does this.`,
        };
      }
      if (replacement === "") {
        return {
          key,
          useInstead: null,
          message: `{{${key}}} is not a variable. Documents are attached to the email automatically and listed at the bottom; they are not inserted as a link.`,
        };
      }
      return {
        key,
        useInstead: null,
        message: `{{${key}}} is not a variable this system can fill, so it would be sent to a subcontractor as raw text.`,
      };
    });
}

// --- Resolution -----------------------------------------------------------

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
  VI: "Virgin Islands", GU: "Guam",
};

/** Words that mean the "name" on a contact record is not a person's name. */
const COMPANY_WORDS_RE =
  /\b(inc|llc|l\.l\.c|ltd|corp|corporation|company|co|holdings|group|services|service|contracting|contractors?|construction|enterprises|associates|partners|systems|solutions|industries|supply|mechanical|electrical|plumbing|roofing|hvac)\b\.?/i;

const NOT_A_NAME_RE = /^(n\/?a|none|unknown|null|undefined|test|info|sales|office|admin|contact|owner|manager|estimator)$/i;

/**
 * The first name to greet someone by, or "there".
 *
 * Contact records are populated from directory scrapes and forms, so the
 * "owner name" field routinely holds a company, an email address, a job title,
 * or the literal string "null". Every one of those produces a greeting that
 * tells the recipient immediately that this is bulk mail: "Hi Precision
 * Mechanical LLC," is worse than no name at all.
 *
 * "there" is not a failure here. It is the correct answer whenever the record
 * does not actually know who is being written to.
 */
export function resolveGreetingName(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "there";
  // An email address is not a name, and neither is anything containing one.
  if (value.includes("@")) return "there";
  if (COMPANY_WORDS_RE.test(value)) return "there";

  const first = value.split(/[\s,]+/)[0]?.replace(/[^\p{L}'-]/gu, "") ?? "";
  if (!first) return "there";
  if (first.length < 2) return "there";
  if (NOT_A_NAME_RE.test(first)) return "there";
  // A token with digits in it came from a scrape, not from a person.
  if (/\d/.test(value.split(/[\s,]+/)[0] ?? "")) return "there";

  // Title case, because scraped names arrive as "MARCUS" or "marcus".
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

/** "Richmond, Virginia" from whatever location text we actually hold. */
export function resolveCityState(input: {
  analysisLocation?: string | null;
  locationText?: string | null;
  locationState?: string | null;
}): { value: string; cityKnown: boolean } {
  const state = (input.locationState ?? "").trim().toUpperCase();
  const stateName = STATE_NAMES[state] ?? "";

  for (const raw of [input.analysisLocation, input.locationText]) {
    const text = (raw ?? "").trim();
    if (!text || /^(not specified|n\/?a|tbd|unknown)\b/i.test(text)) continue;

    /*
     * Pull "City, ST" or "City, State" out of whatever the analyst wrote.
     * Location text arrives as everything from "Richmond, VA 23219" to
     * "Defense Supply Center Richmond, Virginia", so this looks for the
     * comma-separated pair rather than assuming the whole string is one.
     */
    const m = text.match(/([A-Za-z][A-Za-z.'\- ]{1,40}),\s*([A-Za-z]{2}|[A-Za-z ]{4,20})\b/);
    if (m) {
      const city = m[1].trim().replace(/\s+/g, " ");
      const tail = m[2].trim();
      const resolved =
        STATE_NAMES[tail.toUpperCase()] ??
        (Object.values(STATE_NAMES).find((n) => n.toLowerCase() === tail.toLowerCase()) ||
          "");
      if (city && resolved) return { value: `${city}, ${resolved}`, cityKnown: true };
    }
  }

  if (stateName) return { value: stateName, cityKnown: false };
  return { value: "", cityKnown: false };
}

/** A start date only if the solicitation actually names one. */
export function resolveStartDate(
  keyDates: { label: string; date: string }[] | null | undefined
): string {
  for (const row of keyDates ?? []) {
    const label = (row?.label ?? "").trim();
    const date = (row?.date ?? "").trim();
    if (!label || !date) continue;
    if (/^(not specified|n\/?a|tbd|unknown)\b/i.test(date)) continue;
    /*
     * Deliberately narrow. "Award date" is not a start date, and treating it
     * as one puts a date in front of a subcontractor that the solicitation
     * never promised.
     */
    if (/\b(start|commence|notice to proceed|ntp|period of performance begins)\b/i.test(label)) {
      return date;
    }
  }
  return "";
}

export interface ResolveVarsInput {
  sub: { owner_name?: string | null } | null;
  opportunity: {
    title?: string | null;
    agency?: string | null;
    solicitation_number?: string | null;
    location_state?: string | null;
    location_text?: string | null;
    deadline?: string | null;
  };
  analysis?: Parameters<typeof buildOutreachRequirements>[0]["analysis"] & {
    location?: string | null;
    key_dates?: { label: string; date: string }[] | null;
    questions_for_subs?: string[] | null;
    period_of_performance?: string | null;
  };
  profile: {
    legal_name?: string | null;
    outreach_display_name?: string | null;
    owner_name?: string | null;
    phone?: string | null;
    entity_state?: string | null;
  };
  trade?: string | null;
  description?: string | null;
  /**
   * Override for the formatted government deadline.
   *
   * Normally omitted: the resolver formats it itself, because it is the only
   * place that knows which timezone to say it in, and a deadline formatted
   * before that is known comes out in the server's zone.
   */
  deadlineLabel?: string;
  now?: Date;
}

export interface ResolvedVars {
  vars: Record<string, string>;
  /** Required variables that came back empty. Non-empty means: do not send. */
  missingRequired: string[];
  /** Things an operator should know but that do not stop a send. */
  warnings: string[];
  quote: QuoteDeadline;
  requirements: OutreachRequirements;
  /** The one sentence bounding what this sub prices. Not a template variable. */
  scopeBoundary: string;
}

export function resolveOutreachVars(input: ResolveVarsInput): ResolvedVars {
  const warnings: string[] = [];
  const a = input.analysis ?? {};
  const opp = input.opportunity;
  const profile = input.profile;

  const requirements = buildOutreachRequirements({
    trade: input.trade,
    analysis: a,
    description: input.description,
  });
  warnings.push(...requirements.gaps);

  const city = resolveCityState({
    analysisLocation: a.location,
    locationText: opp.location_text,
    locationState: opp.location_state,
  });
  if (city.value && !city.cityKnown) {
    warnings.push(
      `No city could be resolved for this opportunity, so the email says "${city.value}" alone. Confirm the place of performance before relying on travel or crew pricing.`
    );
  }

  const { timeZone, derivedFrom } = resolveTimeZone({
    senderState: profile.entity_state,
    projectState: opp.location_state,
  });
  if (derivedFrom === "fallback") {
    warnings.push(
      "Neither your company nor this opportunity has a state set, so quote deadlines are being written in Eastern time. Set your state in the company profile."
    );
  }
  const quote = computeQuoteDeadline({
    deadline: opp.deadline ?? null,
    timeZone,
    now: input.now,
  });
  if (quote.warning) warnings.push(quote.warning);

  /*
   * The scope summary is the trade's work, said briefly, with the boundary
   * spelled out. The boundary sentence is the part that stops a subcontractor
   * pricing another trade's work: without it, a scope drawn from the whole
   * project reads as an invitation to quote all of it.
   */
  const scopeLines = requirements.tradeScope.map((i) => i.text);
  const tradeLabel = (input.trade ?? "").trim();
  /*
   * The boundary is kept separate from the summary on purpose.
   *
   * {{scope_summary}} is a standalone variable an operator may drop into a
   * template body, so it has to read as a complete statement. The generated
   * Scope section already lists every line underneath, so printing the
   * summary there too put the same three sentences on screen twice, once
   * joined and once as bullets. The section prints the bullets and this one
   * sentence, which is the part that is not already there.
   */
  const scopeBoundary = tradeLabel
    ? requirements.tradeSpecific
      ? `Please price the ${tradeLabel} scope only.`
      : `Please price the ${tradeLabel} portion of this work only; other trades are being quoted separately.`
    : "";
  const scopeSummary = [scopeLines.slice(0, 3).join(" "), scopeBoundary]
    .filter(Boolean)
    .join(" ");

  const questions = (a.questions_for_subs ?? [])
    .map((q) => String(q ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((q) => !/^(not specified|n\/?a|none)\b/i.test(q))
    .slice(0, 6);

  const startDate = resolveStartDate(a.key_dates);
  const duration = (() => {
    const pop = String(a.period_of_performance ?? "").trim();
    return /^(not specified|n\/?a|tbd|unknown)\b/i.test(pop) ? "" : pop;
  })();

  const senderName =
    (profile.outreach_display_name ?? "").trim() ||
    // First token only. A subcontractor-facing email never carries a surname.
    (profile.owner_name ?? "").trim().split(/\s+/)[0] ||
    "";

  const vars: Record<string, string> = {
    owner_name: resolveGreetingName(input.sub?.owner_name),
    opportunity_title: (opp.title ?? "").trim(),
    solicitation_number: (opp.solicitation_number ?? "").trim(),
    agency: (opp.agency ?? "").trim(),
    location_state: (opp.location_state ?? "").trim(),
    location_city_state: city.value,
    trade: tradeLabel,
    scope_summary: scopeSummary,
    trade_scope_requirements: renderRequirementLines(requirements.tradeScope, {
      markMandatory: false,
    })
      .map((l) => `- ${l}`)
      .join("\n"),
    subcontractor_requirements: renderRequirementLines(requirements.subRequirements)
      .map((l) => `- ${l}`)
      .join("\n"),
    questions: questions.map((q) => `- ${q}`).join("\n"),
    deadline: input.deadlineLabel ?? formatDeadlineLabel(opp.deadline ?? null, timeZone),
    quote_due_date: quote.label,
    estimated_start_date: startDate,
    project_duration: duration,
    sender_name: senderName,
    company_name: (profile.legal_name ?? "").trim(),
    phone: (profile.phone ?? "").trim(),
  };

  const missingRequired = OUTREACH_VARS.filter(
    (spec) => spec.required && !(vars[spec.key] ?? "").trim()
  ).map((spec) => spec.key);

  return { vars, missingRequired, warnings, quote, requirements, scopeBoundary };
}

/** Sample values for the editor palette and preview, straight from the specs. */
export const OUTREACH_VAR_SAMPLES: Record<string, string> = Object.fromEntries(
  OUTREACH_VARS.map((v) => [v.key, v.example])
);
