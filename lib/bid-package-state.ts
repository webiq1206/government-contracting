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
import { createHash } from "node:crypto";
import { query, queryOne, transaction } from "./db";
import { getProfileJson } from "./ai/companyProfile";
import { storage, type StorageBackend } from "./integrations/storage";
import { orgOwnsStorageKey } from "./domain/file-ownership";
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
  PackageItem,
  PackageValidation,
  ResolvedRequirement,
} from "./types";

interface StoredPackageDocument {
  name?: string;
  kind: string;
  storage_path: string;
  storage_backend?: string;
  content_hash?: string;
}

export interface SubmissionPackageHashResult {
  hash: string | null;
  error: string | null;
}

/** Hash the exact artifact set represented by one immutable bid package row. */
export async function submissionPackageHash(input: {
  opportunityId: string;
  orgId: string;
  manifest: PackageItem[] | null;
  documents: StoredPackageDocument[] | null;
}): Promise<SubmissionPackageHashResult> {
  const manifest = [...(input.manifest ?? [])].sort((a, b) => a.order - b.order);
  if (manifest.length === 0) {
    return { hash: null, error: "This bid has no assembled package to identify." };
  }

  const current = await query<{
    kind: string;
    storage_path: string;
    storage_backend: string | null;
    content_hash: string | null;
  }>(
    `select kind, storage_path, storage_backend, content_hash
       from documents
      where opportunity_id=$1 and org_id=$2 and storage_path is not null`,
    [input.opportunityId, input.orgId]
  );
  const byPath = new Map(current.map((doc) => [doc.storage_path, doc]));
  const byKind = new Map<string, StoredPackageDocument>();
  for (const doc of input.documents ?? []) {
    if (doc.kind && doc.storage_path) byKind.set(doc.kind, doc);
  }
  for (const doc of current) {
    if (!byKind.has(doc.kind)) {
      byKind.set(doc.kind, {
        kind: doc.kind,
        storage_path: doc.storage_path,
        storage_backend: doc.storage_backend ?? undefined,
        content_hash: doc.content_hash ?? undefined,
      });
    }
  }

  const packageHash = createHash("sha256");
  for (const item of manifest) {
    packageHash.update(
      JSON.stringify({
        order: item.order,
        filename: item.filename,
        requirementId: item.requirement_id,
        status: item.status,
        source: item.source,
      })
    );
    if (item.status !== "satisfied") continue;

    const stored = item.document_path
      ? byPath.get(item.document_path)
      : item.document_kind
        ? byKind.get(item.document_kind)
        : undefined;
    const path = item.document_path ?? stored?.storage_path ?? null;
    if (!path) {
      return {
        hash: null,
        error: `The package cannot identify the stored file for ${item.title ?? item.filename}. Rebuild it before recording delivery.`,
      };
    }

    let digest = stored?.content_hash ?? byPath.get(path)?.content_hash ?? null;
    if (!digest || !/^[a-f0-9]{64}$/i.test(digest)) {
      const owned = byPath.has(path) || (await orgOwnsStorageKey(path, input.orgId));
      if (!owned) {
        return {
          hash: null,
          error: `The stored file for ${item.title ?? item.filename} is not owned by this account. The package was not marked as sent.`,
        };
      }
      try {
        const backend = stored?.storage_backend ?? byPath.get(path)?.storage_backend ?? undefined;
        const bytes = await storage.download(
          path,
          backend === "supabase" || backend === "local" || backend === "db"
            ? backend
            : undefined
        );
        digest = createHash("sha256").update(bytes).digest("hex");
      } catch {
        return {
          hash: null,
          error: `The stored file for ${item.title ?? item.filename} could not be read. Retry the package download, then record delivery once storage is available.`,
        };
      }
    }
    packageHash.update(`\n${item.filename}\n${digest}\n`);
  }

  return { hash: packageHash.digest("hex"), error: null };
}

export interface PackageChange {
  matrix: ResolvedRequirement[];
  findings: AuditFinding[];
}

export interface PackageChangeResult {
  ok: boolean;
  error?: string;
  warning?: string;
  conflict?: boolean;
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
      | "documents_json"
      | "submission_state"
    > & { requirements_fingerprint: string | null }
  >(
    `select id, compliance_matrix, audit_findings, bid_amount, sub_quote_total, markup_pct,
            documents_json, submission_state, requirements_fingerprint
       from bids where opportunity_id=$1 and org_id=$2 order by created_at desc limit 1`,
    [opportunityId, orgId]
  );
  if (!bid?.compliance_matrix) return { ok: false, error: "No package to update." };
  if (bid.submission_state !== "package_ready") {
    return {
      ok: false,
      conflict: true,
      error:
        bid.submission_state === "approved"
          ? "This package is approved to send. Reopen it as a controlled revision before changing its requirements or files."
          : "This package has submission history and is locked against requirement and file changes.",
    };
  }

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
    `select distinct kind from documents where opportunity_id=$1 and org_id=$2`,
    [opportunityId, orgId]
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
  let refreshedLetter:
    | {
        name: string;
        storage_path: string;
        kind: string;
        storage_backend: StorageBackend;
        content_hash: string;
      }
    | null = null;
  if (opp && profile && bidAmount != null) {
    const hasLetter = docKinds.some((d) => d.kind === "cover_letter");
    if (hasLetter) {
      try {
        const { renderCoverLetter } = await import("./agents/package-builder");
        refreshedLetter = await renderCoverLetter({
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

  const documentsJson = [...(bid.documents_json ?? [])];
  if (refreshedLetter) {
    const index = documentsJson.findIndex((doc) => doc.kind === refreshedLetter!.kind);
    if (index >= 0) documentsJson[index] = refreshedLetter;
    else documentsJson.push(refreshedLetter);
  }

  const saved = await query<{ id: string }>(
    `update bids
        set compliance_matrix=$2, audit_findings=$3, package_ready=$4,
            validation_json=$5, package_manifest=$6, documents_json=$7, updated_at=now()
      where id=$1 and org_id=$8 and submission_state='package_ready'
      returning id`,
    [
      bid.id,
      JSON.stringify(next.matrix),
      JSON.stringify(next.findings),
      ready,
      JSON.stringify(validation),
      JSON.stringify(manifest),
      JSON.stringify(documentsJson),
      orgId,
    ]
  );
  if (saved.length === 0) {
    return {
      ok: false,
      conflict: true,
      error:
        "The package was approved or sent while this change was being saved. The approved package was left unchanged.",
    };
  }

  let warning: string | undefined;
  if (refreshedLetter) {
    try {
      const published = await transaction(async (client) => {
        const draft = await client.query<{ id: string }>(
          `select id from bids
            where id=$1 and org_id=$2 and submission_state='package_ready'
            for update`,
          [bid.id, orgId]
        );
        if (draft.rows.length === 0) return false;
        await client.query(
          `delete from documents
            where opportunity_id=$1 and org_id=$2 and kind=$3`,
          [opportunityId, orgId, refreshedLetter.kind]
        );
        await client.query(
          `insert into documents
             (org_id, opportunity_id, kind, name, storage_path, storage_backend, mime,
              content_hash, disposition, extraction_state)
           values ($1,$2,$3,$4,$5,$6,'application/pdf',$7,'delivered','not_applicable')`,
          [
            orgId,
            opportunityId,
            refreshedLetter.kind,
            refreshedLetter.name,
            refreshedLetter.storage_path,
            refreshedLetter.storage_backend,
            refreshedLetter.content_hash,
          ]
        );
        return true;
      });
      if (!published) {
        warning =
          "The package change was saved, but approval finished before the refreshed cover letter could become the current Files entry. The approved package still keeps its exact document version.";
      }
    } catch (error) {
      warning =
        "The requirement was saved, but the refreshed cover letter could not be published to the Files list. Download the package to verify it before approval.";
      console.error(
        `[package-state] cover letter file record failed for ${opportunityId}: ${(error as Error).message}`
      );
    }
  }

  return { ok: true, validation, ready, bidId: bid.id, warning };
}

/**
 * Mark one package requirement complete, or reopen it.
 *
 * Extracted from the route that used to hold it because a second caller
 * appeared: the requirements checklist on the opportunity workspace records
 * its own state, and a checklist that says "Done" while the submission gate
 * still counts the item as outstanding is two systems disagreeing about the
 * same fact in front of the same person. One of them decides, and it is this.
 *
 * Un-confirming also detaches the uploaded file: leaving it attached would
 * keep the document in the manifest for an item the operator just said is not
 * done.
 */
export async function setRequirementConfirmed(
  opportunityId: string,
  orgId: string,
  requirementId: string,
  confirmed: boolean
): Promise<PackageChangeResult> {
  return applyPackageChange(opportunityId, orgId, ({ matrix, findings }) => {
    let found = false;
    const next = matrix.map((r) => {
      if (r.id !== requirementId) return r;
      found = true;
      if (confirmed) return { ...r, operator_confirmed: true, status: "satisfied" as const };
      const { operator_doc: _dropped, ...rest } = r;
      const status: ResolvedRequirement["status"] = r.official_form
        ? "needs_operator"
        : r.satisfied_by === "operator_signature"
          ? "needs_signature"
          : r.satisfied_by === "operator_provided"
            ? "needs_operator"
            : "satisfied";
      return { ...rest, operator_confirmed: false, status };
    });
    if (!found) return null;
    return { matrix: next, findings };
  });
}

/**
 * Attach an uploaded file to a requirement and close it out. The file becomes
 * the package item for that requirement.
 */
export async function attachToRequirement(args: {
  opportunityId: string;
  orgId: string;
  requirementId: string;
  doc: { name: string; path: string; mime?: string; content_hash?: string };
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
