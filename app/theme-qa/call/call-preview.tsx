"use client";

import { CallWorkspace, type CallWorkspaceData } from "@/components/call-workspace";

/**
 * A call card that exercises the parts of the guide worth looking at: typed
 * job-specific questions, a price their email already mentioned, bonding and
 * licence requirements so the paperwork section appears, and a prior quote so
 * the history block is not empty.
 */
const DATA: CallWorkspaceData = {
  card: {
    id: "fixture-card",
    opportunity_id: "fixture-opp",
    subcontractor_id: "fixture-sub",
    card_json: { email_mentioned_price: 42500 },
    call_script: null,
    question_list: [
      { id: "chiller_live", ask: "Can you work with the chiller staying live?", type: "yes_no" },
      {
        id: "crane",
        ask: "Which crane access works for you?",
        type: "choice",
        options: ["Rooftop", "Street side"],
      },
      { id: "crew", ask: "How many crew can you field?", type: "number" },
      { id: "shutdown", ask: "Longest shutdown you would need?", type: "short_text" },
    ],
    needs_project_history: true,
    status: "pending",
    source: "reply",
    response_json: null,
    quote_amount: null,
    company_name: "Rivera Mechanical",
    owner_name: "Dana Rivera",
    email: "dana@riveramech.test",
    phone: "(478) 555-0142",
    website: "riveramech.test",
    address: "410 Industrial Way",
    city: "Warner Robins",
    state: "GA",
    google_rating: 4.6,
    reliability_score: 82,
    license_status: "unknown",
    sam_excluded: false,
    trade_categories: ["HVAC"],
    opportunity_title: "Chiller replacement, Building 400 mechanical room",
    agency: "Robins AFB",
    naics_code: "238220",
    set_aside_type: "Total Small Business",
    value_estimated: 480_000,
    value_estimated_source: "solicitation",
    location_state: "GA",
    opportunity_location: "Warner Robins",
    deadline: new Date(Date.UTC(2026, 8, 18)).toISOString(),
    solicitation_number: "FA8501-26-R-0042",
    description: "Replace the primary chiller and associated pumps and controls.",
    solicitation_analysis: {
      qualifications: {
        bonding: ["Payment and performance bond, 100%"],
        licenses: ["Georgia mechanical contractor licence"],
        certifications: [],
        insurance: [],
      },
      trade_scopes: [
        {
          trade: "HVAC",
          work:
            "Remove the existing 400-ton chiller\nSet the new unit on the existing pad\nTie into the building controls and commission",
        },
      ],
    },
    attachments_json: [{ name: "SOW-Attachment-1.pdf", url: "#" }],
    trade: "HVAC",
  },
  communications: [
    {
      id: "c1",
      channel: "email",
      direction: "outbound",
      subject: "Chiller replacement, quote request",
      body: null,
      created_at: new Date(Date.UTC(2026, 7, 30)).toISOString(),
      replied_at: null,
    },
  ],
  quotes: [
    {
      id: "q1",
      trade: "HVAC",
      quote_amount: 38_000,
      payment_terms: "Net 30",
      is_out_of_range: false,
      created_at: new Date(Date.UTC(2026, 5, 12)).toISOString(),
    },
  ],
};

export function CallPreview() {
  // onClose is a no-op: the slide-over is the whole point of the page.
  return <CallWorkspace data={DATA} onClose={() => {}} />;
}
