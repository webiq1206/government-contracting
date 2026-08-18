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

/**
 * What the transmittal letter may say is enclosed.
 *
 * "The following documents are enclosed as part of this submission" is a
 * statement the owner signs. It used to list every requirement that merely
 * HAD a generated artifact, so a bid bond the operator had not produced and a
 * licence nobody had uploaded were both certified to the contracting officer
 * as being in the envelope. Only what is actually in the package goes in the
 * list; the two documents the platform always produces are named outright
 * rather than inferred, and the letter does not enclose itself.
 */
export function enclosureList(resolved: ResolvedRequirement[]): string[] {
  return [
    "Priced offer",
    ...resolved
      .filter((r) => r.status === "satisfied" && r.artifact_kind !== ARTIFACT_KIND.coverLetter)
      .map((r) => r.title),
  ];
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

  /**
   * The facts about THIS solicitation that belong on the offer.
   *
   * `stated` is the guard: the analysis writes "Not specified in the provided
   * documents" into a field it could not find, and printing that string on a
   * document the agency reads is worse than leaving the line out. Nothing here
   * has a fallback, because the alternative to a real value is silence, not a
   * customary default.
   */
  const analysis = opp.solicitation_analysis ?? null;
  const stated = statedValue;
  const solicitationFacts = {
    place_of_performance:
      stated(analysis?.location) ??
      stated([opp.location_text, opp.location_state].filter(Boolean).join(", ")),
    period_of_performance: stated(analysis?.period_of_performance),
    offer_acceptance_period: stated(analysis?.offer_acceptance_period),
    amendments_acknowledged: amendments.map((a) => a.label).filter(Boolean),
  };

  // Cover / transmittal letter (lists everything enclosed, in order).
  if (need.has(ARTIFACT_KIND.coverLetter)) {
    out.push(await renderCoverLetter({ opportunityId, opp, profile, resolved, bidAmount }));
  }

  // Pricing / bid schedule.
  if (need.has(ARTIFACT_KIND.pricingSchedule)) {
    const buf = await documents.buildPricingSchedulePdf({
      company_name: profile.legal_name,
      opportunity_title: title,
      solicitation_number: sol,
      line_items: lineItems,
      bid_amount: bidAmount,
      agency_schedule: analysis?.bid_schedule ?? [],
      ...solicitationFacts,
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
      // The checkbox reads this, not the label: the label is prose ("Included")
      // and the box used to be ticked by looking for "satisf" inside it, which
      // never matched, so every row on the cover page of every submitted
      // package rendered unchecked, telling the contracting officer that not
      // one requirement was complete.
      complete: r.status === "satisfied",
      mandatory: r.mandatory,
      source: r.source,
      note: r.note,
      format: r.format,
      official_form: r.official_form,
    })),
  });
  out.push(
    await storeDoc(opportunityId, ARTIFACT_KIND.complianceChecklist, "Compliance checklist", checklist)
  );

  return out;
}

/**
 * Render (or re-render) the transmittal letter on its own.
 *
 * The letter states what is enclosed, and what is enclosed changes AFTER the
 * package is built: the operator attaches their bid bond, or reopens an item.
 * The letter was written once at build time and never revisited, so it
 * under-reported the package from the first attachment onward. Splitting it
 * out means the one document that makes a claim about the package can be
 * refreshed whenever the package changes, without re-running the whole
 * builder (which prices the bid and calls the model for the narrative).
 */
export async function renderCoverLetter(args: {
  opportunityId: string;
  opp: Opportunity;
  profile: CompanyProfileJson;
  resolved: ResolvedRequirement[];
  bidAmount: number;
}): Promise<DocRow> {
  const { opportunityId, opp, profile, resolved, bidAmount } = args;
  const analysis = opp.solicitation_analysis ?? null;
  const amendments = (analysis?.qa_addenda ?? []).map((a) => a.label).filter(Boolean);
  const buf = await documents.buildCoverLetterPdf({
    company_name: profile.legal_name,
    company_address: profile.physical_address,
    company_contact:
      [profile.owner_name, profile.owner_title, profile.phone, profile.email]
        .filter(Boolean)
        .join(" · ") || undefined,
    agency: opp.agency ?? undefined,
    opportunity_title: opp.title ?? "(untitled opportunity)",
    solicitation_number: opp.solicitation_number ?? undefined,
    bid_amount: bidAmount,
    contents: enclosureList(resolved),
    uei: profile.uei,
    cage_code: profile.cage_code,
    naics_code: opp.naics_code ?? undefined,
    set_aside: statedValue(opp.set_aside_type) ?? statedValue(analysis?.set_aside),
    place_of_performance:
      statedValue(analysis?.location) ??
      statedValue([opp.location_text, opp.location_state].filter(Boolean).join(", ")),
    period_of_performance: statedValue(analysis?.period_of_performance),
    offer_acceptance_period: statedValue(analysis?.offer_acceptance_period),
    amendments_acknowledged: amendments,
  });
  return storeDoc(opportunityId, ARTIFACT_KIND.coverLetter, "Cover letter", buf);
}

/**
 * A value only counts when the documents actually stated it. The analysis
 * writes "Not specified in the provided documents" into a field it could not
 * find, and printing that on a page the agency reads is worse than silence.
 */
export function statedValue(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  if (!t || /^not specified/i.test(t) || t === "-") return undefined;
  return t;
}
