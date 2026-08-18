import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { recordValidation, isAllowedKey } from "@/lib/integration-settings";
import { orgApiKey } from "@/lib/integration-keys";
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

  // Test the credential the app would ACTUALLY use.
  //
  // This used to read process.env directly, after calling
  // `hydrateIntegrationEnv()` on the assumption that it copied saved keys
  // there. That function is a deliberate no-op now: keys are per-organization
  // and are resolved through `orgApiKey`, because loading one tenant's
  // credential into a shared process environment would leak it across tenants.
  // So the test was reading whatever happened to be in the deployment's
  // environment while the page beside it said "saved here" about a completely
  // different value. Testing one key and using another is worse than not
  // testing at all: it reports confidently on something nobody is running.
  const values: Record<string, string> = {};
  let testedDraft = false;
  for (const f of def.fields) {
    const override = body.values?.[f.env]?.trim();
    if (override) {
      // Unsaved form input, so the operator can check a key before saving it.
      values[f.env] = override;
      testedDraft = true;
      continue;
    }
    values[f.env] = isAllowedKey(f.env)
      ? await orgApiKey(f.env, auth.organizationId ?? undefined)
      : (process.env[f.env] ?? "");
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

  /*
   * Persist the outcome on the UI-saved rows so the page shows last-checked
   * state, but only when what we tested WAS the saved configuration. Testing a
   * key the operator has typed but not saved says nothing about the one on
   * file: recording it would stamp a red "invalid" on a working saved key
   * because a draft was mistyped, or bless a saved key nobody checked.
   */
  if (!testedDraft) {
    for (const f of def.fields) {
      if (isAllowedKey(f.env)) {
        await recordValidation(f.env, result.ok, result.ok ? undefined : result.message).catch(
          () => undefined
        );
      }
    }
  }

  return NextResponse.json(result);
}
