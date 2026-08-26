"use client";

import type { ReactNode } from "react";
import { EditorialTabs } from "@/components/editorial-tabs";

/*
 * Every anchor that has ever pointed into this record, and the section it now
 * lands on. Links to `#submission` are in Today's queue, in the guide, and in
 * emails somebody sent themselves; `#more` is in nothing anyone wrote, but it
 * cost nothing to keep working.
 */
const HASH_ALIASES: Record<string, string> = {
  score: "brief",
  overview: "brief",
  attention: "brief",
  next: "brief",
  "next-step": "brief",
  workflow: "brief",
  requirements: "requirements",
  "key-facts": "requirements",
  coverage: "coverage",
  subs: "coverage",
  quotes: "pricing",
  "revise-quotes": "pricing",
  pricing: "pricing",
  docs: "files",
  attachments: "files",
  files: "files",
  submission: "submission",
  activity: "activity",
  more: "activity",
};

/**
 * Editorial tab shell for Opportunity detail.
 */
export function OpportunityWorkspace({
  brief,
  requirements,
  coverage,
  pricing,
  files,
  submission,
  activity,
  banner,
}: {
  brief: ReactNode;
  requirements: ReactNode;
  coverage: ReactNode;
  pricing: ReactNode;
  files: ReactNode;
  submission: ReactNode;
  activity: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <EditorialTabs
      ariaLabel="Opportunity sections"
      defaultTab="brief"
      hashAliases={HASH_ALIASES}
      banner={banner}
      /*
       * The seven sections the audit names, and two of them had to be dug out
       * of somewhere else to get here.
       *
       * Submission was the last block on the Pricing tab. It is the gate that
       * decides whether a bid goes out, and it was below the quote table,
       * below the comps, below the competitive read -- reachable by scrolling
       * a tab named after something else.
       *
       * Activity was behind a tab labelled "More", which is a label that
       * describes the tab's position rather than its contents and is where
       * things go when nobody wants to decide where they belong.
       *
       * The workflow tracker that shared that tab has moved into Overview. It
       * said so itself: "same tracker as the top banner".
       */
      tabs={[
        { id: "brief", label: "Overview", content: brief },
        { id: "requirements", label: "Requirements", content: requirements },
        { id: "coverage", label: "Subs and outreach", content: coverage },
        { id: "pricing", label: "Pricing", content: pricing },
        { id: "files", label: "Documents", content: files },
        { id: "submission", label: "Submission", content: submission },
        { id: "activity", label: "Activity", content: activity },
      ]}
    />
  );
}
