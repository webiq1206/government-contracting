import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { query } from "@/lib/db";
import { LEGACY_ORG_ID } from "@/lib/tenant-context";
import { config } from "@/lib/config";
import { planRoute, routingConfig } from "@/lib/ai/claude";
import { currentProviderEvidence } from "@/lib/ai/provider-facts";
import { readBudget } from "@/lib/api-usage/budgets";

export const dynamic = "force-dynamic";

/** Read-only rollout evidence. Never tests a provider, synchronizes incidents,
 * returns key material, changes a budget, or resumes queued work. */
export async function GET() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  try {
    const org = LEGACY_ORG_ID;
    const [receipts, budget, providers, routine, complex, rates] = await Promise.all([
      query(`select case when scope_key like 'v2:%' then 'provider_independent' else 'legacy' end as identity,
        state,count(*)::int as count from ai_work_receipts where org_id=$1 group by 1,state`, [org]),
      readBudget(org),
      Promise.all((["OpenAI", "Anthropic"] as const).map(async provider => {
        const { facts, configured, source } = await currentProviderEvidence(provider, org);
        return { provider, configured, source, pending: Boolean(facts?.pending_attempt),
          lastSuccessAt: facts?.last_success_at ?? null, lastFailureAt: facts?.last_failure_at ?? null,
          refusal: facts?.refusal_reason ?? null, failure: facts?.failure_reason ?? null };
      })),
      planRoute({ complexity: "routine" }, org),
      planRoute({ complexity: "complex" }, org),
      query(`select provider,service,rates,max_request_cost::text from api_usage_rates
        where (provider='OpenAI' and service='gpt-4.1') or
          (provider='Anthropic' and service='claude-haiku-4-5-20251001')`),
    ]);
    return NextResponse.json({ observedAt: new Date().toISOString(), organizationId: org,
      failoverEnabled: config.ai.brostcoFailover, configuration: routingConfig(org), routine, complex,
      providers, receipts, budget, rates,
      spendingAuthorization: "Configuration values are not evidence of user spending approval." });
  } catch {
    return NextResponse.json({ error: "AI readiness could not be established. Routing and spending settings were not changed." }, { status: 503 });
  }
}
