/**
 * What the Quick View drawer shows, for every kind of record that has one.
 *
 * The product had two drawers: one for an opportunity on the pipeline table,
 * one for a firm on the roster. Each decided its own sections, its own order
 * and its own idea of what to do when a field was empty, and neither of them
 * existed on the five other screens that are also lists of records somebody
 * is trying to triage.
 *
 * This module is the one shape all of them share. It takes the facts a page
 * has already read and returns sections in a fixed order, each already emptied
 * of the rows that have nothing in them, plus the four things every kind
 * answers the same way: recent messages, attachments, what is blocking it, and
 * the one sentence saying what to do next.
 *
 * It touches nothing -- no database, no React, no clock beyond one passed in.
 * That is what makes "a section with no data does not render" a test rather
 * than a thing somebody checks by opening seven pages.
 *
 * The order is fixed here rather than per surface, because the value of a
 * drawer that opens on eight different screens is that the fourth thing down
 * is the fourth thing down everywhere.
 */

import { countdown, currency, shortDate, timeAgo } from "@/lib/format";
import { stageLabel } from "./journey";

export type QuickViewKind =
  | "opportunity"
  | "subcontractor"
  | "call_card"
  | "conversation"
  | "work";

/** Emphasis a value carries, mapped to a colour by the renderer. */
export type QuickTone = "risk" | "review" | "pursue";

export interface QuickFact {
  label: string;
  /** Null or empty drops the row, unless `unknown` says what absence means. */
  value: string | null;
  /**
   * What to print when the value is missing.
   *
   * Present only where the absence is itself the fact: "no deadline on the
   * solicitation" is worth a line, "no NAICS code" is not. Everything without
   * one disappears, which is what keeps a thin record from rendering as a
   * column of "Not recorded".
   */
  unknown?: string;
  hint?: string;
  tone?: QuickTone;
  /** Rendered as chips rather than a sentence. Trades, flags, statuses. */
  badges?: string[];
}

export interface QuickSection {
  key: string;
  title: string;
  facts: QuickFact[];
}

export interface QuickMessage {
  id: string;
  direction: "in" | "out";
  /** ISO, or null when the row never had one. */
  at: string | null;
  who: string | null;
  subject: string | null;
  preview: string;
}

export interface QuickAttachment {
  name: string;
  href: string | null;
  meta?: string | null;
}

export interface QuickView {
  kind: QuickViewKind;
  id: string;
  title: string;
  subtitle: string | null;
  /** The full record, always offered: the drawer never hosts the whole job. */
  openHref: string;
  openLabel: string;
  sections: QuickSection[];
  messages: QuickMessage[];
  attachments: QuickAttachment[];
  /** What is stopping this, in the record's own words. */
  blockers: string[];
  /** The recommended next move, as a sentence. */
  nextAction: string | null;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Drop the rows that say nothing, then the sections left with no rows.
 *
 * A fact survives if it has a value, or if somebody wrote down what its
 * absence means. Everything else goes, because a drawer whose job is to answer
 * "is this the one" in four seconds cannot spend two of them on blank labels.
 */
export function compactSections(
  sections: readonly { key: string; title: string; facts: readonly (QuickFact | null)[] }[]
): QuickSection[] {
  const out: QuickSection[] = [];
  for (const s of sections) {
    const facts = s.facts.filter((f): f is QuickFact => {
      if (!f) return false;
      const filled = f.value != null && f.value !== "";
      const badged = (f.badges?.length ?? 0) > 0;
      return filled || badged || Boolean(f.unknown);
    });
    if (facts.length > 0) out.push({ key: s.key, title: s.title, facts });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Addressing: which record is open, as a query parameter
// ---------------------------------------------------------------------------

/** The parameter every surface opens its drawer with. */
export const QUICK_VIEW_PARAM = "peek";

export interface QuickViewTarget {
  kind: QuickViewKind;
  id: string;
}

const KINDS: readonly QuickViewKind[] = [
  "opportunity",
  "subcontractor",
  "call_card",
  "conversation",
  "work",
];

const UUID = /^[0-9a-f-]{36}$/i;
/**
 * A thread key or a queue key: both are our own composites ("pair:<id>:<id>",
 * "call:<id>") rather than bare ids, so they are checked as a charset instead
 * of a shape. Bounded, and with no slash or dot, so nothing that arrives here
 * can be walked into a path.
 */
const COMPOSITE = /^[A-Za-z0-9:_-]{1,160}$/;

function idLooksRight(kind: QuickViewKind, id: string): boolean {
  if (kind === "conversation" || kind === "work") return COMPOSITE.test(id);
  return UUID.test(id);
}

/**
 * The parameter value for a record: "call_card:<id>".
 *
 * The kind travels in the URL because Today and the Workbench list four kinds
 * of record in one queue, and a bare id there would make the page guess which
 * loader to call.
 */
export function quickViewValue(target: QuickViewTarget): string {
  return `${target.kind}:${target.id}`;
}

/**
 * The inverse, refusing anything the surface cannot serve.
 *
 * Checked here as well as at the link, because the parameter arrives from a
 * URL somebody can edit: a page that lists opportunities must not be talked
 * into loading a conversation by hand-editing the address.
 *
 * `defaultKind` keeps the two original single-kind surfaces working. The
 * pipeline table and the roster address their drawer with a bare id, and
 * rewriting every one of those links to gain a prefix they can infer would
 * have broken every bookmark for nothing.
 */
export function parseQuickView(
  raw: string | string[] | undefined,
  opts: { allowed: readonly QuickViewKind[]; defaultKind?: QuickViewKind }
): QuickViewTarget | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;

  const at = v.indexOf(":");
  if (at <= 0) {
    if (!opts.defaultKind) return null;
    const kind = opts.defaultKind;
    if (!opts.allowed.includes(kind) || !idLooksRight(kind, v)) return null;
    return { kind, id: v };
  }

  const kind = v.slice(0, at) as QuickViewKind;
  const id = v.slice(at + 1);
  if (!KINDS.includes(kind)) {
    /*
     * Not a prefixed value at all: a thread key handed straight to a
     * single-kind surface reads as "pair:<id>:<id>". Fall back to the
     * surface's own kind rather than rejecting a link that page wrote.
     */
    if (opts.defaultKind && opts.allowed.includes(opts.defaultKind) && idLooksRight(opts.defaultKind, v)) {
      return { kind: opts.defaultKind, id: v };
    }
    return null;
  }
  if (!opts.allowed.includes(kind) || !idLooksRight(kind, id)) return null;
  return { kind, id };
}

// ---------------------------------------------------------------------------
// Shared shorthand
// ---------------------------------------------------------------------------

function days(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / 86_400_000);
}

/** A deadline with its distance, in the tone the distance deserves. */
function deadlineFact(
  label: string,
  iso: string | null | undefined,
  now: Date,
  unknown?: string
): QuickFact {
  const d = days(iso, now);
  return {
    label,
    value: iso ? `${shortDate(iso)}${d == null ? "" : ` · ${d < 0 ? `${Math.abs(d)}d past` : countdown(iso, now)} `.trimEnd()}` : null,
    unknown,
    tone: d == null ? undefined : d < 0 ? "risk" : d <= 2 ? "risk" : d <= 5 ? "review" : undefined,
  };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function humanFlag(flag: string): string {
  return flag.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export interface OpportunityQuickFacts {
  id: string;
  title: string | null;
  agency: string | null;
  stage: string;
  status?: string | null;
  deadline: string | null;
  postedAt?: string | null;
  solicitationNumber?: string | null;
  naics?: string | null;
  setAside?: string | null;
  place?: string | null;
  value?: number | null;
  valueSource?: string | null;
  score?: number | null;
  /** How much of the notice could be read when it was scored. */
  confidence?: string | null;
  snoozedUntil?: string | null;
  pursuitState?: string | null;
  requiredTrades: string[];
  tradesRequired: number;
  tradesCovered: number;
  quoteCount: number;
  subsContacted: number;
  subsResponded: number;
  bidSubmitted: boolean;
  outcome: string | null;
  riskFlags: string[];
  attachments: QuickAttachment[];
  messages: QuickMessage[];
  /** Who here has it, already worded ("You", a name, or "Unassigned"). */
  owner?: string | null;
}

/** Where the value came from, because a modelled figure is not a stated one. */
function valueBasis(source: string | null | undefined): string | null {
  const s = (source ?? "").toLowerCase();
  if (s === "solicitation" || s === "attachment" || s === "analysis") {
    return "Stated in the solicitation.";
  }
  if (s === "comps" || s === "modeled" || s === "model") {
    return "Modelled from comparable awards, not stated.";
  }
  if (s === "operator" || s === "manual") return "Entered by hand.";
  return null;
}

export function opportunityQuickView(
  o: OpportunityQuickFacts,
  now: Date = new Date()
): QuickView {
  const covered =
    o.tradesRequired === 0
      ? null
      : `${o.tradesCovered} of ${plural(o.tradesRequired, "trade")} quoted`;
  const missing = Math.max(0, o.tradesRequired - o.tradesCovered);
  const snoozed = o.snoozedUntil && new Date(o.snoozedUntil).getTime() > now.getTime();

  const sections = compactSections([
    {
      key: "status",
      title: "Where it stands",
      facts: [
        { label: "Stage", value: stageLabel(o.stage), badges: [stageLabel(o.stage)] },
        snoozed
          ? {
              label: "Snoozed",
              value: `Hidden until ${shortDate(o.snoozedUntil)}`,
              hint: "It comes back into the queue on its own.",
              tone: "review",
            }
          : null,
        o.pursuitState === "aborted"
          ? {
              label: "Pursuit",
              value: "Stopped",
              hint: "Outreach and automation for this bid were cancelled.",
              tone: "risk",
            }
          : null,
        {
          label: "Fit",
          value: o.score == null ? null : String(Math.round(o.score)),
          hint: "How well the scope matches what this company does.",
        },
        {
          label: "Confidence",
          value: o.confidence ?? null,
          hint: "How much of the notice could be read when it was scored.",
        },
        { label: "Owner", value: o.owner ?? null },
      ],
    },
    {
      key: "dates",
      title: "Dates",
      facts: [
        deadlineFact("Bid due", o.deadline, now, "No deadline on the solicitation"),
        { label: "Posted", value: o.postedAt ? shortDate(o.postedAt) : null },
      ],
    },
    {
      key: "detail",
      title: "The solicitation",
      facts: [
        { label: "Solicitation", value: o.solicitationNumber ?? null },
        { label: "Agency", value: o.agency ?? null },
        { label: "NAICS", value: o.naics ?? null },
        { label: "Set aside", value: o.setAside ?? null },
        { label: "Where the work is", value: o.place ?? null },
        {
          label: "Value",
          value: o.value == null ? null : currency(o.value),
          hint: valueBasis(o.valueSource) ?? undefined,
        },
        {
          label: "Trades it needs",
          value: o.requiredTrades.length ? o.requiredTrades.join(", ") : null,
          badges: o.requiredTrades,
        },
      ],
    },
    {
      key: "progress",
      title: "Progress",
      facts: [
        { label: "Coverage", value: covered },
        {
          label: "Still missing",
          value: missing > 0 ? `${plural(missing, "trade")} with no quote` : null,
          tone: missing > 0 ? "review" : undefined,
        },
        { label: "Quotes in", value: o.quoteCount > 0 ? String(o.quoteCount) : null },
        {
          label: "Bid",
          value: o.outcome ?? (o.bidSubmitted ? "Submitted, no outcome recorded" : null),
        },
      ],
    },
    {
      key: "subs",
      title: "Subcontractors",
      facts: [
        {
          label: "Contacted",
          value: o.subsContacted > 0 ? String(o.subsContacted) : null,
          unknown: o.stage === "outreach" ? "Nobody contacted yet" : undefined,
        },
        { label: "Answered", value: o.subsResponded > 0 ? String(o.subsResponded) : null },
        {
          label: "Quoted",
          value: o.quoteCount > 0 ? plural(o.quoteCount, "quote") : null,
        },
      ],
    },
  ]);

  return {
    kind: "opportunity",
    id: o.id,
    title: o.title?.trim() || "Untitled opportunity",
    subtitle: o.agency ?? null,
    openHref: `/opportunity/${o.id}`,
    openLabel: "Open the workspace",
    sections,
    messages: o.messages,
    attachments: o.attachments,
    blockers: o.riskFlags.map(humanFlag),
    nextAction: opportunityNextAction(o, now),
  };
}

/**
 * The one sentence.
 *
 * Written from the stage rather than from a score, because the stage is what
 * decides whose move it is. Every branch names an act, not a state: "decide
 * whether to chase this" rather than "awaiting decision", which is the
 * difference between a drawer that tells you something and one that describes
 * itself back to you.
 */
export function opportunityNextAction(o: OpportunityQuickFacts, now: Date = new Date()): string {
  const missing = Math.max(0, o.tradesRequired - o.tradesCovered);
  const due = o.deadline ? ` Due ${shortDate(o.deadline)}.` : "";

  if (o.pursuitState === "aborted") {
    return "This pursuit was stopped. Reopen it from the record if that was wrong.";
  }
  if (o.status === "archived" || o.stage === "dismissed") {
    return "Passed on. Put it back in play from the record if something changed.";
  }
  if (o.stage === "won") return "Won. Nothing further here.";
  if (o.stage === "lost") return "Lost. The debrief lives on the record.";
  if (o.snoozedUntil && new Date(o.snoozedUntil).getTime() > now.getTime()) {
    return `Snoozed until ${shortDate(o.snoozedUntil)}. It returns to the queue on its own.`;
  }
  if (o.riskFlags.length > 0) {
    return `Clear the flag first: ${o.riskFlags.map(humanFlag).join(", ")}.${due}`;
  }

  switch (o.stage) {
    case "monitoring":
    case "scoring":
    case "analysis":
      return `Decide whether to chase this.${due}`;
    case "sub_research":
      return o.requiredTrades.length
        ? `Pick the subs for ${plural(o.requiredTrades.length, "trade")} and start outreach.`
        : "Pick the subs to contact and start outreach.";
    case "outreach":
      return o.subsContacted === 0
        ? "Outreach has not gone out yet. Send it, or contact the subs by hand."
        : `${o.subsResponded} of ${o.subsContacted} contacted have answered. Chase the rest by phone.`;
    case "call_queue":
      return "Call the subs who have not written back.";
    case "quote_entry":
      return missing > 0
        ? `Enter the quotes that have come in. ${plural(missing, "trade")} still unpriced.${due}`
        : `Every trade is priced. Build the bid.${due}`;
    case "bid_building":
      return `Review the package and submit it.${due}`;
    case "submitted":
      return "Submitted. Waiting on the award.";
    default:
      return `Open the workspace to see what this needs.${due}`;
  }
}

// ---------------------------------------------------------------------------
// Subcontractor
// ---------------------------------------------------------------------------

export interface SubcontractorQuickFacts {
  id: string;
  companyName: string;
  ownerName?: string | null;
  email: string | null;
  emailVerified?: boolean;
  phone: string | null;
  city?: string | null;
  state?: string | null;
  tradeCategories?: string[] | null;
  isPreferred?: boolean;
  /** Already computed by the shared state ladder, so two screens agree. */
  stateLabel: string;
  stateDetail: string;
  canContact: boolean;
  canAward: boolean;
  licenseNumber?: string | null;
  licenseStatus?: string | null;
  samExcluded?: boolean;
  blacklisted?: boolean;
  blacklistReason?: string | null;
  archivedReason?: string | null;
  lastContacted?: string | null;
  googleRating?: number | null;
  reviewCount?: number | null;
  reliability: number | null;
  reliabilityEvidence?: string | null;
  /** True when the stored score and the computed one have drifted apart. */
  reliabilityStale?: boolean;
  outreach: number;
  responded48h: number;
  respondedAny: number;
  quoteCount: number;
  openDocs?: number;
  expiredDocs?: number;
  unmetRequiredDocs?: number;
  messages: QuickMessage[];
  attachments: QuickAttachment[];
}

export function subcontractorQuickView(
  s: SubcontractorQuickFacts,
  now: Date = new Date()
): QuickView {
  const area = [s.city, s.state].filter(Boolean).join(", ");
  const trades = s.tradeCategories ?? [];

  const contact = !s.email
    ? {
        label: "No address on file",
        tone: "risk" as QuickTone,
        detail: "Outreach cannot include this firm. Find an address or call them.",
      }
    : s.emailVerified
      ? {
          label: "Address verified",
          tone: "pursue" as QuickTone,
          detail: "Confirmed deliverable when it was last checked.",
        }
      : {
          label: "Address unverified",
          tone: "review" as QuickTone,
          detail: "On file but never confirmed. The first send is the test.",
        };

  const blockers: string[] = [];
  if (s.samExcluded) blockers.push("Excluded on SAM.gov, so they cannot be awarded work");
  if (s.blacklisted) {
    blockers.push(s.blacklistReason?.trim() || "Blacklisted on this account");
  }
  if (s.archivedReason?.trim()) blockers.push(`Archived: ${s.archivedReason.trim()}`);
  if ((s.unmetRequiredDocs ?? 0) > 0) {
    blockers.push(`${plural(s.unmetRequiredDocs ?? 0, "required document")} missing for award`);
  }
  if ((s.expiredDocs ?? 0) > 0) blockers.push(`${plural(s.expiredDocs ?? 0, "document")} expired`);
  if (!s.email) blockers.push("No email address, so outreach skips them");

  const sections = compactSections([
    {
      key: "status",
      title: "Where they stand",
      facts: [
        {
          label: "Can we use them",
          value: s.stateLabel,
          hint: s.stateDetail,
          tone: !s.canContact ? "risk" : !s.canAward ? "review" : "pursue",
        },
        { label: "Contact health", value: contact.label, hint: contact.detail, tone: contact.tone },
        s.isPreferred ? { label: "Preferred", value: "Contacted first on new work" } : null,
      ],
    },
    {
      key: "dates",
      title: "Dates",
      facts: [
        {
          label: "Last contacted",
          value: s.lastContacted ? `${shortDate(s.lastContacted)} · ${timeAgo(s.lastContacted, now)}` : null,
          unknown: "Never contacted",
        },
      ],
    },
    {
      key: "detail",
      title: "What they do, and where",
      facts: [
        {
          label: "Trades",
          value: trades.length ? trades.join(", ") : null,
          badges: trades,
          unknown: "No trades recorded, so they will not be matched to any scope",
        },
        { label: "Service area", value: area || null, unknown: "No location on file" },
        { label: "Email", value: s.email, unknown: "None found" },
        { label: "Phone", value: s.phone, unknown: "None found" },
        {
          label: "Reviews",
          value:
            s.googleRating == null
              ? null
              : `${s.googleRating.toFixed(1)}${s.reviewCount ? ` from ${plural(s.reviewCount, "review")}` : ""}`,
        },
      ],
    },
    {
      key: "progress",
      title: "Reliability",
      facts: [
        {
          label: "Score",
          value: s.reliability == null ? null : String(s.reliability),
          hint: s.reliabilityStale
            ? "The roster column is refreshed on a schedule, so it can trail this."
            : (s.reliabilityEvidence ?? undefined),
          unknown: "Not enough history to score them yet",
        },
        { label: "Times contacted", value: s.outreach > 0 ? String(s.outreach) : null, unknown: "Never" },
        {
          label: "Answered",
          value:
            s.respondedAny > 0
              ? `${s.respondedAny}${s.responded48h > 0 ? `, ${s.responded48h} inside two days` : ""}`
              : null,
          unknown: "Never answered",
        },
        { label: "Quotes given", value: s.quoteCount > 0 ? String(s.quoteCount) : null, unknown: "None" },
      ],
    },
    {
      key: "paperwork",
      title: "Paperwork",
      facts: [
        { label: "License", value: s.licenseNumber ?? null, hint: s.licenseStatus ?? undefined },
        { label: "Documents on file", value: (s.openDocs ?? 0) > 0 ? String(s.openDocs) : null },
        {
          label: "Missing for award",
          value: (s.unmetRequiredDocs ?? 0) > 0 ? String(s.unmetRequiredDocs) : null,
          tone: "risk",
        },
      ],
    },
  ]);

  return {
    kind: "subcontractor",
    id: s.id,
    title: `${s.isPreferred ? "★ " : ""}${s.companyName}`,
    subtitle: s.ownerName ?? null,
    openHref: `/subs/${s.id}`,
    openLabel: "Open the full record",
    sections,
    messages: s.messages,
    attachments: s.attachments,
    blockers,
    nextAction: subcontractorNextAction(s),
  };
}

export function subcontractorNextAction(s: SubcontractorQuickFacts): string {
  if (!s.canContact) return `Nothing. ${s.stateDetail}`;
  if (!s.email) return "Find an email address, or call them.";
  if (!s.canAward) {
    return "Chase the lapsed paperwork. It does not stop you asking them for a price.";
  }
  if (s.outreach === 0) return "Nothing yet. They have never been contacted.";
  if (s.quoteCount === 0 && s.respondedAny === 0) {
    return "They have never answered. Try a call before spending more outreach on them.";
  }
  return "Include them in the next bid that needs this trade.";
}

// ---------------------------------------------------------------------------
// Call card
// ---------------------------------------------------------------------------

export interface CallCardQuickFacts {
  id: string;
  companyName: string;
  ownerName?: string | null;
  trade: string | null;
  phone: string | null;
  email: string | null;
  city?: string | null;
  state?: string | null;
  status: string | null;
  source?: string | null;
  attempts?: number;
  lastContacted?: string | null;
  calledAt?: string | null;
  /** When this sub's price is actually needed, already worded by the caller. */
  quoteDue?: string | null;
  quoteDueOverdue?: boolean;
  opportunityId: string | null;
  opportunityTitle: string | null;
  agency?: string | null;
  deadline: string | null;
  solicitationNumber?: string | null;
  scope?: string | null;
  quoteAmount?: number | null;
  questions: string[];
  needsProjectHistory?: boolean;
  reliability?: number | null;
  rating?: number | null;
  licenseStatus?: string | null;
  samExcluded?: boolean;
  messages: QuickMessage[];
  attachments: QuickAttachment[];
  /** Where the guided call opens. The drawer explains the call; it is not it. */
  openHref: string;
}

export function callCardQuickView(c: CallCardQuickFacts, now: Date = new Date()): QuickView {
  const called = c.status === "called" || Boolean(c.calledAt);

  const blockers: string[] = [];
  if (!c.phone) blockers.push("No phone number on this firm, so the call cannot be made");
  if (c.samExcluded) blockers.push("Excluded on SAM.gov, so they cannot be awarded work");
  if ((c.attempts ?? 0) >= 3 && !called) {
    blockers.push(`${plural(c.attempts ?? 0, "attempt")} already made with no answer`);
  }

  const sections = compactSections([
    {
      key: "status",
      title: "Where it stands",
      facts: [
        {
          label: "Call",
          value: called ? "Made" : c.status === "skipped" ? "Skipped" : "Waiting",
          tone: called ? "pursue" : c.quoteDueOverdue ? "risk" : undefined,
        },
        {
          label: "Attempts",
          value: (c.attempts ?? 0) > 0 ? String(c.attempts) : null,
        },
        {
          label: "Why they are queued",
          value: c.source === "no_reply" ? "They never answered the outreach email" : (c.source ?? null),
        },
        {
          label: "Quote in",
          value: c.quoteAmount == null ? null : currency(c.quoteAmount),
          tone: "pursue",
        },
      ],
    },
    {
      key: "dates",
      title: "Dates",
      facts: [
        deadlineFact("Bid due", c.deadline, now, "No deadline on the solicitation"),
        {
          label: "Their price needed",
          value: c.quoteDue ?? null,
          tone: c.quoteDueOverdue ? "risk" : undefined,
        },
        {
          label: "Last contacted",
          value: c.lastContacted ? `${shortDate(c.lastContacted)} · ${timeAgo(c.lastContacted, now)}` : null,
          unknown: "Never contacted",
        },
      ],
    },
    {
      key: "detail",
      title: "The call",
      facts: [
        { label: "Firm", value: c.companyName, hint: c.ownerName ?? undefined },
        { label: "Trade", value: c.trade },
        { label: "Phone", value: c.phone, unknown: "No number on file" },
        { label: "Email", value: c.email },
        { label: "Where they are", value: [c.city, c.state].filter(Boolean).join(", ") || null },
        { label: "For", value: c.opportunityTitle, hint: c.agency ?? undefined },
        { label: "Solicitation", value: c.solicitationNumber ?? null },
        { label: "Scope", value: c.scope ?? null },
      ],
    },
    {
      key: "progress",
      title: "What to ask",
      facts: [
        {
          label: "Questions",
          value: c.questions.length ? c.questions.join(" · ") : null,
          badges: c.questions,
        },
        c.needsProjectHistory
          ? { label: "Also ask", value: "For comparable projects they have done" }
          : null,
      ],
    },
    {
      key: "subs",
      title: "The firm",
      facts: [
        { label: "Reliability", value: c.reliability == null ? null : String(c.reliability) },
        { label: "Reviews", value: c.rating == null ? null : c.rating.toFixed(1) },
        { label: "License", value: c.licenseStatus ?? null },
      ],
    },
  ]);

  return {
    kind: "call_card",
    id: c.id,
    title: c.companyName,
    subtitle: [c.trade, c.opportunityTitle].filter(Boolean).join(" · ") || null,
    openHref: c.openHref,
    openLabel: "Open the guided call",
    sections,
    messages: c.messages,
    attachments: c.attachments,
    blockers,
    nextAction: called
      ? "The call is logged. Enter the price if they gave one."
      : c.phone
        ? `Call ${c.companyName}${c.trade ? ` about ${c.trade}` : ""} and ask for a price.`
        : "No number on file. Email them, or find a number on the record.",
  };
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface ConversationQuickFacts {
  threadKey: string;
  subject: string;
  subcontractorId: string | null;
  subcontractorName: string;
  subcontractorEmail: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  trade: string | null;
  state: string;
  stateLabel?: string | null;
  reason: string;
  nextAction: string;
  lastAt: string | null;
  messageCount: number;
  unreadCount: number;
  followUpAt: string | null;
  /** Set when the newest outbound message did not arrive. */
  failedState: string | null;
  deadline?: string | null;
  messages: QuickMessage[];
  attachments: QuickAttachment[];
  openHref: string;
}

export function conversationQuickView(
  c: ConversationQuickFacts,
  now: Date = new Date()
): QuickView {
  const blockers: string[] = [];
  if (c.failedState) {
    blockers.push(`The last message we sent did not arrive (${humanFlag(c.failedState)})`);
  }
  if (!c.subcontractorEmail) blockers.push("No address on this thread, so a reply cannot be sent");

  const sections = compactSections([
    {
      key: "status",
      title: "Where it stands",
      facts: [
        {
          label: "State",
          value: c.stateLabel ?? humanFlag(c.state),
          hint: c.reason,
          tone: c.failedState ? "risk" : c.unreadCount > 0 ? "review" : undefined,
        },
        {
          label: "Unread",
          value: c.unreadCount > 0 ? plural(c.unreadCount, "message") : null,
          tone: "review",
        },
      ],
    },
    {
      key: "dates",
      title: "Dates",
      facts: [
        {
          label: "Last message",
          value: c.lastAt ? `${shortDate(c.lastAt)} · ${timeAgo(c.lastAt, now)}` : null,
        },
        {
          label: "Follow-up due",
          value: c.followUpAt ? shortDate(c.followUpAt) : null,
          tone:
            c.followUpAt && new Date(c.followUpAt).getTime() < now.getTime() ? "risk" : undefined,
        },
        deadlineFact("Bid due", c.deadline ?? null, now),
      ],
    },
    {
      key: "detail",
      title: "Who and what",
      facts: [
        { label: "Firm", value: c.subcontractorName },
        { label: "Address", value: c.subcontractorEmail, unknown: "None on the thread" },
        { label: "Trade", value: c.trade },
        { label: "Bid", value: c.opportunityTitle },
        { label: "Subject", value: c.subject },
      ],
    },
    {
      key: "progress",
      title: "Progress",
      facts: [
        { label: "Messages", value: c.messageCount > 0 ? String(c.messageCount) : null },
      ],
    },
  ]);

  return {
    kind: "conversation",
    id: c.threadKey,
    title: c.subcontractorName,
    subtitle: c.subject || null,
    openHref: c.openHref,
    openLabel: "Open the conversation",
    sections,
    messages: c.messages,
    attachments: c.attachments,
    blockers,
    nextAction: c.nextAction,
  };
}

// ---------------------------------------------------------------------------
// Work item
// ---------------------------------------------------------------------------

export interface WorkItemQuickFacts {
  key: string;
  kind: string;
  title: string;
  context: string;
  due?: string | null;
  expiresAt?: string | null;
  reason?: string | null;
  blocker?: string | null;
  waitingOn?: { party: string; since?: string | null } | null;
  owner?: string | null;
  actionLabel: string;
  href: string;
  recordHref: string;
}

/**
 * The fallback peek, for a task whose record has no drawer of its own.
 *
 * A reply waiting to be read and a pairing waiting on a subcontractor are
 * tasks rather than records: everything worth knowing about them is already
 * on the queue row, and a read for them would be a query returning what the
 * page has in hand. So this is built from the item itself, and the surfaces
 * that can resolve the record to an opportunity or a call card show those
 * instead.
 */
export function workItemQuickView(w: WorkItemQuickFacts, now: Date = new Date()): QuickView {
  const sections = compactSections([
    {
      key: "status",
      title: "Where it stands",
      facts: [
        { label: "What this is", value: humanFlag(w.kind) },
        { label: "Why now", value: w.reason ?? null },
        {
          label: "Waiting on",
          value: w.waitingOn
            ? `${w.waitingOn.party}${w.waitingOn.since ? ` since ${shortDate(w.waitingOn.since)}` : ""}`
            : null,
          hint: w.waitingOn ? "Nothing to do here until they come back." : undefined,
        },
        { label: "Owner", value: w.owner ?? null },
      ],
    },
    {
      key: "dates",
      title: "Dates",
      facts: [
        deadlineFact("Due", w.due ?? null, now),
        { label: "Drops off", value: w.expiresAt ? shortDate(w.expiresAt) : null },
      ],
    },
    {
      key: "detail",
      title: "The record",
      facts: [{ label: "Belongs to", value: w.context || null }],
    },
  ]);

  return {
    kind: "work",
    id: w.key,
    title: w.title,
    subtitle: w.context || null,
    openHref: w.recordHref || w.href,
    openLabel: "Open the full record",
    sections,
    messages: [],
    attachments: [],
    blockers: w.blocker ? [w.blocker] : [],
    nextAction: w.blocker
      ? `${w.blocker} Fix that, then ${w.actionLabel.toLowerCase()}.`
      : `${w.actionLabel}.`,
  };
}
