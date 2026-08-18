import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { AUTOMATION_PAUSED_ERROR, isAutomationPaused } from "@/lib/app-settings";
import { enqueue } from "@/lib/queue";
import { getAgent } from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manually trigger an agent run (enqueues a job the worker picks up). */
export async function POST(req: Request, { params }: { params: { name: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  if (await isAutomationPaused()) {
    return NextResponse.json({ error: AUTOMATION_PAUSED_ERROR }, { status: 409 });
  }

  const def = getAgent(params.name);
  if (!def) return NextResponse.json({ error: `Unknown agent "${params.name}"` }, { status: 404 });

  const payload = await req.json().catch(() => ({}));
  // force: a person pressing "run" on an agent means run it, including the
  // idempotency-guarded ones that would otherwise report "already done".
  const id = await enqueue(def.name, { ...payload, trigger: "manual", force: true });
  return NextResponse.json({ ok: true, jobId: id, agent: def.name });
}
