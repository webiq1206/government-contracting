/**
 * What it actually takes to bid this job, as a classified list rather than
 * prose the reader has to interpret.
 *
 * The Solicitation Analyst already extracts a compliance_matrix: every
 * deliverable the solicitation demands, each with mandatory, signature_required,
 * official_form and satisfied_by. That is the most useful thing the platform
 * knows about an opportunity, and until now it only appeared once a bid row
 * existed, which is late in the pipeline. Someone deciding whether to pursue saw
 * "Submission requirements" as a flat bullet list, mixed in with evaluation
 * criteria and special requirements, several clicks inside a collapsed block,
 * with nothing marking which items would get their bid thrown out.
 *
 * This turns all of it into one deduplicated list where every item says how
 * important it is, who has to do it, and whether missing it is fatal. Four
 * sources overlap heavily (the matrix restates the forms, the forms restate the
 * submission requirements), so merging them is most of the work.
 *
 * Pure. Invents no requirement that is not in the analysis.
 */

import type {
  ComplianceRequirement,
  MeetingInfo,
  Qualifications,
  RequiredForm,
} from "@/lib/types";

/** How much trouble skipping this causes. */
export type Importance = "required" | "recommended" | "optional" | "info";

/** Who has to produce it. */
export type Owner = "platform" | "you";

export interface BriefRequirement {
  id: string;
  /** Short, plain-English, one line. */
  label: string;
  /** Format rules, instructions, or where the solicitation says it. */
  detail?: string;
  importance: Importance;
  owner: Owner;
  /**
   * True when skipping this gets the bid rejected AND a person has to act.
   * Platform-generated items are mandatory too, but the operator cannot forget
   * them, so flagging those as well would bury the ones that matter.
   */
  disqualifying: boolean;
  /** Plain-language reason, shown next to the warning. */
  disqualifyingReason?: string;
  /** Plain-English gloss of any jargon in the label. */
  explain?: string;
  source?: string;
  needsSignature?: boolean;
  officialForm?: string;
}

export interface OpportunityBrief {
  /** Everything to bid, most consequential first. */
  requirements: BriefRequirement[];
  /** The subset that can get the bid thrown out. */
  disqualifiers: BriefRequirement[];
  /** True when nothing was extracted, so the UI can say so honestly. */
  empty: boolean;
  counts: { required: number; recommended: number; optional: number; info: number };
}

export interface OpportunityBriefInput {
  complianceMatrix?: ComplianceRequirement[] | null;
  submissionRequirements?: string[] | null;
  requiredForms?: RequiredForm[] | null;
  qualifications?: Qualifications | null;
  prebidMeeting?: MeetingInfo | null;
  siteVisit?: MeetingInfo | null;
  specialRequirements?: string[] | null;
}

const NA = /^not specified|^n\/?a\b|^none\b|^tbd\b/i;

/** "shall submit a signed copy" is required; "may include" is not. */
const MUST = /\b(must|shall|required?|mandatory|is due|no later than|will be rejected)\b/i;
const SHOULD = /\b(should|recommend(ed)?|encouraged|strongly urged|advisable)\b/i;
const MAY = /\b(may|optional|if applicable|at the offeror'?s? discretion|as desired)\b/i;

/**
 * Jargon a first-time bidder will not know, with the shortest honest gloss.
 * Matched case-insensitively against a requirement's text.
 */
const PLAIN_LANGUAGE: { pattern: RegExp; explain: string }[] = [
  {
    pattern: /\bSF[-\s]?1449\b/i,
    explain:
      "SF-1449 is the standard federal order form. The agency's own copy has to be signed and returned; a lookalike will not be accepted.",
  },
  {
    pattern: /\bSF[-\s]?33\b/i,
    explain:
      "SF-33 is the standard solicitation and award form. Page 1 carries your offer and signature.",
  },
  {
    pattern: /\breps?\s*(and|&)\s*certs?\b|\brepresentations and certifications\b/i,
    explain:
      "Representations and certifications: a set of yes/no statements about your business (size, ownership, tax status). Most are answered once in SAM.gov and reused.",
  },
  {
    pattern: /\bSAM\.gov\b|\bSAM registration\b|\bactive registration in SAM\b/i,
    explain:
      "SAM.gov is the federal contractor register. Registration must be active on the due date or the bid cannot be accepted.",
  },
  {
    pattern: /\bDavis[-\s]?Bacon\b|\bwage determination\b/i,
    explain:
      "Davis-Bacon sets minimum wages for construction labor on federal jobs. Your subcontractors must price at those rates, which are usually higher than local market pay.",
  },
  {
    pattern: /\bService Contract Act\b|\bSCA\b/,
    explain:
      "The Service Contract Act sets minimum wages and benefits for service work on federal contracts. It raises labor cost, so quotes have to account for it.",
  },
  {
    pattern: /\bbid bond\b|\bperformance bond\b|\bpayment bond\b/i,
    explain:
      "A bond is a guarantee bought from a surety company. It takes time to obtain, so start before the due date rather than the week of.",
  },
  {
    pattern: /\bcertificate of insurance\b|\bCOI\b/,
    explain:
      "A certificate of insurance is proof of coverage issued by your insurer, usually naming the agency. Your broker produces it, often same-day.",
  },
  {
    pattern: /\bamendments?\b|\baddend(um|a)\b/i,
    explain:
      "Amendments change the solicitation after it was posted. Each one usually has to be acknowledged in your bid; an unacknowledged amendment is a common reason bids are rejected.",
  },
  {
    pattern: /\bpast performance\b|\bCPARS\b/i,
    explain:
      "Past performance is evidence your company has done similar work before, usually as references the agency may contact.",
  },
  {
    pattern: /\bsite visit\b|\bpre[-\s]?bid\b|\bpre[-\s]?proposal conference\b/i,
    explain:
      "A walkthrough of the work site before bidding. When attendance is mandatory, skipping it disqualifies you no matter how good the price is.",
  },
  {
    pattern: /\bFAR\b|\bDFARS\b/,
    explain:
      "The FAR is the federal procurement rulebook. A clause reference points at a rule the contract will hold you to.",
  },
];

function explainFor(text: string): string | undefined {
  return PLAIN_LANGUAGE.find((t) => t.pattern.test(text))?.explain;
}

function clean(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return !s || NA.test(s) ? "" : s;
}

/**
 * Reduce a requirement to the words that identify it, so the same thing stated
 * three different ways collapses to one entry. "Signed SF-1449 (offer form)",
 * "SF-1449" and "Submit a completed SF 1449" all key to "sf1449".
 */
const NOISE = new RegExp(
  "\\b(a|an|the|of|for|to|in|on|with|and|or|is|are|be|must|shall|should|may|" +
    "submit|submitted|submission|provide|provided|include|included|complete|" +
    "completed|signed|sign|copy|copies|form|forms|document|documents|attach|" +
    "attached|attachment|required|offeror|contractor|bidder|your|all|one|each)\\b",
  "gi"
);

/**
 * Government form identifiers, normalised. "SF-1449", "SF 1449" and "sf1449"
 * are the same document, and a form number is the strongest identity signal a
 * requirement has: the matrix calls it "Signed SF-1449 (offer form)" while the
 * submission instructions say "Offerors must submit a completed and signed SF
 * 1449", and those are one obligation, not two.
 */
const FORM_ID = /\b(sf|std|dd|da|gsa|w|opt)[\s-]?(\d{1,4})\b/i;

function formId(text: string): string | null {
  const m = FORM_ID.exec(text);
  return m ? `${m[1].toLowerCase()}${m[2]}` : null;
}

/** The words that carry meaning once boilerplate is stripped. */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(NOISE, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

/** Stable React key. Not used for matching. */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || text;
}

interface Fingerprint {
  form: string | null;
  words: Set<string>;
}

function fingerprint(text: string): Fingerprint {
  return { form: formId(text), words: tokens(text) };
}

function isSubset(small: Set<string>, large: Set<string>): boolean {
  if (small.size === 0) return false;
  for (const w of small) if (!large.has(w)) return false;
  return true;
}

/**
 * Two entries describe the same obligation when they name the same form, or
 * when one is a restatement of the other with no extra substance.
 */
function sameThing(a: Fingerprint, b: Fingerprint): boolean {
  if (a.form && b.form) return a.form === b.form;
  const [small, large] =
    a.words.size <= b.words.size ? [a.words, b.words] : [b.words, a.words];
  return isSubset(small, large);
}

function classifyText(text: string): Importance {
  if (MUST.test(text)) return "required";
  if (SHOULD.test(text)) return "recommended";
  if (MAY.test(text)) return "optional";
  // A submission requirement with no hedging language is an instruction, and
  // treating it as optional is the more dangerous guess.
  return "required";
}

const ORDER: Record<Importance, number> = {
  required: 0,
  recommended: 1,
  optional: 2,
  info: 3,
};

export function buildOpportunityBrief(
  input: OpportunityBriefInput
): OpportunityBrief {
  const out: BriefRequirement[] = [];
  const seen: Fingerprint[] = [];

  /** Add unless something equivalent is already listed. */
  const push = (req: BriefRequirement, identity: string) => {
    const fp = fingerprint(identity);
    if (seen.some((existing) => sameThing(existing, fp))) return;
    seen.push(fp);
    out.push(req);
  };

  // --- The compliance matrix is the most structured source, so it goes first
  // and everything else dedupes against it. ------------------------------------
  for (const r of input.complianceMatrix ?? []) {
    const label = clean(r?.title);
    if (!label) continue;
    const owner: Owner =
      r.satisfied_by === "auto_generated" || r.satisfied_by === "from_profile"
        ? "platform"
        : "you";
    const detail = [clean(r.instructions), clean(r.format)].filter(Boolean).join(" ");
    const disqualifying = Boolean(r.mandatory) && owner === "you";
    push(
      {
        id: r.id || slug(label),
        label,
        detail: detail || undefined,
        importance: r.mandatory ? "required" : "optional",
        owner,
        disqualifying,
        disqualifyingReason: disqualifying
          ? r.official_form
            ? `The agency's own ${r.official_form} has to be used. A substitute is rejected.`
            : r.signature_required
              ? "Required and needs your signature, so it cannot be produced automatically."
              : "Required, and only you can supply it."
          : undefined,
        explain: explainFor(`${label} ${detail}`),
        source: clean(r.source) || undefined,
        needsSignature: r.signature_required || undefined,
        officialForm: clean(r.official_form) || undefined,
      },
      label
    );
  }

  // --- Named forms. Usually already in the matrix; kept for analyses that
  // predate it or where extraction found the form but not the matrix row. ------
  for (const f of input.requiredForms ?? []) {
    const label = clean(f?.name);
    if (!label) continue;
    push(
      {
        id: `form:${slug(label)}`,
        label,
        detail: clean(f.note) || undefined,
        importance: "required",
        owner: "you",
        disqualifying: true,
        disqualifyingReason: "A required form. A bid missing it is rejected unread.",
        explain: explainFor(`${label} ${clean(f.note)}`),
      },
      label
    );
  }

  // --- Free-text submission instructions. -------------------------------------
  for (const s of input.submissionRequirements ?? []) {
    const label = clean(String(s ?? ""));
    if (!label) continue;
    const importance = classifyText(label);
    push(
      {
        id: `sub:${slug(label)}`,
        label,
        importance,
        owner: "you",
        disqualifying: importance === "required",
        disqualifyingReason:
          importance === "required"
            ? "The solicitation states this as a condition of a valid bid."
            : undefined,
        explain: explainFor(label),
      },
      label
    );
  }

  // --- Eligibility. You either hold these on the due date or you cannot bid. ---
  const q = input.qualifications ?? {};
  const QUAL_GROUPS: { items?: string[]; noun: string }[] = [
    { items: q.certifications, noun: "certification" },
    { items: q.licenses, noun: "license" },
    { items: q.insurance, noun: "insurance requirement" },
    { items: q.bonding, noun: "bonding requirement" },
    { items: q.experience, noun: "experience requirement" },
    { items: q.other, noun: "requirement" },
  ];
  for (const group of QUAL_GROUPS) {
    for (const item of group.items ?? []) {
      const label = clean(String(item ?? ""));
      if (!label) continue;
      push(
        {
          id: `qual:${slug(label)}`,
          label,
          importance: "required",
          owner: "you",
          disqualifying: true,
          disqualifyingReason: `An eligibility ${group.noun}. Without it the bid cannot be accepted, however good the price.`,
          explain: explainFor(label),
        },
        label
      );
    }
  }

  // --- Meetings. A mandatory walkthrough is one of the most common ways a
  // good bid gets thrown out, so it is never buried. ---------------------------
  const MEETINGS: { info?: MeetingInfo | null; label: string }[] = [
    { info: input.prebidMeeting, label: "Pre-bid meeting" },
    { info: input.siteVisit, label: "Site visit" },
  ];
  for (const m of MEETINGS) {
    if (!m.info) continue;
    const detail = clean(m.info.details);
    push(
      {
        id: `meeting:${slug(m.label)}`,
        label: m.info.required ? `${m.label} (attendance required)` : `${m.label} (optional)`,
        detail: detail || undefined,
        importance: m.info.required ? "required" : "optional",
        owner: "you",
        disqualifying: Boolean(m.info.required),
        disqualifyingReason: m.info.required
          ? "Attendance is mandatory. Bids from companies that did not attend are not evaluated."
          : undefined,
        explain: explainFor(`${m.label} ${detail}`),
      },
      m.label
    );
  }

  // --- Special requirements are context for pricing, not deliverables. --------
  for (const s of input.specialRequirements ?? []) {
    const label = clean(String(s ?? ""));
    if (!label) continue;
    // Always context, never a deliverable. "Work must occur between 6pm and
    // 6am" contains "must", but filing it under required items tells the
    // reader to go submit something, and there is nothing to submit.
    push(
      {
        id: `special:${slug(label)}`,
        label,
        importance: "info",
        owner: "you",
        disqualifying: false,
        explain: explainFor(label),
      },
      label
    );
  }

  const requirements = out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      // Disqualifiers first inside each importance band, then original order,
      // so the reader meets the fatal items before the routine ones.
      const byImportance = ORDER[a.r.importance] - ORDER[b.r.importance];
      if (byImportance !== 0) return byImportance;
      if (a.r.disqualifying !== b.r.disqualifying) return a.r.disqualifying ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ r }) => r);

  const counts = { required: 0, recommended: 0, optional: 0, info: 0 };
  for (const r of requirements) counts[r.importance] += 1;

  return {
    requirements,
    disqualifiers: requirements.filter((r) => r.disqualifying),
    empty: requirements.length === 0,
    counts,
  };
}
