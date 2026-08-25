import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { resolveOutreachVars } from "@/lib/domain/outreach-vars";
import { getProfileJson } from "@/lib/ai/companyProfile";
import type { Opportunity } from "@/lib/types";

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
         join subcontractors s on s.id = os.subcontractor_id
        where o.org_id = $1
          and o.status = 'open'
          and s.email is not null
        order by o.created_at desc, s.company_name asc
        limit 25`,
      [orgId]
    );
    if (real.length) return NextResponse.json({ pairings: real, synthesized: false });

    /*
     * Nobody has been paired to anything yet.
     *
     * This is exactly when checking a template matters most: before the first
     * send, not after. So pair each open opportunity with a subcontractor,
     * preferring one whose trades overlap what the analysis says the job
     * needs, and falling back to any contactable firm when the opportunity has
     * no analysis yet.
     *
     * That last case is not a degraded preview, it is the interesting one: an
     * opportunity with no analysis cannot produce a sendable email, and seeing
     * exactly which required values are missing is more use than an empty
     * picker that says nothing.
     */
    const synthesized = await query<Pairing>(
      `select o.id as opportunity_id, s.id as subcontractor_id,
              t.trade, o.title as opportunity_title, s.company_name
         from opportunities o
         left join lateral (
           select trade
             from jsonb_array_elements_text(
                    case
                      when jsonb_typeof(o.solicitation_analysis->'required_trades') = 'array'
                        then o.solicitation_analysis->'required_trades'
                      else '[]'::jsonb
                    end
                  ) as trade
            limit 1
         ) t on true
         join lateral (
           select s2.id, s2.company_name
             from subcontractors s2
            where s2.org_id = o.org_id
              and s2.email is not null
            -- A trade match first; any contactable firm rather than none.
            order by (t.trade is not null and s2.trade_categories && array[t.trade]) desc,
                     s2.company_name asc
            limit 1
         ) s on true
        where o.org_id = $1 and o.status = 'open'
        order by o.created_at desc
        limit 25`,
      [orgId]
    );

    return NextResponse.json({ pairings: synthesized, synthesized: true });
  }

  const opportunityId = url.searchParams.get("opportunityId");
  const subcontractorId = url.searchParams.get("subcontractorId");
  if (!opportunityId || !subcontractorId) {
    return NextResponse.json(
      { error: "opportunityId and subcontractorId are required" },
      { status: 400 }
    );
  }

  // Both reads are org-scoped. A preview must never be a way to read another
  // tenant's opportunity by guessing an id.
  const opp = await queryOne<Opportunity>(
    `select * from opportunities where id = $1 and org_id = $2`,
    [opportunityId, orgId]
  );
  const sub = await queryOne<{ owner_name: string | null; company_name: string }>(
    `select owner_name, company_name from subcontractors where id = $1 and org_id = $2`,
    [subcontractorId, orgId]
  );
  if (!opp || !sub) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  /*
   * The trade decides the scope, so losing it turns a trade-specific preview
   * into a whole-project one. Read it from the pairing when one exists; a
   * hypothetical pairing has no row, so the caller passes the trade it offered.
   */
  const pairing = await queryOne<{ trade: string | null }>(
    `select trade from opportunity_subs
      where opportunity_id = $1 and subcontractor_id = $2
      order by created_at desc limit 1`,
    [opportunityId, subcontractorId]
  );
  const trade = pairing?.trade ?? url.searchParams.get("trade") ?? null;
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
   * sending the email.
   */
  const docs = await query<{ name: string }>(
    `select name from documents
      where opportunity_id = $1 and kind in ('solicitation','sow')
      order by created_at asc limit 40`,
    [opportunityId]
  );

  return NextResponse.json({
    vars: resolved.vars,
    scopeBoundary: resolved.scopeBoundary,
    missingRequired: resolved.missingRequired,
    warnings: resolved.warnings,
    attachedNames: docs.map((d) => d.name),
    subject: opp.title,
    company: sub.company_name,
  });
}
