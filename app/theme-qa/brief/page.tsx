import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BidBrief } from "@/components/bid-brief";
import type { SolicitationAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bid brief lab",
  description: "Development-only check of the opportunity brief and requirement list.",
  robots: { index: false, follow: false },
};

/**
 * A solicitation with the awkward parts present: a mandatory site visit, an
 * official form that cannot be substituted, a bond only the operator can buy,
 * the same form named three different ways across three fields, and a mix of
 * must / should / may language in the submission instructions.
 */
const ANALYSIS = {
  project_overview:
    "Replace two 200-ton chillers serving Building 400 and tie the new units into the existing building automation system.",
  scope_plain_language:
    "Remove and dispose of the existing units\nSet new units on the existing pads\nReconnect power and controls\nCommission and provide O&M training",
  location: "Warner Robins, GA",
  estimated_value: "$310,000",
  due_date: "Sep 18, 2026, 2:00 PM ET",
  submission_method: "Email to the contracting officer, PDF only, 25MB limit",
  qualifications: {
    licenses: ["Active Georgia mechanical contractor license"],
    insurance: ["General liability, $1M per occurrence, agency named as additional insured"],
    bonding: ["Payment and performance bonds at 100% of contract value"],
  },
  prebid_meeting: { required: false, details: "Sep 2, 10am, virtual" },
  site_visit: { required: true, details: "Sep 8, 9:00 AM, Building 400 main gate. Photo ID required." },
  submission_requirements: [
    "Offerors must submit a completed and signed SF 1449.",
    "Acknowledge all amendments in Block 14.",
    "Offerors are encouraged to include a capability statement.",
    "Offerors may include photographs of comparable installations, if applicable.",
    "Pricing on the attached schedule, one line per item.",
  ],
  evaluation_criteria: [
    "Price, 60%",
    "Technical approach, 25%",
    "Past performance, 15%",
  ],
  required_forms: [{ name: "SF-1449", note: "Blocks 12, 17 and 30" }, { name: "W-9" }],
  key_dates: [
    { label: "Questions due", date: "Sep 4, 2026" },
    { label: "Site visit", date: "Sep 8, 2026" },
    { label: "Bids due", date: "Sep 18, 2026" },
  ],
  contacts: [{ name: "A. Contracting Officer", role: "CO", email: "co@example.test" }],
  qa_addenda: [
    { label: "Amendment 0001", date: "Aug 29, 2026", summary: "Extended the due date by one week." },
  ],
  special_requirements: [
    "Davis-Bacon wage determination applies to all site labor.",
    "Work must occur between 6pm and 6am.",
  ],
  attention_items: ["Bonding at 100% is unusual for a job this size."],
  pursue_recommendation: "Pursue. Strong NAICS match and we have three chiller subs in Georgia.",
  required_trades: ["HVAC", "Electrical"],
  trade_scopes: [
    { trade: "HVAC", work: "Set and commission two 200-ton units" },
    { trade: "Electrical", work: "Reconnect feeders and controls wiring" },
  ],
  geographic_area: "GA",
  risk_flags: [],
  past_perf_classification: "team_accepted",
  questions_for_subs: [],
  draft_sow: "",
  set_aside: "Total Small Business",
  compliance_matrix: [
    {
      id: "sf1449",
      title: "Signed SF-1449 (offer form)",
      category: "form",
      mandatory: true,
      source: "Section L.3",
      signature_required: true,
      satisfied_by: "operator_signature",
      official_form: "SF-1449",
      instructions: "Sign Block 30 and return page 1 with the offer.",
    },
    {
      id: "pricing_schedule",
      title: "Pricing schedule",
      category: "pricing",
      mandatory: true,
      source: "Attachment 2",
      signature_required: false,
      satisfied_by: "auto_generated",
      format: "One line per item, unit prices in dollars.",
    },
    {
      id: "bid_bond",
      title: "Bid bond at 20% of the offered price",
      category: "attachment",
      mandatory: true,
      source: "Section L.7",
      signature_required: false,
      satisfied_by: "operator_provided",
    },
    {
      id: "brochure",
      title: "Product brochure for the proposed units",
      category: "attachment",
      mandatory: false,
      source: "Section L.9",
      signature_required: false,
      satisfied_by: "operator_provided",
    },
  ],
} as unknown as SolicitationAnalysis;

const DOCS = [
  { id: "1", name: "Solicitation FA8501-26-R-0042.pdf", kind: "solicitation", storage_path: "x" },
  { id: "2", name: "Attachment 2, Pricing Schedule.xlsx", kind: "attachment", storage_path: "y" },
];

/**
 * The brief as a first-time bidder meets it. Dev only: 404 in production.
 */
export default function BriefLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="min-h-screen bg-background p-6 text-foreground">
      <p className="eyebrow">Theme QA</p>
      <h1 className="font-display text-lg">Bid brief</h1>
      <p className="mb-6 mt-1 max-w-2xl text-sm text-muted-foreground">
        Checks that the disqualifying items lead, that the same form stated in three
        fields appears once, and that generated items are marked so they stop looking
        like chores.
      </p>
      <div className="max-w-4xl">
        <BidBrief analysis={ANALYSIS} documents={DOCS} />
      </div>
    </div>
  );
}
