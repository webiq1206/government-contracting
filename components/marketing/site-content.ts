import { TRIAL_DAYS } from "@/lib/billing/catalog";
import { TRIAL_ALLOWANCE_COPY } from "@/lib/billing/trial-catalog";

export const MARKETING_LINKS = [
  { href: "/platform", label: "Platform" },
  { href: "/ai", label: "How AI works" },
  { href: "/demo", label: "Product tour" },
  { href: "/pricing-guide", label: "Pricing" },
] as const;
export const TRIAL_COPY = `${TRIAL_DAYS} days free. No credit card required. ${TRIAL_ALLOWANCE_COPY} Subscribe only when you choose.`;
export const USAGE_COPY =
  "Service usage is separate from your subscription. Use supported platform services with usage billing, or connect eligible API keys and pay those providers directly.";
export const HOME_FAQ = [
  [
    "Who is BrostCo for?",
    "Small and mid-size government contractors. Discovery follows your company profile and industry codes across the full industry catalog, with connected pursuit workflows especially useful for services teams coordinating subcontractors. It is most useful when reading requirements, chasing quotes, and preparing bids consume your team's time.",
  ],
  [
    "What does the AI actually do?",
    "After setup, AI finds and scores opportunities, reads solicitations, finds subcontractors, sends outreach and follow-ups, interprets replies, captures clearly stated prices, and prepares bid documents. Work runs through your connected services and automation rules. Your team handles calls, exceptions, quote confirmation, final pricing and contract review, signatures, and submission.",
  ],
  [
    "Does BrostCo submit bids for me?",
    "No. Your team reviews the requirements, pricing, and documents, completes signatures and attestations, and submits through the required agency channel. AI output needs review against the original solicitation.",
  ],
  [
    "What do I need to get started?",
    "Start with your company details and target work. Setup guides you through the connections your workflow needs, including SAM.gov access for discovery and your mailbox for outreach. Supported trial services have usage limits. Review connections and automation rules before enabling outreach.",
  ],
  [
    "What happens when the free trial ends?",
    `The ${TRIAL_DAYS}-day trial requires no card and does not automatically become a paid subscription. Choose a plan and complete checkout to continue with paid access. If you subscribe before the trial ends, review the payment schedule at checkout.`,
  ],
  [
    "Are AI and service costs included?",
    USAGE_COPY +
      " Your account shows usage, billing choices, and available limits. Platform usage is billed at confirmed provider cost plus 25% after you accept usage billing.",
  ],
  [
    "Does BrostCo replace SAM.gov or my team?",
    "SAM.gov remains the official source for federal opportunities and registration. BrostCo connects the work around those opportunities. Your team brings the relationships, business judgment, and final review.",
  ],
] as const;
export const WORKFLOW_STAGES = [
  {
    label: "Find",
    title: "AI finds contracts that fit your business.",
    copy: "BrostCo monitors opportunities and scores each one against your company profile. Strong matches move forward under your rules. Borderline opportunities come to you.",
    benefit: "A relevant pipeline, without sorting postings every morning.",
    human: "Set your target work once. Step in for borderline decisions.",
    done: "Opportunity found and matched",
    result: "Company profile → relevant opportunity",
    evidence: "Matched to services, location, and pursuit rules.",
  },
  {
    label: "Understand",
    title: "AI reads the solicitation for you.",
    copy: "BrostCo reads the notice and attachments, extracts the scope, dates, and requirements, and creates the working brief for the next steps.",
    benefit: "A usable brief, without rebuilding it from pages of documents.",
    human:
      "Resolve flagged questions and verify important requirements at review.",
    done: "Documents analyzed. Brief prepared.",
    result: "Solicitation → scope, dates, and requirements",
    evidence: "The extracted brief stays connected to its source material.",
  },
  {
    label: "Coordinate",
    title: "AI contacts subcontractors and follows up.",
    copy: "BrostCo finds candidates, sends quote requests through your connected mailbox, follows up, and processes replies using your automation rules.",
    benefit:
      "Conversations and quotes move forward without manual email chasing.",
    human:
      "Make the calls that need a person and confirm unclear quotes or qualifications.",
    done: "Outreach sent. Follow-ups handled.",
    result: "Trade requirements → outreach and quote replies",
    evidence:
      "Sent messages, follow-ups, and replies remain in the opportunity history.",
  },
  {
    label: "Prepare",
    title: "AI prepares the bid for your review.",
    copy: "Once required pricing is available, BrostCo combines quotes with your margin rules, drafts the documents, and checks the package for missing requirements.",
    benefit:
      "A prepared starting point for review, with the supporting work attached.",
    human:
      "Confirm pricing, review the bid and contract terms, sign, and submit.",
    done: "Pricing assembled. Bid documents drafted.",
    result: "Quotes + requirements → draft bid package",
    evidence:
      "Drafts and pricing are ready for your final checks. Submission stays with you.",
  },
  {
    label: "Track",
    title: "See what's done. Handle what needs you.",
    copy: "BrostCo keeps the background work moving and brings calls, exceptions, and reviews into Today with the context already attached.",
    benefit:
      "Start with the work that needs your judgment, not a search for updates.",
    human:
      "Handle the highlighted actions. Adjust your rules when priorities change.",
    done: "Routine work logged. Next actions prepared.",
    result: "Background activity → a focused action list",
    evidence: "Completed automation and human actions are visible separately.",
  },
] as const;
