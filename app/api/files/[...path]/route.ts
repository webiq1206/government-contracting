import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/org-guard";
import { storage, verifyFileToken } from "@/lib/integrations/storage";
import { normalizeAttachmentMeta } from "@/lib/domain/attachment-meta";
import { orgIdForStorageKey } from "@/lib/domain/file-ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve a stored document (local/db backend) or redirect to a Supabase signed URL. */
export async function GET(req: Request, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
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

  let ownerOrgId: string | null;
  try {
    ownerOrgId = await orgIdForStorageKey(key, { failOnError: true });
  } catch {
    return NextResponse.json(
      {
        error:
          "File access could not be verified right now. Try again in a few minutes.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  // A signature does not outlive the database record that granted access.
  // Purging an account removes that record, immediately revoking old links
  // even if a physical provider needs a second cleanup attempt.
  if (!ownerOrgId) return fileNotFound();

  if (!tokenOk) {
    const ctx = await requireOrgContext();
    if (ctx instanceof NextResponse) return ctx;
    // Same 404 as a missing file: never confirm that a key exists but belongs
    // to someone else. The founding organization follows the same rule now
    // that every historical storage reference has an org_id.
    if (ownerOrgId !== ctx.orgId) {
      return fileNotFound();
    }
  }

  try {
    const signed = await storage.signedUrl(key);
    if (signed && signed.startsWith("http") && !signed.includes("/api/files/")) {
      const response = NextResponse.redirect(signed);
      response.headers.set("Cache-Control", "private, no-store, max-age=0");
      return response;
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
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch {
    return fileNotFound();
  }
}

function fileNotFound(): NextResponse {
  return NextResponse.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
