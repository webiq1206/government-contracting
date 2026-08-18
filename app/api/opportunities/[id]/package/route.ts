import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
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
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;
  const { orgId } = ctx;

  const opp = await queryOne<Opportunity>(
    `select id, title, solicitation_number, deadline, solicitation_analysis
       from opportunities where id=$1 and org_id=$2`,
    [params.id, orgId]
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
  /**
   * Documents the platform said it had produced and then could not put in the
   * archive. These used to land in the same list as the bid bond and the
   * insurance certificate, under a heading that reads "documents only you can
   * supply", so a generation or storage failure was presented to the operator
   * as their own to-do. They would tick it off, submit, and the package would
   * be missing a document the compliance checklist swore was included.
   */
  const missingGenerated: string[] = [];

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
    // Anything the package CLAIMS to contain and could not produce bytes for
    // is a hole, whoever was supposed to supply it. An operator-attached file
    // whose storage object has gone missing is not a to-do item for them, it
    // is a document that will be absent from a package their own checklist
    // says is complete.
    if (item.status === "satisfied") {
      missingGenerated.push(item.title ?? item.filename);
    } else {
      toProvide.push(`${item.title ?? item.filename} (${item.status.replace(/_/g, " ")})`);
    }
  }

  /**
   * The compliance checklist rides along, clearly marked, and is NOT part of
   * the offer.
   *
   * It was generated on every build, stored, and then never appeared in the
   * archive at all, because the manifest is built from requirements and no
   * requirement maps to it. It is worth having, but it is an internal
   * pre-flight page: its rows say things like "You must provide this", which
   * is not something to hand a contracting officer. So it goes in under a
   * name nobody could mistake for a submission document, and the README says
   * to leave it out.
   */
  const checklist = byKind.get("compliance_checklist");
  let checklistIncluded = false;
  if (checklist?.storage_path) {
    try {
      const backend =
        checklist.storage_backend === "supabase" || checklist.storage_backend === "local"
          ? checklist.storage_backend
          : undefined;
      entries.push({
        name: "00_INTERNAL_compliance_checklist_DO_NOT_SUBMIT.pdf",
        data: await storage.download(checklist.storage_path, backend),
      });
      checklistIncluded = true;
    } catch {
      /* the README still lists what is outstanding */
    }
  }

  /**
   * How and when to submit, in the solicitation's own words.
   *
   * A package can be assembled perfectly and still lose because it went to
   * the wrong place or arrived an hour late. The analysis captured the
   * submission method and the due date verbatim, including its timezone, and
   * neither ever reached the operator at the moment they are about to send.
   * Printed only when actually stated, never reconstructed.
   */
  const analysis = opp.solicitation_analysis ?? null;
  const stated = (v: string | null | undefined): string | null => {
    const t = (v ?? "").trim();
    return !t || /^not specified/i.test(t) || t === "-" ? null : t;
  };
  const dueDate = stated(analysis?.due_date);
  const method = stated(analysis?.submission_method);
  const submissionRules = (analysis?.submission_requirements ?? []).filter(
    (r) => stated(r) !== null
  );
  const howToSubmit =
    dueDate || method || submissionRules.length > 0
      ? [
          "HOW AND WHEN TO SUBMIT, as the solicitation states it:",
          "",
          dueDate ? `  Due: ${dueDate}` : "",
          method ? `  Method: ${method}` : "",
          ...submissionRules.map((r) => `  - ${r}`),
          "",
        ].filter(Boolean)
      : [];

  const readme = [
    `SUBMISSION PACKAGE, ${opp.title ?? params.id}`,
    opp.solicitation_number ? `Solicitation: ${opp.solicitation_number}` : "",
    "",
    ...howToSubmit,
    ...(missingGenerated.length
      ? [
          "THIS ARCHIVE IS INCOMPLETE. DO NOT SUBMIT IT AS IS.",
          "",
          "The following documents were supposed to be in here and could not be",
          "read back from storage. This is a platform failure, not something for",
          "you to write. Re-run the Bid Builder on this opportunity, then download",
          "the package again:",
          "",
          ...missingGenerated.map((t) => `  ! ${t}`),
          "",
        ]
      : []),
    "This archive contains the documents the platform generated, named and",
    "ordered for submission. Before you submit, complete the following items,",
    "which require your signature or documents only you can supply:",
    "",
    ...(toProvide.length
      ? toProvide.map((t) => `  • ${t}`)
      : ["  (nothing, every item is either enclosed or already confirmed)"]),
    "",
    ...(checklistIncluded
      ? [
          "",
          "00_INTERNAL_compliance_checklist_DO_NOT_SUBMIT.pdf is your own pre-flight",
          "page. Read it, then leave it out of what you send.",
        ]
      : []),
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
