/**
 * What a firm can take on, said in the words an estimator would use.
 *
 * The record held identity and contact details and almost nothing about
 * capability, so the questions that actually decide whether a firm goes on a
 * bid lived in somebody's head: can they cover this county, can they carry a
 * job this size, are they bonded to this amount, do they hold the
 * certification this solicitation sets aside for.
 *
 * Every value here is optional and every absent value renders as "Not on
 * file". None of them falls back to zero. A firm nobody has asked about their
 * crew size does not have a crew of nobody, and a bonding capacity of $0 is a
 * statement this record has never been in a position to make.
 *
 * Pure.
 */

export const CONTACT_ROLES = ["estimator", "owner", "foreman", "office", "accounts", "other"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = {
  estimator: "Estimator",
  owner: "Owner",
  foreman: "Foreman",
  office: "Office manager",
  accounts: "Accounts",
  other: "Other",
};

/** Who a quote request should go to, in order of who is likeliest to price it. */
export const QUOTING_ROLES: readonly ContactRole[] = ["estimator", "owner", "office"];

export const PREFERRED_CONTACT = ["email", "phone", "text"] as const;
export type PreferredContact = (typeof PREFERRED_CONTACT)[number];

export const PREFERRED_CONTACT_LABEL: Record<PreferredContact, string> = {
  email: "Email",
  phone: "Phone call",
  text: "Text message",
};

/**
 * How much of this record to believe.
 *
 * A row a sourcing agent built from a map listing is not the same kind of
 * fact as one an estimator typed after a phone call, and the roster showed
 * them identically. Ordered weakest to strongest so a comparison is a
 * comparison rather than a lookup table.
 */
export const SOURCE_CONFIDENCE = ["inferred", "reported", "confirmed"] as const;
export type SourceConfidence = (typeof SOURCE_CONFIDENCE)[number];

export const SOURCE_CONFIDENCE_LABEL: Record<SourceConfidence, string> = {
  inferred: "Worked out from a listing",
  reported: "Told to us",
  confirmed: "Confirmed with them",
};

export const SOURCE_CONFIDENCE_HINT: Record<SourceConfidence, string> = {
  inferred: "Nobody has checked this with the firm. Treat it as a starting point.",
  reported: "Somebody at the firm said so, and it has not been verified against a document.",
  confirmed: "Checked against a document or confirmed on a call.",
};

/**
 * Set-aside certifications.
 *
 * Held here rather than in the database so adding one is an edit rather than
 * a migration. The keys are the values stored; the labels are what a person
 * sees. Federal socioeconomic categories first, because those are the ones a
 * solicitation sets aside for.
 */
export const CERTIFICATIONS = [
  { key: "8a", label: "8(a) Business Development" },
  { key: "hubzone", label: "HUBZone" },
  { key: "sdvosb", label: "Service-Disabled Veteran-Owned" },
  { key: "vosb", label: "Veteran-Owned" },
  { key: "wosb", label: "Woman-Owned Small Business" },
  { key: "edwosb", label: "Economically Disadvantaged Woman-Owned" },
  { key: "sdb", label: "Small Disadvantaged Business" },
  { key: "mbe", label: "Minority Business Enterprise" },
  { key: "dbe", label: "Disadvantaged Business Enterprise" },
  { key: "union", label: "Union signatory" },
] as const;

export type CertificationKey = (typeof CERTIFICATIONS)[number]["key"];

export function certificationLabel(key: string): string {
  return CERTIFICATIONS.find((c) => c.key === key)?.label ?? key;
}

export interface CapabilityFacts {
  serviceAreaStates?: string[] | null;
  serviceRadiusMiles?: number | null;
  serviceAreaNote?: string | null;
  crewSize?: number | null;
  concurrentJobs?: number | null;
  minProjectCents?: number | null;
  maxProjectCents?: number | null;
  bonded?: boolean | null;
  bondSingleCents?: number | null;
  bondAggregateCents?: number | null;
  bondSurety?: string | null;
  certifications?: string[] | null;
  paymentTerms?: string | null;
  quoteValidityDays?: number | null;
  preferredContact?: string | null;
  timeZone?: string | null;
  source?: string | null;
  sourceConfidence?: string | null;
}

/** What is missing, so the record can ask for it instead of hiding the gap. */
export const CAPABILITY_PROMPTS = [
  { key: "serviceArea", label: "Where they work", ask: "Which counties or how far will they travel?" },
  { key: "capacity", label: "How much they can carry", ask: "How big a crew, and how many jobs at once?" },
  { key: "projectSize", label: "Job size", ask: "Is there a job too small or too big for them?" },
  { key: "bonding", label: "Bonding", ask: "Are they bonded, and to what amount?" },
  { key: "certifications", label: "Certifications", ask: "Do they hold any set-aside certifications?" },
  { key: "terms", label: "Terms", ask: "What payment terms, and how long do their quotes stand?" },
] as const;

export type CapabilityPromptKey = (typeof CAPABILITY_PROMPTS)[number]["key"];

/**
 * Which capability questions this record cannot answer yet.
 *
 * Returned as a list to ask rather than as a completeness percentage. A score
 * says a record is 60% done; a list says which two calls would finish it.
 */
export function capabilityGaps(f: CapabilityFacts): CapabilityPromptKey[] {
  const gaps: CapabilityPromptKey[] = [];
  const states = f.serviceAreaStates ?? [];
  if (states.length === 0 && f.serviceRadiusMiles == null && !f.serviceAreaNote?.trim()) {
    gaps.push("serviceArea");
  }
  if (f.crewSize == null && f.concurrentJobs == null) gaps.push("capacity");
  if (f.minProjectCents == null && f.maxProjectCents == null) gaps.push("projectSize");
  if (f.bonded == null) gaps.push("bonding");
  if ((f.certifications ?? []).length === 0) gaps.push("certifications");
  if (!f.paymentTerms?.trim() && f.quoteValidityDays == null) gaps.push("terms");
  return gaps;
}

/**
 * Whether a job of this size is inside what the firm says it takes.
 *
 * Three answers, not two. `null` means the firm has never said, which is the
 * common case and must not be read as a yes or as a no: a bid built by
 * excluding every firm that has not filled in a form is a bid with two
 * quotes.
 */
export function fitsProjectSize(f: CapabilityFacts, cents: number): boolean | null {
  if (f.minProjectCents == null && f.maxProjectCents == null) return null;
  if (f.minProjectCents != null && cents < f.minProjectCents) return false;
  if (f.maxProjectCents != null && cents > f.maxProjectCents) return false;
  return true;
}

/** Same three answers for whether they cover a state. */
export function coversState(f: CapabilityFacts, state: string | null | undefined): boolean | null {
  const states = f.serviceAreaStates ?? [];
  if (states.length === 0) return null;
  if (!state) return null;
  return states.some((s) => s.toUpperCase() === state.toUpperCase());
}

/** And for whether their bond covers a job. */
export function bondCovers(f: CapabilityFacts, cents: number): boolean | null {
  if (f.bonded === false) return false;
  if (f.bondSingleCents == null) return null;
  return f.bondSingleCents >= cents;
}

/** The label to print when there is nothing on file. Never a dash, never 0. */
export const NOT_ON_FILE = "Not on file";

/** A count with a unit, or the honest absence. */
export function countLabel(n: number | null | undefined, one: string, many: string): string {
  if (n == null) return NOT_ON_FILE;
  return `${n} ${n === 1 ? one : many}`;
}
