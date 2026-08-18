/**
 * Submission-package domain logic, pure and unit-tested. Given the extracted
 * compliance matrix, the company profile, and which documents the platform
 * generates, it resolves each requirement to a status + artifact, assembles an
 * ordered manifest, and validates the package before submission.
 */
import type {
  ComplianceRequirement,
  ResolvedRequirement,
  PackageItem,
  PackageValidation,
  RequirementCategory,
  AuditFinding,
} from "../types";

/** documents.kind values used for generated package artifacts. */
export const ARTIFACT_KIND = {
  coverLetter: "cover_letter",
  pricingSchedule: "pricing_schedule",
  repsCerts: "reps_certs",
  capability: "capability_statement",
  bidPdf: "bid_pdf",
  complianceChecklist: "compliance_checklist",
  amendmentAck: "amendment_ack",
} as const;

export interface ResolveContext {
  /** Requirement ids the operator already confirmed complete (signed/uploaded). */
  confirmed: Set<string>;
  /** True when a past-performance / technical narrative was generated. */
  hasNarrative: boolean;
  /** Key company identifiers present (UEI/CAGE), affects reps&certs warnings. */
  hasIdentifiers: boolean;
}

/** Map an auto/profile requirement to the artifact the platform generates for it. */
function artifactFor(req: ComplianceRequirement): string {
  if (req.category === "acknowledgment") return ARTIFACT_KIND.amendmentAck;
  if (req.satisfied_by === "auto_generated") {
    if (req.category === "pricing") return ARTIFACT_KIND.pricingSchedule;
    return ARTIFACT_KIND.coverLetter;
  }
  if (req.satisfied_by === "from_profile") {
    if (req.category === "certification" || req.category === "form")
      return ARTIFACT_KIND.repsCerts;
    return ARTIFACT_KIND.capability;
  }
  // operator_signature items are prefilled onto the reps & certs data sheet.
  if (req.satisfied_by === "operator_signature") return ARTIFACT_KIND.repsCerts;
  return ""; // operator_provided: no artifact the platform can produce
}

export function resolveRequirements(
  requirements: ComplianceRequirement[],
  ctx: ResolveContext
): ResolvedRequirement[] {
  return requirements.map((req) => {
    if (ctx.confirmed.has(req.id)) {
      return {
        ...req,
        status: "satisfied",
        operator_confirmed: true,
        artifact_kind: artifactFor(req) || undefined,
      };
    }
    // A required SPECIFIC agency form cannot be reproduced exactly, the
    // operator must complete the official form. Any generated document is only
    // a worksheet. This is always the operator's item until confirmed.
    if (req.official_form) {
      return {
        ...req,
        status: "needs_operator",
        artifact_kind: artifactFor(req) || undefined,
        note: `Use the official ${req.official_form}${
          req.signature_required ? " and sign it" : ""
        } from the solicitation, the generated draft is a worksheet only.`,
      };
    }
    /**
     * A signature can only be made by a person.
     *
     * The switch below treats "we generated it" and "we filled it from the
     * profile" as satisfied, which is right for a document nobody has to sign.
     * But the solicitation having said this item must be SIGNED is a fact
     * about the item, not about who produced it: reps and certs are prefilled
     * from the profile and still certified under penalty, and a generated
     * cover letter can still require the offeror's signature. Before this,
     * such an item was marked satisfied and went out unsigned, which is
     * non-responsive, and nothing in the package ever asked anyone to sign it.
     *
     * So the signature outranks the satisfier. The generated artifact is still
     * attached (that is what the operator signs), and an operator confirmation
     * above still closes it.
     */
    if (req.signature_required) {
      return {
        ...req,
        status: "needs_signature",
        artifact_kind: artifactFor(req) || undefined,
        note: "The solicitation requires this to be signed. Review the prefilled document, sign it, then mark it complete.",
      };
    }
    switch (req.satisfied_by) {
      case "auto_generated":
      case "from_profile":
        return { ...req, status: "satisfied", artifact_kind: artifactFor(req) || undefined };
      case "operator_signature":
        return {
          ...req,
          status: "needs_signature",
          artifact_kind: artifactFor(req) || undefined,
          note: "Prefilled, review and sign, then mark complete.",
        };
      case "operator_provided":
      default:
        return {
          ...req,
          status: "needs_operator",
          note: req.instructions ?? "You must supply this item.",
        };
    }
  });
}

/** Federal-style submission order by category. */
const CATEGORY_ORDER: RequirementCategory[] = [
  "narrative", // cover/transmittal letter, technical approach
  "form", // signed offer form (SF-1449, etc.)
  "pricing", // pricing/bid schedule
  "certification", // reps & certs
  "acknowledgment", // amendment acknowledgments
  "attachment", // supporting docs
  "other",
];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function extFor(kind?: string): string {
  return kind ? "pdf" : "";
}

export function buildManifest(
  resolved: ResolvedRequirement[],
  solNumber?: string | null
): PackageItem[] {
  const sorted = [...resolved].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );
  const solTag = solNumber ? `_${slugify(solNumber)}` : "";
  return sorted.map((r, i) => {
    const order = i + 1;
    const num = String(order).padStart(2, "0");
    // When the real agency form was found in the attachments, that file IS the
    // package item (the operator signs the actual form).
    if (r.official_form_doc) {
      return {
        order,
        filename: `${num}_${slugify(r.official_form ?? r.title)}${solTag}.pdf`,
        requirement_id: r.id,
        category: r.category,
        source: "solicitation" as const,
        document_path: r.official_form_doc.path,
        status: r.status,
      };
    }
    const ext = extFor(r.artifact_kind);
    const source: PackageItem["source"] =
      r.satisfied_by === "operator_provided"
        ? "operator"
        : r.artifact_kind
          ? "generated"
          : "operator";
    const filename = ext
      ? `${num}_${slugify(r.title)}${solTag}.${ext}`
      : `${num}_${slugify(r.title)}${solTag}__PROVIDE_THIS.txt`;
    return {
      order,
      filename,
      requirement_id: r.id,
      category: r.category,
      source,
      document_kind: r.artifact_kind,
      status: r.status,
    };
  });
}

export interface ValidationInput {
  resolved: ResolvedRequirement[];
  hasIdentifiers: boolean;
  /** Pricing sanity: does bid_amount reconcile with subtotal + markup? */
  pricingReconciles: boolean;
  bidAmount: number | null;
  nowIso: string;
  /**
   * documents.kind values actually stored for this opportunity. When provided,
   * a requirement "satisfied" by a generated artifact whose file was never
   * written (e.g. document assembly failed mid-build) becomes a blocker
   * instead of silently shipping an incomplete package.
   */
  presentDocKinds?: Set<string> | null;
}

export function validatePackage(input: ValidationInput): PackageValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const mandatory = input.resolved.filter((r) => r.mandatory);

  /**
   * No requirements at all is NOT an empty to-do list, it is a missing one.
   *
   * Every real solicitation asks for something: a signed offer form, a price,
   * reps and certs. So an empty matrix never means "this one needs nothing",
   * it means the analysis has not run, could not read the documents (a scanned
   * PDF), or returned nothing usable. Before this check, that state produced
   * an EMPTY package that validated as passed and displayed as ready to
   * submit: every mandatory loop below iterates zero items, so nothing objects.
   * The operator would send a package containing none of the forms the agency
   * asked for and be found non-responsive.
   *
   * Absence of evidence is not evidence of absence, so this fails closed.
   */
  if (input.resolved.length === 0) {
    blockers.push(
      "The submission requirements for this solicitation have not been extracted, so there is no way to know what the package must contain. Re-run the analysis on this opportunity, and if its documents are scans with no readable text, add the required items by hand before submitting."
    );
  }

  for (const r of mandatory) {
    if (r.status === "satisfied") continue;
    if (r.status === "needs_signature") {
      blockers.push(`Sign "${r.title}" (prefilled), then mark it complete.`);
    } else if (r.status === "needs_operator") {
      blockers.push(`Provide "${r.title}": ${r.instructions ?? "required item"}.`);
    } else {
      blockers.push(`Missing required item: "${r.title}".`);
    }
  }

  // Generated-artifact existence: "satisfied by a generated document" only
  // counts if that document actually exists in storage. Operator-confirmed
  // items are exempt (the human vouched for them), as are items backed by an
  // official solicitation file (already stored with the solicitation).
  if (input.presentDocKinds) {
    for (const r of mandatory) {
      if (r.status !== "satisfied" || r.operator_confirmed || r.official_form_doc) continue;
      if (r.artifact_kind && !input.presentDocKinds.has(r.artifact_kind)) {
        blockers.push(
          `The generated document for "${r.title}" (${r.artifact_kind.replace(/_/g, " ")}) is missing from storage. Re-run the Bid Builder.`
        );
      }
    }
    if (!input.presentDocKinds.has(ARTIFACT_KIND.bidPdf)) {
      blockers.push("The bid PDF is missing from storage. Re-run the Bid Builder.");
    }
  }

  for (const r of input.resolved.filter((r) => !r.mandatory)) {
    if (r.status !== "satisfied") {
      warnings.push(`Optional item not included: "${r.title}".`);
    }
  }

  if (input.bidAmount == null || !(input.bidAmount > 0)) {
    blockers.push("Bid price is not set. Enter subcontractor quotes so the bid can be priced.");
  }
  if (!input.pricingReconciles) {
    warnings.push("Pricing total does not reconcile with the line items, review the numbers.");
  }
  if (!input.hasIdentifiers) {
    warnings.push(
      "Company UEI/CAGE is missing from your profile; reps & certs will be incomplete until added."
    );
  }

  const satisfied_count = input.resolved.filter((r) => r.status === "satisfied").length;

  return {
    passed: blockers.length === 0,
    checked_at: input.nowIso,
    blockers,
    warnings,
    satisfied_count,
    total_mandatory: mandatory.length,
  };
}

/** Unresolved (unacknowledged) blocker findings from the independent audit. */
export function openAuditBlockers(findings: AuditFinding[] | null | undefined): AuditFinding[] {
  return (findings ?? []).filter((f) => f.severity === "blocker" && !f.acknowledged);
}

/**
 * The single source of truth for "can this be submitted": the deterministic
 * validation must pass AND the independent audit must have no open blockers.
 */
export function computeReady(
  validation: PackageValidation | null,
  findings: AuditFinding[] | null | undefined
): boolean {
  return Boolean(validation?.passed) && openAuditBlockers(findings).length === 0;
}
