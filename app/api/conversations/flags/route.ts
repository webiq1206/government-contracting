import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { conversationExists, setConversationResolved } from "@/lib/conversations";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a conversation finished, or reopen it.
 *
 * The thread key arrives from the client, so it is checked against this org's
 * own mail before anything is written. Without that check the key is just a
 * string and a flag row could be created for another tenant's conversation --
 * harmless on its own, and exactly the kind of thing that becomes a leak the
 * moment somebody joins that table to something else.
 */
export async function POST(req: Request) {
  const auth = await requireCapability("outreach");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as {
    threadKey?: string;
    resolved?: boolean;
  };
  const threadKey = (body.threadKey ?? "").trim();
  if (!threadKey || threadKey.length > 500) {
    return NextResponse.json({ error: "Which conversation?" }, { status: 400 });
  }
  if (!(await conversationExists(orgId, threadKey))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const resolved = body.resolved === true;
  await setConversationResolved(orgId, threadKey, resolved, auth.id ?? null);
  await logAgent({
    agent: "communications",
    action: resolved ? "conversation_resolved" : "conversation_reopened",
    status: "ok",
    message: resolved ? "Conversation marked resolved" : "Conversation reopened",
    input: { threadKey },
  });

  return NextResponse.json({ ok: true, resolved });
}
