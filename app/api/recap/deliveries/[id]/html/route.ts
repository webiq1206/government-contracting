import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { getDelivery } from "@/lib/recap/delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The copy of a recap that actually went out.
 *
 * The delivery record keeps the rendered mail so a retry can send that exact
 * copy rather than a fresh recap describing a different day. It was never
 * readable: the history listed a subject, a recipient and, on a bad morning,
 * an error string, and answering "what did they actually receive" meant asking
 * the recipient to forward it back.
 *
 * Served as a document so the settings page can put it in a sandboxed frame
 * beside the list, the same way the live preview is shown. Scoped to the
 * caller's own organization; a row belonging to somebody else answers 404
 * rather than 403, because a distinguishable refusal would confirm that a
 * guessed delivery id is real.
 *
 * Deliberately at `requireUser` rather than `manage_rules`: this is the
 * organization's own recap, which the same person can already build live
 * through the preview route, and the history sits on a page every role can
 * read. Acting on a row -- the retry -- is the part that stays privileged.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: "No such delivery." }, { status: 404 });
  }

  const orgId = await tryResolveTenantOrgId();
  if (!orgId) {
    return NextResponse.json({ error: "No account is resolvable for this session." }, { status: 400 });
  }

  const existing = await getDelivery(params.id);
  if (!existing || existing.orgId !== orgId) {
    return NextResponse.json({ error: "No such delivery." }, { status: 404 });
  }

  if (!existing.html) {
    /*
     * A row with no saved copy is a real state, not a fault: the send failed
     * before the mail was written. Answered in the same shape the frame can
     * show, so the pane says what happened instead of rendering a blank.
     */
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:16px;color:#444">` +
        `No copy of this one was saved. It failed before the mail was written, so there is nothing to show and nothing to resend.` +
        `</body>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": "frame-ancestors 'self'",
        },
      }
    );
  }

  return new NextResponse(existing.html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Framed by the settings page and nowhere else. frame-ancestors rather
      // than X-Frame-Options for the reason spelled out in the preview route:
      // a browser handed both DENY (from next.config.mjs) and SAMEORIGIN
      // takes the stricter, and a policy carrying frame-ancestors is the one
      // thing that makes it ignore X-Frame-Options altogether.
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}
