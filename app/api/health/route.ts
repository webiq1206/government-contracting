import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/db";
import { integrationStatus } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Health + integration-readiness endpoint for the host and the operator. */
export async function GET() {
  const db = await dbHealthy().catch(() => false);
  return NextResponse.json(
    { ok: db, service: "brostco-web", db, integrations: integrationStatus() },
    { status: db ? 200 : 503 }
  );
}
