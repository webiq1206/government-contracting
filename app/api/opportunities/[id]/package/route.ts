import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { storage } from "@/lib/integrations/storage";
import { makeZip, type ZipEntry } from "@/lib/zip";
import type { Bid, Opportunity, PackageItem } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DocRow {
  kind: string;
  storage_path: string | null;
  storage_backend: string | null;
}

/**
 * Download the entire submission package as a single ZIP: every generated file
 * named and ordered per the manifest, plus a README listing anything the
 * operator must still add (signatures, bid bonds, etc.).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const opp = await queryOne<Opportunity>(
    `select id, title, solicitation_number from opportunities where id=$1`,
    [params.id]
  );
  if (!opp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bid = await queryOne<Pick<Bid, "package_manifest">>(
    `select package_manifest from bids where opportunity_id=$1 order by created_at desc limit 1`,
    [params.id]
  );
  const manifest: PackageItem[] = bid?.package_manifest ?? [];
  if (manifest.length === 0) {
    return NextResponse.json({ error: "No package assembled yet." }, { status: 400 });
  }

  // Load the current storage path for each generated document kind.
  const docs = await queryOne<{ rows: DocRow[] }>(
    `select coalesce(json_agg(json_build_object(
        'kind', kind, 'storage_path', storage_path, 'storage_backend', storage_backend)), '[]') as rows
       from documents where opportunity_id=$1`,
    [params.id]
  );
  const byKind = new Map<string, DocRow>();
  for (const d of docs?.rows ?? []) if (d.kind) byKind.set(d.kind, d);

  const entries: ZipEntry[] = [];
  const toProvide: string[] = [];

  for (const item of manifest) {
    // Explicit path (e.g. the real agency form pulled from the solicitation).
    if (item.document_path) {
      try {
        const buf = await storage.download(item.document_path);
        entries.push({ name: item.filename, data: buf });
        continue;
      } catch {
        /* fall through */
      }
    }
    if (item.document_kind && byKind.has(item.document_kind)) {
      const doc = byKind.get(item.document_kind)!;
      if (doc.storage_path) {
        try {
          const backend =
            doc.storage_backend === "supabase" || doc.storage_backend === "local"
              ? doc.storage_backend
              : undefined;
          const buf = await storage.download(doc.storage_path, backend);
          entries.push({ name: item.filename, data: buf });
          continue;
        } catch {
          /* fall through to the provide-list */
        }
      }
    }
    // Operator-provided or unavailable: note it in the README instead.
    toProvide.push(`${item.filename} — ${item.status.replace(/_/g, " ")}`);
  }

  const readme = [
    `SUBMISSION PACKAGE — ${opp.title ?? params.id}`,
    opp.solicitation_number ? `Solicitation: ${opp.solicitation_number}` : "",
    "",
    "This archive contains the documents the platform generated, named and",
    "ordered for submission. Before you submit, complete the following items,",
    "which require your signature or documents only you can supply:",
    "",
    ...(toProvide.length ? toProvide.map((t) => `  • ${t}`) : ["  (nothing — the package is complete)"]),
    "",
    "Always confirm against the actual solicitation's instructions to offerors.",
  ]
    .filter((l) => l !== undefined)
    .join("\n");
  entries.push({ name: "00_READ_ME_FIRST.txt", data: Buffer.from(readme, "utf8") });

  const zip = makeZip(entries.sort((a, b) => a.name.localeCompare(b.name)));
  const base = (opp.solicitation_number ?? opp.title ?? "bid")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 60);

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="submission_package_${base}.zip"`,
    },
  });
}
