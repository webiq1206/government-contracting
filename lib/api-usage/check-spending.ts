import { query } from "../db";
import { config } from "../config";
import { orgApiKey } from "../integration-keys";
import { isAllowedKey } from "../integration-settings";
import { beginUsage, requestIdentity, ApiUsageBlockedError } from "./ledger";
import { BILLABLE_PROVIDERS } from "./providers";
import { ENV_KEY_FOR, providerForModel, type AiProvider, type AiRoute, type AiTier } from "../ai/routing";

/** Anything but a provider's routine default is complex work for the cost controls. */
export function isComplexService(provider: string, service: string): boolean {
  if (provider === "Anthropic") return service !== config.claude.model;
  if (provider === "OpenAI") return service !== config.openai.model;
  return false;
}

/** Exercise the real admission checks without sending a request or reserving money. */
export async function checkRecentSpending(orgId: string) {
  const recent=await query<{provider:string;service:string;feature:string}>(`select distinct provider,service,feature from api_usage_events
    where org_id=$1 and credential_source in ('platform','tenant') and started_at>=now()-interval '7 days'
    order by provider,service,feature limit 21`,[orgId]);
  if(recent.length>20) throw new ApiUsageBlockedError("Several workflows need review. Open API Usage to check the affected service before retrying it.");
  const work=recent.length?recent:[{provider:"Anthropic",service:config.claude.model,feature:"AI assistance"}];
  for(const item of work) {
    const envKey=item.provider==="Ahrefs"?"AHREFS_API_KEY":BILLABLE_PROVIDERS.find(p=>p.provider===item.provider)?.key;
    if(!envKey || !isAllowedKey(envKey)) throw new Error("Unsupported spending scope");
    const value=await orgApiKey(envKey,orgId);
    if(!value) throw new ApiUsageBlockedError("The API account is not connected. Open Settings, Integrations to reconnect it, then retry this check.");
    const identity=await requestIdentity(envKey,value,orgId);
    await beginUsage(identity,item.provider,item.service,item.feature,{dryRun:true,complex:isComplexService(item.provider,item.service)});
  }
}

async function preflight(orgId: string, provider: AiProvider, model: string, feature: string) {
  const envKey = ENV_KEY_FOR[provider];
  const value = await orgApiKey(envKey, orgId);
  if (!value) throw new ApiUsageBlockedError("AI is not connected. Analysis is waiting. Open Settings, Integrations to complete setup.");
  const identity = await requestIdentity(envKey, value, orgId);
  await beginUsage(identity, provider, model, feature, {
    dryRun: true,
    complex: isComplexService(provider, model),
  });
}

/** Stop expensive preparation when this exact model is already blocked.
 * This is only a preflight: metered() still atomically admits the real call.
 * The provider is read off the model id, so an OpenAI model checks the OpenAI key.
 */
export async function checkClaudeSpending(orgId: string, model: string, feature: string) {
  await preflight(orgId, providerForModel(model), model, feature);
}

/**
 * The same preflight against whichever provider and model the router would
 * actually pick for this tier right now. Use this rather than naming a model
 * when the caller only knows how hard the work is.
 */
export async function checkAiSpending(orgId: string, tier: AiTier, feature: string): Promise<AiRoute> {
  const { planRoute } = await import("../ai/claude");
  const plan = await planRoute({ complexity: tier }, orgId);
  if (!plan) throw new ApiUsageBlockedError("AI is not connected. Analysis is waiting. Open Settings, Integrations to complete setup.");
  await preflight(orgId, plan.primary.provider, plan.primary.model, feature);
  return plan.primary;
}
