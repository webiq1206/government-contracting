import { readAmendmentNumber } from "@/lib/domain/document-inventory";
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query } from "@/lib/db";
import { resolveOutreachVars } from "@/lib/domain/outreach-vars";
import { selectDocumentsForTrade } from "@/lib/domain/attachment-selection";
import { professionalStem, uniqueFilename } from "@/lib/domain/attachment-naming";
import { normalizeAttachmentMeta } from "@/lib/domain/attachment-meta";
import { getProfileJson } from "@/lib/ai/companyProfile";
import { loadOutreachPreviewPair, OutreachPreviewUnavailable } from "@/lib/outreach-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real values for the Content Library preview.
 *
 * The preview used to render every template against the sample values the
 * palette advertises. That proves the SHAPE of an email and nothing about
 * whether it can be sent: the samples are complete by construction, so a
 * preview built from them is always perfect, and every gap that actually stops
 * a send is invisible until a real opportunity hits the outreach agent at 3am.
 *
 * Several defects in this rebuild were found by rendering an email by hand and
 * reading it. This is that, in the product, against records the operator
 * actually holds.
 *
 * GET  ?list=1                              -> pairings worth previewing
 * GET  ?opportunityId=..&subcontractorId=.. -> resolved variables for that pair
 */
export async function GET(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const url = new URL(req.url);

  if (url.searchParams.get("list") === "1") {
    type Pairing = {
      opportunity_id: string;
      subcontractor_id: string;
      trade: string | null;
      opportunity_title: string | null;
      company_name: string;
    };

    /*
     * Pairings that would really be emailed: a contactable subcontractor on a
     * live opportunity. Most recent first, because an operator checking their
     * template has a particular job in mind.
     */
    const real = await query<Pairing>(
      `select os.opportunity_id, os.subcontractor_id, os.trade,
              o.title as opportunity_title, s.company_name
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         join subcontractors s on s.id = os.subcontractor_id and s.org_id = o.org_id
        where o.org_id = $1
          and o.status = 'open'
          and coalesce(o.is_sources_sought, false) = false
          and os.removed_at is null
          and nullif(btrim(s.email), '') is not null
        order by o.created_at desc, s.company_name asc
        limit 25`,
      [orgId]
    );
    // An empty list is safer than presenting unrelated firms as trade matches.
    // Operators can still preview and test with sample values.
    return NextResponse.json({ pairings: real, synthesized: false });
  }

  const opportunityId = url.searchParams.get("opportunityId");
  const subcontractorId = url.searchParams.get("subcontractorId");
  if (!opportunityId || !subcontractorId) {
    return NextResponse.json(
      { error: "opportunityId and subcontractorId are required" },
      { status: 400 }
    );
  }

  let context: Awaited<ReturnType<typeof loadOutreachPreviewPair>>;
  try {
    context = await loadOutreachPreviewPair(orgId, {
      opportunityId, subcontractorId, trade: url.searchParams.get("trade"),
    });
  } catch (error) {
    if (error instanceof OutreachPreviewUnavailable) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const { opp, sub, trade } = context;
  const profile = await getProfileJson();

  const resolved = resolveOutreachVars({
    sub,
    opportunity: opp,
    analysis: (opp.solicitation_analysis ?? undefined) as never,
    profile: profile ?? {},
    trade,
    description: opp.description,
  });

  /*
   * Filenames only. The preview lists what would be attached; downloading the
   * bytes to render a preview would make opening a modal as expensive as
   * sending the email. Selection and renaming still run, because the count
   * and the names the operator sees must be the ones the send would produce.
   */
  const docs = await query<{
    name: string;
    document_class: string | null;
    amendment_number: number | null;
    trade_relevance: unknown;
    relevant_to_all: boolean | null;
    mime: string | null;
  }>(
    `select name, document_class, amendment_number, trade_relevance, relevant_to_all, mime
       from documents
      where opportunity_id = $1 and kind in ('solicitation','sow')
        and superseded_by is null and disposition <> 'excluded'
      order by created_at asc`,
    [opportunityId]
  );
  const selection = selectDocumentsForTrade(
    docs.map((d) => ({
      ...d,
      documentClass: d.document_class,
      tradeRelevance: Array.isArray(d.trade_relevance)
        ? d.trade_relevance.filter((t): t is string => typeof t === "string")
        : null,
      relevantToAll: d.relevant_to_all,
    })),
    trade
  );
  const taken = new Set<string>();
  const attachedNames = selection.included.map((d, i) =>
    uniqueFilename(
      normalizeAttachmentMeta({
        filename: professionalStem(d.name, {
          documentClass: d.document_class,
          amendmentNumber: readAmendmentNumber(d.name, d.amendment_number),
          solicitationNumber: opp.solicitation_number,
          index: i + 1,
        }),
        mime: d.mime,
      }).filename,
      taken
    )
  );

  return NextResponse.json({
    vars: resolved.vars,
    scopeBoundary: resolved.scopeBoundary,
    missingRequired: resolved.missingRequired,
    warnings: resolved.warnings,
    attachedNames,
    omittedDocuments: selection.omitted.map((o) => ({
      name: o.doc.name,
      reason: o.reason,
    })),
    subject: opp.title,
    company: sub.company_name,
  });
}
