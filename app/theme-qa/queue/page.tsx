import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WorkQueue } from "@/components/work-queue";
import type { WorkItem } from "@/lib/domain/work-queue";
import { sortWorkItems } from "@/lib/domain/work-queue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Work queue lab",
  description: "Development-only check of the unified work queue.",
  robots: { index: false, follow: false },
};

/** All five kinds at once, so the ordering policy is visible. Dev only. */
const ITEMS: WorkItem[] = sortWorkItems([
  {
    key: "d1",
    kind: "decide",
    title: "Pursue or pass: Grounds maintenance IDIQ",
    context: "Borderline score",
    due: "2026-09-20",
    href: "#",
    recordHref: "#",
    actionLabel: "Decide",
  },
  {
    key: "c1",
    kind: "call",
    title: "Call Rivera Mechanical about HVAC",
    context: "Chiller replacement, Building 400",
    due: "2026-09-18",
    href: "#",
    recordHref: "#",
    actionLabel: "Open call",
  },
  {
    key: "q1",
    kind: "enter_quote",
    title: "Enter quotes: Roof replacement and sheet metal",
    context: "quote entry",
    due: "2026-09-04",
    href: "#",
    recordHref: "#",
    actionLabel: "Enter quote",
  },
  {
    key: "b1",
    kind: "review_bid",
    title: "Review & submit bid: HVAC replacement, Robins AFB",
    context: "bid building",
    due: "2026-08-28",
    href: "#",
    recordHref: "#",
    actionLabel: "Review bid",
  },
  {
    key: "f1",
    kind: "fix_blocker",
    title: "Resolve blocker: Janitorial services, Building 12",
    context: "analysis",
    due: null,
    href: "#",
    recordHref: "#",
    actionLabel: "Resolve",
  },
]);

export default function QueueLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="eyebrow">Theme QA</p>
      <h1 className="mb-6 font-display text-lg">Work queue</h1>
      <div className="max-w-2xl space-y-8">
        <WorkQueue items={ITEMS} />
        <WorkQueue items={ITEMS} limit={3} />
        <WorkQueue items={[]} />
      </div>
    </div>
  );
}
