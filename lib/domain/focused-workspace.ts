import { dedupeWorkItems, needsYou, sortWorkItems, type WorkItem } from "./work-queue";

/** Same actionable queue, limited presentation. No counts or outcomes invented. */
export function focusTasks(items: WorkItem[]): WorkItem[] {
  return sortWorkItems(needsYou(dedupeWorkItems(items))).slice(0, 4);
}
