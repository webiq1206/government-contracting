import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { storage, verifyFileToken } from "@/lib/integrations/storage";
import { normalizeAttachmentMeta } from "@/lib/domain/attachment-meta";
import { orgOwnsStorageKey } from "@/lib/domain/file-ownership";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve a stored document (local/db backend) or redirect to a Supabase signed URL. */
export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = params.path.join("/");
  // Reject traversal.
  if (key.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });

  // Access is one of two capabilities, and NEITHER is "any logged-in user".
  //
  //   1. A signed, time-limited token. The token is bound to this exact key
  //      (HMAC over key+exp), so it is a capability for one file and cannot be
  //      repointed at another tenant's key. These are the links emailed to
  //      external recipients (subcontractors), who have no session.
  //
  //   2. A signed-in user WHOSE ORG OWNS THE FILE. Authentication alone is not
  //      enough: keys are a flat namespace and several shapes are guessable
  //      from an opportunity UUID, so a bare requireUser() here let any tenant
  //      read any other tenant's bids, solicitations, and W-9s. The key is
  //      resolved back to its owning record and the org is checked.
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  const tokenOk = sig !== "" && verifyFileToken(key, exp, sig);

  if (!tokenOk) {
    const ctx = await requireOrgContext();
    if (ctx instanceof NextResponse) return ctx;
    // The founding org's legacy single-tenant data predates org_id on some
    // rows; it keeps its historical access. Every other org must own the key.
    if (ctx.orgId !== LEGACY_ORG_ID) {
      const owns = await orgOwnsStorageKey(key, ctx.orgId);
      // Same 404 as a missing file: never confirm that a key exists but
      // belongs to someone else.
      if (!owns) return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  try {
    const signed = await storage.signedUrl(key);
    if (signed && signed.startsWith("http") && !signed.includes("/api/files/")) {
      return NextResponse.redirect(signed);
    }
    const buf = await storage.download(key);
    const storedMime = await storage.getMime(key);
    const meta = normalizeAttachmentMeta({
      filename: key.split("/").pop() || "attachment",
      mime: storedMime,
      content: buf,
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": meta.mime,
        "Content-Disposition": `inline; filename="${meta.filename.replace(/"/g, "")}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
