/** Only known campaign labels may enter analytics. No arbitrary URL values. */
export const GROWTH_SOURCES = ["linkedin", "reddit", "partner", "newsletter", "github", "organic"] as const;
export const GROWTH_CAMPAIGNS = ["free-tools", "contractor-guides", "opportunity-sources"] as const;
export const GROWTH_CONTENT = ["bid-scorecard", "capability-builder", "compliance-matrix", "construction", "cleaning", "it-services", "sam-search", "quote-checklist"] as const;
export type CampaignAttribution = { source?: string; campaign?: string; content?: string };
export function campaignAttribution(value: unknown): CampaignAttribution {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  const out: CampaignAttribution = {};
  if (GROWTH_SOURCES.some(s => s === v.source)) out.source = v.source as string;
  if (GROWTH_CAMPAIGNS.some(s => s === v.campaign)) out.campaign = v.campaign as string;
  if (GROWTH_CONTENT.some(s => s === v.content)) out.content = v.content as string;
  return out;
}
export function attributionFromSearch(search: string): CampaignAttribution {
  const params = new URLSearchParams(search);
  return campaignAttribution({ source: params.get("utm_source"), campaign: params.get("utm_campaign"), content: params.get("utm_content") });
}
export function campaignUrl(path: string, source: typeof GROWTH_SOURCES[number], campaign: typeof GROWTH_CAMPAIGNS[number], content: typeof GROWTH_CONTENT[number]) {
  const url = new URL(path, "https://brostco.com");
  if (url.origin !== "https://brostco.com") throw new Error("Campaign links must point to BrostCo.");
  url.search = new URLSearchParams({ utm_source: source, utm_medium: source === "newsletter" ? "email" : source === "partner" ? "referral" : "organic", utm_campaign: campaign, utm_content: content }).toString();
  return url.href;
}
