/**
 * Generates, stores, and records every auto-producible document in the
 * submission package: cover/transmittal letter, pricing schedule, prefilled
 * reps & certifications, capability statement, and the compliance checklist.
 * Called by the Bid Builder after pricing. Returns the documents_json rows.
 */
import { query } from "../db";
import { storage } from "../integrations/storage";
import { documents } from "../integrations/documents";
import { ARTIFACT_KIND } from "../domain/package";
import type { CompanyProfileJson, Opportunity, ResolvedRequirement } from "../types";

const STATUS_LABEL: Record<ResolvedRequirement["status"], string> = {
  satisfied: "Included",
  needs_signature: "Prefilled, needs signature",
  needs_operator: "You must provide this",
  missing: "Missing",
};

interface DocRow {
  name: string;
  storage_path: string;
  kind: string;
}

async function storeDoc(
  opportunityId: string,
  kind: string,
  displayName: string,
  buf: Buffer
): Promise<DocRow> {
  const key = `bids/${opportunityId}/${kind}.pdf`;
  const up = await storage.upload(key, buf, "application/pdf");
  await query(`delete from documents where opportunity_id = $1 and kind = $2`, [opportunityId, kind]);
  await query(
    `insert into documents (opportunity_id, kind, name, storage_path, storage_backend, mime)
     values ($1,$2,$3,$4,$5,'application/pdf')`,
    [opportunityId, kind, displayName, up.path, up.backend]
  );
  return { name: displayName, storage_path: up.path, kind };
}

export async function assemblePackageDocuments(args: {
  opportunityId: string;
  opp: Opportunity;
  profile: CompanyProfileJson;
  resolved: ResolvedRequirement[];
  lineItems: Array<{ label: string; amount: number }>;
  bidAmount: number;
  amendments?: Array<{ label: string; date?: string; summary?: string }>;
}): Promise<DocRow[]> {
  const { opportunityId, opp, profile, resolved, lineItems, bidAmount, amendments = [] } = args;
  const need = new Set(resolved.map((r) => r.artifact_kind).filter(Boolean) as string[]);
  const out: DocRow[] = [];
  const title = opp.title ?? "(untitled opportunity)";
  const sol = opp.solicitation_number ?? undefined;

  // Cover / transmittal letter (lists everything enclosed, in order).
  if (need.has(ARTIFACT_KIND.coverLetter)) {
    const contents = resolved
      .filter((r) => r.status === "satisfied" || r.artifact_kind)
      .map((r) => r.title);
    const buf = await documents.buildCoverLetterPdf({
      company_name: profile.legal_name,
      company_address: profile.physical_address,
      company_contact: [profile.owner_name, profile.owner_title, profile.phone, profile.email]
        .filter(Boolean)
        .join(" · ") || undefined,
      agency: opp.agency ?? undefined,
      opportunity_title: title,
      solicitation_number: sol,
      bid_amount: bidAmount,
      contents: contents.length ? contents : ["Priced offer", "Pricing schedule"],
    });
    out.push(await storeDoc(opportunityId, ARTIFACT_KIND.coverLetter, "Cover letter", buf));
  }

  // Pricing / bid schedule.
  if (need.has(ARTIFACT_KIND.pricingSchedule)) {
    const buf = await documents.buildPricingSchedulePdf({
      company_name: profile.legal_name,
      opportunity_title: title,
      solicitation_number: sol,
      line_items: lineItems,
      bid_amount: bidAmount,
    });
    out.push(await storeDoc(opportunityId, ARTIFACT_KIND.pricingSchedule, "Pricing schedule", buf));
  }

  // Prefilled representations & certifications.
  if (need.has(ARTIFACT_KIND.repsCerts)) {
    const buf = await documents.buildRepsAndCertsPdf({
      legal_name: profile.legal_name,
      dba: profile.dba,
      physical_address: profile.physical_address,
      uei: profile.uei,
      cage_code: profile.cage_code,
      duns: profile.duns,
      ein: profile.ein,
      entity_state: profile.entity_state,
      business_structure: profile.business_structure,
      small_business: profile.small_business,
      certifications: profile.certifications ?? [],
      naics_codes: profile.naics_codes ?? [],
      owner_name: profile.owner_name,
      owner_title: profile.owner_title,
      phone: profile.phone,
      email: profile.email,
      solicitation_number: sol,
    });
    out.push(
      await storeDoc(opportunityId, ARTIFACT_KIND.repsCerts, "Reps & certifications (prefilled)", buf)
    );
  }

  // Amendment acknowledgment (when amendments were issued).
  if (need.has(ARTIFACT_KIND.amendmentAck)) {
    const buf = await documents.buildAmendmentAckPdf({
      company_name: profile.legal_name,
      opportunity_title: title,
      solicitation_number: sol,
      amendments,
    });
    out.push(
      await storeDoc(opportunityId, ARTIFACT_KIND.amendmentAck, "Amendment acknowledgment", buf)
    );
  }

  // Capability statement.
  if (need.has(ARTIFACT_KIND.capability)) {
    const buf = await documents.buildCapabilityStatementPdf({
      company_name: profile.legal_name,
      uei: profile.uei,
      cage_code: profile.cage_code,
      naics_codes: profile.naics_codes ?? [],
      certifications: profile.certifications ?? [],
      primary_trades: profile.primary_trades ?? [],
      service_areas: profile.service_areas ?? [],
      contact: [profile.phone, profile.email].filter(Boolean).join(" · ") || undefined,
    });
    out.push(await storeDoc(opportunityId, ARTIFACT_KIND.capability, "Capability statement", buf));
  }

  // Compliance checklist cover page (always).
  const checklist = await documents.buildComplianceMatrixPdf({
    opportunity_title: title,
    solicitation_number: sol,
    company_name: profile.legal_name,
    rows: resolved.map((r) => ({
      title: r.title,
      status: STATUS_LABEL[r.status],
      mandatory: r.mandatory,
      source: r.source,
      note: r.note,
    })),
  });
  out.push(
    await storeDoc(opportunityId, ARTIFACT_KIND.complianceChecklist, "Compliance checklist", checklist)
  );

  return out;
}
