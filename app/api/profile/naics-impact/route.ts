import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How much work each NAICS code is actually bringing in.
 *
 * The code list is the filter the opportunity feed runs on, and it is edited
 * as a row of chips with nothing to say what any of them does. Removing one is
 * a decision about the pipeline, taken with no information: an operator
 * tidying up a list they no longer recognize can switch off the source of half
 * their work and find out six weeks later when the feed is thin.
 *
 * Read-only, and counted over what is open now rather than over all history,
 * because "what would I stop seeing" is the question being asked.
 */
export async function GET(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const raw = new URL(req.url).searchParams.get("codes") ?? "";
  const codes = raw
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    // A bounded list: this is driven by a form field, and a request naming
    // five hundred codes is a mistake or an attempt, never a real profile.
    .slice(0, 60);
  if (codes.length === 0) return NextResponse.json({ counts: [], unmatched: 0 });

  const rows = await query<{ code: string; open: string; pursued: string }>(
    `select o.naics_code as code,
            count(*)::int as open,
            count(*) filter (
              where o.tier = 'pursue'
                 or o.stage in ('sub_research','outreach','call_queue','quote_entry',
                                'bid_building','submitted','won','lost')
            )::int as pursued
       from opportunities o
      where o.org_id = $1
        and o.status = 'open'
        and o.stage not in ('dismissed','lost')
        and o.naics_code = any($2::text[])
      group by 1`,
    [ctx.orgId, codes]
  );

  const byCode = new Map(rows.map((r) => [r.code, r]));
  const counts = codes.map((code) => ({
    code,
    open: Number(byCode.get(code)?.open ?? 0),
    pursued: Number(byCode.get(code)?.pursued ?? 0),
  }));

  /*
   * Open work carrying a code that is not on the list. It arrived under an
   * older profile, or was added by hand, and it is the other half of the
   * question: a code missing from the list is work the feed will stop
   * finding.
   */
  const other = await query<{ code: string | null; n: string }>(
    `select o.naics_code as code, count(*)::int as n
       from opportunities o
      where o.org_id = $1
        and o.status = 'open'
        and o.stage not in ('dismissed','lost')
        and coalesce(o.naics_code, '') <> ''
        and not (o.naics_code = any($2::text[]))
      group by 1
      order by count(*) desc
      limit 5`,
    [ctx.orgId, codes]
  );

  return NextResponse.json({
    counts,
    unlisted: other.map((r) => ({ code: r.code, open: Number(r.n) })),
  });
}
