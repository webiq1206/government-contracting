import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { enqueue } from "@/lib/queue";
import { getAgent } from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manually trigger an agent run (enqueues a job the worker picks up). */
export async function POST(req: Request, { params }: { params: { name: string } }) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const def = getAgent(params.name);
  if (!def) return NextResponse.json({ error: `Unknown agent "${params.name}"` }, { status: 404 });

  const payload = await req.json().catch(() => ({}));
  const id = await enqueue(def.name, { ...payload, trigger: "manual" });
  return NextResponse.json({ ok: true, jobId: id, agent: def.name });
}
