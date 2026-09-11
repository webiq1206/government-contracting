/** Visible constraints for the activity ledger. Paging is not a filter. */
export function activityFilterLabels(filters: Record<string, string>): { key: string; label: string }[] {
  const names: Record<string, string> = {
    q: "Search", category: "Type", status: "Status", from: "From", to: "Through",
    actor: "Who did it", opportunityId: "Opportunity", subcontractorId: "Subcontractor",
  };
  const humanize = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
  return Object.entries(filters).flatMap(([key, value]) => {
    if (!value || key === "page" || key === "pageSize" || key === "format") return [];
    if (key === "sort") return value === "oldest" ? [{ key, label: "Oldest first" }] : [];
    if (key === "attention") return value === "1" ? [{ key, label: "Needs attention" }] : [];
    return [{ key, label: `${names[key] ?? humanize(key)}: ${["category", "status"].includes(key) ? humanize(value) : value}` }];
  });
}
