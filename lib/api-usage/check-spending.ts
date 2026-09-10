import { query } from "../db";
import { config } from "../config";
import { orgApiKey } from "../integration-keys";
import { isAllowedKey } from "../integration-settings";
import { beginUsage, requestIdentity, ApiUsageBlockedError } from "./ledger";
import { BILLABLE_PROVIDERS } from "./providers";

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
    await beginUsage(identity,item.provider,item.service,item.feature,{dryRun:true,complex:item.provider==="Anthropic"&&item.service!==config.claude.model});
  }
}

/** Stop expensive preparation when this exact model is already blocked.
 * This is only a preflight: metered() still atomically admits the real call.
 */
export async function checkClaudeSpending(orgId: string, model: string, feature: string) {
  const value = await orgApiKey("ANTHROPIC_API_KEY", orgId);
  if (!value) throw new ApiUsageBlockedError("AI is not connected. Analysis is waiting. Open Settings, Integrations to complete setup.");
  const identity = await requestIdentity("ANTHROPIC_API_KEY", value, orgId);
  await beginUsage(identity, "Anthropic", model, feature, {
    dryRun: true,
    complex: model !== config.claude.model,
  });
}
