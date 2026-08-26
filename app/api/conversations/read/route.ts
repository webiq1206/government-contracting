import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { conversationExists, markConversationRead } from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mark a conversation as looked at.
 *
 * A POST, not a side effect of rendering the page, and the reason is not
 * purity. Next prefetches the links in the conversation list, and a prefetch
 * runs the server component: marking read during render meant hovering the
 * list marked every conversation in it read, and the unread count went to zero
 * without anybody opening anything. A client effect only runs when the pane is
 * actually mounted in front of a person.
 *
 * Reading requires `view` rather than `outreach`: someone who may read the
 * mail may record that they read it.
 */
export async function POST(req: Request) {
  const auth = await requireCapability("view");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();

  const body = (await req.json().catch(() => ({}))) as { threadKey?: string };
  const threadKey = (body.threadKey ?? "").trim();
  if (!threadKey || threadKey.length > 500) {
    return NextResponse.json({ error: "Which conversation?" }, { status: 400 });
  }
  if (!(await conversationExists(orgId, threadKey))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await markConversationRead(orgId, threadKey);
  return NextResponse.json({ ok: true });
}
