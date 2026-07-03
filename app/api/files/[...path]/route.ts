import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { storage } from "@/lib/integrations/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** Serve a stored document (local backend) or redirect to a Supabase signed URL. */
export async function GET(_req: Request, { params }: { params: { path: string[] } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const key = params.path.join("/");
  // Reject traversal.
  if (key.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });

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
