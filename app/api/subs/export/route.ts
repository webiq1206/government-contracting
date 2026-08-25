import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query } from "@/lib/db";
import { toCsv } from "@/lib/domain/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never export the whole roster in one request by accident. */
const MAX_ROWS = 1000;

interface Row {
  company_name: string;
  owner_name: string | null;
  trade_categories: string[] | null;
  city: string | null;
  state: string | null;
  email: string | null;
  email_verified: boolean;
  phone: string | null;
  website: string | null;
  license_status: string | null;
  reliability_score: number | null;
  google_rating: number | null;
  review_count: number | null;
  is_preferred: boolean;
  last_contacted: string | null;
}

/**
 * Export selected subcontractors as CSV.
 *
 * Scoped to the caller's organization in the statement itself, not filtered
 * afterwards: an export is a bulk read of contact details, and it is exactly
 * the kind of endpoint where "the ids came from the client" becomes another
 * tenant's roster if the query trusts them.
 */
export async function GET(req: Request) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, MAX_ROWS);

  if (ids.length === 0) {
    return NextResponse.json({ error: "Select at least one subcontractor to export." }, { status: 400 });
  }

  const rows = await query<Row>(
    `select company_name, owner_name, trade_categories, city, state,
            email, email_verified, phone, website, license_status,
            reliability_score, google_rating, review_count, is_preferred, last_contacted
       from subcontractors
      where org_id = $1 and id = any($2::uuid[])
      order by company_name`,
    [orgId, ids]
  );

  const csv = toCsv(
    [
      "Company",
      "Owner",
      "Trades",
      "City",
      "State",
      "Email",
      "Email verified",
      "Phone",
      "Website",
      "Licence",
      "Reliability",
      "Google rating",
      "Reviews",
      "Preferred",
      "Last contacted",
    ],
    rows.map((r) => [
      r.company_name,
      r.owner_name,
      (r.trade_categories ?? []).join("; "),
      r.city,
      r.state,
      r.email,
      r.email_verified ? "yes" : "no",
      r.phone,
      r.website,
      r.license_status,
      r.reliability_score,
      r.google_rating,
      r.review_count,
      r.is_preferred ? "yes" : "no",
      r.last_contacted ? new Date(r.last_contacted).toISOString().slice(0, 10) : "",
    ])
  );

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="subcontractors-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      // A roster of contact details is not something to leave in a shared cache.
      "cache-control": "no-store",
    },
  });
}
