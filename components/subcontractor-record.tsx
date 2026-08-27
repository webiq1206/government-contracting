"use client";

import type { ReactNode } from "react";
import { EditorialTabs } from "@/components/editorial-tabs";

/*
 * Anchors that already point into this record, and where they land now. The
 * compliance badge in the header links to `#compliance`, the guide points at
 * `#sub-contact`, and Communications links here by company name.
 */
const HASH_ALIASES: Record<string, string> = {
  overview: "overview",
  "sub-contact": "overview",
  contact: "overview",
  projects: "overview",
  capability: "capability",
  people: "capability",
  licenses: "capability",
  pairings: "opportunities",
  opportunities: "opportunities",
  conversations: "communications",
  communications: "communications",
  quotes: "quotes",
  compliance: "compliance",
  documents: "compliance",
  notes: "notes",
  activity: "activity",
};

/**
 * The subcontractor record, as sections rather than a scroll.
 *
 * It was a stack of collapsibles in a two-column grid, which meant the answer
 * to "can we send this company work" was a panel somebody had to find, and the
 * answer to "what happened with them" did not exist at all. The sections are
 * the ones the audit names, in the order somebody works a record: who they
 * are, what we have them on, what has been said, what they quoted, whether
 * their paperwork stands up, our own notes, and the history.
 */
export function SubcontractorRecord({
  overview,
  capability,
  opportunities,
  communications,
  quotes,
  compliance,
  notes,
  activity,
}: {
  overview: ReactNode;
  capability: ReactNode;
  opportunities: ReactNode;
  communications: ReactNode;
  quotes: ReactNode;
  compliance: ReactNode;
  notes: ReactNode;
  activity: ReactNode;
}) {
  return (
    <EditorialTabs
      ariaLabel="Subcontractor sections"
      defaultTab="overview"
      hashAliases={HASH_ALIASES}
      tabs={[
        { id: "overview", label: "Overview", content: overview },
        /*
         * Directly after Overview, because it answers the question Overview
         * raises. Knowing who a firm is leads straight to whether they can
         * take this job, and that used to have nowhere to live.
         */
        { id: "capability", label: "Capability", content: capability },
        { id: "opportunities", label: "Opportunities", content: opportunities },
        { id: "communications", label: "Communications", content: communications },
        { id: "quotes", label: "Quotes", content: quotes },
        /*
         * Compliance and Documents are one section, deliberately. A
         * subcontractor's documents are their compliance: the file and whether
         * it is still valid are the same row, and splitting them would put a
         * certificate on one tab and the fact that it expired on another.
         */
        { id: "compliance", label: "Compliance and documents", content: compliance },
        { id: "notes", label: "Notes", content: notes },
        { id: "activity", label: "Activity", content: activity },
      ]}
    />
  );
}
