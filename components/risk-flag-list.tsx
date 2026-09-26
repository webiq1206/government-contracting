import { flagLabel } from "@/lib/flag-labels";

/** Collapse duplicate user-facing symptoms without deleting source flags. */
export function RiskFlagList({ flags }: { flags: string[] }) {
  const groups = new Map<string, string[]>();
  for (const flag of flags) {
    const label = flagLabel(flag);
    groups.set(label, [...(groups.get(label) ?? []), flag]);
  }
  return <ul className="flex flex-wrap gap-2" aria-label="Risk flags">
    {[...groups].map(([label, sources]) => <li key={label}>
      <a href="#attention" className="inline-flex min-h-11 items-center rounded-md bg-risk/10 px-3 py-2 text-xs text-risk hover:bg-risk/20" title={`Open attention items. Recorded flags: ${sources.join(", ")}`}>
        <span aria-hidden="true">⚠&nbsp;</span>{label}{sources.length > 1 ? ` (${sources.length} recorded flags)` : ""}
      </a>
    </li>)}
  </ul>;
}
