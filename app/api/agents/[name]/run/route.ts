import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { AUTOMATION_PAUSED_ERROR, isAutomationPaused } from "@/lib/app-settings";
import { enqueue } from "@/lib/queue";
import { getAgent } from "@/lib/agents/registry";
import { lookupPayloadRecords } from "@/lib/agents/payload-records";

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

  const body = await req.json().catch(() => ({}));
  const given: Record<string, unknown> =
    body && typeof body === "object" && !Array.isArray(body) ? body : {};

  /**
   * Everything below exists because this endpoint hands a request body to the
   * runner, and the runner decides from that payload which tenant the job runs
   * as. So the body is an authority document unless it is checked, and the
   * caller writes it.
   *
   * Two ways it could name another tenant. `orgId` says so outright, and is
   * simply dropped: nothing internal sends it, and the runner works the tenant
   * out from the records instead. Naming another organization's record is the
   * subtler one, because the runner then resolves that record's owner and runs
   * the agent as them, which would read, write, bill and log across the tenant
   * boundary on a record id alone.
   */
  const { orgId: _notFromTheCaller, ...payload } = given;

  const records = await lookupPayloadRecords(payload);
  const notTheirs = records.find((r) => r.state !== "found" || r.orgId !== auth.organizationId);
  if (notTheirs) {
    // Same answer whether it belongs to someone else, was deleted, or was
    // never a real id, so this cannot be used to discover what exists.
    return NextResponse.json(
      { error: `No such ${notTheirs.label} in your organization.` },
      { status: 404 }
    );
  }

  // force: a person pressing "run" on an agent means run it, including the
  // idempotency-guarded ones that would otherwise report "already done".
  const id = await enqueue(def.name, { ...payload, trigger: "manual", force: true });
  return NextResponse.json({ ok: true, jobId: id, agent: def.name });
}
