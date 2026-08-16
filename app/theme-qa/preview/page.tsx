import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CardPreview, CardPreviewBody, type CardPreviewData } from "@/components/card-preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Card preview lab",
  description: "Development-only check of the board hover preview.",
  robots: { index: false, follow: false },
};

/** The live Guam opportunity, and a thinner one. Dev only. */
const CASES: { label: string; data: CardPreviewData }[] = [
  {
    label: "Two trades, none priced",
    data: {
      title: "Aircraft Hangar Fall Arrest System Inspection and Certification",
      agency: "DEPT OF DEFENSE · DEPT OF THE AIR FORCE",
      solicitationNumber: "FA524026Q0021",
      stageLabel: "Calls to make",
      score: 73,
      tier: "pursue",
      deadline: "2026-08-16",
      valueEstimated: null,
      why: "Pursue: fall protection inspection is squarely in your trades and the location is inside your service area, though the incumbent has held it for years.",
      trades: [
        {
          trade: "Fall protection / fall arrest system inspection and certification",
          status: "action_required",
          statusLabel: "Action required: not contacted yet",
        },
        {
          trade: "Industrial equipment repair and maintenance",
          status: "action_required",
          statusLabel: "Action required: not contacted yet",
        },
      ],
      tradesPriced: 0,
      tradeCount: 2,
      nextStep: {
        title: "Call the subcontractors",
        why: "Subs are ready to be called.",
        waitingOn: "you",
      },
    },
  },
  {
    label: "One trade priced, no analysis yet",
    data: {
      title: "Janitorial Services for Englebright Lake",
      agency: "DEPT OF DEFENSE · DEPT OF THE ARMY",
      solicitationNumber: null,
      stageLabel: "Collecting quotes",
      score: 82,
      tier: "pursue",
      deadline: "2026-08-17",
      valueEstimated: 240000,
      why: null,
      trades: [
        { trade: "Janitorial", status: "complete", statusLabel: "Complete: quote on file" },
      ],
      tradesPriced: 1,
      tradeCount: 1,
      nextStep: {
        title: "Finish and submit the package",
        why: "The bid is priced.",
        waitingOn: "you",
      },
    },
  },
];

export default function PreviewLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="eyebrow">Theme QA</p>
      <h1 className="mb-6 font-display text-lg">Board hover preview</h1>
      {/* A real card wired to the real hover component, so the interaction
          itself (open delay, placement, caching) can be exercised. */}
      <div className="mb-10">
        <p className="label mb-2">Live hover behaviour</p>
        <CardPreview opportunityId="00000000-0000-0000-0000-000000000001">
          <div className="card w-64" data-testid="hover-card">
            <p className="text-sm font-medium">Hover me</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Opens after a short delay.
            </p>
          </div>
        </CardPreview>
      </div>

      <div className="flex flex-wrap gap-8">
        {CASES.map((c) => (
          <div key={c.label}>
            <p className="label mb-2">{c.label}</p>
            <div
              style={{ width: 340 }}
              className="rounded-md border border-border/75 bg-surface-raised p-3 shadow-xl dark:border-white/[0.17]"
            >
              <CardPreviewBody data={c.data} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
