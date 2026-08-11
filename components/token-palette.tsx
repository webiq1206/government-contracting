"use client";

/** All tokens available in outreach and follow-up templates (from lib/agents/outreach.ts). */
const TOKENS = [
  {
    key: "owner_name",
    label: "Sub's first name",
    description: "Recipient's first name, or \"there\" if unknown",
  },
  {
    key: "sender_name",
    label: "Your name",
    description: "Your configured outreach display name",
  },
  {
    key: "company_name",
    label: "Your company",
    description: "Your company's legal name (BROSTCO Holdings)",
  },
  {
    key: "phone",
    label: "Your phone",
    description: "Your business phone number",
  },
  {
    key: "opportunity_title",
    label: "Opportunity title",
    description: "Full title of the solicitation",
  },
  {
    key: "solicitation_number",
    label: "Solicitation #",
    description: "SAM.gov solicitation number",
  },
  {
    key: "agency",
    label: "Agency",
    description: "Government agency name",
  },
  {
    key: "location_state",
    label: "State",
    description: "State where the work is located",
  },
  {
    key: "deadline",
    label: "Deadline",
    description: "Formatted proposal submission deadline",
  },
  {
    key: "trade",
    label: "Trade",
    description: "Trade category (e.g., HVAC, Electrical)",
  },
  {
    key: "scope_summary",
    label: "Scope summary",
    description: "Sanitized scope of work for this trade",
  },
  {
    key: "questions",
    label: "Questions",
    description: "Questions for the sub, as a bulleted list",
  },
] as const;

interface Props {
  /** Called when a token chip is clicked or dragged-and-dropped. */
  onInsert: (key: string) => void;
}

/**
 * A palette of token chips the operator can click or drag into the subject /
 * body fields. Each chip represents one {{token}} placeholder that the
 * outreach agent replaces with live solicitation data before sending.
 */
export function TokenPalette({ onInsert }: Props) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <p className="eyebrow mb-2.5 text-slate-500">
        Insert token &mdash; click or drag into subject / body
      </p>
      <div className="flex flex-wrap gap-2">
        {TOKENS.map((tok) => (
          <button
            key={tok.key}
            type="button"
            draggable
            title={tok.description}
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", `{{${tok.key}}}`);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => onInsert(tok.key)}
            className="group flex cursor-grab items-center gap-1.5 rounded border border-accent/30 bg-accent-soft px-2 py-1 text-xs font-medium text-accent-strong transition hover:border-accent hover:bg-accent/10 active:cursor-grabbing"
          >
            <span className="font-mono opacity-60">{"{"}</span>
            {tok.label}
            <span className="font-mono opacity-60">{"}"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
