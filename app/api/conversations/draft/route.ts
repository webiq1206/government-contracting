import { NextResponse } from "next/server";
import { requireSubscriber } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { generateReplyDraft, saveDraftEdit } from "@/lib/domain/reply-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drafting costs a model call every time. An operator working a busy inbox
 * might legitimately draft a dozen replies in a sitting; a stuck button or an
 * impatient double-click should not turn that into a hundred. The window is
 * generous enough that nobody doing the job by hand will ever see it.
 */
const DRAFT_RULE = { limit: 30, windowMs: 10 * 60 * 1000 };

/**
 * Write a suggested reply to a subcontractor's email.
 *
 * Generates only, never sends. The draft goes back to the reply box the
 * operator already uses, and sending stays on the existing reply endpoint so
 * there is exactly one path that can put mail in front of a subcontractor.
 */
export async function POST(req: Request) {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const { consume, tooManyRequests } = await import("@/lib/rate-limit");
  // Keyed by tenant, not by IP: the cost lands on the org, and two operators
  // behind one office connection should not throttle each other.
  const gate = consume("reply-draft", orgId ?? "no-org", DRAFT_RULE);
  if (!gate.ok) {
    return tooManyRequests(
      "That is a lot of drafts in a short time. Give it a few minutes.",
      gate
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    communicationId?: string;
  };
  if (!body.communicationId) {
    return NextResponse.json({ error: "Nothing to reply to." }, { status: 400 });
  }

  const res = await generateReplyDraft({
    communicationId: body.communicationId,
    orgId,
  });

  if (!res.ok) {
    const status =
      res.reason === "not-found"
        ? 404
        : res.reason === "not-configured"
          ? 503
          : // The thread moved on while the tab sat open.
            res.reason === "superseded"
            ? 409
            : 422;
    return NextResponse.json({ error: res.message }, { status });
  }

  return NextResponse.json({ ok: true, draft: res.draft });
}

/**
 * Keep what the operator has typed over the draft. Called on a debounce while
 * they edit, so closing the tab mid-sentence does not throw the work away and
 * does not make them pay for a fresh draft to get back to where they were.
 */
export async function PUT(req: Request) {
  const auth = await requireSubscriber();
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    communicationId?: string;
    body?: string;
    rev?: number;
  };
  if (!body.communicationId) {
    return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  }
  if ((body.body ?? "").length > 20000) {
    return NextResponse.json({ error: "That draft is too long." }, { status: 400 });
  }
  // The revision decides which of two writes wins, so a missing or malformed
  // one cannot be waved through as zero: that would make every save the oldest
  // and silently stop persisting edits.
  const rev = Number(body.rev);
  if (!Number.isSafeInteger(rev) || rev < 1) {
    return NextResponse.json({ error: "Bad revision." }, { status: 400 });
  }

  const saved = await saveDraftEdit({
    communicationId: body.communicationId,
    orgId,
    body: body.body ?? "",
    rev,
  });
  if (saved === "missing") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  // A stale write is a non-event, not an error: newer text is already stored,
  // which is exactly what was wanted.
  return NextResponse.json({ ok: true, stale: saved === "stale" });
}
