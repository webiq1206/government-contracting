/**
 * Subcontractor compliance: what is on file, what is about to lapse, and what
 * that blocks.
 *
 * The reason this is a workflow gate and not a filing cabinet: on federal work
 * the prime is responsible for its subcontractors' coverage. A certificate
 * that lapsed mid-project can void the coverage and put the prime in breach,
 * and nobody notices until a claim. So expiry is evaluated on read, and a
 * subcontractor without current coverage is not sendable a bid package.
 *
 * The $600 threshold for a 1099-NEC is a reporting duty, not a payment gate:
 * it never blocks work, it just has to be tracked.
 */

/** Documents required before a subcontractor may be sent a bid package. */
export const REQUIRED_FOR_AWARD = [
  "w9",
  "coi_general_liability",
  "coi_workers_comp",
] as const;

export type DocType =
  | "w9"
  | "coi_general_liability"
  | "coi_workers_comp"
  | "coi_auto"
  | "license"
  | "other";

/** Plain-English label. Never a raw column value in front of a person. */
export const DOC_LABEL: Record<DocType, string> = {
  w9: "W-9",
  coi_general_liability: "General liability insurance",
  coi_workers_comp: "Workers compensation insurance",
  coi_auto: "Commercial auto insurance",
  license: "Trade license",
  other: "Other document",
};

/** IRS reporting threshold for a 1099-NEC, in cents, per calendar year. */
export const FORM_1099_THRESHOLD_CENTS = 60_000;

/** How far ahead a document counts as expiring rather than active. */
export const EXPIRING_SOON_DAYS = 30;

export type DocStatus = "missing" | "pending" | "active" | "expiring" | "expired" | "rejected";

export interface ComplianceDoc {
  doc_type: string;
  status: string;
  expires_at: string | null;
  signed_at: string | null;
  verified_at: string | null;
}

/**
 * The status a document actually has right now.
 *
 * Computed from the expiry date rather than trusting the stored status,
 * because a row written last month cannot know that its certificate lapsed
 * yesterday. The stored status is a cache; this is the truth.
 */
export function currentStatus(doc: ComplianceDoc, now = new Date()): DocStatus {
  if (doc.status === "rejected") return "rejected";
  if (doc.status === "pending") return "pending";
  if (!doc.expires_at) return "active";

  const expires = new Date(doc.expires_at).getTime();
  if (Number.isNaN(expires)) return "active";
  if (expires <= now.getTime()) return "expired";

  const daysLeft = (expires - now.getTime()) / 86_400_000;
  return daysLeft <= EXPIRING_SOON_DAYS ? "expiring" : "active";
}

/** True when a document is good enough to work behind. */
export function isCurrent(doc: ComplianceDoc, now = new Date()): boolean {
  const s = currentStatus(doc, now);
  // Expiring still counts: coverage has not lapsed yet, and blocking a sub a
  // month early would stop work for no reason. It is a prompt, not a stop.
  return s === "active" || s === "expiring";
}

export interface ComplianceAssessment {
  /** True when every required document is on file and current. */
  clearedForAward: boolean;
  /** Required documents with nothing on file at all. */
  missing: DocType[];
  /** Required documents whose coverage has lapsed. */
  expired: DocType[];
  /** On file, current, but lapsing within the window. */
  expiringSoon: { docType: DocType; expiresAt: string }[];
  /** Uploaded but not yet checked by a human. */
  awaitingVerification: DocType[];
  /** One line explaining what is blocking, or null when clear. */
  blockReason: string | null;
}

/**
 * Decide whether a subcontractor may be sent a bid package.
 *
 * Deliberately conservative: an unverified upload does not clear the gate. The
 * cost of pausing one outreach is a phone call; the cost of a lapsed policy on
 * a federal job is the contract.
 */
export function assessCompliance(
  docs: ComplianceDoc[],
  now = new Date()
): ComplianceAssessment {
  const byType = new Map<string, ComplianceDoc>();
  for (const d of docs) {
    // Keep the best row per type: a current document beats a rejected one left
    // behind for the audit trail.
    const existing = byType.get(d.doc_type);
    if (!existing || (!isCurrent(existing, now) && isCurrent(d, now))) {
      byType.set(d.doc_type, d);
    }
  }

  const missing: DocType[] = [];
  const expired: DocType[] = [];
  const expiringSoon: { docType: DocType; expiresAt: string }[] = [];
  const awaitingVerification: DocType[] = [];

  for (const type of REQUIRED_FOR_AWARD) {
    const doc = byType.get(type);
    if (!doc) {
      missing.push(type);
      continue;
    }
    const status = currentStatus(doc, now);
    if (status === "expired" || status === "rejected") {
      expired.push(type);
      continue;
    }
    if (status === "pending" || !doc.verified_at) {
      awaitingVerification.push(type);
      continue;
    }
    if (status === "expiring" && doc.expires_at) {
      expiringSoon.push({ docType: type, expiresAt: doc.expires_at });
    }
  }

  const blocking: string[] = [];
  if (missing.length) {
    blocking.push(`no ${missing.map((t) => DOC_LABEL[t]).join(" or ")} on file`);
  }
  if (expired.length) {
    blocking.push(`${expired.map((t) => DOC_LABEL[t]).join(" and ")} has lapsed`);
  }
  if (awaitingVerification.length) {
    blocking.push(
      `${awaitingVerification.map((t) => DOC_LABEL[t]).join(" and ")} still needs checking`
    );
  }

  return {
    clearedForAward: blocking.length === 0,
    missing,
    expired,
    expiringSoon,
    awaitingVerification,
    blockReason: blocking.length ? `Cannot send work: ${blocking.join("; ")}.` : null,
  };
}

/** Whether a subcontractor's payments this year require a 1099-NEC. */
export function needs1099(totalPaidCents: number): boolean {
  return totalPaidCents >= FORM_1099_THRESHOLD_CENTS;
}

/**
 * Evidence captured when someone signs in the platform.
 *
 * Recorded together because it is the combination that makes an electronic
 * signature defensible: who, when, from where, and against exactly which
 * rendered document.
 */
export interface SignatureEvidence {
  signedName: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  docHash: string;
}

/** A signature is only usable when every part of the evidence is present. */
export function signatureIsComplete(e: Partial<SignatureEvidence>): boolean {
  return Boolean(e.signedName?.trim() && e.signedAt && e.docHash);
}
