import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { storage, verifyFileToken } from "@/lib/integrations/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Serve a stored document (local backend) or redirect to a Supabase signed URL. */
export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  const key = params.path.join("/");
  // Reject traversal.
  if (key.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });

  // Access: either a valid time-limited signed token (links emailed to
  // external recipients, e.g. subcontractors) or a logged-in app user.
  const url = new URL(req.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  const tokenOk = sig !== "" && verifyFileToken(key, exp, sig);
  if (!tokenOk) {
    const auth = await requireUser();
    if (auth instanceof NextResponse) return auth;
  }

  try {
    const signed = await storage.signedUrl(key);
    if (signed && signed.startsWith("http") && !signed.includes("/api/files/")) {
      return NextResponse.redirect(signed);
    }
    const buf = await storage.download(key);
    const ext = key.split(".").pop()?.toLowerCase() ?? "";
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${key.split("/").pop()}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
