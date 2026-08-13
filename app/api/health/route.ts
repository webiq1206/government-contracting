import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/db";
import { config, integrationStatus } from "@/lib/config";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { currentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health endpoint. `{ ok, db }` is public for the host's health check; the
 * integration-readiness block (which providers are configured) is only exposed
 * to a logged-in operator, it's recon-useful info that shouldn't be public.
 */
export async function GET() {
  const db = await dbHealthy().catch(() => false);
  const user = await currentUser().catch(() => null);
  // A production instance on the public default AUTH_SECRET is unhealthy,
  // full stop: every signed token (portal links, document links, sessions,
  // TIN encryption) would be forgeable from the open-source default. Failing
  // the host's health check is what makes this misconfiguration impossible
  // to run for weeks without noticing.
  const secretOk = !(config.isProd && config.auth.secretIsDefault);
  const ok = db && secretOk;
  const payload: Record<string, unknown> = { ok, service: "brostco-web", db };
  if (!secretOk) payload.error = "AUTH_SECRET is not set; refusing to serve.";
  if (user) {
    await hydrateIntegrationEnv();
    payload.integrations = integrationStatus();
  }
  return NextResponse.json(payload, { status: ok ? 200 : 503 });
}
