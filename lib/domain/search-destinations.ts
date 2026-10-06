import { NAVIGATION_SECTIONS, SETTINGS_DESTINATIONS } from "../navigation";
import type { SearchResult } from "./search-results";

export type NavigationSearchAccess = { platformAdmin: boolean };
const ALIASES: Record<string, string[]> = {
  "/analytics": ["analytics", "reports", "win performance", "revenue"],
  "/settings/integrations": ["connections", "connect services", "AI providers", "Gmail"],
  "/review": ["review opportunities", "review decisions"],
  "/settings/profile": ["company profile", "NAICS", "setup"],
  "/settings/content": ["email templates", "outreach wording"],
  "/agents": ["automation health", "agents", "incidents"],
  "/workbench": ["tasks", "my work", "queue"],
};

/** Safe page shortcuts only. Search never executes a bid, send, or agent run. */
export function searchDestinations(query: string, access?: NavigationSearchAccess): SearchResult[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!access || query.trim().length < 2) return [];
  const candidates = new Map<string, { title: string; terms: string[] }>();
  for (const item of [
    ...NAVIGATION_SECTIONS.filter(section => !section.adminOnly || access.platformAdmin).flatMap(section => section.items),
    ...SETTINGS_DESTINATIONS,
  ]) {
    const prior = candidates.get(item.href);
    candidates.set(item.href, { title: item.label,
      terms: [...(prior?.terms ?? []), item.label, item.hint ?? "", ...(ALIASES[item.href] ?? [])] });
  }
  return [...candidates].filter(([, entry]) => {
    const text = entry.terms.join(" ").toLocaleLowerCase();
    return words.every(word => text.includes(word));
  }).map(([href, entry]) => ({ kind: "page", title: entry.title,
    subtitle: "Open this page. No action is performed.", href }));
}
