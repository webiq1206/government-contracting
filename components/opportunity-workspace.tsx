"use client";

import type { ReactNode } from "react";
import { EditorialTabs } from "@/components/editorial-tabs";

const HASH_ALIASES: Record<string, string> = {
  score: "brief",
  overview: "requirements",
  requirements: "requirements",
  coverage: "coverage",
  subs: "coverage",
  quotes: "pricing",
  submission: "pricing",
  "revise-quotes": "pricing",
  pricing: "pricing",
  docs: "files",
  attachments: "files",
  files: "files",
  workflow: "more",
  activity: "more",
  more: "more",
  attention: "brief",
  next: "brief",
  "next-step": "brief",
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
  more,
  banner,
}: {
  brief: ReactNode;
  requirements: ReactNode;
  coverage: ReactNode;
  pricing: ReactNode;
  files: ReactNode;
  more: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <EditorialTabs
      ariaLabel="Opportunity sections"
      defaultTab="brief"
      hashAliases={HASH_ALIASES}
      banner={banner}
      tabs={[
        { id: "brief", label: "Brief", content: brief },
        { id: "requirements", label: "Requirements", content: requirements },
        { id: "coverage", label: "Coverage", content: coverage },
        { id: "pricing", label: "Pricing", content: pricing },
        { id: "files", label: "Files", content: files },
        { id: "more", label: "More", content: more },
      ]}
    />
  );
}
