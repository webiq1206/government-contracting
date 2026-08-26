/**
 * Context-aware page guidance. Pure: turns pathname + live account/workflow
 * facts into the same story the operator sees in the Guide Me panel.
 * Today answers "what needs me across Brost Co?"; this answers "what do I
 * need to know or do on this page?" Both reuse setup, action-center counts,
 * deriveStep, and bid readiness so they never disagree.
 */

import type { HelpContent } from "@/components/help-popover";
import { PAGE_HELP } from "@/lib/help-content";
import { GLOSSARY } from "@/lib/domain/glossary";
import { buildWorkLedger } from "@/lib/domain/work-ledger";
import {
  deriveStep,
  journeySteps,
  stageLabel,
  type NextStep,
  type StepInput,
} from "@/lib/domain/journey";
import type { AttentionItem, BidReadiness } from "@/lib/domain/bid-readiness";
import type { SetupChecklist, SetupItem } from "@/lib/domain/setup";

export type GuidePageKey =
  | "today"
  | "pipeline"
  | "review"
  | "call-queue"
  | "subs"
  | "sub"
  | "opportunity"
  | "contracts"
  | "compliance"
  | "analytics"
  | "authority"
  | "email-log"
  | "agents"
  | "how-it-works"
  | "profile"
  | "rules"
  | "integrations"
  | "content"
  | "billing"
  | "unknown";

export type GuideOwner = "you" | "brost" | "subs" | "agency";

export type GuideActionKind =
  | "link"
  | "highlight"
  | "triage"
  | "outcome"
  | "setup-identity"
  | "setup-naics"
  | "setup-areas"
  | "enter-quote"
  | "open-call"
  | "edit-sub-contact"
  | "compliance-update"
  | "resume-automation"
  | "approve-weights"
  | "review-quote"
  | "upload-document"
  | "submit-package"
  | "none";

export interface GuideStep {
  id: string;
  title: string;
  why: string;
  after?: string;
  cta: string;
  href?: string;
  /** Page-local target: CSS id or data-guide-target value. */
  target?: string;
  tone: "action" | "warn" | "info";
  owner: GuideOwner;
  kind: GuideActionKind;
  source: "setup" | "today" | "journey" | "readiness" | "page";
  decision?: "triage" | "outcome";
  opportunityId?: string;
  setupKey?: string;
  /** Adapter payload keys resolved by the API/UI (call card, compliance item, etc.). */
  adapter?:
    | "quote"
    | "call"
    | "followUp"
    | "compliance"
    | "weights"
    | "subContact"
    | "quoteReview"
    | "package"
    | "upload";
}

/** Live payloads so the wizard can complete work without scavenger hunts. */
export interface GuideAdapters {
  quote?: {
    opportunityId: string;
    subs: { subcontractor_id: string; company_name: string; trade: string | null }[];
  };
  call?: { cardId: string; companyName: string; opportunityTitle: string | null };
  followUp?: {
    opportunityId: string;
    subcontractorId: string;
    companyName: string;
    phone: string | null;
    trade: string | null;
    opportunityTitle: string | null;
  };
  compliance?: {
    id: string;
    label: string;
    status: string;
    dueAt: string | null;
  };
  weights?: { id: string; version: number; rationale: string | null };
  subContact?: {
    id: string;
    companyName: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    ownerName: string | null;
  };
  quoteReview?: {
    quoteId: string;
    opportunityId: string;
    opportunityTitle: string | null;
    companyName: string | null;
    trade: string | null;
    quoteAmount: number | null;
  };
  package?: {
    opportunityId: string;
    packageReady: boolean | null;
    blockers: string[];
    submitted: boolean;
  };
  upload?: {
    opportunityId: string;
  };
}

export interface GuideTerm {
  key: string;
  label: string;
  tip: string;
}

export interface GuideScoreExplain {
  total: number;
  summary: string;
  factors: { label: string; points: number; max: number; reasoning: string }[];
}

export interface ActionSummary {
  urgent: number;
  triage: number;
  calls: number;
  bidWork: number;
  subFollowUps: number;
  quoteReviews: number;
  compliance: number;
  approvals: number;
  totalActions: number;
  /** First deep link matching Today's priority order. */
  firstHref?: string;
  firstLabel?: string;
  firstTriageOpportunityId?: string;
  firstBidWorkOpportunityId?: string;
  firstUrgentOpportunityId?: string;
}

export interface OpportunityGuideFacts {
  id: string;
  title: string | null;
  stage: string;
  score: number | null;
  deadline: string | null;
  stepInput: StepInput;
  readiness?: Pick<
    BidReadiness,
    "percent" | "summary" | "attention" | "complete" | "actionRequired" | "blocked"
  >;
  scoreExplain?: GuideScoreExplain | null;
  packageReady?: boolean | null;
  packageBlockers?: string[];
  bidSubmitted?: boolean;
}

export interface SubGuideFacts {
  id: string;
  companyName: string;
  contactStatus: string | null;
  email: string | null;
  phone: string | null;
  openJobs: number;
  lastTouchAt: string | null;
  pendingOutreach: { opportunityId: string; title: string | null; state: string | null }[];
  missingContact: boolean;
}

export interface GuideContextInput {
  pathname: string;
  setup: SetupChecklist;
  actions: ActionSummary;
  automationPaused?: boolean;
  experience: "new" | "familiar";
  opportunity?: OpportunityGuideFacts | null;
  sub?: SubGuideFacts | null;
}

export interface PageGuide {
  pageKey: GuidePageKey;
  pathname: string;
  experience: "new" | "familiar";
  headline: string;
  situation: string;
  stageLabel?: string;
  scoreLine?: string;
  completed: string[];
  needsAttention: string[];
  brostHandling: string[];
  whatHappensNext: string | null;
  steps: GuideStep[];
  idle: boolean;
  pageExplain: HelpContent | null;
  terms: GuideTerm[];
  scoreExplain: GuideScoreExplain | null;
  badgeCount: number;
  opportunityId?: string;
  subId?: string;
  automationPaused: boolean;
}

const PAGE_TERM_KEYS: Partial<Record<GuidePageKey, string[]>> = {
  opportunity: [
    "score",
    "stage",
    "uei",
    "naics",
    "set_aside",
    "sub_coverage",
    "package_ready",
    "follow_up_due",
  ],
  profile: ["uei", "cage", "naics", "psc", "set_aside"],
  review: ["score", "tier_review", "tier_pursue"],
  "call-queue": ["call_queue", "outreach_state", "quote_entry"],
  subs: ["contact_status", "outreach_state"],
  sub: ["contact_status", "outreach_state", "follow_up_due"],
  compliance: ["package_ready"],
  pipeline: ["stage", "workflow"],
  today: ["stage", "follow_up_due"],
  billing: [],
};

const TERM_LABELS: Record<string, string> = {
  uei: "UEI",
  cage: "CAGE",
  naics: "NAICS",
  psc: "PSC",
  set_aside: "Set-aside",
  score: "Opportunity score",
  tier_pursue: "Pursue tier",
  tier_review: "Review tier",
  stage: "Pipeline stage",
  workflow: "Workflow",
  call_queue: "Call Queue",
  quote_entry: "Quote entry",
  outreach_state: "Outreach state",
  contact_status: "Contact status",
  package_ready: "Package ready",
  follow_up_due: "Follow-up due",
  sub_coverage: "Sub coverage",
};

export function pageKeyFromPath(pathname: string): GuidePageKey {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/today") return "today";
  if (p === "/pipeline") return "pipeline";
  if (p === "/review") return "review";
  if (p === "/call-queue") return "call-queue";
  if (p === "/subs") return "subs";
  if (/^\/subs\/[^/]+$/.test(p)) return "sub";
  if (/^\/opportunity\/[^/]+$/.test(p)) return "opportunity";
  if (p === "/contracts") return "contracts";
  if (p === "/compliance") return "compliance";
  if (p === "/analytics") return "analytics";
  if (p === "/authority") return "authority";
  if (p === "/communications" || p === "/email-log") return "email-log";
  if (p === "/agents") return "agents";
  if (p === "/how-it-works") return "how-it-works";
  if (p === "/settings/profile") return "profile";
  if (p === "/settings/rules") return "rules";
  if (p === "/settings/integrations") return "integrations";
  if (p === "/settings/content") return "content";
  if (p === "/settings/billing") return "billing";
  return "unknown";
}

export function opportunityIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/opportunity\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

export function subIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/subs\/([0-9a-f-]{36})/i);
  return m?.[1] ?? null;
}

function rowId(row: unknown): string | undefined {
  if (!row || typeof row !== "object") return undefined;
  const id = (row as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

export function summarizeActions(data: {
  urgent: unknown[];
  triage: unknown[];
  calls: { count: number };
  bidWork: unknown[];
  subFollowUps: unknown[];
  quoteReviews: unknown[];
  complianceAlerts: unknown[];
  awardCompliance?: unknown[];
  proposedWeights: unknown[];
  backlinkApprovals: number;
  /**
   * Uncapped counts of the same buckets, when the caller has them. The lists
   * above are page-sized; these are how much work there is.
   */
  totals?: {
    triage: number;
    bidWork: number;
    urgent: number;
    flagged: number;
    subFollowUps: number;
    quoteReviews: number;
    replyReviews: number;
  };
}): ActionSummary {
  const approvals = data.proposedWeights.length + data.backlinkApprovals;
  /*
   * The total comes from the shared ledger, not from adding these lists up.
   *
   * This function summed its own eight buckets while Today summed a different
   * eleven, so the guide panel and the page it floated over quoted different
   * numbers for the same account -- 46 against 56 -- and neither was right,
   * because several of these lists are capped at ten rows and were reporting
   * the cap. `totals` carries the real counts when the caller has them.
   */
  const t = data.totals;
  const ledger = buildWorkLedger({
    urgent: t?.urgent ?? data.urgent.length,
    replyReviews: t?.replyReviews ?? 0,
    triage: t?.triage ?? data.triage.length,
    calls: data.calls.count,
    bidWork: t?.bidWork ?? data.bidWork.length,
    quoteReviews: t?.quoteReviews ?? data.quoteReviews.length,
    subFollowUps: t?.subFollowUps ?? data.subFollowUps.length,
    compliance: data.complianceAlerts.length,
    awardCompliance: data.awardCompliance?.length ?? 0,
    flagged: t?.flagged ?? 0,
    approvals,
  });
  const totalActions = ledger.total;

  let firstHref: string | undefined;
  let firstLabel: string | undefined;
  if (data.urgent.length > 0) {
    firstHref = "/today#urgent";
    firstLabel = "Handle urgent deadlines";
  } else if (data.triage.length > 0) {
    firstHref = "/review";
    firstLabel = "Decide pursue or pass";
  } else if (data.calls.count > 0) {
    firstHref = "/call-queue";
    firstLabel = "Work the Call Queue";
  } else if (data.subFollowUps.length > 0) {
    firstHref = "/today#follow-ups";
    firstLabel = "Follow up with subcontractors";
  } else if (data.quoteReviews.length > 0) {
    firstHref = "/today#quotes";
    firstLabel = "Review out-of-range quotes";
  } else if (data.bidWork.length > 0) {
    firstHref = "/today#bid-work";
    firstLabel = "Continue bid work";
  } else if (data.complianceAlerts.length > 0) {
    firstHref = "/compliance";
    firstLabel = "Clear compliance alerts";
  } else if (approvals > 0) {
    firstHref = "/today";
    firstLabel = "Review pending approvals";
  }

  return {
    urgent: data.urgent.length,
    triage: data.triage.length,
    calls: data.calls.count,
    bidWork: data.bidWork.length,
    subFollowUps: data.subFollowUps.length,
    quoteReviews: data.quoteReviews.length,
    compliance: data.complianceAlerts.length,
    approvals,
    totalActions,
    firstHref,
    firstLabel,
    firstTriageOpportunityId: rowId(data.triage[0]),
    firstBidWorkOpportunityId: rowId(data.bidWork[0]),
    firstUrgentOpportunityId: rowId(data.urgent[0]),
  };
}

function helpFor(pageKey: GuidePageKey): HelpContent | null {
  if (pageKey === "sub") return PAGE_HELP.subs ?? null;
  if (pageKey === "billing") {
    return {
      title: "Billing and subscription",
      points: [
        "Your plan keeps Brost Co automation and storage active for your organization.",
        "Use the portal to update payment methods or view invoices.",
        "After checkout, finish your company profile so scoring and outreach can run.",
      ],
    };
  }
  if (pageKey === "unknown") return null;
  return PAGE_HELP[pageKey] ?? null;
}

function termsFor(pageKey: GuidePageKey, extra?: GuideTerm[]): GuideTerm[] {
  const keys = PAGE_TERM_KEYS[pageKey] ?? [];
  const base = keys
    .map((key) => {
      const tip = GLOSSARY[key];
      if (!tip) return null;
      return { key, label: TERM_LABELS[key] ?? key, tip };
    })
    .filter((t): t is GuideTerm => Boolean(t));
  return [...(extra ?? []), ...base].slice(0, 8);
}

function ownerFromParty(waitingOn: NextStep["waitingOn"]): GuideOwner {
  if (waitingOn === "you") return "you";
  if (waitingOn === "subs") return "subs";
  if (waitingOn === "agency") return "agency";
  return "brost";
}

function setupStep(item: SetupItem): GuideStep {
  let kind: GuideActionKind = "link";
  let cta = "Open settings";
  if (item.key === "identity") {
    kind = "setup-identity";
    cta = "Complete identifiers";
  } else if (item.key === "naics") {
    kind = "setup-naics";
    cta = "Pick NAICS codes";
  } else if (item.key === "service_areas") {
    kind = "setup-areas";
    cta = "Set service areas";
  }
  return {
    id: `setup-${item.key}`,
    title: item.label,
    why: item.hint,
    cta,
    href: item.href,
    target: item.key === "identity" ? "identity" : item.key,
    tone: "action",
    owner: "you",
    kind,
    source: "setup",
    setupKey: item.key,
  };
}

function stepFromNext(
  ns: NextStep,
  opportunityId: string,
  stage: string,
  callsEnabled = true
): GuideStep {
  const target = ns.anchor?.replace(/^#/, "") || undefined;
  let kind: GuideActionKind = "none";
  let adapter: GuideStep["adapter"];
  if (ns.decision === "triage") kind = "triage";
  else if (ns.decision === "outcome") kind = "outcome";
  else if (ns.cta === "Resume automation" || ns.href === "/agents") {
    kind = "resume-automation";
  } else if (
    target === "submission" ||
    /submit|submission package/i.test(ns.title)
  ) {
    kind = "submit-package";
    adapter = "package";
  } else if (
    stage === "quote_entry" ||
    target === "quotes" ||
    target === "coverage" ||
    /quote|pricing/i.test(ns.title)
  ) {
    kind = "enter-quote";
    adapter = "quote";
  } else if (callsEnabled && (stage === "call_queue" || ns.href === "/call-queue")) {
    // With calling off there is no call to open, not even for a record left
    // on the call stage from before the preference changed.
    kind = "open-call";
    adapter = "call";
  } else if (ns.href) kind = "link";
  else if (target) kind = "highlight";

  return {
    id: `journey-${ns.title.slice(0, 40)}`,
    title: ns.title,
    why: ns.why,
    after: ns.after,
    cta: ns.cta || (kind === "highlight" ? "Show me where" : kind === "none" ? "" : "Continue"),
    href: ns.href,
    target,
    tone: ns.tone,
    owner: ownerFromParty(ns.waitingOn),
    kind,
    source: "journey",
    decision: ns.decision,
    opportunityId,
    adapter,
  };
}

function stepFromAttention(item: AttentionItem, opportunityId: string): GuideStep {
  const target =
    item.action?.href?.replace(/^#/, "") ||
    item.href?.replace(/^#/, "") ||
    "attention";
  const owner: GuideOwner =
    item.who === "brost" ? "brost" : item.who === "either" ? "you" : "you";
  const isPageLocal = !item.action?.href?.startsWith("/") && !item.href?.startsWith("/");
  const modal = item.action?.modal;
  let kind: GuideActionKind =
    owner === "brost" ? "none" : isPageLocal ? "highlight" : "link";
  let adapter: GuideStep["adapter"];
  if (owner === "you" && (modal === "enter-quote" || modal === "contact-trade")) {
    kind = "enter-quote";
    adapter = "quote";
  } else if (owner === "you" && (modal === "upload" || modal === "review-missing")) {
    kind = "upload-document";
    adapter = "upload";
  }
  return {
    id: `attn-${item.key}`,
    title: item.label,
    why: item.why + (item.how ? ` ${item.how}` : ""),
    cta: item.action?.label ?? (owner === "brost" ? "" : "Show me where"),
    href: item.action?.href?.startsWith("/")
      ? item.action.href
      : item.href?.startsWith("/")
        ? item.href
        : `/opportunity/${opportunityId}`,
    target: isPageLocal ? target : undefined,
    tone: item.severity === "warn" ? "warn" : item.severity === "info" ? "info" : "action",
    owner,
    kind,
    source: "readiness",
    opportunityId,
    adapter,
  };
}

function dedupeSteps(steps: GuideStep[]): GuideStep[] {
  const seen = new Set<string>();
  const out: GuideStep[] = [];
  for (const s of steps) {
    const key = `${s.source}:${s.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function prioritizeSteps(steps: GuideStep[]): GuideStep[] {
  const rank = (s: GuideStep) => {
    if (s.owner !== "you") return 50;
    if (s.source === "setup") return 0;
    if (s.tone === "warn") return 1;
    if (s.source === "journey") return 2;
    if (s.source === "readiness") return 3;
    if (s.source === "today") return 4;
    return 10;
  };
  return [...steps].sort((a, b) => rank(a) - rank(b));
}

function pageScopedTodaySteps(
  pageKey: GuidePageKey,
  actions: ActionSummary,
  automationPaused: boolean
): GuideStep[] {
  const steps: GuideStep[] = [];
  if (automationPaused) {
    steps.push({
      id: "automation-paused",
      title: "Automation is paused",
      why: "Brost Co will not move opportunities forward until you resume the master switch.",
      after: "Resuming picks up each record where it left off.",
      cta: "Resume automation",
      href: "/agents",
      tone: "warn",
      owner: "you",
      kind: "resume-automation",
      source: "page",
    });
  }

  const pushBucket = (
    count: number,
    id: string,
    title: string,
    why: string,
    href: string,
    opts?: {
      kind?: GuideActionKind;
      adapter?: GuideStep["adapter"];
      opportunityId?: string;
      cta?: string;
    }
  ) => {
    if (count <= 0) return;
    steps.push({
      id,
      title: count === 1 ? title : `${title} (${count})`,
      why,
      cta: opts?.cta ?? "Open",
      href,
      tone: "action",
      owner: "you",
      kind: opts?.kind ?? "link",
      source: "today",
      adapter: opts?.adapter,
      opportunityId: opts?.opportunityId,
    });
  };

  if (pageKey === "today" || pageKey === "unknown") {
    pushBucket(
      actions.urgent,
      "today-urgent",
      "Urgent deadlines need attention",
      "These opportunities are due soon and are not submitted yet.",
      actions.firstUrgentOpportunityId
        ? `/opportunity/${actions.firstUrgentOpportunityId}`
        : "/today#urgent",
      { opportunityId: actions.firstUrgentOpportunityId }
    );
    pushBucket(
      actions.triage,
      "today-triage",
      "Decide pursue or pass",
      "Borderline scores wait on your judgment before automation continues.",
      "/review",
      {
        kind: "triage",
        opportunityId: actions.firstTriageOpportunityId,
        cta: "Decide here",
      }
    );
    pushBucket(
      actions.calls,
      "today-calls",
      "Call subcontractors",
      "Prepared call cards are waiting so you can capture prices by phone.",
      "/call-queue",
      { kind: "open-call", adapter: "call", cta: "Start the next call" }
    );
    pushBucket(
      actions.subFollowUps,
      "today-followups",
      "Follow up with subcontractors",
      "Automated outreach finished without a reply; a human nudge is next.",
      "/today#follow-ups",
      { kind: "open-call", adapter: "followUp", cta: "Follow up now" }
    );
    pushBucket(
      actions.quoteReviews,
      "today-quotes",
      "Review unusual quotes",
      "Some prices look high or low versus comps and need a quick check.",
      "/today#quotes",
      { kind: "review-quote", adapter: "quoteReview", cta: "Review quote" }
    );
    pushBucket(
      actions.bidWork,
      "today-bid",
      "Continue bid work",
      "Quotes or package review are waiting on these opportunities.",
      actions.firstBidWorkOpportunityId
        ? `/opportunity/${actions.firstBidWorkOpportunityId}`
        : "/today#bid-work",
      {
        kind: "enter-quote",
        adapter: "quote",
        opportunityId: actions.firstBidWorkOpportunityId,
        cta: "Enter a quote",
      }
    );
    pushBucket(
      actions.compliance,
      "today-compliance",
      "Clear compliance alerts",
      "Registrations or renewals need dates, documents, or follow-through.",
      "/compliance",
      { kind: "compliance-update", adapter: "compliance", cta: "Update renewal" }
    );
    pushBucket(
      actions.approvals,
      "today-approvals",
      "Review pending approvals",
      "Scoring weight or backlink drafts need your approve or reject.",
      "/today",
      { kind: "approve-weights", adapter: "weights", cta: "Review proposal" }
    );
  }

  if (pageKey === "review" && actions.triage > 0) {
    steps.push({
      id: "review-triage",
      title: `${actions.triage} opportunit${actions.triage === 1 ? "y" : "ies"} awaiting your decision`,
      why: "Pursue starts analysis and sub research; dismiss archives the record.",
      cta: "Decide on the next one",
      href: "/review",
      target: "review-list",
      tone: "action",
      owner: "you",
      kind: "triage",
      source: "today",
      opportunityId: actions.firstTriageOpportunityId,
    });
  }

  if (pageKey === "call-queue" && actions.calls > 0) {
    steps.push({
      id: "calls-ready",
      title: `${actions.calls} call${actions.calls === 1 ? "" : "s"} ready`,
      why: "Each card opens a guided workspace with a script and quote capture.",
      cta: "Start the next call",
      href: "/call-queue",
      target: "call-queue",
      tone: "action",
      owner: "you",
      kind: "open-call",
      adapter: "call",
      source: "today",
    });
  }

  if (pageKey === "compliance" && actions.compliance > 0) {
    steps.push({
      id: "compliance-alerts",
      title: `${actions.compliance} item${actions.compliance === 1 ? "" : "s"} need attention`,
      why: "Warning and critical renewals can block eligibility to bid.",
      cta: "Update the next item",
      href: "/compliance",
      target: "compliance-attention",
      tone: "warn",
      owner: "you",
      kind: "compliance-update",
      adapter: "compliance",
      source: "today",
    });
  }

  if (pageKey === "pipeline" && actions.totalActions > 0 && actions.firstHref) {
    steps.push({
      id: "pipeline-focus",
      title: actions.firstLabel ?? "Work the highest-priority item",
      why: "Pipeline shows every stage; Today and this guide surface what needs you first.",
      cta: "Go there",
      href: actions.firstHref,
      tone: "action",
      owner: "you",
      kind: "link",
      source: "today",
    });
  }

  return steps;
}

function buildOpportunityGuide(input: GuideContextInput): Omit<
  PageGuide,
  "pageKey" | "pathname" | "experience" | "pageExplain" | "terms" | "automationPaused"
> {
  const opp = input.opportunity!;
  const ns = deriveStep(opp.stepInput);
  // Same preference the banner reads, so the guide never walks the operator to
  // a call step the account has turned off.
  const journey = journeySteps(opp.stage, {
    callsEnabled: opp.stepInput.callsEnabled !== false,
  });
  const completed = journey.filter((j) => j.status === "done").map((j) => j.label);
  const current = journey.find((j) => j.status === "current");

  const needsAttention: string[] = [];
  const brostHandling: string[] = [];
  const steps: GuideStep[] = [];

  if (ns) {
    const g = stepFromNext(ns, opp.id, opp.stage, opp.stepInput.callsEnabled !== false);
    if (g.owner === "you") {
      needsAttention.push(ns.title);
      steps.push(g);
    } else if (g.owner === "brost") {
      brostHandling.push(ns.why);
    } else if (g.owner === "subs") {
      brostHandling.push(ns.why);
      if (g.cta) steps.push({ ...g, owner: "you", tone: "info" });
    } else {
      needsAttention.push(ns.title);
      if (g.kind !== "none") steps.push(g);
    }
  }

  const readiness = opp.readiness;
  if (readiness) {
    for (const item of readiness.blocked) {
      needsAttention.push(item.label);
      if (item.who !== "brost") steps.push(stepFromAttention(item, opp.id));
      else brostHandling.push(item.label);
    }
    for (const item of readiness.actionRequired) {
      if (item.who === "brost") {
        brostHandling.push(item.label);
        continue;
      }
      needsAttention.push(item.label);
      steps.push(stepFromAttention(item, opp.id));
    }
    for (const item of readiness.complete.slice(0, 6)) {
      if (!completed.includes(item.label)) completed.push(item.label);
    }
  }

  if (
    opp.stepInput.hasBid &&
    !opp.bidSubmitted &&
    !steps.some((s) => s.kind === "submit-package")
  ) {
    steps.push({
      id: "submit-package",
      title: opp.packageReady
        ? "Review and submit the package"
        : "Clear blockers, then submit the package",
      why: opp.packageReady
        ? "The package is marked ready. Confirm and submit when you are satisfied."
        : (opp.packageBlockers?.slice(0, 2).join(" ") ||
          "Submission stays locked until required items are cleared."),
      cta: "Submit package",
      href: `/opportunity/${opp.id}#submission`,
      target: "submission",
      tone: opp.packageReady ? "action" : "warn",
      owner: "you",
      kind: "submit-package",
      adapter: "package",
      source: "page",
      opportunityId: opp.id,
    });
  }

  if (
    readiness?.actionRequired.some((a) => a.action?.modal === "upload") &&
    !steps.some((s) => s.kind === "upload-document")
  ) {
    steps.push({
      id: "upload-doc",
      title: "Upload a required document",
      why: "Some submission items only you can supply. Upload the file here.",
      cta: "Upload document",
      href: `/opportunity/${opp.id}#attachments`,
      target: "attachments",
      tone: "action",
      owner: "you",
      kind: "upload-document",
      adapter: "upload",
      source: "page",
      opportunityId: opp.id,
    });
  }

  const prioritized = prioritizeSteps(dedupeSteps(steps)).filter((s) => s.owner === "you");
  const idle = prioritized.length === 0;
  const title = opp.title?.trim() || "this opportunity";

  let situation = `You are reviewing ${title}.`;
  if (current) situation += ` Current stage: ${stageLabel(opp.stage)}.`;
  if (readiness?.summary) situation += ` ${readiness.summary}`;

  let whatHappensNext: string | null = null;
  if (ns?.after) whatHappensNext = ns.after;
  else if (idle && brostHandling.length)
    whatHappensNext = "Brost Co will continue automatically when the next response or agent run finishes.";
  else if (idle)
    whatHappensNext = "Nothing is blocked on this page right now.";

  if (idle && !needsAttention.length && brostHandling.length === 0) {
    needsAttention.push("Everything on this opportunity is current.");
  }

  return {
    headline: idle
      ? ns?.waitingOn === "system" || ns?.waitingOn === "subs"
        ? "No action needed here right now"
        : "You are caught up on this opportunity"
      : prioritized.length === 1
        ? "1 action remains on this opportunity"
        : `${prioritized.length} actions remain on this opportunity`,
    situation,
    stageLabel: stageLabel(opp.stage),
    scoreLine:
      opp.score != null
        ? `Score ${Math.round(opp.score)}${opp.scoreExplain?.summary ? `: ${opp.scoreExplain.summary}` : ""}`
        : undefined,
    completed: completed.slice(0, 8),
    needsAttention: Array.from(new Set(needsAttention)).slice(0, 8),
    brostHandling: Array.from(new Set(brostHandling)).slice(0, 6),
    whatHappensNext,
    steps: prioritized.slice(0, 6),
    idle,
    scoreExplain: opp.scoreExplain ?? null,
    badgeCount: prioritized.length,
    opportunityId: opp.id,
  };
}

function buildSubGuide(input: GuideContextInput): Omit<
  PageGuide,
  "pageKey" | "pathname" | "experience" | "pageExplain" | "terms" | "automationPaused" | "scoreExplain"
> {
  const sub = input.sub!;
  const steps: GuideStep[] = [];
  const needsAttention: string[] = [];
  const completed: string[] = [];
  const brostHandling: string[] = [];

  if (sub.email) completed.push("Email on file");
  if (sub.phone) completed.push("Phone on file");
  if (sub.contactStatus === "verified") completed.push("Email verified");

  if (sub.missingContact) {
    needsAttention.push("Contact details are incomplete");
    steps.push({
      id: "sub-contact",
      title: "Add missing contact details",
      why: "Outreach and Call Queue need a working email or phone to reach this company.",
      cta: "Complete contact",
      href: `/subs/${sub.id}`,
      target: "sub-contact",
      tone: "action",
      owner: "you",
      kind: "edit-sub-contact",
      adapter: "subContact",
      source: "page",
    });
  }

  for (const p of sub.pendingOutreach.slice(0, 3)) {
    needsAttention.push(
      `Follow up on ${p.title ?? "an open opportunity"} (${p.state ?? "pending"})`
    );
    steps.push({
      id: `sub-opp-${p.opportunityId}`,
      title: `Continue work on ${p.title ?? "open opportunity"}`,
      why: "This sub is still paired to an active bid. Open the opportunity to call, follow up, or enter a quote.",
      cta: "Open opportunity",
      href: `/opportunity/${p.opportunityId}`,
      tone: "action",
      owner: "you",
      kind: "link",
      source: "page",
      opportunityId: p.opportunityId,
    });
  }

  if (sub.openJobs === 0 && steps.length === 0) {
    brostHandling.push(
      "No open opportunity pairings need you on this record. Brost Co will attach this sub again when a matching trade appears."
    );
  }

  const prioritized = prioritizeSteps(dedupeSteps(steps));
  const idle = prioritized.length === 0;

  return {
    headline: idle
      ? "Nothing required on this subcontractor"
      : prioritized.length === 1
        ? "1 action on this subcontractor"
        : `${prioritized.length} actions on this subcontractor`,
    situation: `You are viewing ${sub.companyName}.${
      sub.openJobs > 0 ? ` Linked to ${sub.openJobs} open job${sub.openJobs === 1 ? "" : "s"}.` : ""
    }`,
    completed,
    needsAttention: needsAttention.length
      ? needsAttention
      : idle
        ? ["Everything on this record is current."]
        : [],
    brostHandling,
    whatHappensNext: idle
      ? "Use this page to review history, notes, and past quotes when a new opportunity pairs them."
      : "Completing contact or opportunity follow-up unblocks outreach and pricing.",
    steps: prioritized.slice(0, 5),
    idle,
    badgeCount: prioritized.length,
    subId: sub.id,
  };
}

function buildSetupOrPageGuide(input: GuideContextInput): Omit<
  PageGuide,
  "pageKey" | "pathname" | "experience" | "pageExplain" | "terms" | "automationPaused" | "scoreExplain"
> {
  const pageKey = pageKeyFromPath(input.pathname);
  const incomplete = input.setup.items.filter((i) => !i.done);
  const steps: GuideStep[] = [];

  if (!input.setup.complete) {
    // On setup-related pages, guide through remaining checklist. Elsewhere,
    // still surface setup as the top blocker so new users are not stranded.
    const setupPages: GuidePageKey[] = [
      "today",
      "profile",
      "integrations",
      "unknown",
      "billing",
      "how-it-works",
    ];
    if (setupPages.includes(pageKey) || incomplete.length > 0) {
      for (const item of incomplete) {
        if (
          pageKey === "profile" &&
          !["identity", "naics", "service_areas", "certifications"].includes(item.key)
        )
          continue;
        if (
          pageKey === "integrations" &&
          !["sam", "claude", "googleMaps", "email"].includes(item.key)
        )
          continue;
        steps.push(setupStep(item));
      }
    }
  }

  steps.push(...pageScopedTodaySteps(pageKey, input.actions, Boolean(input.automationPaused)));

  // Profile page with setup done: idle useful context.
  if (pageKey === "profile" && input.setup.complete) {
    steps.push({
      id: "profile-review",
      title: "Keep scoring inputs accurate",
      why: "NAICS, certifications, and service areas decide which opportunities fit and how they score.",
      cta: "Review profile sections",
      href: "/settings/profile",
      target: "profile",
      tone: "info",
      owner: "you",
      kind: "highlight",
      source: "page",
    });
  }

  if (pageKey === "agents" && input.automationPaused) {
    // already added
  } else if (pageKey === "agents") {
    steps.push({
      id: "agents-log",
      title: "Check recent agent activity",
      why: "The log shows what Brost Co did, why, and any errors that stopped a stage.",
      cta: "Show the log",
      href: "/agents",
      target: "agent-log",
      tone: "info",
      owner: "you",
      kind: "highlight",
      source: "page",
    });
  }

  const prioritized = prioritizeSteps(dedupeSteps(steps));
  // Drop optional "info" tips when real actions exist (except for new users on explain-heavy pages).
  const humanActions = prioritized.filter(
    (s) => s.owner === "you" && s.tone !== "info" && s.kind !== "none"
  );
  const finalSteps =
    humanActions.length > 0
      ? humanActions
      : prioritized.filter((s) => s.owner === "you").slice(0, 3);

  const idle = finalSteps.every((s) => s.tone === "info") || finalSteps.length === 0;
  const actionSteps = finalSteps.filter((s) => s.tone !== "info");

  const completed = input.setup.items.filter((i) => i.done).map((i) => i.label);
  const needsAttention = actionSteps.map((s) => s.title);
  const brostHandling: string[] = [];
  if (input.setup.complete && input.actions.totalActions === 0 && !input.automationPaused) {
    brostHandling.push(
      "Brost Co is monitoring solicitations, scoring fits, and advancing open opportunities."
    );
  }
  if (input.automationPaused) {
    brostHandling.push("Scheduled agents are held until you resume automation.");
  }

  let headline: string;
  if (!input.setup.complete) {
    headline = `${incomplete.length} setup step${incomplete.length === 1 ? "" : "s"} left`;
  } else if (actionSteps.length > 0) {
    headline =
      actionSteps.length === 1
        ? "1 action needs you here"
        : `${actionSteps.length} actions need you here`;
  } else {
    headline = "Nothing required on this page";
  }

  const help = helpFor(pageKey);
  const situation =
    pageKey === "today"
      ? input.actions.totalActions > 0
        ? `Today lists ${input.actions.totalActions} item${input.actions.totalActions === 1 ? "" : "s"} that need you across Brost Co.`
        : "Today is clear. Brost Co is handling the active pipeline."
      : help
        ? `${help.title}.`
        : "You are in Brost Co.";

  return {
    headline,
    situation,
    completed: completed.slice(0, 8),
    needsAttention: needsAttention.length
      ? needsAttention.slice(0, 8)
      : idle
        ? ["Everything here is current."]
        : [],
    brostHandling,
    whatHappensNext:
      actionSteps[0]?.after ??
      (idle
        ? "When something needs you, it will appear on Today and in this guide."
        : null),
    steps: (idle ? finalSteps : actionSteps).slice(0, 6),
    idle: actionSteps.length === 0,
    badgeCount: actionSteps.length || (!input.setup.complete ? incomplete.length : 0),
  };
}

/** Build the full guide payload for the current page. */
export function buildPageGuide(input: GuideContextInput): PageGuide {
  const pageKey = pageKeyFromPath(input.pathname);
  const base = {
    pageKey,
    pathname: input.pathname,
    experience: input.experience,
    pageExplain: helpFor(pageKey),
    automationPaused: Boolean(input.automationPaused),
  };

  if (pageKey === "opportunity" && input.opportunity) {
    const built = buildOpportunityGuide(input);
    return {
      ...base,
      ...built,
      terms: termsFor(pageKey),
    };
  }

  if (pageKey === "sub" && input.sub) {
    const built = buildSubGuide(input);
    return {
      ...base,
      ...built,
      scoreExplain: null,
      terms: termsFor(pageKey),
    };
  }

  const built = buildSetupOrPageGuide(input);
  return {
    ...base,
    ...built,
    scoreExplain: null,
    terms: termsFor(pageKey),
  };
}
