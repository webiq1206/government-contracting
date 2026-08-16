import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuidedPlanPanel } from "@/components/guided-plan";
import { buildGuidedPlan, type GuidedPlanInput } from "@/lib/domain/guided-plan";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guided plan lab",
  description: "Development-only check of the guided opportunity plan.",
  robots: { index: false, follow: false },
};

function input(over: Partial<GuidedPlanInput> = {}): GuidedPlanInput {
  return {
    stage: "scoring",
    tier: null,
    humanActionRequired: false,
    pastPerfBlocked: false,
    expired: false,
    score: null,
    hasAnalysis: false,
    missingInfo: [],
    coverage: { trades: [] },
    quotesEntered: 0,
    outreachDraftOnly: false,
    callsEnabled: true,
    pendingCalls: 0,
    hasBid: false,
    bidAmount: null,
    packageReady: null,
    packageBlockers: [],
    needsSignature: 0,
    needsProvide: 0,
    bidSubmitted: false,
    outcome: null,
    ...over,
  };
}

const t = (
  trade: string,
  over: Partial<{ found: number; contacted: number; quotes: number }> = {}
) => ({
  trade,
  found: 0,
  contacted: 0,
  responded: 0,
  quotes: 0,
  followUpDue: 0,
  declined: 0,
  status: "empty" as const,
  statusLabel: "",
  ...over,
});

/** Every plan state at once, so status styling is visible. Dev only. */
const STATES: { label: string; plan: ReturnType<typeof buildGuidedPlan> }[] = [
  { label: "Fresh record, being scored", plan: buildGuidedPlan(input()) },
  {
    label: "Borderline score, your decision",
    plan: buildGuidedPlan(input({ tier: "review", humanActionRequired: true, score: 55 })),
  },
  {
    label: "Mid-flight with problems (missing doc, unpriced trade)",
    plan: buildGuidedPlan(
      input({
        stage: "quote_entry",
        score: 82,
        hasAnalysis: true,
        missingInfo: [
          {
            what: "Attachment B (pricing sheet) is missing",
            how: "Download it from SAM and upload it here.",
          },
        ],
        coverage: {
          trades: [
            t("HVAC", { found: 3, contacted: 3, quotes: 1 }),
            t("Electrical", { found: 2, contacted: 2 }),
          ],
        },
        quotesEntered: 1,
      })
    ),
  },
  {
    label: "Endgame: signatures outstanding",
    plan: buildGuidedPlan(
      input({
        stage: "bid_building",
        score: 90,
        hasAnalysis: true,
        coverage: { trades: [t("Roofing", { found: 2, contacted: 2, quotes: 1 })] },
        quotesEntered: 1,
        hasBid: true,
        bidAmount: 125000,
        packageReady: false,
        packageBlockers: ['Sign "SF-1449 (offer form)" (prefilled), then mark it complete.'],
      })
    ),
  },
  {
    label: "Won",
    plan: buildGuidedPlan(
      input({
        stage: "won",
        score: 90,
        hasAnalysis: true,
        hasBid: true,
        bidSubmitted: true,
        outcome: "won",
      })
    ),
  },
  {
    label: "Dismissed",
    plan: buildGuidedPlan(input({ stage: "dismissed", score: 40 })),
  },
];

export default function PlanLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="eyebrow">Theme QA</p>
      <h1 className="mb-6 font-display text-lg">Guided plan</h1>
      <div className="max-w-2xl space-y-8">
        {STATES.map((s) => (
          <div key={s.label}>
            <p className="label mb-2">{s.label}</p>
            <GuidedPlanPanel plan={s.plan} />
          </div>
        ))}
      </div>
    </div>
  );
}
