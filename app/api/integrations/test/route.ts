import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import {
  hydrateIntegrationEnv,
  recordValidation,
  isAllowedKey,
} from "@/lib/integration-settings";
import { INTEGRATION_DEFS } from "@/lib/integration-defs";
import { VALIDATORS } from "@/lib/integration-validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live connection test for one integration.
 * Body: { integration: string, values?: Record<envKey, string> }
 * `values` (unsaved form input) override the currently-effective credentials,
 * so a key can be tested BEFORE saving it.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as {
    integration?: string;
    values?: Record<string, string>;
  };

  const def = INTEGRATION_DEFS.find((d) => d.id === body.integration);
  const validator = def && VALIDATORS[def.id];
  if (!def || !validator) {
    return NextResponse.json({ error: "Unknown integration." }, { status: 400 });
  }

  await hydrateIntegrationEnv();
  const values: Record<string, string> = {};
  for (const f of def.fields) {
    const override = body.values?.[f.env]?.trim();
    values[f.env] = override || process.env[f.env] || "";
  }

  let result;
  try {
    result = await validator(values);
  } catch (err) {
    result = {
      ok: false,
      message: `Couldn't reach the service: ${(err as Error).message}`,
    };
  }

  // Persist the outcome on any UI-saved rows so the page shows last-checked state.
  for (const f of def.fields) {
    if (isAllowedKey(f.env)) {
      await recordValidation(f.env, result.ok, result.ok ? undefined : result.message).catch(
        () => undefined
      );
    }
  }

  return NextResponse.json(result);
}
