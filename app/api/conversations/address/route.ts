import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Deliberately strict rather than clever. A bounce means the address on file
 * is wrong, and the correction is typed by a person under pressure. Accepting
 * something that is not an address, or silently trimming it into a different
 * one, produces a second bounce and the appearance that the fix did not work.
 */
const EMAIL = /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/;

/**
 * Correct the email address on a subcontractor record.
 *
 * Scoped to this org's subcontractors, so a bounced conversation cannot be
 * used to rewrite an address belonging to another tenant. The old address is
 * logged: proving what was on file when a message bounced is the point of
 * keeping a log at all.
 */
export async function POST(req: Request) {
  const auth = await requireCapability("outreach");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    subcontractorId?: string;
    email?: string;
  };
  const email = (body.email ?? "").trim();
  if (!body.subcontractorId) {
    return NextResponse.json({ error: "Which subcontractor?" }, { status: 400 });
  }
  if (!EMAIL.test(email) || email.length > 320) {
    return NextResponse.json(
      { error: "That does not look like an email address." },
      { status: 400 }
    );
  }

  const sub = await queryOne<{ id: string; email: string | null; company_name: string | null }>(
    `select id, email, company_name from subcontractors
      where id = $1 and (org_id = $2 or org_id is null)`,
    [body.subcontractorId, orgId]
  );
  if (!sub) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await query(
    `update subcontractors set email = $1, updated_at = now() where id = $2`,
    [email, sub.id]
  );
  await logAgent({
    agent: "communications",
    action: "email_corrected",
    subcontractorId: sub.id,
    status: "ok",
    message: `Corrected email for ${sub.company_name ?? "a subcontractor"}`,
    input: { from: sub.email, to: email },
  });

  return NextResponse.json({ ok: true, email });
}
