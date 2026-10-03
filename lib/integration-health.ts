/** Provider health is evidence about the current account and credential.
 * Silence never establishes recovery, and another provider's success cannot
 * clear a refusal. Generic agent activity remains useful only for pricing.
 */
import { queryOne } from "./db";
import { resolveTenantOrgId } from "./tenant";
import { currentProviderFacts, providerProblem } from "./ai/provider-facts";

export interface ServiceTrouble {
  /** Number of providers with unresolved failures, not a rolling job count. */
  count: number;
  reason: string | null;
  lastAt: Date | null;
  lastSuccessAt?: Date | null;
}

export function troubleHasStopped(t: ServiceTrouble, _now = new Date()): boolean {
  return Boolean(t.count > 0 && t.lastAt && t.lastSuccessAt && t.lastSuccessAt > t.lastAt);
}

export function agoInWords(at: Date, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

export async function lastProviderSuccess(provider: "Anthropic" | "OpenAI", orgId?: string): Promise<Date | null> {
  return (await currentProviderFacts(provider, orgId))?.last_success_at ?? null;
}

export async function lastAiSuccess(orgId?: string): Promise<Date | null> {
  const dates = (await Promise.all([lastProviderSuccess("Anthropic", orgId), lastProviderSuccess("OpenAI", orgId)]))
    .filter((d): d is Date => d !== null);
  return dates.sort((a,b) => +b - +a)[0] ?? null;
}

export async function lastPricingSuccess(orgId?: string): Promise<Date | null> {
  const org = orgId ?? (await resolveTenantOrgId());
  const row = await queryOne<{ at: Date | null }>(`select max(created_at) as at from agent_logs
    where org_id=$1 and level in ('success','info') and agent='pricing-research'`, [org]);
  return row?.at ?? null;
}

export async function recentAiTrouble(orgId?: string, provider?: "Anthropic" | "OpenAI"): Promise<ServiceTrouble> {
  const providers = provider ? [provider] : ["Anthropic", "OpenAI"] as const;
  const facts = await Promise.all(providers.map(p => currentProviderFacts(p, orgId)));
  const failed = facts.filter(f => providerProblem(f));
  failed.sort((a,b) => +new Date(b!.last_failure_at!) - +new Date(a!.last_failure_at!));
  const latest = failed[0];
  return { count: failed.length, reason: providerProblem(latest ?? null),
    lastAt: latest?.last_failure_at ?? null, lastSuccessAt: latest?.last_success_at ?? null };
}

export function troubleSummary(t: ServiceTrouble, now = new Date()): string | null {
  if (t.count === 0 || troubleHasStopped(t, now)) return null;
  return `Last provider failure${t.lastAt ? ` (${agoInWords(t.lastAt, now)} ago)` : ""}: ${t.reason ?? "The service refused the request."} No newer successful request has confirmed recovery.`;
}
