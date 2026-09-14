import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/api-auth";
import { can } from "@/lib/domain/roles";
import { config } from "@/lib/config";
import { authUrl, parseScope, serviceAvailable } from "@/lib/connected-services";
import { SERVICE_BY_ID, isServiceProvider } from "@/lib/domain/connected-services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "brostco_service_state";

/**
 * Start the provider's sign-in. `?scope=personal|company` says whose
 * connection it becomes; a company-wide one needs the integrations
 * permission. The random state, the provider and the scope travel in a
 * short-lived cookie and are checked by the callback.
 */
export async function GET(req: Request, props: { params: Promise<{ provider: string }> }) {
  const { provider } = await props.params;
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const back = new URL("/settings/integrations", config.appUrl);
  back.hash = "apps";
  if (!isServiceProvider(provider) || SERVICE_BY_ID[provider].method !== "oauth") {
    back.searchParams.set("service", "unknown");
    return NextResponse.redirect(back);
  }
  const def = SERVICE_BY_ID[provider];
  if (!serviceAvailable(def)) {
    back.searchParams.set("service", "unavailable");
    back.searchParams.set("provider", provider);
    return NextResponse.redirect(back);
  }
  const scope = parseScope(new URL(req.url).searchParams.get("scope"));
  if (!def.scopes.includes(scope)) {
    back.searchParams.set("service", "bad_scope");
    return NextResponse.redirect(back);
  }
  if (scope === "company" && !can(auth.orgRole, "manage_integrations")) {
    back.searchParams.set("service", "forbidden");
    return NextResponse.redirect(back);
  }
  const nonce = randomBytes(24).toString("hex");
  const state = `${nonce}.${provider}.${scope}`;
  (await cookies()).set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: 600,
  });
  return NextResponse.redirect(authUrl(provider, state));
}
