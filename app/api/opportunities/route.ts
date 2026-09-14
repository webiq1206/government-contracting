import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { createSolicitation, type CreateSolicitationInput } from "@/lib/solicitation-import";
import { IMPORTED_FIELD_KEYS, type FieldProvenance, type ImportedFieldKey } from "@/lib/domain/solicitation-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHODS = new Set(["url", "upload", "manual"]);
const PROVENANCE = new Set<FieldProvenance>(["retrieved", "inferred", "entered"]);

/**
 * Add a solicitation a person found themselves.
 *
 * Until now every opportunity row was created by the SAM.gov monitor. This
 * is the one other way in, and it lands the record in the same place: the
 * same table, the same scoring job, the same analysis, documents, pricing
 * and deadlines as anything the monitor found.
 */
export async function POST(req: Request) {
  const ctx = await requireOrgContext({ capability: "decide" });
  if (ctx instanceof NextResponse) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const method = typeof body.method === "string" && METHODS.has(body.method) ? (body.method as CreateSolicitationInput["method"]) : "manual";
  const rawFields = (body.fields && typeof body.fields === "object" ? body.fields : {}) as Record<string, unknown>;
  const fields: CreateSolicitationInput["fields"] = {};
  for (const key of IMPORTED_FIELD_KEYS) {
    const v = rawFields[key];
    if (typeof v === "string") fields[key] = v.slice(0, key === "description" ? 60_000 : 500);
  }
  const rawProv = (body.provenance && typeof body.provenance === "object" ? body.provenance : {}) as Record<string, unknown>;
  const provenance: Partial<Record<ImportedFieldKey, FieldProvenance>> = {};
  for (const key of IMPORTED_FIELD_KEYS) {
    const v = rawProv[key];
    if (typeof v === "string" && PROVENANCE.has(v as FieldProvenance)) provenance[key] = v as FieldProvenance;
  }
  const attachments = Array.isArray(body.attachments)
    ? (body.attachments as unknown[])
        .filter((a): a is { name?: unknown; url?: unknown } => !!a && typeof a === "object")
        .map((a) => ({ name: typeof a.name === "string" ? a.name.slice(0, 200) : "attachment", url: typeof a.url === "string" ? a.url.slice(0, 2000) : "" }))
        .filter((a) => /^https?:\/\//i.test(a.url))
    : [];

  const res = await createSolicitation(ctx.orgId, ctx.user.email ?? null, {
    method,
    url: typeof body.url === "string" ? body.url : null,
    samNoticeId: typeof body.samNoticeId === "string" ? body.samNoticeId : null,
    fields,
    provenance,
    attachments,
    force: body.force === true,
  });
  if (!res.ok && "duplicates" in res) return NextResponse.json({ duplicates: res.duplicates }, { status: 409 });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, id: res.id, scoringQueued: res.scoringQueued });
}
