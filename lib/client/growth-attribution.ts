import { attributionFromSearch, campaignAttribution, type CampaignAttribution } from "@/lib/marketing/campaigns";
const KEY = "brostco-campaign-v1";
export function growthAttribution(): CampaignAttribution {
  if (typeof window === "undefined") return {};
  const optedOut = navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
  if (optedOut) { try { sessionStorage.removeItem(KEY); } catch {} return {}; }
  const current = attributionFromSearch(window.location.search);
  try {
    if (Object.keys(current).length) { sessionStorage.setItem(KEY, JSON.stringify(current)); return current; }
    return campaignAttribution(JSON.parse(sessionStorage.getItem(KEY) || "{}"));
  } catch { return current; }
}
