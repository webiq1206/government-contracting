import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActivityLogActions } from "@/components/activity-log-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Activity log lab",
  description: "Development-only check of the activity action row.",
  robots: { index: false, follow: false },
};

/** Action row in its closed state; click a button to see the composer. Dev only. */
export default function LogLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="eyebrow">Theme QA</p>
      <h1 className="mb-6 font-display text-lg">Activity actions</h1>
      <div className="max-w-md space-y-8">
        <ActivityLogActions opportunityId="00000000-0000-0000-0000-000000000000" />
      </div>
    </div>
  );
}
