import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/db";
import { integrationStatus } from "@/lib/config";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health endpoint. `{ ok, db }` is public for the host's health check; the
 * integration-readiness block (which providers are configured) is only exposed
 * to a logged-in operator — it's recon-useful info that shouldn't be public.
 */
export async function GET() {
  const db = await dbHealthy().catch(() => false);
  const user = await currentUser().catch(() => null);
  const payload: Record<string, unknown> = { ok: db, service: "brostco-web", db };
  if (user) payload.integrations = integrationStatus();
  return NextResponse.json(payload, { status: db ? 200 : 503 });
}
