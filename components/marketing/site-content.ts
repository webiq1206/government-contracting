import { TRIAL_DAYS } from "@/lib/billing/catalog";

export const MARKETING_LINKS = [
  { href: "/platform", label: "Platform" },
  { href: "/ai", label: "How AI works" },
  { href: "/demo", label: "Product tour" },
  { href: "/pricing-guide", label: "Pricing" },
] as const;
export const TRIAL_COPY = `${TRIAL_DAYS} days free. No credit card required. Subscribe only when you choose.`;
export const USAGE_COPY =
  "Service usage is separate from your subscription. Use supported platform services with usage billing, or connect eligible API keys and pay those providers directly.";
export const HOME_FAQ = [
  [
    "Who is BrostCo for?",
    "Small and mid-size federal services contractors, especially teams coordinating subcontractors across construction, facilities, and professional services. It is most useful when reading requirements, chasing quotes, and preparing bids consume your team's time.",
  ],
  [
    "What does the AI actually do?",
    "AI scores opportunities against your company profile, extracts scope and requirements, prepares outreach and call guidance, interprets replies, and helps assemble bid documents. Connected services and your automation rules determine which work can run. Your team checks important facts and handles final submission.",
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
    title: "Find work that fits your company.",
    copy: "BrostCo gathers federal opportunities and scores them against your services, qualifications, and pursuit rules.",
    benefit:
      "Spend less time sorting postings. Start with the reason a project fits.",
    human: "Review fit and decide which opportunities deserve your attention.",
  },
  {
    label: "Understand",
    title: "Turn a solicitation into a working brief.",
    copy: "AI extracts scope, dates, requirements, and questions from the solicitation so the team can work from a shared brief.",
    benefit:
      "See the work and its requirements without rebuilding the brief by hand.",
    human: "Check the source documents and resolve ambiguities before you act.",
  },
  {
    label: "Coordinate",
    title: "Keep quotes moving toward the bid.",
    copy: "Find subcontractors by trade, prepare outreach, track replies, and follow up through your connected mailbox and configured rules.",
    benefit:
      "See who replied, what is missing, and which conversation needs you.",
    human:
      "Confirm qualifications, resolve unclear replies, and make the calls that need a person.",
  },
  {
    label: "Prepare",
    title: "Build a bid your team can review.",
    copy: "Bring scope, quotes, pricing, requirements, and draft documents together in the opportunity workspace.",
    benefit:
      "Find missing information before final review becomes a last-minute scramble.",
    human:
      "Confirm pricing, review documents, complete signatures, and submit.",
  },
  {
    label: "Track",
    title: "Start the day with a clear next step.",
    copy: "Today brings decisions, replies, calls, blockers, and reviews together. Activity history records the work behind them.",
    benefit: "Pick up the right task with the context already attached.",
    human: "Work the queue and adjust automation when your priorities change.",
  },
] as const;
