import { NextResponse } from "next/server";
import { storage } from "@/lib/integrations/storage";
import {
  decodeDocToken,
  encodeDocToken,
  isAllowedUpstream,
} from "@/lib/domain/doc-link";
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

  /*
   * A package is a page, not a file.
   *
   * The email carries one link for everything too large to attach; this is
   * what it opens. Each document keeps its own signed pointer, so the page
   * grants nothing the individual links would not have, and the set is the one
   * named in the token rather than whatever the opportunity holds now: the
   * recipient sees exactly what they were told about.
   */
  if (p.k === "p") {
    const rows = (p.d ?? [])
      .map((entry) => {
        const m = normalizeAttachmentMeta({ filename: entry.n });
        const href = `/d/${encodeDocTokenForEntry(entry, p.e)}`;
        return `<li><a href="${href}">${escapeHtml(m.filename)}</a></li>`;
      })
      .join("");
    const html =
      `<!doctype html><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<meta name="robots" content="noindex,nofollow">` +
      `<title>${escapeHtml(p.n)} documents</title>` +
      `<style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:42rem;padding:0 1rem;color:#242424}` +
      `h1{font-size:1.25rem}li{margin:.4rem 0}a{color:#7a5c2e}</style>` +
      `<h1>${escapeHtml(p.n)}</h1>` +
      `<p>These are the bid documents for the work you were asked to price. ` +
      `They were too large to attach to the email, so they are here instead. ` +
      `No sign-in is needed.</p>` +
      `<ul>${rows}</ul>` +
      `<p>If a document will not open, reply to the email you received and we will send it directly.</p>`;
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, max-age=3600",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A per-file token for one entry of a package.
 *
 * It inherits the package's expiry rather than getting a fresh one, so opening
 * the page cannot extend how long the documents stay reachable.
 */
function encodeDocTokenForEntry(
  entry: { k: "s" | "u"; v: string; n: string },
  expiry: number
): string {
  return encodeDocToken({ k: entry.k, v: entry.v, n: entry.n, e: expiry });
}
