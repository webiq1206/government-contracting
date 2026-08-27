import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { query, queryOne } from "@/lib/db";
import { recordAdminAction } from "@/lib/admin/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything one account's people put into the product, as one JSON file.
 *
 * For the customer who asks for their data, and for the account being closed
 * whose owner wants what was theirs. The shape is deliberate:
 *
 * - Business records only. Sessions, password hashes, encrypted integration
 *   secrets and Stripe internals are the platform's operational plumbing,
 *   not the customer's data, and exporting a credential blob would turn a
 *   data request into a security incident.
 * - Bounded per table, with the bound stated in the file. An export that
 *   silently truncates reads as complete, which is the worst version.
 * - Recorded in the admin audit log, because handing a copy of an account
 *   to whoever is signed in as an administrator is exactly the action that
 *   log exists to remember.
 */
const EXPORT_TABLES: { table: string; limit: number }[] = [
  { table: "company_profile", limit: 50 },
  { table: "opportunities", limit: 2000 },
  { table: "bids", limit: 2000 },
  { table: "contracts", limit: 500 },
  { table: "subcontractors", limit: 5000 },
  { table: "subcontractor_contacts", limit: 5000 },
  { table: "quotes", limit: 5000 },
  { table: "communications", limit: 10000 },
  { table: "documents", limit: 5000 },
  { table: "compliance_items", limit: 1000 },
  { table: "content_library", limit: 500 },
  { table: "custom_kpis", limit: 200 },
  { table: "feedback_reports", limit: 500 },
];

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof NextResponse) return auth;

  const org = await queryOne<{ id: string; name: string }>(
    `select id, name from organizations where id = $1`,
    [params.id]
  ).catch(() => null);
  if (!org) return NextResponse.json({ error: "No such account." }, { status: 404 });

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    organization: { id: org.id, name: org.name },
    note:
      "Business records only. Sessions, credentials and payment-processor internals are never part of an export. Each table is bounded; a table at its bound says so in _truncated.",
  };

  for (const { table, limit } of EXPORT_TABLES) {
    // Table names come from the constant above, never from the request.
    const rows = await query<Record<string, unknown>>(
      `select * from ${table} where org_id = $1 limit ${limit + 1}`,
      [org.id]
    ).catch(() => null);
    if (rows == null) {
      // Named, not skipped: a table that failed to read must not look empty.
      out[table] = { _error: "This table could not be read. The export is incomplete." };
      continue;
    }
    const truncated = rows.length > limit;
    out[table] = {
      count: Math.min(rows.length, limit),
      _truncated: truncated
        ? `Only the first ${limit} rows are here. Ask for a narrower export for the rest.`
        : undefined,
      rows: rows.slice(0, limit),
    };
  }

  await recordAdminAction({
    orgId: org.id,
    adminEmail: auth.email,
    action: "account_exported",
    detail: { tables: EXPORT_TABLES.length },
  });

  const safeName = org.name.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "account";
  return new NextResponse(JSON.stringify(out, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${safeName}-export.json"`,
    },
  });
}
