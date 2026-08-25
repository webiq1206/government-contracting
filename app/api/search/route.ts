import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query } from "@/lib/db";
import { dedupeOpportunityHits, type OppHit } from "@/lib/domain/search-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface SearchResult {
  kind: "opportunity" | "subcontractor" | "contract";
  title: string;
  subtitle: string;
  href: string;
}

export async function GET(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });
  const like = `%${q}%`;

  const [opps, subs, contracts] = await Promise.all([
    query<{ id: string; title: string | null; agency: string | null; solicitation_number: string | null; stage: string; status: string }>(
      `select id, title, agency, solicitation_number, stage, status
         from opportunities
        where org_id = $2 and (title ilike $1 or solicitation_number ilike $1 or agency ilike $1)
        order by (status='open') desc, updated_at desc
        limit 8`,
      [like, orgId]
    ),
    query<{ id: string; company_name: string; city: string | null; state: string | null; trade_categories: string[] | null }>(
      `select id, company_name, city, state, trade_categories
         from subcontractors
        where org_id = $2 and (company_name ilike $1 or owner_name ilike $1)
        order by is_preferred desc, company_name asc
        limit 6`,
      [like, orgId]
    ),
    query<{ id: string; contract_number: string | null; title: string | null }>(
      `select c.id, c.contract_number, o.title
         from contracts c
         left join opportunities o on o.id = c.opportunity_id
        where c.org_id = $2 and (c.contract_number ilike $1 or o.title ilike $1)
        order by c.created_at desc
        limit 4`,
      [like, orgId]
    ),
  ]);

  const results: SearchResult[] = [
    ...dedupeOpportunityHits(opps).map((o) => ({
      kind: "opportunity" as const,
      title: o.title ?? "Untitled opportunity",
      subtitle: [
        o.agency,
        o.solicitation_number,
        o.status === "archived" ? "archived" : o.stage.replace(/_/g, " "),
        // Say so rather than hide it. A folded duplicate is a data-quality
        // fact the operator may want to act on, and silently showing one of
        // three looks like the other two do not exist.
        o.duplicates > 0 ? `+${o.duplicates} duplicate record${o.duplicates === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/opportunity/${o.id}`,
    })),
    ...subs.map((s) => ({
      kind: "subcontractor" as const,
      title: s.company_name,
      subtitle: [
        (s.trade_categories ?? []).slice(0, 2).join(", "),
        [s.city, s.state].filter(Boolean).join(", "),
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/subs/${s.id}`,
    })),
    ...contracts.map((c) => ({
      kind: "contract" as const,
      title: c.contract_number ?? "Contract",
      subtitle: c.title ?? "",
      href: "/contracts",
    })),
  ];

  return NextResponse.json({ results });
}
