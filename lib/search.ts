/**
 * One implementation of "search this account", used by both surfaces.
 *
 * The overlay and the full results page ask the same question and must get the
 * same answer. Two copies of these queries would drift, and the way anybody
 * would find out is a record appearing in one and not the other, which reads
 * as data loss rather than as a bug.
 *
 * Every query is scoped to the caller's organization. A search is the one
 * place a tenant boundary is easiest to lose, because it deliberately reaches
 * across every table at once, and the most expensive to lose for the same
 * reason.
 */
import { query } from "./db";
import { dedupeOpportunityHits } from "./domain/search-dedupe";
import { snippet, type SearchResult } from "./domain/search-results";

export async function searchEverything(
  rawQuery: string,
  orgId: string,
  perKind = 8,
  /**
   * Show every copy of a duplicated solicitation rather than the one being
   * worked. The default is to collapse, because that is what somebody
   * jumping to a record wants; this is for the operator who followed the
   * "see all copies" link and is about to close two of them.
   */
  opts: { collapseDuplicates?: boolean } = {}
): Promise<SearchResult[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;

  const [opps, subs, contracts, messages, docs] = await Promise.all([
    query<{ id: string; title: string | null; agency: string | null; solicitation_number: string | null; stage: string; status: string }>(
      `select id, title, agency, solicitation_number, stage, status
         from opportunities
        where org_id = $2 and (title ilike $1 or solicitation_number ilike $1 or agency ilike $1)
        order by (status='open') desc, updated_at desc
        limit $3`,
      [like, orgId, perKind]
    ),
    query<{ id: string; company_name: string; city: string | null; state: string | null; trade_categories: string[] | null }>(
      `select id, company_name, city, state, trade_categories
         from subcontractors
        where org_id = $2 and (company_name ilike $1 or owner_name ilike $1)
        order by is_preferred desc, company_name asc
        limit $3`,
      [like, orgId, perKind]
    ),
    query<{ id: string; contract_number: string | null; title: string | null }>(
      `select c.id, c.contract_number, o.title
         from contracts c
         left join opportunities o on o.id = c.opportunity_id
        where c.org_id = $2 and (c.contract_number ilike $1 or o.title ilike $1)
        order by c.created_at desc
        limit $3`,
      [like, orgId, perKind]
    ),
    /*
     * Messages and documents were never searched at all.
     *
     * Somebody looking for a line from an email, or for the scope sheet they
     * attached last week, got nothing back and no sign that those records had
     * simply never been looked at. Both are org-scoped like everything else
     * here; a search is the one place a tenant boundary is easiest to lose and
     * most expensive to lose.
     */
    query<{
      id: string;
      subject: string | null;
      body: string | null;
      direction: string;
      created_at: Date;
      opportunity_id: string | null;
      company_name: string | null;
    }>(
      `select c.id, c.subject, c.body, c.direction, c.created_at, c.opportunity_id,
              s.company_name
         from communications c
         left join subcontractors s on s.id = c.subcontractor_id
        where c.org_id = $2 and (c.subject ilike $1 or c.body ilike $1)
        order by c.created_at desc
        limit $3`,
      [like, orgId, perKind]
    ),
    query<{ id: string; name: string; kind: string; opportunity_id: string | null }>(
      `select id, name, kind, opportunity_id
         from documents
        where org_id = $2 and name ilike $1
        order by created_at desc
        limit $3`,
      [like, orgId, perKind]
    ),
  ]);

  const collapse = opts.collapseDuplicates !== false;
  const oppRows = collapse
    ? dedupeOpportunityHits(opps)
    : opps.map((o) => ({ ...o, duplicates: 0 }));

  const results: SearchResult[] = [
    ...oppRows.map((o) => ({
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
      // The folded copies, reachable rather than merely counted. Searching
      // the government's own identifier is what puts them side by side, and
      // `all=1` is what stops this list collapsing them again.
      cluster:
        o.duplicates > 0 && o.solicitation_number
          ? {
              count: o.duplicates + 1,
              href: `/search?q=${encodeURIComponent(o.solicitation_number)}&kind=opportunity&all=1`,
            }
          : undefined,
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
    ...messages.map((m) => ({
      kind: "communication" as const,
      title: m.subject?.trim() || "(no subject)",
      // A window around the match rather than the opening of the body, so a
      // long email shows the line that matched instead of its greeting.
      subtitle: [
        m.company_name,
        m.direction === "inbound" ? "received" : "sent",
        snippet(m.body ?? "", q),
      ]
        .filter(Boolean)
        .join(" · "),
      href: "/communications",
    })),
    ...docs.map((d) => ({
      kind: "document" as const,
      title: d.name,
      subtitle: d.kind.replace(/_/g, " "),
      // Documents live on their opportunity; one without a parent has nowhere
      // of its own to open, so it points at the library rather than at a
      // record that does not exist.
      href: d.opportunity_id ? `/opportunity/${d.opportunity_id}#documents` : "/pipeline",
    })),
  ];


  return results;
}
