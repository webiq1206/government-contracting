/**
 * The two lists a subcontractor needs before it can put a number on anything:
 * what work it is being asked to perform, and what it must satisfy to perform
 * it.
 *
 * These used to be one sentence apiece. {{scope_summary}} was the trade's work
 * text with the location, the deadline and a few requirements glued on with
 * spaces, and everything else -- the licence, the wage determination, the
 * mandatory site visit, the quote validity period -- either appeared as a
 * generic "worth knowing" footnote or did not appear at all. A subcontractor
 * that learns about a mandatory site visit after quoting has either priced
 * wrong or wasted its time, and either way it stops answering our emails.
 *
 * So the scope and the conditions are separated and each is built as a list of
 * discrete, checkable items with its origin recorded.
 *
 * The hard rule, and the reason this module is so conservative: NOTHING here
 * is generated. Every item traces to a field the analyst extracted from the
 * solicitation. Where the solicitation is silent this reports a gap rather
 * than filling it, because a requirement we invented is one the subcontractor
 * prices against and then disputes when it is not in the contract.
 *
 * Pure. No database, no Claude, no I/O.
 */

import { toScannable } from "./scannable";
import { resolveSubWork } from "./sub-work";

/** Where an item came from, so an operator can go and check it. */
export type RequirementSource =
  | "trade_scope"
  | "bid_schedule"
  | "special_requirements"
  | "qualifications"
  | "site_visit"
  | "prebid_meeting"
  | "submission"
  | "period_of_performance"
  | "offer_acceptance"
  | "key_date"
  | "scope_fallback";

export interface RequirementItem {
  text: string;
  /** True only when the solicitation says so; never assumed. */
  mandatory: boolean;
  source: RequirementSource;
}

export interface OutreachRequirements {
  /** What this subcontractor is being asked to build, install or perform. */
  tradeScope: RequirementItem[];
  /** What it must hold, attend, carry or submit in order to do that. */
  subRequirements: RequirementItem[];
  /** True when the scope is this trade's, not the whole project's. */
  tradeSpecific: boolean;
  /** Plain-English notes for the operator about what could not be found. */
  gaps: string[];
}

interface AnalysisLike {
  trade_scopes?: { trade: string; work: string }[] | null;
  draft_sow?: string | null;
  scope_plain_language?: string | null;
  project_overview?: string | null;
  special_requirements?: string[] | null;
  qualifications?: {
    certifications?: string[];
    licenses?: string[];
    insurance?: string[];
    bonding?: string[];
    experience?: string[];
    other?: string[];
  } | null;
  site_visit?: { required?: boolean; details?: string } | null;
  prebid_meeting?: { required?: boolean; details?: string } | null;
  submission_requirements?: string[] | null;
  period_of_performance?: string | null;
  offer_acceptance_period?: string | null;
  key_dates?: { label: string; date: string }[] | null;
  bid_schedule?: Array<{
    clin?: string;
    description: string;
    quantity?: string;
    unit?: string;
  }> | null;
}

/** The analyst's way of saying "the documents do not answer this". */
const NOT_SPECIFIED_RE = /^(not specified|not stated|n\/?a|tbd|unknown|none|-)\b/i;

function clean(v: unknown): string {
  const s = String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return NOT_SPECIFIED_RE.test(s) ? "" : s;
}

/**
 * Words that mark a requirement the sub cannot decline.
 *
 * Deliberately narrow. Reading "should" or "may" as mandatory over-promises on
 * the subcontractor's behalf, and a wrongly-mandatory line is the kind of
 * thing that gets a quote withdrawn.
 */
const MANDATORY_RE = /\b(mandatory|required|must|shall|non-?negotiable|prior to award)\b/i;

/** Conditions on being allowed to do the work, rather than the work itself. */
const CONDITION_RE =
  /\b(licen[cs]|certif|insur|bond|wage determination|davis-?bacon|prevailing wage|background check|clearance|badg|safety|osha|permit|submittal|warrant|payment term|invoic|quote (?:format|validity)|pricing schedule|working hours|hours of work|hours of \d|restricted to hours|after hours|escort|drug test|e-?verify|apprentice|union|travel|per diem|mobiliz)/i;

/** Work: things done on site, with hands and equipment. */
const SCOPE_RE =
  /\b(install|remove|replace|demolish|furnish|supply|provide|construct|repair|paint|weld|excavat|haul|dispos|clean|test|inspect|commission|calibrat|closeout|punch list|as-?built|alternate|option|exclu|quantit|square feet|linear feet)/i;

function item(
  text: string,
  source: RequirementSource,
  mandatory?: boolean
): RequirementItem | null {
  const t = clean(text);
  if (!t) return null;
  return { text: t, mandatory: mandatory ?? MANDATORY_RE.test(t), source };
}

/** Same requirement written twice by two extractors is still one requirement. */
function dedupe(items: RequirementItem[]): RequirementItem[] {
  const seen = new Set<string>();
  const out: RequirementItem[] = [];
  for (const it of items) {
    const key = it.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function mentionsTrade(text: string, trade: string): boolean {
  const t = trade.trim().toLowerCase();
  if (!t) return false;
  if (text.toLowerCase().includes(t)) return true;
  // "electrical" should match a scope written as "electric".
  const stem = t.replace(/(ing|ion|al|s)$/i, "");
  return stem.length >= 4 && text.toLowerCase().includes(stem);
}

export function buildOutreachRequirements(input: {
  trade?: string | null;
  analysis?: AnalysisLike | null;
  /** The notice text, used only when the analyst produced no scope at all. */
  description?: string | null;
}): OutreachRequirements {
  const a = input.analysis ?? {};
  const trade = clean(input.trade);
  const gaps: string[] = [];

  // --- What they are pricing ----------------------------------------------
  const subWork = resolveSubWork({
    trade: input.trade,
    analysis: a,
    description: input.description,
    maxChars: 4000,
  });

  const tradeScope: RequirementItem[] = [];
  if (subWork.work) {
    const parsed = toScannable(subWork.work);
    const lines = parsed
      ? parsed.kind === "bullets"
        ? parsed.items
        : [parsed.text]
      : [];
    for (const line of lines) {
      const it = item(
        line,
        subWork.source === "trade_scope" ? "trade_scope" : "scope_fallback"
      );
      if (it) tradeScope.push(it);
    }
  }

  if (!subWork.tradeSpecific && trade) {
    gaps.push(
      `The analysis has no scope written specifically for ${trade}, so this email describes the project scope instead. A subcontractor pricing from it may include work another trade is covering.`
    );
  }

  /*
   * The agency's own priced line items, which is where the quantities live.
   * Without these a scope says what to install and not how many, and every
   * price that comes back is a guess dressed as a quote.
   */
  const clins = (a.bid_schedule ?? []).filter((row) => clean(row?.description));
  const tradeClins = trade
    ? clins.filter((row) => mentionsTrade(clean(row.description), trade))
    : [];
  // Only attach the agency's line items when they name this trade. Pasting an
  // unrelated CLIN into a scope invites a price for work someone else is doing.
  for (const row of tradeClins) {
    const qty = [clean(row.quantity), clean(row.unit)].filter(Boolean).join(" ");
    const label = clean(row.clin) ? `${clean(row.clin)}: ` : "";
    const it = item(
      `${label}${clean(row.description)}${qty ? ` (${qty})` : ""}`,
      "bid_schedule"
    );
    if (it) tradeScope.push(it);
  }

  // Scope-shaped special requirements: testing, cleanup, disposal, closeout,
  // alternates and exclusions all arrive here rather than in trade_scopes.
  for (const raw of a.special_requirements ?? []) {
    const text = clean(raw);
    if (!text || text.length > 300) continue;
    if (CONDITION_RE.test(text)) continue; // that is a condition, handled below
    if (!SCOPE_RE.test(text)) continue;
    if (trade && !mentionsTrade(text, trade) && !SCOPE_RE.test(text)) continue;
    const it = item(text, "special_requirements");
    if (it) tradeScope.push(it);
  }

  if (!tradeScope.length) {
    gaps.push(
      "No scope could be assembled for this trade. Nothing in the analysis says what this subcontractor would be pricing."
    );
  }
  if (!tradeClins.length && !tradeScope.some((i) => /\d/.test(i.text))) {
    gaps.push(
      "The scope carries no quantities or measurements, so any price returned will be an estimate rather than a quote."
    );
  }

  // --- What they must satisfy ---------------------------------------------
  const subRequirements: RequirementItem[] = [];

  const q = a.qualifications ?? {};
  const qualGroups: [string[] | undefined, string][] = [
    [q.licenses, "License"],
    [q.certifications, "Certification"],
    [q.insurance, "Insurance"],
    [q.bonding, "Bonding"],
    [q.experience, "Experience"],
    [q.other, ""],
  ];
  for (const [list, label] of qualGroups) {
    for (const raw of list ?? []) {
      const text = clean(raw);
      if (!text) continue;
      /*
       * Qualifications are prerequisites by definition: the solicitation is
       * listing what a bidder has to hold. Labelling them mandatory is
       * reporting the field's meaning, not inferring one.
       */
      const it = item(label ? `${label}: ${text}` : text, "qualifications", true);
      if (it) subRequirements.push(it);
    }
  }

  if (a.site_visit?.required) {
    const details = clean(a.site_visit.details);
    subRequirements.push({
      text: `Site visit: ${details || "required, details to be confirmed"}`,
      mandatory: true,
      source: "site_visit",
    });
    if (!details) {
      gaps.push(
        "A site visit is required but the analysis has no date or location for it, so the email cannot tell a subcontractor when to be there."
      );
    }
  }
  if (a.prebid_meeting?.required) {
    const details = clean(a.prebid_meeting.details);
    subRequirements.push({
      text: `Pre-bid meeting: ${details || "required, details to be confirmed"}`,
      mandatory: true,
      source: "prebid_meeting",
    });
  }

  // Condition-shaped special requirements: wages, clearances, hours, permits.
  for (const raw of a.special_requirements ?? []) {
    const text = clean(raw);
    if (!text || text.length > 300) continue;
    if (!CONDITION_RE.test(text)) continue;
    const it = item(text, "special_requirements");
    if (it) subRequirements.push(it);
  }

  // Submission requirements only when they bear on what the SUB sends us.
  for (const raw of a.submission_requirements ?? []) {
    const text = clean(raw);
    if (!text || text.length > 300) continue;
    if (!CONDITION_RE.test(text)) continue;
    const it = item(text, "submission");
    if (it) subRequirements.push(it);
  }

  const pop = clean(a.period_of_performance);
  if (pop) {
    subRequirements.push({
      text: `Period of performance: ${pop}`,
      mandatory: false,
      source: "period_of_performance",
    });
  }

  const acceptance = clean(a.offer_acceptance_period);
  if (acceptance) {
    // How long our bid must stay firm is how long their price must stay firm.
    subRequirements.push({
      text: `Quote must remain valid for ${acceptance}`,
      mandatory: true,
      source: "offer_acceptance",
    });
  }

  return {
    tradeScope: dedupe(tradeScope),
    subRequirements: dedupe(subRequirements),
    tradeSpecific: subWork.tradeSpecific,
    gaps,
  };
}

/**
 * Render a list for an email body.
 *
 * `markMandatory` is off for scope lines on purpose: everything in a scope is
 * required by definition, so tagging some lines "(required)" and not others
 * implies the untagged ones are optional. The marker earns its place only in
 * the requirements list, where some items genuinely are conditional.
 */
export function renderRequirementLines(
  items: RequirementItem[],
  opts: { markMandatory?: boolean } = {}
): string[] {
  const mark = opts.markMandatory ?? true;
  return items.map((i) => (mark && i.mandatory ? `${i.text} (required)` : i.text));
}
