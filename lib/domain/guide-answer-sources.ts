export type GuideAnswerSource = { label: string; href: string };

/** Server-owned facts may link only to the current record and account workload. */
export function guideAnswerSources(value: unknown, pathname: string): GuideAnswerSource[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["/today"]);
  const opportunity = pathname.match(/^\/opportunity\/([0-9a-f-]{36})(?:\/requirements)?$/i)?.[1];
  if (opportunity) allowed.add(`/opportunity/${opportunity}#brief`);
  const contract = pathname.match(/^\/contracts\/([0-9a-f-]{36})$/i)?.[1];
  if (contract) for (const section of ["overview", "obligations", "documents", "financials"]) {
    allowed.add(`/contracts/${contract}#${section}`);
  }
  const seen = new Set<string>();
  return value.flatMap(source => {
    if (!source || typeof source !== "object") return [];
    const { label, href } = source as { label?: unknown; href?: unknown };
    if (typeof label !== "string" || !label.trim() || typeof href !== "string"
      || !allowed.has(href) || seen.has(href)) return [];
    seen.add(href);
    return [{ label: label.trim().slice(0, 300), href }];
  }).slice(0, 8);
}
