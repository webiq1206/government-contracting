import { platformApiValue } from "@/lib/api-usage/credentials";
import { NextResponse } from "next/server";
import { requireUser, requireCapability } from "@/lib/api-auth";
import { readUsage } from "@/lib/api-usage/read";
import { query, transaction } from "@/lib/db";
import { BILLABLE_PROVIDERS } from "@/lib/api-usage/providers";
import { VALIDATORS } from "@/lib/integration-validators";
import { encryptSecret, isAllowedKey } from "@/lib/integration-settings";
import { clearIntegrationKeyCache, orgApiKey } from "@/lib/integration-keys";
import { requestIdentity } from "@/lib/api-usage/ledger";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  if (!auth.organizationId)
    return NextResponse.json({ error: "No account found." }, { status: 403 });
  try {
    const [usage, preferences] = await Promise.all([
      readUsage(new URL(req.url).searchParams, auth.organizationId),
      query(
        "select env_key,source,accepted_at::text,updated_at::text from api_usage_preferences where org_id=$1",
        [auth.organizationId],
      ),
    ]);
    const providers = await Promise.all(
      BILLABLE_PROVIDERS.map(async (def) => {
        try {
        if (!isAllowedKey(def.key)) throw new Error("Unsupported key");
        const key = await orgApiKey(def.key, auth.organizationId!);
        const identity = key
          ? await requestIdentity(def.key, key, auth.organizationId!)
          : null;
        return {
          provider: def.provider,
          key: def.key,
          active: identity?.source ?? "none",
          extraFields: def.extraFields ?? [],
          platformAvailable: (
            await Promise.all(
              [def.key, ...(def.extraFields ?? []).map((f) => f.key)].map(
                platformApiValue,
              ),
            )
          ).every(Boolean),
          preference: preferences.find((p) => p.env_key === def.key) ?? null,
        };
        } catch { return {provider:def.provider,key:def.key,active:"needs_attention",extraFields:def.extraFields??[],platformAvailable:false,error:"This connection needs attention. Reconnect your API key below."}; }
      }),
    );
    return NextResponse.json({ ...usage, providers });
  } catch {
    return NextResponse.json(
      { error: "Usage could not be loaded. Please retry." },
      { status: 503 },
    );
  }
}
export async function POST(req: Request) {
  const auth = await requireCapability("manage_integrations");
  if (auth instanceof Response) return auth;
  if (!auth.organizationId)
    return NextResponse.json({ error: "No account found." }, { status: 403 });
  try {
    const body = await req.json();
    const def = BILLABLE_PROVIDERS.find((d) => d.key === body.key);
    if (!def || !["platform", "tenant"].includes(body.source))
      throw new Error("Choose a supported API service.");
    let secret = "";
    const keys = [def.key, ...(def.extraFields ?? []).map((f) => f.key)];
    const credentials: Record<string, string> = {};
    if (body.source === "platform") {
      if (body.acceptCharges !== true)
        throw new Error("Confirm that API usage will be added to your bill.");
      if (!(await Promise.all(keys.map(platformApiValue))).every(Boolean))
        throw new Error(
          "This platform service is not available. Connect your own account.",
        );
    } else {
      secret = typeof body.secret === "string" ? body.secret.trim() : "";
      if (!secret || secret.length > 4096)
        throw new Error("Enter your API key.");
      if (secret === (await platformApiValue(def.key)))
        throw new Error(
          "This is a platform credential. Choose Use Our API instead.",
        );
      credentials[def.key] = secret;
      for (const f of def.extraFields ?? []) {
        const v =
          typeof body.values?.[f.key] === "string"
            ? body.values[f.key].trim()
            : "";
        if (!v || v.length > 4096) throw new Error(`Enter ${f.label}.`);
        credentials[f.key] = v;
      }
      const result = await VALIDATORS[def.validator](credentials);
      if (!result.ok)
        throw new Error(
          "The provider rejected this key. Check the key and available credits, then retry.",
        );
    }
    await transaction(async (client) => {
      for (const key of keys) {
        if (body.source === "tenant")
          await client.query(
            `insert into integration_settings(org_id,env_key,value_enc,last_validated_at)
        values($1,$2,$3,now()) on conflict(org_id,env_key) do update set value_enc=excluded.value_enc,last_validated_at=now(),updated_at=now()`,
            [auth.organizationId, key, encryptSecret(credentials[key])],
          );
        await client.query(
          `insert into api_usage_preferences(org_id,env_key,source,accepted_at) values($1,$2,$3,case when $3='platform' then now() end)
        on conflict(org_id,env_key) do update set source=excluded.source,accepted_at=excluded.accepted_at,updated_at=now()`,
          [auth.organizationId, key, body.source],
        );
      }
      await client.query(
        "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,$3,$4)",
        [
          auth.organizationId,
          auth.email,
          "source_changed",
          JSON.stringify({
            key: def.key,
            source: body.source,
            accepted: body.acceptCharges === true,
          }),
        ],
      );
    });
    clearIntegrationKeyCache();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
