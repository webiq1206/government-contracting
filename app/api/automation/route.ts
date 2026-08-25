import { NextResponse } from "next/server";
import { requireUser, requireCapability } from "@/lib/api-auth";
import { getAutomationState, setAutomationPaused } from "@/lib/app-settings";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read the automation pause switch. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json(await getAutomationState());
}

/** Toggle the automation pause switch. Body: { paused: boolean }. */
export async function POST(req: Request) {
  const auth = await requireCapability("pause_automation");
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => ({}))) as { paused?: unknown };
  if (typeof body.paused !== "boolean") {
    return NextResponse.json({ error: "Body must be { paused: boolean }" }, { status: 400 });
  }

  const state = await setAutomationPaused(body.paused, auth.email);
  // Audit trail: state changes show up in the Automation Log like any agent action.
  await logAgent({
    agent: "scheduler",
    action: body.paused ? "automation_paused" : "automation_resumed",
    level: body.paused ? "warn" : "success",
    message: body.paused
      ? `Master pause ON by ${auth.email}. Agents, queue jobs, outreach email, digests, and SMS are stopped.`
      : `Master pause OFF by ${auth.email}. Automation is active again.`,
  });
  return NextResponse.json(state);
}
