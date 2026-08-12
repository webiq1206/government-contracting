import type { HelpContent } from "@/components/help-popover";

/**
 * Per-page help popover content. Keep each page to 3-4 short bullets:
 * what this is, what to do here, what runs on its own. The full journey
 * lives at /how-it-works, don't duplicate it here.
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
    title: "Subcontractors to call",
    points: [
      "Every sub we email becomes a card here so you can follow up by phone.",
      "Subs who replied are marked 'interested' and sorted to the top.",
      "Each card opens a workspace with a script and everything about the job.",
      "Fill in answers during the call; one save updates every record.",
      "Skip records that you chose not to call and removes the card from the queue.",
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
      "The system checks registrations, certifications, and insurance daily.",
      "Renewing is your job: open an item to set its date, link, and document.",
      "Set a renewal date and the board counts down and warns you.",
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
  authority: {
    title: "Grow your Domain Rating, hands-off",
    points: [
      "The Backlink Scout runs daily: it tracks your DR, finds prospects from competitors' links and their broken links, and looks up a free contact email for each.",
      "Spammy, off-topic, and unindexed sites are rejected automatically, only quality opportunities show here.",
      "Click Draft outreach on a prospect, review the message, then Approve. Nothing is ever sent until you approve it.",
      "Once approved, it emails from your connected Gmail and sends one polite follow-up. New and lost links are tracked automatically.",
    ],
  },
  "email-log": {
    title: "Every outreach email, exactly as sent",
    points: [
      "Shows every automated email sent to a subcontractor, newest first.",
      "Click any row to read the full message body as it was delivered.",
      "Open and click badges update when tracking pixels fire.",
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
  rules: {
    title: "Guardrails for the automation",
    points: [
      "Set how close a deadline must be to count as approaching or urgent.",
      "Skip solicitations that are due too soon to finish properly.",
      "Choose how long archived records are kept before cleanup.",
      "The preview shows how many records each rule would touch before you save.",
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
  content: {
    title: "Emails and proposal language Brost Co reuses",
    points: [
      "Emails to subcontractors: edit the outreach and follow-up messages the system sends.",
      "Proposal snippets: short paragraphs (past work, what you can do, why choose you) that get drafted into bids.",
      "Tag snippets with trades, agencies, or NAICS so the right paragraph is chosen automatically.",
    ],
  },
  opportunity: {
    title: "The complete record for one bid",
    points: [
      "Jump links hop to Attention, Coverage, Brief, Quotes, Subs, Score, and Activity.",
      "What needs attention and trade coverage sit near the top so you can scan blockers first.",
      "The Subs panel shows who was found, contact status, emails/calls, next action, and history for this bid.",
      "The banner always shows the recommended next step; submission stays blocked until compliance passes.",
    ],
  },
  "how-it-works": {
    title: "The full Brost Co sequence",
    points: [
      "Every step from setup through win/loss is listed here in order.",
      "Green steps need you; gray steps run automatically; others wait on subs or the agency.",
      "Day to day, use Today. This page is the map, not the to-do list.",
    ],
  },
};
