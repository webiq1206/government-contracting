import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/api-auth";
import { can } from "@/lib/domain/roles";
import { config } from "@/lib/config";
import { resolveTenantOrgId } from "@/lib/tenant";
import { exchangeCode, saveConnection } from "@/lib/connected-services";
import { SERVICE_BY_ID, isServiceProvider } from "@/lib/domain/connected-services";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "brostco_service_state";

/**
 * The provider sends the person back here. The state cookie must match, the
 * provider in the state decides which family exchanged the code (Google
 * serves Calendar and Drive from one callback), and the organization comes
 * from the session, never from the URL.
 */
export async function GET(req: Request, props: { params: Promise<{ provider: string }> }) {
  const { provider: family } = await props.params;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const back = new URL("/settings/integrations", config.appUrl);
  back.hash = "apps";
  const url = new URL(req.url);
  const returned = url.searchParams.get("state");
  const expected = (await cookies()).get(STATE_COOKIE)?.value;
  (await cookies()).delete(STATE_COOKIE);
  const done = (status: string, extra: Record<string, string> = {}) => {
    back.searchParams.set("service", status);
    for (const [k, v] of Object.entries(extra)) back.searchParams.set(k, v);
    return NextResponse.redirect(back);
  };
  if (!expected || !returned || returned !== expected) return done("csrf");
  const [, provider, scope] = expected.split(".");
  if (!isServiceProvider(provider) || SERVICE_BY_ID[provider].family !== family) return done("csrf");
  if (url.searchParams.get("error")) return done("denied", { provider });
  const code = url.searchParams.get("code");
  if (!code) return done("missing_code", { provider });
  const personal = scope === "personal";
  if (!personal && !can(auth.orgRole, "manage_integrations")) return done("forbidden", { provider });
  try {
    const orgId = await resolveTenantOrgId();
    const ex = await exchangeCode(provider, code);
    const row = await saveConnection({
      orgId,
      userId: personal ? auth.id : null,
      createdBy: auth.id,
      provider,
      tokens: ex.tokens,
      accountLabel: ex.accountLabel,
      externalId: ex.externalId,
      scopes: ex.scopes,
      settings: ex.settings,
    });
    await logAgent({
      agent: "operator",
      action: "service-connected",
      level: "info",
      message: `${auth.email} connected ${SERVICE_BY_ID[provider].name}${ex.accountLabel ? ` (${ex.accountLabel})` : ""} ${personal ? "for themselves" : "for the company"}.`,
    });
    return done("connected", { provider, id: row.id });
  } catch (e) {
    return done("error", { provider, msg: (e as Error).message.slice(0, 300) });
  }
}
