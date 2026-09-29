/** Free, local-only worksheet logic. No providers, billing or account data. */
export const BID_CHECKS = [
  { id: "eligibility", label: "We meet the stated eligibility and qualification requirements.", gate: true, help: "Check the actual notice, attachments and amendments. Do not assume a certification or registration is sufficient." },
  { id: "deadline", label: "We can meet the submission deadline and mandatory pre-bid steps.", gate: true, help: "Include questions, site visits, required meetings and the stated time zone." },
  { id: "capacity", label: "We have a credible plan for staffing, location and delivery.", gate: true, help: "Count confirmed team capacity, not hoped-for subcontractor availability." },
  { id: "scope", label: "We understand the scope, exclusions and deliverables.", gate: false, help: "Record uncertainties and use the buyer's stated question process." },
  { id: "evidence", label: "We can support the requested experience and qualifications.", gate: false, help: "Use relevant, verifiable examples and obtain permission before naming references." },
  { id: "pricing", label: "Our pricing assumptions and supplier quotes are documented.", gate: false, help: "Include labor, materials, overhead, schedule risk and quote validity." },
  { id: "review", label: "An owner can complete an independent requirements review.", gate: false, help: "Assign review and submission responsibilities before the deadline." },
] as const;
export type BidAnswer = "yes" | "no" | "unknown";
export type BidAnswers = Partial<Record<typeof BID_CHECKS[number]["id"], BidAnswer>>;
export function bidReadiness(answers: BidAnswers) {
  const confirmed = BID_CHECKS.filter(c => answers[c.id] === "yes").length;
  const blockers = BID_CHECKS.filter(c => c.gate && answers[c.id] === "no");
  const unresolved = BID_CHECKS.filter(c => answers[c.id] !== "yes");
  const unanswered = BID_CHECKS.filter(c => !answers[c.id]).length;
  const status = blockers.length ? "Resolve a critical blocker" : unanswered ? "Complete your review" : unresolved.length ? "Clarify before committing" : "Ready for your bid decision";
  return { confirmed, total: BID_CHECKS.length, percent: Math.round(confirmed / BID_CHECKS.length * 100), blockers, unresolved, unanswered, status };
}
export function bidWorksheet(answers: BidAnswers) {
  const result = bidReadiness(answers);
  return ["# BrostCo bid/no-bid worksheet", "", result.status, `${result.confirmed} of ${result.total} checks confirmed. This is checklist readiness, not a win probability or eligibility determination.`, "", ...BID_CHECKS.map(c => `- ${c.label} ${answers[c.id] ?? "unanswered"}`), "", "Verify the solicitation and all amendments before acting.", "https://brostco.com/tools/bid-no-bid"].join("\n");
}
export type CapabilityInput = { company: string; summary: string; competencies: string; differentiators: string; experience: string; identifiers: string; contact: string };
export const CAPABILITY_FIELDS: { key: keyof CapabilityInput; label: string; placeholder: string; required?: boolean }[] = [
  { key: "company", label: "Company name", placeholder: "Your legal or trading name", required: true },
  { key: "summary", label: "What you do", placeholder: "Who you serve, what you deliver and where you work.", required: true },
  { key: "competencies", label: "Core capabilities", placeholder: "One specific service or capability per line.", required: true },
  { key: "differentiators", label: "What sets you apart", placeholder: "Use facts you can substantiate, such as equipment, response coverage or specialist experience." },
  { key: "experience", label: "Relevant experience", placeholder: "Describe relevant projects and your actual role. Only include information you have permission to share." },
  { key: "identifiers", label: "Verified business details", placeholder: "Relevant NAICS codes, UEI, CAGE or certifications, only where current and applicable." },
  { key: "contact", label: "Business contact", placeholder: "Name, business email, phone and website.", required: true },
];
export function capabilityText(input: CapabilityInput) {
  return ["# " + input.company.trim(), "Capability statement", ...CAPABILITY_FIELDS.filter(f => f.key !== "company" && input[f.key].trim()).flatMap(f => ["", `## ${f.label}`, input[f.key].trim()]), "", "Prepared with BrostCo's free capability statement builder.", "https://brostco.com/tools/capability-statement"].join("\n");
}
export type MatrixRow = { requirement: string; source: string; owner: string; response: string; status: string };
/** Quote all cells, neutralize spreadsheet formulas and preserve multiline text. */
export function csvCell(value: string) {
  const normalized = value.replace(/\u0000/g, "");
  const safe = /^[\s]*[=+\-@]/.test(normalized) || /^[\t\r\n]/.test(normalized) ? "'" + normalized : normalized;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function matrixCsv(rows: MatrixRow[]) {
  return "\uFEFF" + [["Requirement", "Source / page / amendment", "Owner", "Response location", "Review status"], ...rows.map(r => [r.requirement, r.source, r.owner, r.response, r.status])].map(row => row.map(csvCell).join(",")).join("\r\n");
}
/** The day the tools last changed in a way a visitor would notice. */
export const TOOLS_UPDATED_ON = "2026-09-27";
export const FREE_TOOLS = [
  { slug: "bid-no-bid", title: "Bid/no-bid scorecard", description: "Check seven practical criteria and download a decision worksheet before committing time to a government bid." },
  { slug: "capability-statement", title: "Capability statement builder", description: "Turn your verified company information into an editable capability statement. No account or email required." },
  { slug: "compliance-matrix", title: "Proposal compliance matrix", description: "Map requirements to source pages, owners and response locations, then export a spreadsheet-ready CSV." },
] as const;
