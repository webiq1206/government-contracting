import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set(["note", "call"]);
const MAX_BODY = 4000;

/**
 * Log a manual activity on an opportunity: a note or a call summary. Lands in
 * the communications table so the activity timeline shows it alongside
 * automation, with no subcontractor attached (this is record-level history).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "outreach" });
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const payload = await req.json().catch(() => ({}));
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const text = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "kind must be note or call" }, { status: 400 });
  }
  if (!text) {
    return NextResponse.json({ error: "Write something first." }, { status: 400 });
  }

  const opp = await queryOne<{ id: string }>(
    `select id from opportunities where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await query(
    `insert into communications (org_id, opportunity_id, channel, direction, subject, body)
     values ($1, $2, $3, 'outbound', $4, $5)`,
    [
      orgId,
      params.id,
      kind,
      kind === "call" ? "Call logged" : "Note",
      text.slice(0, MAX_BODY),
    ]
  );
  return NextResponse.json({ ok: true });
}
