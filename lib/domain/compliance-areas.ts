/**
 * The six kinds of compliance, and which of them an item belongs to.
 *
 * The board grouped by its raw `category` column, so it produced whatever
 * headings the data happened to contain -- "sam_registration", "far_change",
 * "state_llc" -- in whatever order they arrived. That is a database schema
 * shown to a person, and it has two costs. Related items sit apart (a SAM
 * registration and a state LLC filing are both "can we legally take the work",
 * and appeared as two unrelated headings), and the one area the board never
 * showed at all had no category to be grouped under.
 *
 * That missing area is subcontractor compliance. It lives in a different table
 * -- the documents a subcontractor has to produce before they can be paid --
 * and until now the only way to see it was to open each subcontractor in turn.
 * A prime whose subcontractor's insurance has lapsed has a compliance problem
 * whether or not the interface files it under compliance.
 *
 * Pure.
 */

import {
  assessCompliance,
  currentStatus,
  DOC_LABEL,
  type ComplianceDoc,
  type DocType,
} from "./sub-compliance";

export type ComplianceArea =
  | "company_registrations"
  | "certifications"
  | "insurance_bonding"
  | "subcontractor"
  | "contract_specific"
  | "regulatory"
  | "other";

/**
 * Category to area.
 *
 * This used to send unknown categories to Company registrations on the
 * argument that a new category is more likely to be another
 * thing the company has to keep current than a genuinely new kind of thing,
 * and "Other" is where items go to be ignored.
 */
const AREA_BY_CATEGORY: Record<string, ComplianceArea> = {
  sam_registration: "company_registrations",
  state_llc: "company_registrations",
  certification: "certifications",
  // The value the monitor writes, alongside the one the area map already had.
  sb_cert: "certifications",
  insurance: "insurance_bonding",
  bonding: "insurance_bonding",
  /*
   * The values the add form actually emits.
   *
   * It offers `bond`, `license` and `other`; the map had `bonding` and
   * neither of the others, so every bond an operator added by hand fell
   * through the default and filed itself under Company registrations. A bond
   * certificate sitting in the registrations section is one nobody looking
   * for insurance will ever find.
   */
  bond: "insurance_bonding",
  license: "certifications",
  non_ss_cap: "contract_specific",
  cpars: "contract_specific",
  contract_deadline: "contract_specific",
  far_change: "regulatory",
};

export function areaFor(category: string | null | undefined): ComplianceArea {
  const key = (category ?? "").trim().toLowerCase();
  /*
   * Unrecognised categories go to Other rather than to Company registrations.
   * Defaulting an unknown into a real area is how a thing nobody classified
   * ends up looking classified, and the section it landed in was the one
   * whose items stop an award.
   */
  return AREA_BY_CATEGORY[key] ?? "other";
}

export const AREA_LABEL: Record<ComplianceArea, string> = {
  company_registrations: "Company registrations",
  certifications: "Certifications",
  insurance_bonding: "Insurance and bonding",
  subcontractor: "Subcontractor compliance",
  contract_specific: "Contract-specific compliance",
  regulatory: "Regulatory updates",
  other: "Unclassified",
};

/**
 * What each area is for, in the consequence rather than the category.
 *
 * "Certifications" says nothing; "lose the set-aside you bid under" says why
 * the date matters, which is the difference between a list somebody skims and
 * a list somebody works.
 */
export const AREA_EXPLANATION: Record<ComplianceArea, string> = {
  company_registrations:
    "Without these the company cannot be awarded anything. A lapsed SAM registration stops an award that has already been won.",
  certifications:
    "The certifications set-asides are bid under. Letting one lapse loses the advantage the bid was priced around.",
  insurance_bonding:
    "Coverage the agency requires before work starts, and the bonding capacity that decides how large a job can be taken on.",
  subcontractor:
    "What subcontractors must produce before they can be paid. A lapsed certificate on their side is the prime's problem.",
  contract_specific:
    "Obligations attached to work already won: performance evaluations and deadlines written into the contract.",
  regulatory:
    "Rule changes that affect how bids have to be written or work has to be performed.",
  other:
    "Items whose category the platform does not recognise. They are here rather than filed into a section they may not belong in.",
};

/** The order an operator works them: legal ability to bid first, news last. */
export const AREA_ORDER: ComplianceArea[] = [
  "company_registrations",
  "insurance_bonding",
  "certifications",
  "subcontractor",
  "contract_specific",
  "regulatory",
  // Last, and usually empty. Visible so an unrecognised category is a thing
  // somebody can see and reclassify rather than a row hiding in a real area.
  "other",
];

/**
 * The sixth area, built from a different table.
 *
 * Subcontractor paperwork lives in `subcontractor_documents`, one row per
 * document, and the compliance board never read it. What a person needs on a
 * board is not a document list, it is one line per subcontractor saying what
 * is wrong and what to do about it, so that is what this produces.
 *
 * Scope is deliberate. Most subcontractor records are prospects sourced for
 * outreach and have no paperwork because none was ever asked for; listing
 * every one of them as "missing W-9" would bury the handful that matter under
 * hundreds that do not. Callers pass only subcontractors who are engaged --
 * paperwork started, or named on a contract.
 *
 * Pure.
 */

export interface SubComplianceInput {
  subId: string;
  companyName: string;
  /** Every document row on file for this subcontractor, current or not. */
  docs: ComplianceDoc[];
  /** True when this subcontractor is named on a contract. */
  onContract: boolean;
}

export interface SubComplianceItem {
  subId: string;
  companyName: string;
  statusLabel: string;
  color: "red" | "amber";
  /** What is wrong, named in documents rather than statuses. */
  reason: string;
  /** The one thing to do next. */
  nextAction: string;
  /** Earliest relevant expiry, ISO day, or null when nothing has a date. */
  dueDay: string | null;
}

export interface SubComplianceBoard {
  /** Subcontractors with something to act on, worst first. */
  items: SubComplianceItem[];
  /** Subcontractors whose required paperwork is complete and current. */
  currentCount: number;
}

function labels(types: DocType[]): string {
  const names = types.map((t) => DOC_LABEL[t]);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function isoDay(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * One line per engaged subcontractor, and a count of the ones that are fine.
 *
 * Ordering puts lapsed coverage above absent coverage: a subcontractor working
 * today behind a policy that expired last week is a live exposure, while one
 * who has not sent a certificate yet has not started.
 */
export function subcontractorComplianceBoard(
  subs: SubComplianceInput[],
  now = new Date()
): SubComplianceBoard {
  const items: SubComplianceItem[] = [];
  let currentCount = 0;

  for (const sub of subs) {
    const a = assessCompliance(sub.docs, now);

    if (a.expired.length > 0) {
      const expiredDates = sub.docs
        .filter((d) => currentStatus(d, now) === "expired" && d.expires_at)
        .map((d) => isoDay(d.expires_at as string))
        .filter((v): v is string => v != null)
        .sort();
      items.push({
        subId: sub.subId,
        companyName: sub.companyName,
        statusLabel: "Coverage lapsed",
        color: "red",
        reason: `${labels(a.expired)} is no longer current.`,
        nextAction: sub.onContract
          ? "This subcontractor is on a contract. Get a replacement certificate before any further work is performed."
          : "Ask for a replacement certificate before sending any more bid packages.",
        dueDay: expiredDates[0] ?? null,
      });
      continue;
    }

    if (a.missing.length > 0) {
      items.push({
        subId: sub.subId,
        companyName: sub.companyName,
        statusLabel: sub.onContract ? "Missing on a contract" : "Not on file",
        color: sub.onContract ? "red" : "amber",
        reason: `${labels(a.missing)} has never been received.`,
        nextAction: sub.onContract
          ? "This subcontractor is on a contract and cannot be paid without it. Request it today."
          : "Send the document request from the subcontractor record.",
        dueDay: null,
      });
      continue;
    }

    if (a.awaitingVerification.length > 0) {
      items.push({
        subId: sub.subId,
        companyName: sub.companyName,
        statusLabel: "Waiting on your check",
        color: "amber",
        reason: `${labels(a.awaitingVerification)} was uploaded but nobody has confirmed it.`,
        nextAction: "Open the document and either accept it or say what is wrong with it.",
        dueDay: null,
      });
      continue;
    }

    if (a.expiringSoon.length > 0) {
      const soonest = [...a.expiringSoon].sort((x, y) =>
        x.expiresAt.localeCompare(y.expiresAt)
      )[0];
      items.push({
        subId: sub.subId,
        companyName: sub.companyName,
        statusLabel: "Expires soon",
        color: "amber",
        reason: `${labels(a.expiringSoon.map((e) => e.docType))} lapses shortly.`,
        nextAction: "Ask for the renewal now so coverage does not gap.",
        dueDay: isoDay(soonest.expiresAt),
      });
      continue;
    }

    currentCount += 1;
  }

  const rank = (i: SubComplianceItem) => (i.color === "red" ? 0 : 1);
  items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueDay ?? "9999-99-99").localeCompare(b.dueDay ?? "9999-99-99") ||
      a.companyName.localeCompare(b.companyName)
  );

  return { items, currentCount };
}

/** The colours a compliance card can carry. Mirrors ComplianceCardData. */
export type CardColor = "green" | "amber" | "red" | "slate";

/**
 * The four states a person filters this board by.
 *
 * Derived from the card's colour rather than stored, for the same reason the
 * contract risk views are derived: a stored state is one somebody has to
 * remember to update, and this one changes by itself every night as dates
 * pass.
 */
export type BoardState = "attention" | "expiring" | "unknown" | "complete";

export const STATE_LABEL: Record<BoardState, string> = {
  attention: "Needs attention now",
  expiring: "Expiring within 30 days",
  /*
   * Two different reasons for a slate card, said as one filter because the
   * operator does the same thing about both: go and find out. "Cannot
   * monitor" alone hid every item that simply has nothing on file yet.
   */
  unknown: "Nothing on file, or nothing we can check",
  complete: "Complete",
};

/*
 * Deliberately not "0 items" for a state nobody has any of. A count is a real
 * measurement here -- every item has been classified -- so zero is the truth
 * rather than an unknown dressed up as one.
 */
export function stateOf(color: CardColor): BoardState {
  if (color === "red") return "attention";
  if (color === "amber") return "expiring";
  if (color === "slate") return "unknown";
  return "complete";
}

export function parseState(v: string | string[] | undefined): BoardState | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === "attention" || s === "expiring" || s === "unknown" || s === "complete") return s;
  // The two names these filters used to have, so a bookmarked or shared link
  // still lands somewhere rather than silently showing everything.
  if (s === "cannot_monitor") return "unknown";
  if (s === "on_track") return "complete";
  return null;
}

export function parseArea(v: string | string[] | undefined): ComplianceArea | null {
  const s = Array.isArray(v) ? v[0] : v;
  return AREA_ORDER.find((a) => a === s) ?? null;
}

