import { NextResponse } from "next/server";
import { storage } from "@/lib/integrations/storage";
import { decodeDocToken, isAllowedUpstream } from "@/lib/domain/doc-link";
import { normalizeAttachmentMeta } from "@/lib/domain/attachment-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public document delivery for outreach recipients.
 *
 * Deliberately NOT behind auth: a subcontractor we emailed has no account and
 * must be able to open the plans with one tap. Access is controlled by the
 * signed, expiring token instead, which is unguessable and cannot be edited.
 *
 * Everything is streamed through this route so the recipient only ever sees a
 * brostco.com URL, never SAM.gov or a storage provider.
 */
export async function GET(
  _req: Request,
  { params }: { params: { token: string } }
) {
  const p = decodeDocToken(params.token);
  if (!p) {
    // Plain, friendly text: the reader is a contractor, not an operator.
    return new NextResponse(
      "This document link has expired or is not valid. Please reply to the email you received and we will send a fresh copy.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }

  const meta = normalizeAttachmentMeta({ filename: p.n });
  const headers = new Headers({
    "Content-Type": meta.mime || "application/octet-stream",
    // inline so PDFs open in the browser rather than forcing a download.
    "Content-Disposition": `inline; filename="${meta.filename.replace(/"/g, "")}"`,
    "Cache-Control": "private, max-age=3600",
    "X-Robots-Tag": "noindex, nofollow",
  });

  try {
    if (p.k === "s") {
      const buf = await storage.download(p.v);
      return new NextResponse(new Uint8Array(buf), { status: 200, headers });
    }

    // Upstream proxy. Re-check the host at request time, never trust the token
    // alone in case the allowlist tightened after the link was sent.
    if (!isAllowedUpstream(p.v)) {
      return new NextResponse("This document is no longer available.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const upstream = await fetch(p.v, { redirect: "follow" });
    if (!upstream.ok || !upstream.body) {
      return new NextResponse(
        "We could not load this document right now. Please reply to our email and we will send it directly.",
        { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } }
      );
    }
    const upstreamType = upstream.headers.get("content-type");
    if (upstreamType) headers.set("Content-Type", upstreamType);
    return new NextResponse(upstream.body, { status: 200, headers });
  } catch {
    return new NextResponse(
      "We could not load this document right now. Please reply to our email and we will send it directly.",
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  }
}
