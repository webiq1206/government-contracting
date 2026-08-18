/**
 * One place that mutates a bid's compliance state.
 *
 * Marking a requirement complete, attaching an uploaded document to it, and
 * acknowledging an audit finding all have to do the same four things
 * afterwards: rebuild the manifest, revalidate, recompute readiness, and
 * persist. They were doing three of them in one route and none of them
 * anywhere else, so an operator who uploaded their signed offer form got a
 * requirement marked complete and a manifest that still pointed at nothing.
 *
 * Everything here is org-scoped: the bid is loaded by opportunity AND org, so
 * a requirement id from one tenant can never reach another tenant's package.
 */
import { query, queryOne } from "./db";
import { getProfileJson } from "./ai/companyProfile";
import {
  buildManifest,
  validatePackage,
  computeReady,
  requirementsFingerprint,
  pageLimitFrom,
} from "./domain/package";
import { looksLikePdfBytes } from "./integrations/pdf";
import type {
  AuditFinding,
  Bid,
  Opportunity,
  PackageValidation,
  ResolvedRequirement,
} from "./types";

export interface PackageChange {
  matrix: ResolvedRequirement[];
  findings: AuditFinding[];
}

export interface PackageChangeResult {
  ok: boolean;
  error?: string;
  validation?: PackageValidation;
  ready?: boolean;
  bidId?: string;
}

/**
 * Load the newest bid for an opportunity, hand its matrix and findings to
 * `mutate`, then re-derive and store everything downstream of them.
 *
 * `mutate` returns null to abort (nothing matched), which becomes a 404-shaped
 * error for the caller rather than a silent no-op write.
 */
export async function applyPackageChange(
  opportunityId: string,
  orgId: string,
  mutate: (current: PackageChange) => PackageChange | null
): Promise<PackageChangeResult> {
  const bid = await queryOne<
    Pick<
      Bid,
      | "id"
      | "compliance_matrix"
      | "audit_findings"
      | "bid_amount"
      | "sub_quote_total"
      | "markup_pct"
    > & { requirements_fingerprint: string | null }
  >(
    `select id, compliance_matrix, audit_findings, bid_amount, sub_quote_total, markup_pct,
            requirements_fingerprint
       from bids where opportunity_id=$1 and org_id=$2 order by created_at desc limit 1`,
    [opportunityId, orgId]
  );
  if (!bid?.compliance_matrix) return { ok: false, error: "No package to update." };

  const next = mutate({
    matrix: bid.compliance_matrix,
    findings: bid.audit_findings ?? [],
  });
  if (!next) return { ok: false, error: "Not found." };

  const opp = await queryOne<Opportunity>(
    `select id, title, agency, naics_code, set_aside_type, location_text, location_state,
            solicitation_number, solicitation_analysis
       from opportunities where id=$1 and org_id=$2`,
    [opportunityId, orgId]
  );
  const profile = await getProfileJson();
  const docKinds = await query<{ kind: string }>(
    `select distinct kind from documents where opportunity_id=$1`,
    [opportunityId]
  );

  const bidAmount = bid.bid_amount != null ? Number(bid.bid_amount) : null;
  const subtotal = bid.sub_quote_total != null ? Number(bid.sub_quote_total) : 0;
  const markup = bid.markup_pct != null ? Number(bid.markup_pct) : 0;

  const validation = validatePackage({
    resolved: next.matrix,
    // Read from the profile, not asserted. Hardcoding this true meant the
    // missing-UEI/CAGE warning vanished the moment an operator ticked any
    // requirement, so the same package validated differently depending on
    // which code path last touched it.
    hasIdentifiers: Boolean(profile?.uei || profile?.cage_code),
    pricingReconciles:
      bidAmount == null
        ? false
        : Math.abs(bidAmount - subtotal * (1 + markup / 100)) < Math.max(1, bidAmount * 0.02),
    bidAmount,
    nowIso: new Date().toISOString(),
    presentDocKinds: new Set(docKinds.map((d) => d.kind)),
    builtFingerprint: bid.requirements_fingerprint,
    currentFingerprint: opp ? currentRequirementsFingerprint(opp) : null,
  });
  const ready = computeReady(validation, next.findings);
  // The manifest is what the download route zips, so it has to be rebuilt
  // from the matrix that just changed. An attached document that is not in
  // the manifest is not in the package.
  const manifest = buildManifest(next.matrix, opp?.solicitation_number ?? null);

  /**
   * Refresh the one document that makes a claim about the package.
   *
   * The transmittal letter says "the following documents are enclosed", and
   * what is enclosed just changed. Written once at build time and never
   * revisited, it under-reported the package from the first attachment
   * onward: the operator attaches their bid bond, the bond goes into the zip,
   * and the signed letter next to it does not mention it. Only re-rendered
   * when a letter already exists, and a failure here must not lose the state
   * change that prompted it.
   */
  if (opp && profile && bidAmount != null) {
    const hasLetter = docKinds.some((d) => d.kind === "cover_letter");
    if (hasLetter) {
      try {
        const { renderCoverLetter } = await import("./agents/package-builder");
        await renderCoverLetter({
          opportunityId,
          opp,
          profile,
          resolved: next.matrix,
          bidAmount,
        });
      } catch (err) {
        console.error(
          `[package-state] cover letter refresh failed for ${opportunityId}: ${(err as Error).message}`
        );
      }
    }
  }

  await query(
    `update bids
        set compliance_matrix=$2, audit_findings=$3, package_ready=$4,
            validation_json=$5, package_manifest=$6, updated_at=now()
      where id=$1`,
    [
      bid.id,
      JSON.stringify(next.matrix),
      JSON.stringify(next.findings),
      ready,
      JSON.stringify(validation),
      JSON.stringify(manifest),
    ]
  );

  return { ok: true, validation, ready, bidId: bid.id };
}

/**
 * Attach an uploaded file to a requirement and close it out. The file becomes
 * the package item for that requirement.
 */
export async function attachToRequirement(args: {
  opportunityId: string;
  orgId: string;
  requirementId: string;
  doc: { name: string; path: string; mime?: string };
  /** The file's bytes, so a page limit can actually be checked. */
  bytes?: Buffer | Uint8Array;
}): Promise<PackageChangeResult> {
  const { opportunityId, orgId, requirementId, doc, bytes } = args;

  /**
   * Count the pages BEFORE deciding the item is done.
   *
   * A page limit is the format rule most likely to make an otherwise good
   * volume non-responsive, and it is the one rule a machine can actually
   * verify: the file has a page count. An over-length document is still
   * attached, because it is the operator's document and they may have a
   * reason, but the requirement does NOT close and the note says what the
   * solicitation allows and what was uploaded. They can still mark it
   * complete themselves, with that in front of them.
   */
  let overLimit: { pages: number; limit: number } | null = null;
  if (bytes && looksLikePdfBytes(bytes)) {
    const pages = await pdfPageCount(bytes);
    if (pages > 0) {
      const current = await queryOne<{ compliance_matrix: ResolvedRequirement[] | null }>(
        `select compliance_matrix from bids where opportunity_id=$1 and org_id=$2
          order by created_at desc limit 1`,
        [opportunityId, orgId]
      );
      const req = (current?.compliance_matrix ?? []).find((r) => r.id === requirementId);
      const limit = pageLimitFrom(req?.format);
      if (limit && pages > limit) overLimit = { pages, limit };
    }
  }

  const result = await applyPackageChange(opportunityId, orgId, ({ matrix, findings }) => {
    let found = false;
    const next = matrix.map((r) => {
      if (r.id !== requirementId) return r;
      found = true;
      if (overLimit) {
        return {
          ...r,
          operator_doc: doc,
          operator_confirmed: false,
          status: "needs_operator" as const,
          note: `"${doc.name}" is ${overLimit.pages} pages. The solicitation allows ${overLimit.limit}. Shorten it and upload again, or mark this complete yourself if the limit does not apply to the whole document.`,
        };
      }
      return {
        ...r,
        operator_doc: doc,
        operator_confirmed: true,
        status: "satisfied" as const,
        note: `Your uploaded "${doc.name}" is included in the package for this item.`,
      };
    });
    if (!found) return null;
    return { matrix: next, findings };
  });

  if (result.ok && overLimit) {
    return {
      ...result,
      error: `Attached, but not marked complete: "${doc.name}" is ${overLimit.pages} pages and the solicitation allows ${overLimit.limit}.`,
    };
  }
  return result;
}

/** Pages in a PDF, or 0 when the bytes cannot be read as one. */
async function pdfPageCount(bytes: Buffer | Uint8Array): Promise<number> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(
      bytes.constructor === Uint8Array ? (bytes as Uint8Array) : new Uint8Array(bytes),
      { ignoreEncryption: true }
    );
    return doc.getPageCount();
  } catch (err) {
    console.warn(`[package-state] could not count pages: ${(err as Error).message}`);
    return 0;
  }
}

/** Requirements the CURRENT analysis states, for drift detection. */
export function currentRequirementsFingerprint(opp: {
  solicitation_analysis?: Opportunity["solicitation_analysis"];
}): string {
  return requirementsFingerprint(
    opp.solicitation_analysis?.compliance_matrix ?? [],
    opp.solicitation_analysis?.qa_addenda ?? []
  );
}
