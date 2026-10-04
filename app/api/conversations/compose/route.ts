import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@/lib/api-auth";
import { resolveTenantOrgId } from "@/lib/tenant";
import { projectMessageTarget } from "@/lib/project-message";
import { resolveOutreachSender } from "@/lib/domain/sender-identity";
import { withMailSignature } from "@/lib/domain/mail-signature";
import { sendManualEmail } from "@/lib/manual-email";
import { runWithPursuitVersion } from "@/lib/pursuit-job-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ requestKey: z.string().uuid(), subcontractorId: z.string().uuid(),
  opportunityId: z.string().uuid(), trade: z.string().max(200),
  recipient: z.string().email(), sender: z.string().min(1).max(320),
  subject: z.string().trim().min(1).max(250).regex(/^[^\r\n\0]+$/),
  message: z.string().trim().min(1).max(20000).refine(v => !v.includes("\0")) });

export async function POST(req: Request) {
  const auth = await requireCapability("outreach");
  if (auth instanceof NextResponse) return auth;
  const orgId = await resolveTenantOrgId();
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the recipient, subject and message before sending." }, { status: 400 });
  const body = parsed.data;
  const target = await projectMessageTarget(orgId, body.subcontractorId, body.opportunityId, body.trade);
  if (!target) return NextResponse.json({ error: "This active project assignment is unavailable. No new send attempt was made. An earlier attempt may have been sent; check communication history before composing another message." }, { status: 404 });
  const sender = await resolveOutreachSender(orgId);
  if (!target.email_verified || !target.email || target.email !== body.recipient || !sender.connected || sender.from !== body.sender)
    return NextResponse.json({ error: "The verified recipient or sender changed or is unavailable. Reload and review before sending." }, { status: 409 });
  const text = withMailSignature(body.message, orgId, sender.from);
  const html = `<div>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br />")}</div>`;
  const result = await runWithPursuitVersion({ opportunityId: body.opportunityId, version: target.pursuit_version }, () => sendManualEmail({
    requestKey: body.requestKey, actorId: auth.id,
    params: { orgId, subcontractorId: target.id, opportunityId: body.opportunityId, trade: target.trade,
      to: target.email!, subject: body.subject, text, html,
      beforeProviderSend: async from => {
        const current = await projectMessageTarget(orgId, body.subcontractorId, body.opportunityId, body.trade);
        if (from !== body.sender || !current?.email_verified || current.email !== body.recipient || current.pursuit_version !== target.pursuit_version)
          throw new Error("The reviewed recipient, sender or project assignment changed before sending.");
      },
    },
  }));
  if (!result.ok) return NextResponse.json({ error: result.error, safeToCompose: "safeToCompose" in result && result.safeToCompose }, { status: result.status });
  return NextResponse.json({ ok: true, threadId: result.threadId });
}
