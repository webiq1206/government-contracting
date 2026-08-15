/**
 * Operator-facing fill-in fields for outreach / follow-up email templates.
 * Keys must match what outreach and maintenance agents put in `vars`.
 */

import { buildOutreachBrief } from "./outreach-brief";

export type TemplateTokenGroup = "sub" | "job" | "you";

export interface TemplateToken {
  key: string;
  /** Short chip label. */
  label: string;
  /** One-line plain-English meaning. */
  description: string;
  /** Example value shown in the palette and preview. */
  example: string;
  group: TemplateTokenGroup;
}

export const TEMPLATE_TOKEN_GROUPS: {
  id: TemplateTokenGroup;
  label: string;
  blurb: string;
}[] = [
  {
    id: "sub",
    label: "About the subcontractor",
    blurb: "Filled from their contact record.",
  },
  {
    id: "job",
    label: "About the job",
    blurb: "Filled from the solicitation Brost Co is quoting.",
  },
  {
    id: "you",
    label: "About you",
    blurb: "Filled from your company / outreach settings.",
  },
];

export const TEMPLATE_TOKENS: TemplateToken[] = [
  {
    key: "owner_name",
    label: "Sub's first name",
    description: "Their first name, or \"there\" if unknown.",
    example: "Marcus",
    group: "sub",
  },
  {
    key: "opportunity_title",
    label: "Job title",
    description: "Full title of the solicitation.",
    example: "HVAC Maintenance Services, Building 36C",
    group: "job",
  },
  {
    key: "solicitation_number",
    label: "Solicitation number",
    description: "SAM.gov solicitation number.",
    example: "W912DR-26-R-0042",
    group: "job",
  },
  {
    key: "agency",
    label: "Agency",
    description: "Government agency name.",
    example: "US Army Corps of Engineers",
    group: "job",
  },
  {
    key: "location_state",
    label: "State",
    description: "State where the work is located.",
    example: "Virginia",
    group: "job",
  },
  {
    key: "deadline",
    label: "Deadline",
    description: "Proposal due date, written for email.",
    example: "Aug 25, 2026",
    group: "job",
  },
  {
    key: "trade",
    label: "Trade",
    description: "Trade you are asking them to price (HVAC, electrical, etc.).",
    example: "HVAC",
    group: "job",
  },
  {
    key: "scope_summary",
    label: "Scope summary",
    description:
      "Work for this trade, as one sentence. The brief below the body already lists it, so inserting this repeats it.",
    example: "replace HVAC units in 4 buildings, about 120,000 sq ft total",
    group: "job",
  },
  {
    key: "questions",
    label: "Questions for the sub",
    description:
      "Retired. The brief below the body carries these questions, so this token now fills in as nothing.",
    example: "",
    group: "job",
  },
  {
    key: "sender_name",
    label: "Your name",
    description: "Your outreach display name.",
    example: "Jared",
    group: "you",
  },
  {
    key: "company_name",
    label: "Your company",
    description: "Your company's legal name.",
    example: "BROSTCO Holdings LLC",
    group: "you",
  },
  {
    key: "phone",
    label: "Your phone",
    description: "Your business phone number.",
    example: "(800) 555-0199",
    group: "you",
  },
];

/** Sample map for preview / test sends in the editor. */
export const TEMPLATE_TOKEN_SAMPLES: Record<string, string> = Object.fromEntries(
  TEMPLATE_TOKENS.map((t) => [t.key, t.example])
);

/** Filenames shown in the editor preview details footer (not sent as bytes). */
export const TEMPLATE_PREVIEW_ATTACHMENTS = [
  "Statement of Work.pdf",
  "Wage Determination.pdf",
];

/**
 * The brief the Outreach agent appends beneath the template body.
 *
 * The editor preview and the test send both build it from the same sample
 * values the token palette advertises, so what an operator sees while editing
 * is the shape a subcontractor receives. Previewing the old facts-and-files
 * footer while sending a structured brief would make the editor lie.
 */
export function previewBriefSections() {
  return buildOutreachBrief({
    trade: TEMPLATE_TOKEN_SAMPLES.trade,
    title: TEMPLATE_TOKEN_SAMPLES.opportunity_title,
    agency: TEMPLATE_TOKEN_SAMPLES.agency,
    solicitationNumber: TEMPLATE_TOKEN_SAMPLES.solicitation_number,
    locationState: TEMPLATE_TOKEN_SAMPLES.location_state,
    deadlineLabel: TEMPLATE_TOKEN_SAMPLES.deadline,
    description: TEMPLATE_TOKEN_SAMPLES.scope_summary,
    attachedNames: TEMPLATE_PREVIEW_ATTACHMENTS,
    links: [],
    documentsExpected: true,
  }).sections;
}
