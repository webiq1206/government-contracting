import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { trackEvent } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Client-side product events (Guide Me opens, step completions, etc.). */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = (await req.json().catch(() => null)) as {
    event?: string;
    path?: string;
    meta?: Record<string, unknown>;
  } | null;

  const event = typeof body?.event === "string" ? body.event.trim() : "";
  // Conversion milestones are recorded by successful server actions only.
  // A signed-in client must not be able to manufacture acquisition results.
  const serverEvents = ["trial_started", "account_created", "subscription_completed", "company_profile_saved"];
  if (!event || event.length > 80 || serverEvents.includes(event)) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }

  await trackEvent({
    event,
    orgId: auth.organizationId,
    userId: auth.id,
    path: typeof body?.path === "string" ? body.path : null,
    meta: body?.meta && typeof body.meta === "object" ? body.meta : {},
  });

  return NextResponse.json({ ok: true });
}
