/**
 * Named slices of the pipeline, shared by whatever counts them and whatever
 * shows them.
 *
 * The Today rail displays "In pursuit 69" and the board shows opportunities;
 * until these agreed on a stage list, making that number clickable would have
 * meant a link that lands on a different total than the one you clicked,
 * which is worse than no link. The counts on the rail and the filter on the
 * board are now computed from the same arrays here.
 */

export const FOCUS_KEYS = ["in_capture", "in_pursuit", "packages_ready"] as const;
export type FocusKey = (typeof FOCUS_KEYS)[number];

export interface FocusSet {
  key: FocusKey;
  label: string;
  /** What the slice means, for the banner on the filtered board. */
  blurb: string;
  stages: string[];
}

export const FOCUS_SETS: Record<FocusKey, FocusSet> = {
  in_capture: {
    key: "in_capture",
    label: "In capture",
    blurb: "Scored a strong fit and being worked up: analysis, sub research, outreach, quotes, and bid building.",
    stages: ["analysis", "sub_research", "outreach", "quote_entry", "bid_building"],
  },
  in_pursuit: {
    key: "in_pursuit",
    label: "In pursuit",
    blurb: "Actively chasing a price and a package: outreach, calls, quotes, and bid building.",
    stages: ["outreach", "call_queue", "quote_entry", "bid_building"],
  },
  packages_ready: {
    key: "packages_ready",
    label: "Packages ready",
    blurb: "Priced and assembled, waiting on your review and submission.",
    stages: ["bid_building"],
  },
};

export function focusSet(key: string | null | undefined): FocusSet | null {
  if (!key) return null;
  return (FOCUS_SETS as Record<string, FocusSet>)[key] ?? null;
}

/** Total across a focus set, from a stage → count map. */
export function focusCount(
  key: FocusKey,
  byStage: Record<string, number>
): number {
  return FOCUS_SETS[key].stages.reduce((n, s) => n + (byStage[s] ?? 0), 0);
}
