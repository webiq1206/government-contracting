/**
 * Reading and writing subcontractor compliance documents.
 *
 * The rules for what a document means live in lib/domain/sub-compliance.ts and
 * lib/domain/w9.ts. This is the layer that talks to Postgres, and it exists so
 * that the vendor portal and the operator screens cannot drift apart: both go
 * through the same three writes (sign, upload, decide) and the same read.
 *
 * One invariant is enforced here rather than left to callers, because getting
 * it wrong is silent and expensive: a new document supersedes the old one.
 * Migration 040 puts a unique index across (subcontractor_id, doc_type) for
 * live statuses, so a second insert would otherwise fail with a constraint
 * error at exactly the moment a subcontractor is trying to renew a lapsing
 * certificate. Superseded rows are kept, never deleted; proving what was on
 * file on a given date is the entire reason this table exists.
 */
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "./db";
import { storage } from "./integrations/storage";
import { logAgent } from "./logger";
import {
  assessCompliance,
  currentStatus,
  DOC_LABEL,
  type ComplianceAssessment,
  type DocStatus,
  type DocType,
} from "./domain/sub-compliance";
import { encryptTin, w9DocHash } from "./domain/w9-crypto";
import {
  canonicalW9Text,
  normalizeTin,
  tinLast4,
  W9_CERTIFICATION_VERSION,
  type W9FormData,
  type TinType,
} from "./domain/w9";
import { renderSignedW9Pdf } from "./integrations/documents";

/** A document row as every screen needs it. Never carries the TIN. */
export interface ComplianceDocRow {
  id: string;
  doc_type: string;
  status: string;
  storage_path: string | null;
  original_filename: string | null;
  carrier: string | null;
  policy_number: string | null;
  coverage_cents: string | number | null;
  effective_at: string | null;
  expires_at: string | null;
  signed_name: string | null;
  signed_at: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  source: string | null;
  w9_legal_name: string | null;
  w9_tin_type: string | null;
  w9_tin_last4: string | null;
  created_at: string | null;
}

const ROW_COLUMNS = `
  id, doc_type, status, storage_path, original_filename, carrier, policy_number,
  coverage_cents, effective_at::text as effective_at, expires_at::text as expires_at,
  signed_name, signed_at::text as signed_at, verified_at::text as verified_at,
  rejection_reason, source, w9_legal_name, w9_tin_type, w9_tin_last4,
  created_at::text as created_at
`;

/** Every document on file for a subcontractor, newest first. */
export async function loadComplianceDocs(subId: string): Promise<ComplianceDocRow[]> {
  return query<ComplianceDocRow>(
    `select ${ROW_COLUMNS}
       from subcontractor_documents
      where subcontractor_id = $1
      order by created_at desc`,
    [subId]
  ).catch(() => []);
}

export interface ComplianceView {
  docs: ComplianceDocRow[];
  assessment: ComplianceAssessment;
  /** Live status per row, computed rather than read off the status column. */
  liveStatus: Record<string, DocStatus>;
}

/**
 * Everything a screen needs about one subcontractor's paperwork.
 *
 * Statuses are recomputed here even though the sweep keeps the column in step,
 * because the sweep runs daily and a certificate can lapse between runs. The
 * column is a cache for filtering; this is what a person is shown.
 */
export async function subComplianceView(subId: string, now = new Date()): Promise<ComplianceView> {
  const docs = await loadComplianceDocs(subId);
  const liveStatus: Record<string, DocStatus> = {};
  for (const d of docs) liveStatus[d.id] = currentStatus(d, now);
  return { docs, assessment: assessCompliance(docs, now), liveStatus };
}

/** Identity for the portal header and for any log line about this sub. */
export interface PortalSubject {
  id: string;
  company_name: string;
  owner_name: string | null;
  email: string | null;
  org_id: string | null;
}

export async function loadPortalSubject(subId: string): Promise<PortalSubject | null> {
  return queryOne<PortalSubject>(
    `select id, company_name, owner_name, email, org_id
       from subcontractors where id = $1`,
    [subId]
  ).catch(() => null);
}

/**
 * Retire whatever is currently on file for this document type.
 *
 * Marked rejected with a plain reason rather than deleted, per the table's
 * design. `assessCompliance` prefers a current row over a rejected one, so the
 * history stays queryable without ever counting against the subcontractor.
 */
async function supersede(
  subId: string,
  docType: string,
  client: PoolClient
): Promise<void> {
  await client.query(
    `update subcontractor_documents
        set status = 'rejected',
            rejection_reason = coalesce(rejection_reason, 'Superseded by a newer submission.'),
            updated_at = now()
      where subcontractor_id = $1
        and doc_type = $2
        and status in ('pending', 'active', 'expiring')`,
    [subId, docType]
  );
}

export interface SignatureContext {
  ip: string | null;
  userAgent: string | null;
}

export interface SignedW9Result {
  id: string;
  storagePath: string;
}

/**
 * Record a W-9 signed by the subcontractor themselves.
 *
 * The order matters. The canonical text is built first, the PDF is rendered
 * from that same text, and the hash covers the text plus the full number. So
 * the stored evidence, the stored document, and what was on the signer's
 * screen are one thing rather than three things that happen to agree.
 *
 * The row lands as `pending`: a signature proves the sub certified their
 * number, not that anybody has checked the form against what we know about
 * them. Verification stays a human step, which is what assessCompliance
 * expects.
 */
export async function recordSignedW9(
  sub: PortalSubject,
  form: W9FormData,
  ctx: SignatureContext,
  now = new Date()
): Promise<SignedW9Result> {
  const tinType = form.tinType as TinType;
  const digits = normalizeTin(form.tin);
  const canonical = canonicalW9Text(form, {
    signedName: form.signedName.trim(),
    signedAt: now,
    companyName: sub.company_name,
  });
  const hash = w9DocHash(canonical, digits);

  const pdf = await renderSignedW9Pdf({
    canonicalText: canonical,
    companyName: sub.company_name,
    signedName: form.signedName.trim(),
    signedAt: now,
    docHash: hash,
    ip: ctx.ip,
  });

  const safeCompany = sub.company_name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40) || "sub";
  const key = `subcontractors/${sub.id}/w9/${now.getTime()}-${safeCompany}-w9.pdf`;
  const up = await storage.upload(key, pdf, "application/pdf");

  const inserted = await transaction(async (client) => {
    await supersede(sub.id, "w9", client);
    const res = await client.query(
      `insert into subcontractor_documents
         (org_id, subcontractor_id, doc_type, storage_path, original_filename, mime_type,
          signed_name, signed_at, signed_ip, signed_user_agent, signed_doc_hash,
          status, source,
          w9_legal_name, w9_business_name, w9_tax_classification, w9_llc_tax_class,
          w9_exempt_payee_code, w9_fatca_code,
          w9_address, w9_city, w9_state, w9_zip,
          w9_tin_type, w9_tin_last4, w9_tin_encrypted, w9_certification_version)
       values ($1,$2,'w9',$3,$4,'application/pdf',
               $5,$6,$7,$8,$9,
               'pending','subcontractor',
               $10,$11,$12,$13,
               $14,$15,
               $16,$17,$18,$19,
               $20,$21,$22,$23)
       returning id`,
      [
        sub.org_id,
        sub.id,
        up.path,
        `${safeCompany}-w9.pdf`,
        form.signedName.trim(),
        now.toISOString(),
        ctx.ip,
        ctx.userAgent,
        hash,
        form.legalName.trim(),
        form.businessName.trim() || null,
        form.taxClassification || null,
        form.llcTaxClass || null,
        form.exemptPayeeCode.trim() || null,
        form.fatcaCode.trim() || null,
        form.address.trim(),
        form.city.trim(),
        form.state.trim().toUpperCase(),
        form.zip.trim(),
        tinType,
        tinLast4(digits),
        encryptTin(digits),
        W9_CERTIFICATION_VERSION,
      ]
    );
    return res.rows[0] as { id: string };
  });

  await logAgent({
    agent: "compliance",
    action: "w9-signed",
    subcontractorId: sub.id,
    level: "info",
    // Never the number, not even the last four: log lines get shipped around.
    message: `${sub.company_name} signed a W-9 as ${form.signedName.trim()}. Waiting on verification before work can go out.`,
  });

  return { id: inserted.id, storagePath: up.path };
}

export interface UploadedDocInput {
  docType: DocType;
  file: { name: string; mime: string; bytes: Buffer };
  carrier?: string | null;
  policyNumber?: string | null;
  coverageCents?: number | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  /** 'subcontractor' through the portal, 'operator' when staff file it. */
  source: "subcontractor" | "operator";
}

/**
 * Store an uploaded document (a certificate of insurance, a license, a W-9 a
 * sub already had on paper).
 *
 * Always lands as `pending`. An upload is a claim about coverage, and
 * assessCompliance deliberately does not let a claim clear the gate.
 */
export async function recordUploadedDocument(
  sub: PortalSubject,
  input: UploadedDocInput,
  now = new Date()
): Promise<{ id: string; storagePath: string }> {
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
  const key = `subcontractors/${sub.id}/${input.docType}/${now.getTime()}-${safeName}`;
  const up = await storage.upload(key, input.file.bytes, input.file.mime);

  const inserted = await transaction(async (client) => {
    await supersede(sub.id, input.docType, client);
    const res = await client.query(
      `insert into subcontractor_documents
         (org_id, subcontractor_id, doc_type, storage_path, original_filename, mime_type,
          carrier, policy_number, coverage_cents, effective_at, expires_at, status, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
       returning id`,
      [
        sub.org_id,
        sub.id,
        input.docType,
        up.path,
        input.file.name.slice(0, 200),
        input.file.mime,
        input.carrier?.trim() || null,
        input.policyNumber?.trim() || null,
        input.coverageCents ?? null,
        input.effectiveAt || null,
        input.expiresAt || null,
        input.source,
      ]
    );
    return res.rows[0] as { id: string };
  });

  await logAgent({
    agent: "compliance",
    action: "document-uploaded",
    subcontractorId: sub.id,
    level: "info",
    message:
      input.source === "subcontractor"
        ? `${sub.company_name} uploaded their ${DOC_LABEL[input.docType]}. Needs checking before it counts.`
        : `${DOC_LABEL[input.docType]} filed for ${sub.company_name} by staff. Needs checking before it counts.`,
  });

  return { id: inserted.id, storagePath: up.path };
}

/* --------------------------- upload parsing ----------------------------- */

/** Certificates are a page or two. Anything larger is a scan nobody needs. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const ALLOWED_UPLOAD_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Document types a subcontractor may send us through the portal. */
export const UPLOADABLE_DOC_TYPES: readonly DocType[] = [
  "coi_general_liability",
  "coi_workers_comp",
  "coi_auto",
  "license",
  "w9",
  "other",
];

export type ParsedUpload =
  | { ok: true; value: Omit<UploadedDocInput, "source"> }
  | { ok: false; error: string };

/**
 * Turn a multipart form into something recordUploadedDocument accepts.
 *
 * Shared by the portal and the operator screen so a subcontractor and a member
 * of staff cannot get different answers about the same file. Every message is
 * written to be read by a contractor on a phone, because on the portal side
 * that is exactly who reads it.
 */
export async function parseComplianceUpload(form: FormData): Promise<ParsedUpload> {
  const docType = String(form.get("doc_type") ?? "").trim() as DocType;
  if (!UPLOADABLE_DOC_TYPES.includes(docType)) {
    return { ok: false, error: "Choose which kind of document this is." };
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return { ok: false, error: "Attach a file." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "That file is over 12 MB. Send a smaller scan or a PDF." };
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_UPLOAD_MIME.has(mime) && !/\.(pdf|png|jpe?g|heic|docx?)$/i.test(file.name)) {
    return { ok: false, error: "Send a PDF, a photo, or a Word document." };
  }

  const text = (key: string): string | null => {
    const v = form.get(key);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const expiresAt = text("expires_at");
  const effectiveAt = text("effective_at");
  // Insurance is the reason this table exists, so a certificate without an
  // expiry is not accepted: it would sit on file looking valid forever.
  if (docType.startsWith("coi_") && !expiresAt) {
    return { ok: false, error: "Enter the date this policy expires. It is on the certificate." };
  }
  for (const [label, value] of [
    ["expiry", expiresAt],
    ["effective", effectiveAt],
  ] as const) {
    if (value && Number.isNaN(new Date(value).getTime())) {
      return { ok: false, error: `That ${label} date could not be read. Use the date picker.` };
    }
  }
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    return {
      ok: false,
      error: "That policy has already expired. Send the current certificate instead.",
    };
  }

  const coverageRaw = text("coverage_cents");
  const coverageCents = coverageRaw ? Number(coverageRaw) : null;
  if (coverageCents != null && (!Number.isFinite(coverageCents) || coverageCents < 0)) {
    return { ok: false, error: "Coverage amount has to be a number." };
  }

  return {
    ok: true,
    value: {
      docType,
      file: { name: file.name, mime, bytes: Buffer.from(await file.arrayBuffer()) },
      carrier: text("carrier"),
      policyNumber: text("policy_number"),
      coverageCents: coverageCents == null ? null : Math.round(coverageCents),
      effectiveAt,
      expiresAt,
    },
  };
}

/**
 * A human's decision on a document.
 *
 * Verifying sets the status from the expiry rather than to a flat 'active', so
 * a certificate that was already inside the 30 day window the moment it
 * arrived shows up as expiring straight away instead of looking fine until the
 * next sweep.
 */
export async function setDocumentDecision(
  subId: string,
  docId: string,
  decision: { action: "verify" | "reject"; userId: string; reason?: string },
  now = new Date()
): Promise<ComplianceDocRow | null> {
  const doc = await queryOne<ComplianceDocRow>(
    `select ${ROW_COLUMNS} from subcontractor_documents
      where id = $1 and subcontractor_id = $2`,
    [docId, subId]
  );
  if (!doc) return null;

  if (decision.action === "reject") {
    await query(
      `update subcontractor_documents
          set status = 'rejected', rejection_reason = $3, verified_by = $4,
              verified_at = null, updated_at = now()
        where id = $1 and subcontractor_id = $2`,
      [docId, subId, decision.reason?.trim() || "Rejected on review.", decision.userId]
    );
  } else {
    const status = currentStatus({ ...doc, status: "active" }, now);
    await query(
      `update subcontractor_documents
          set status = $3, verified_by = $4, verified_at = now(),
              rejection_reason = null, updated_at = now()
        where id = $1 and subcontractor_id = $2`,
      [docId, subId, status, decision.userId]
    );
  }

  await logAgent({
    agent: "compliance",
    action: decision.action === "verify" ? "document-verified" : "document-rejected",
    subcontractorId: subId,
    level: decision.action === "verify" ? "info" : "warn",
    message: `${DOC_LABEL[doc.doc_type as DocType] ?? doc.doc_type} ${
      decision.action === "verify" ? "verified" : `rejected: ${decision.reason?.trim() || "no reason given"}`
    }.`,
  });

  return queryOne<ComplianceDocRow>(
    `select ${ROW_COLUMNS} from subcontractor_documents where id = $1`,
    [docId]
  );
}
