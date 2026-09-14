import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { query, queryOne } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { getService, isAuthFailure, markServiceError, markSynced } from "@/lib/connected-services";
import { ensureOpportunityFolder, uploadFile } from "@/lib/integrations/file-export";
import { folderName } from "@/lib/domain/connected-services";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE_PROVIDERS = new Set(["google_drive", "microsoft_onedrive", "dropbox", "box"]);

/**
 * Save this opportunity's stored documents into the person's connected
 * storage. Body: `{ serviceId, documentIds?: string[] }`; with no ids, every
 * stored document goes. Each file is recorded in the sync ledger so a
 * second press does not upload a second copy.
 */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireOrgContext({ capability: "view" });
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as { serviceId?: unknown; documentIds?: unknown };
  const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
  const row = serviceId ? await getService(serviceId, ctx.orgId) : null;
  if (!row || !FILE_PROVIDERS.has(row.provider)) return NextResponse.json({ error: "Choose a connected file storage first." }, { status: 400 });
  if (row.status !== "connected") return NextResponse.json({ error: "That storage connection is not active. Check it under Settings, Integrations." }, { status: 409 });
  // A personal connection is only its owner's to write into.
  if (row.user_id && row.user_id !== ctx.user.id) return NextResponse.json({ error: "That is somebody else's personal connection." }, { status: 403 });

  const opp = await queryOne<{ id: string; title: string | null; solicitation_number: string | null }>(
    `select id, title, solicitation_number from opportunities where id=$1 and org_id=$2`,
    [params.id, ctx.orgId]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ids = Array.isArray(body.documentIds) ? (body.documentIds as unknown[]).filter((d): d is string => typeof d === "string") : [];
  const docs = await query<{ id: string; name: string; storage_path: string | null; storage_backend: string | null; mime: string | null }>(
    `select id, name, storage_path, storage_backend, mime from documents
      where opportunity_id=$1 and storage_path is not null and superseded_by is null and disposition <> 'excluded'
        and ($2::uuid[] = '{}'::uuid[] or id = any($2::uuid[]))
      order by created_at limit 40`,
    [opp.id, ids]
  );
  if (docs.length === 0) return NextResponse.json({ error: "There are no stored documents to save yet." }, { status: 400 });

  const done: { id: string; name: string; url: string | null; skipped?: boolean }[] = [];
  const failed: { id: string; name: string; error: string }[] = [];
  try {
    const folder = await ensureOpportunityFolder(row, opp.id, folderName(opp));
    for (const d of docs) {
      const key = `document:${d.id}`;
      const prior = await queryOne<{ remote_id: string | null; last_error: string | null; status: string }>(
        `select remote_id, last_error, status from connected_service_items where service_id=$1 and kind='file' and local_key=$2`,
        [row.id, key]
      );
      if (prior?.status === "synced") {
        done.push({ id: d.id, name: d.name, url: prior.last_error, skipped: true });
        continue;
      }
      try {
        const bytes = await storage.download(d.storage_path!, (d.storage_backend as "supabase" | "db" | "local" | null) ?? undefined);
        const up = await uploadFile(row, folder, d.name, d.mime ?? "application/octet-stream", bytes);
        // The file's link is kept in last_error's slot only because the ledger
        // has no dedicated column; it is a URL, never an error, on a synced row.
        await query(
          `insert into connected_service_items (service_id, org_id, kind, local_key, remote_id, status, last_error, synced_at)
           values ($1,$2,'file',$3,$4,'synced',$5,now())
           on conflict (service_id, kind, local_key) do update set remote_id=excluded.remote_id, status='synced', last_error=excluded.last_error, synced_at=now()`,
          [row.id, ctx.orgId, key, up.remoteId, up.url]
        );
        done.push({ id: d.id, name: d.name, url: up.url });
      } catch (err) {
        if (isAuthFailure(err)) throw err;
        failed.push({ id: d.id, name: d.name, error: (err as Error).message.slice(0, 200) });
      }
    }
    await markSynced(row.id);
  } catch (err) {
    if (isAuthFailure(err)) {
      await markServiceError(row.id, "The storage provider no longer accepts this connection. Reconnect it.");
      return NextResponse.json({ error: "The storage provider no longer accepts this connection. Reconnect it under Settings, Integrations." }, { status: 502 });
    }
    return NextResponse.json({ error: `Could not save to storage: ${(err as Error).message}` }, { status: 502 });
  }
  await logAgent({
    agent: "operator",
    action: "documents-exported",
    level: "info",
    opportunityId: opp.id,
    message: `${ctx.user.email} saved ${done.filter((d) => !d.skipped).length} document(s) to ${row.provider.replace(/_/g, " ")}${failed.length ? `; ${failed.length} failed` : ""}.`,
  });
  return NextResponse.json({ ok: failed.length === 0, saved: done, failed });
}
