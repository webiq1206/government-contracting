import type { HelpContent } from "@/components/help-popover";

/**
 * Per-page help popover content. Keep each page to 3-4 short bullets:
 * what this is, what to do here, what runs on its own. The full journey
 * lives at /how-it-works — don't duplicate it here.
 */
export const PAGE_HELP: Record<string, HelpContent> = {
  today: {
    title: "Your starting point, every day",
    points: [
      "Everything that needs you is listed here, most urgent first.",
      "Click any item to jump straight to where the work happens.",
      "Empty list means the automation is handling everything right now.",
    ],
  },
  pipeline: {
    title: "Every opportunity, by stage",
    points: [
      "Each column is a stage; cards move right as work completes.",
      "Most movement is automatic. Cards needing you are flagged.",
      "Click any card to open its full record.",
    ],
  },
  review: {
    title: "Borderline scores need your call",
    points: [
      "These scored in the middle band, so the system wants your judgment.",
      "Pursue starts the full pipeline; Dismiss archives it.",
      "Undecided items auto-dismiss when their timer expires.",
      "Click a card to read the full brief before deciding.",
    ],
  },
  "call-queue": {
    title: "Subcontractors ready to be called",
    points: [
      "Each card opens a workspace with a script and everything about the job.",
      "Fill in answers during the call; one save updates every record.",
      "A captured price automatically moves the bid forward.",
    ],
  },
  subs: {
    title: "Your growing subcontractor roster",
    points: [
      "Fills automatically as opportunities are pursued and subs are found.",
      "Reliability (0-100) reflects how consistently a sub responds and delivers.",
      "Click a company to see its full history, quotes, and notes.",
    ],
  },
  contracts: {
    title: "Work you've won",
    points: [
      "Track milestones, the 50% small-business rule, and performance reviews.",
      "Log coordination activities here; they prove you manage the work.",
      "Created automatically the moment you record a win.",
    ],
  },
  compliance: {
    title: "Stay eligible to bid",
    points: [
      "Registrations, certifications, and insurance are checked daily.",
      "Anything under 'Needs attention now' should be handled today.",
      "You get an SMS if something turns critical (when Twilio is connected).",
    ],
  },
  analytics: {
    title: "How your bidding is performing",
    points: [
      "Win rate and margins fill in as bids are decided.",
      "Breakdowns show where you win most; bid more there.",
      "The weekly learning agent uses this data to propose scoring tweaks.",
    ],
  },
  agents: {
    title: "The automation, fully transparent",
    points: [
      "Every agent action is logged here with its reasoning.",
      "Search or filter to find anything; use Run now to trigger an agent.",
      "Errors here explain why something didn't happen when expected.",
    ],
  },
  profile: {
    title: "The brain of the scoring system",
    points: [
      "Everything here feeds scoring: industry codes, certifications, thresholds.",
      "Auto-pursue controls how much runs without asking you.",
      "Approve proposed weight changes when the learning agent suggests them.",
    ],
  },
  integrations: {
    title: "Connect the services that power automation",
    points: [
      "Paste a key, press Test to verify it live, then Save.",
      "Keys are encrypted and shown only as a masked preview.",
      "Each card says what stops working without it.",
    ],
  },
  opportunity: {
    title: "The complete record for one bid",
    points: [
      "The banner up top always shows the recommended next step.",
      "The Submission package panel assembles every required file, validates it, and runs an independent compliance audit.",
      "Your job is to clear the items marked for you (signatures, provided docs) and submit — it's blocked until compliance passes.",
      "Attachments and the plain-English brief live together below.",
    ],
  },
};
