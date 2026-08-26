import { NextResponse } from "next/server";
import { requireOrgContext, notFoundResponse } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { logAgent } from "@/lib/logger";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DocRow {
  id: string;
  org_id: string | null;
  opportunity_id: string | null;
  name: string;
  disposition: string;
}

/**
 * Resolve a document and prove the caller's organization owns it.
 *
 * Same 404 for missing and for somebody else's: distinguishing them would
 * confirm that a document id exists and belongs to another account. The
 * founding organization's legacy rows predate `org_id`, so a null org is
 * theirs and nobody else's.
 */
async function ownedDocument(id: string, orgId: string): Promise<DocRow | null> {
  const doc = await queryOne<DocRow>(
    `select id, org_id, opportunity_id, name, disposition from documents where id = $1`,
    [id]
  );
  if (!doc) return null;
  const owned = doc.org_id === orgId || (doc.org_id === null && orgId === LEGACY_ORG_ID);
  return owned ? doc : null;
}

/**
 * Record a person's judgement about one document.
 *
 * PATCH /api/documents/[id]
 *
 * Three actions, deliberately not one "update":
 *
 *   review    a person read the file and says what is true about it
 *   supersede this file was replaced by another one
 *   exclude   this document is irrelevant to the bid, and here is why
 *
 * Every one of them changes whether the analysis can be trusted, which is a
 * judgement about the bid rather than a setting, so it takes the same
 * capability as deciding to pursue the opportunity at all. A viewer cannot do
 * any of them.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;
  const actor = ctx.user.email;

  const doc = await ownedDocument(params.id, ctx.orgId);
  if (!doc) return notFoundResponse();

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    note?: string;
    supersededBy?: string;
    reason?: string;
  };
  const note = (body.note ?? "").trim();

  if (body.action === "review") {
    if (!note) {
      // A review with no note records that somebody looked and nothing about
      // what they found, which is worth less than the blocker it clears.
      return NextResponse.json(
        { error: "Say what you found. A review with no note clears the flag and records nothing." },
        { status: 400 }
      );
    }
    await query(
      `update documents set reviewed_by=$2, reviewed_at=now(), review_note=$3 where id=$1`,
      [doc.id, actor, note]
    );
    await logAgent({
      agent: "operator",
      action: "document_reviewed",
      opportunityId: doc.opportunity_id ?? undefined,
      level: "info",
      message: `${actor} reviewed ${doc.name}: ${note}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "supersede") {
    const replacement = (body.supersededBy ?? "").trim();
    if (!replacement) {
      return NextResponse.json({ error: "Name the document that replaces this one." }, { status: 400 });
    }
    if (replacement === doc.id) {
      return NextResponse.json({ error: "A document cannot replace itself." }, { status: 400 });
    }
    const newer = await ownedDocument(replacement, ctx.orgId);
    // Not found rather than a validation message: the replacement id came from
    // a request body, and confirming that an id exists elsewhere is the same
    // leak as confirming it on the document itself.
    if (!newer || newer.opportunity_id !== doc.opportunity_id) return notFoundResponse();
    await query(`update documents set superseded_by=$2 where id=$1`, [doc.id, newer.id]);
    await logAgent({
      agent: "operator",
      action: "document_superseded",
      opportunityId: doc.opportunity_id ?? undefined,
      level: "info",
      message: `${actor} marked ${doc.name} as replaced by ${newer.name}. The older file is kept.`,
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "exclude") {
    const reason = (body.reason ?? "").trim();
    if (!reason) {
      // The database refuses this too. Answering here means the person gets a
      // sentence rather than a constraint violation.
      return NextResponse.json(
        { error: "Give a reason. An exclusion with no reason cannot be told apart from a lost file." },
        { status: 400 }
      );
    }
    await query(
      `update documents set disposition='excluded', excluded_reason=$2, excluded_by=$3, excluded_at=now()
        where id=$1`,
      [doc.id, reason, actor]
    );
    await logAgent({
      agent: "operator",
      action: "document_excluded",
      opportunityId: doc.opportunity_id ?? undefined,
      level: "info",
      message: `${actor} excluded ${doc.name} from this bid: ${reason}`,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
