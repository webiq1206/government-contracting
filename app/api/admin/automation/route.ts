import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  clearAutomationStateCache,
  getPlatformAutomationState,
  setPlatformAutomationPaused,
} from "@/lib/app-settings";
import { recordRequiredAdminAction } from "@/lib/admin/audit";
import { transaction } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Platform-wide emergency stop. Never shared with an account's own switch. */
export async function GET() {
  const admin = await requirePlatformAdmin();
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json(await getPlatformAutomationState());
}

export async function POST(req: Request) {
  const admin = await requirePlatformAdmin();
  if (admin instanceof NextResponse) return admin;

  const body = (await req.json().catch(() => null)) as { paused?: unknown } | null;
  if (typeof body?.paused !== "boolean") {
    return NextResponse.json(
      { error: "Choose whether to pause or resume platform automation." },
      { status: 400 }
    );
  }
  const paused = body.paused;

  let state;
  try {
    state = await transaction(async (client) => {
      const next = await setPlatformAutomationPaused(paused, admin.email, client);
      await recordRequiredAdminAction(
        {
          adminEmail: admin.email,
          action: paused ? "platform_automation_paused" : "platform_automation_resumed",
          detail: {
            effect: paused
              ? "All scheduled jobs, queued work, outreach, alerts, and automated sends are stopped."
              : "Platform automation may run again; each account pause remains in effect.",
          },
        },
        client
      );
      return next;
    });
  } catch (err) {
    console.error("[admin-automation] switch change was rolled back", err);
    return NextResponse.json(
      {
        error:
          "The platform automation switch was not changed because the setting and its required audit record could not be saved together. Try again; the previous state is still active.",
      },
      { status: 503 }
    );
  }
  clearAutomationStateCache();
  return NextResponse.json(state);
}
