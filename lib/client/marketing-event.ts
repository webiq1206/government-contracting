import { growthAttribution } from "./growth-attribution";
import type { PublicEvent } from "@/lib/domain/public-analytics";

export function marketingEvent(event: PublicEvent, details: { target?: string; location?: string } = {}) {
  if (typeof window === "undefined" || navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
  // Only allowlisted campaign labels. No cookies, visitor IDs, raw queries, referrers or field contents.
  void fetch("/api/track/marketing", {
    method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ event, path: window.location.pathname, attribution: growthAttribution(), ...details }),
  }).catch(() => {});
}
