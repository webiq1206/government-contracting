import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { logAgent } from "@/lib/logger";
import { attachToRequirement } from "@/lib/bid-package-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/**
 * Operator document upload for an opportunity (proof, amendments, attachments).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { user: auth, orgId } = ctx;

  const opp = await queryOne<{ id: string }>(
    `select id from opportunities where id=$1 and org_id=$2`,
    [params.id, orgId]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be between 1 byte and 12 MB." }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  if (!ALLOWED.has(mime) && !file.name.toLowerCase().match(/\.(pdf|png|jpe?g|docx?)$/)) {
    return NextResponse.json(
      { error: "Upload a PDF, Word doc, PNG, or JPEG." },
      { status: 400 }
    );
  }

  const label =
    (typeof form.get("name") === "string" && String(form.get("name")).trim()) ||
    file.name ||
    "Operator upload";
  const kindRaw = typeof form.get("kind") === "string" ? String(form.get("kind")).trim() : "";
  const kind = (kindRaw || "operator_upload").replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);

  /**
   * Which requirement this file answers.
   *
   * Optional, but when it is given the upload stops being a loose attachment
   * and becomes part of the submission: the requirement is marked complete
   * with this file attached, and the manifest carries it, so the operator's
   * signed offer form and their bid bond are actually inside the package they
   * download. Before this, an upload lived on the opportunity and the zip
   * still contained a "__PROVIDE_THIS.txt" placeholder in its place.
   */
  const requirementId =
    typeof form.get("requirement_id") === "string"
      ? String(form.get("requirement_id")).trim().slice(0, 120)
      : "";

  const buf = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "upload.bin";
  const key = `opportunities/${params.id}/operator/${Date.now()}-${safeName}`;
  const up = await storage.upload(key, buf, mime);

  const row = await queryOne<{ id: string }>(
    `insert into documents (opportunity_id, kind, name, storage_path, storage_backend, mime, requirement_id)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id`,
    [params.id, kind, label, up.path, up.backend, mime, requirementId || null]
  );

  if (requirementId) {
    const attached = await attachToRequirement({
      opportunityId: params.id,
      orgId,
      requirementId,
      doc: { name: label, path: up.path, mime },
    });
    if (!attached.ok) {
      // The file is stored either way; say plainly that it did not land on a
      // requirement rather than let the operator believe the item is closed.
      return NextResponse.json(
        { ok: true, id: row?.id, path: up.path, name: label, requirement_error: attached.error },
        { status: 200 }
      );
    }
  }

  await logAgent({
    agent: "operator",
    action: "document-upload",
    level: "info",
    opportunityId: params.id,
    message: `Operator ${auth.email} uploaded "${label}".`,
  });

  return NextResponse.json({
    ok: true,
    id: row?.id,
    path: up.path,
    name: label,
    requirement_id: requirementId || undefined,
  });
}
