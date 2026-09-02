/**
 * What the Quick View drawer reads, for the record kinds that need a read.
 *
 * One function per kind, each returning the drawer's content and the facts the
 * row-action builder needs, so a page opens a peek with a single call and can
 * offer exactly the actions the row offered. The rule from the task holds
 * here: no new data. Every one of these is the existing summary read plus, at
 * most, the five most recent messages -- never the record page's load, which
 * pulls hundreds of communications, documents and log lines.
 *
 * The shaping into sections lives in `lib/domain/quick-view`, which is pure.
 * This file is only the queries and the mapping between them.
 */

import { query } from "./db";
import { THREAD_KEY_SQL } from "./thread-key";
import { callCardById, currentOrg, oppPeek, subPeek } from "./data";
import {
  CONVERSATION_STATE_LABEL,
  preview,
  type ConversationSummary,
} from "./domain/conversation-centre";
import { coerceQuestions } from "./domain/call-guide";
import { reliabilityBreakdown } from "./domain/reliability";
import { subState } from "./domain/sub-state";
import {
  callCardQuickView,
  conversationQuickView,
  opportunityQuickView,
  subcontractorQuickView,
  type QuickAttachment,
  type QuickMessage,
  type QuickView,
} from "./domain/quick-view";
import type {
  CallCardActionFacts,
  ConversationActionFacts,
  OpportunityActionFacts,
  SubActionFacts,
} from "./domain/row-actions";

const UUID_RE = /^[0-9a-f-]{36}$/i;

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number {
  return Math.trunc(num(v) ?? 0);
}

/**
 * The notice's own attachment list, as links.
 *
 * Only entries with a real http(s) URL become links; a stored file is named
 * without one, because the drawer has no download route and a dead anchor is
 * worse than plain text. Capped, because a large solicitation carries dozens
 * and the drawer is a summary.
 */
function attachmentsFrom(raw: unknown, limit = 8): QuickAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const a = entry as { name?: unknown; url?: unknown; mime?: unknown };
    const url = str(a.url);
    const href = url && /^https?:\/\//i.test(url) ? url : null;
    out.push({
      name: str(a.name) ?? "Attachment",
      href,
      meta: href ? null : "Stored with the record",
    });
    if (out.length >= limit) break;
  }
  return out;
}

interface CommRow {
  id: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  created_at: string | null;
  who: string | null;
}

/**
 * The five most recent messages behind one drawer, newest first.
 *
 * Every peek that shows messages goes through here rather than through the
 * reads the record pages use. Those are written for a page that renders the
 * whole thread, so they fetch hundreds of rows and throw all but a handful
 * away; a drawer that costs what a page costs is not a quick look.
 *
 * The caller supplies the where clause because the thing a thread is keyed by
 * differs (a pairing, a card, an opportunity), but the shape and the cap do
 * not.
 */
async function recentMessages(where: string, params: unknown[]): Promise<CommRow[]> {
  const orgId = await currentOrg();
  return query<CommRow>(
    `select c.id, c.direction, c.subject, c.body, c.created_at::text as created_at,
            null::text as who
       from communications c
      where c.org_id = $1 and ${where}
      order by c.created_at desc
      limit 5`,
    [orgId, ...params]
  );
}

function messagesFrom(rows: CommRow[]): QuickMessage[] {
  return rows.map((m) => ({
    id: String(m.id),
    direction: m.direction === "inbound" ? "in" : "out",
    at: m.created_at ? new Date(m.created_at).toISOString() : null,
    who: str(m.who),
    subject: str(m.subject),
    preview: preview(m.body, 160),
  }));
}

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------

export interface OpportunityQuickView {
  view: QuickView;
  /** So the drawer's controls come from the same builder the row's do. */
  actionFacts: OpportunityActionFacts;
}

export async function opportunityQuickViewData(
  id: string,
  opts: { owner?: string | null } = {}
): Promise<OpportunityQuickView | null> {
  if (!UUID_RE.test(id)) return null;
  const peek = await oppPeek(id);
  if (!peek) return null;

  const orgId = await currentOrg();
  const comms = await query<CommRow>(
    `select c.id, c.direction, c.subject, c.body, c.created_at::text as created_at,
            s.company_name as who
       from communications c
       left join subcontractors s on s.id = c.subcontractor_id
      where c.opportunity_id = $1 and c.org_id = $2
      order by c.created_at desc limit 5`,
    [id, orgId]
  );

  const o = peek.opp;
  const breakdown = o.score_breakdown as { data_confidence?: string } | null;

  const view = opportunityQuickView({
    id,
    title: str(o.title),
    agency: str(o.agency),
    stage: String(o.stage ?? ""),
    status: str(o.status),
    deadline: str(o.deadline),
    postedAt: str(o.posted_date) ?? str(o.created_at),
    solicitationNumber: str(o.solicitation_number),
    naics: str(o.naics_code),
    setAside: str(o.set_aside_type),
    place: str(o.location_text) ?? str(o.location_state),
    value: num(o.value_estimated),
    valueSource: str(o.value_estimated_source),
    score: num(o.score),
    confidence: str(breakdown?.data_confidence),
    snoozedUntil: str(o.snoozed_until),
    pursuitState: str(o.pursuit_state),
    requiredTrades: peek.requiredTrades,
    tradesRequired: peek.tradesRequired,
    tradesCovered: peek.tradesCovered,
    quoteCount: peek.quoteCount,
    subsContacted: peek.subsContacted,
    subsResponded: peek.subsResponded,
    bidSubmitted: peek.bidSubmitted,
    outcome: peek.outcome,
    riskFlags: Array.isArray(o.risk_flags) ? (o.risk_flags as string[]) : [],
    attachments: attachmentsFrom(o.attachments_json),
    messages: messagesFrom(comms),
    owner: opts.owner ?? null,
  });

  return {
    view,
    actionFacts: {
      id,
      title: str(o.title),
      stage: String(o.stage ?? ""),
      status: str(o.status),
      pursuitState: str(o.pursuit_state),
      snoozedUntil: str(o.snoozed_until),
    },
  };
}

// ---------------------------------------------------------------------------
// Subcontractor
// ---------------------------------------------------------------------------

export interface SubcontractorQuickView {
  view: QuickView;
  actionFacts: SubActionFacts;
}

export async function subcontractorQuickViewData(
  id: string
): Promise<SubcontractorQuickView | null> {
  if (!UUID_RE.test(id)) return null;
  const s = await subPeek(id);
  if (!s) return null;

  const orgId = await currentOrg();
  const comms = await query<CommRow>(
    `select c.id, c.direction, c.subject, c.body, c.created_at::text as created_at,
            null::text as who
       from communications c
      where c.subcontractor_id = $1 and c.org_id = $2
      order by c.created_at desc limit 5`,
    [id, orgId]
  );

  const rel = reliabilityBreakdown({
    outreach: int(s.outreach),
    respondedWithin48h: int(s.responded_48h),
    respondedEver: int(s.responded_any),
    quotes: int(s.quote_count),
    blacklisted: s.blacklisted,
  });
  const state = subState({
    samExcluded: s.sam_excluded,
    blacklisted: s.blacklisted,
    blacklistReason: s.blacklist_reason,
    archivedAt: s.archived_at,
    archivedReason: s.archived_reason,
    mergedInto: s.merged_into,
    email: s.email,
    emailVerified: s.email_verified,
    phone: s.phone,
    missingDocuments:
      int(s.unmet_required_docs) > 0
        ? [`${int(s.unmet_required_docs)} required for award`]
        : [],
    preferred: s.is_preferred,
  });

  const view = subcontractorQuickView({
    id,
    companyName: s.company_name,
    ownerName: s.owner_name,
    email: s.email,
    emailVerified: Boolean(s.email_verified),
    phone: s.phone,
    city: s.city,
    state: s.state,
    tradeCategories: s.trade_categories ?? [],
    isPreferred: s.is_preferred,
    stateLabel: state.label,
    stateDetail: state.detail,
    canContact: state.canContact,
    canAward: state.canAward,
    licenseNumber: s.license_number,
    licenseStatus: s.license_status,
    samExcluded: s.sam_excluded,
    blacklisted: s.blacklisted,
    blacklistReason: s.blacklist_reason,
    archivedReason: s.archived_reason,
    lastContacted: s.last_contacted,
    googleRating: num(s.google_rating),
    reviewCount: num(s.review_count),
    reliability: rel.reliability,
    reliabilityEvidence: rel.caveat,
    /*
     * The stored column is refreshed on a schedule and outreach has happened
     * since, so the two numbers can differ. Saying which is which beats
     * silently showing one of them.
     */
    reliabilityStale:
      s.reliability_score != null && Number(s.reliability_score) !== rel.reliability,
    outreach: int(s.outreach),
    responded48h: int(s.responded_48h),
    respondedAny: int(s.responded_any),
    quoteCount: int(s.quote_count),
    openDocs: int(s.open_docs),
    expiredDocs: int(s.expired_docs),
    unmetRequiredDocs: int(s.unmet_required_docs),
    messages: messagesFrom(comms),
    attachments: [],
  });

  return {
    view,
    actionFacts: {
      id,
      companyName: s.company_name,
      phone: s.phone,
      email: s.email,
      emailVerified: Boolean(s.email_verified),
      /*
       * The same fact the table row passes. Without it the drawer would offer
       * to stop outreach to a firm outreach has already stopped for, which is
       * the exact disagreement between row and drawer this contract exists to
       * prevent.
       */
      outreachStopped: Boolean(s.blacklisted || s.archived_at),
    },
  };
}

// ---------------------------------------------------------------------------
// Call card
// ---------------------------------------------------------------------------

export interface CallCardQuickView {
  view: QuickView;
  actionFacts: CallCardActionFacts;
}

export async function callCardQuickViewData(
  id: string,
  opts: { openHref?: string; quoteDue?: string | null; quoteDueOverdue?: boolean } = {}
): Promise<CallCardQuickView | null> {
  if (!UUID_RE.test(id)) return null;
  const c = await callCardById(id);
  if (!c) return null;

  const comms = (await recentMessages(
    `subcontractor_id = $2 and opportunity_id = $3`,
    [c.subcontractor_id, c.opportunity_id]
  )).map((m) => ({ ...m, who: c.company_name }));

  const openHref = opts.openHref ?? `/call-queue?open=${id}`;
  const view = callCardQuickView({
    id,
    companyName: c.company_name,
    ownerName: c.owner_name,
    trade: c.trade,
    phone: c.phone,
    email: c.email,
    city: c.city,
    state: c.state,
    status: c.status,
    source: c.source,
    attempts: int(c.attempts),
    lastContacted: c.last_contacted ?? null,
    calledAt: c.called_at ?? null,
    quoteDue: opts.quoteDue ?? null,
    quoteDueOverdue: opts.quoteDueOverdue ?? false,
    opportunityId: c.opportunity_id,
    opportunityTitle: c.opportunity_title,
    agency: c.agency,
    deadline: c.deadline,
    solicitationNumber: c.solicitation_number,
    /*
     * The scope, cut to a paragraph. The full description is the record's
     * job; a drawer that scrolls for a page stops being a quick look.
     */
    scope: c.description ? `${c.description.slice(0, 320)}${c.description.length > 320 ? "…" : ""}` : null,
    quoteAmount: num(c.quote_amount),
    questions: coerceQuestions(c.question_list).map((q) => q.ask),
    needsProjectHistory: c.needs_project_history,
    reliability: num(c.reliability_score),
    rating: num(c.google_rating),
    licenseStatus: c.license_status,
    samExcluded: c.sam_excluded,
    messages: messagesFrom(comms),
    attachments: attachmentsFrom(c.attachments_json),
    openHref,
  });

  return {
    view,
    actionFacts: {
      id,
      companyName: c.company_name,
      trade: c.trade,
      subcontractorId: c.subcontractor_id,
      opportunityId: c.opportunity_id,
      status: c.status,
      openHref,
    },
  };
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export interface ConversationQuickView {
  view: QuickView;
  actionFacts: ConversationActionFacts;
}

/**
 * A thread, from the summary the list already holds plus its messages.
 *
 * The summary is passed in rather than re-derived: the inbox has already read
 * every thread to render the list, and re-running that read to describe one of
 * them would make opening a drawer cost what loading the page cost.
 */
export async function conversationQuickViewData(
  summary: ConversationSummary,
  opts: { openHref: string; deadline?: string | null }
): Promise<ConversationQuickView> {
  const recent = await recentMessages(`${THREAD_KEY_SQL} = $2`, [summary.threadKey]);

  const view = conversationQuickView({
    threadKey: summary.threadKey,
    subject: summary.subject,
    subcontractorId: summary.subcontractorId,
    subcontractorName: summary.subcontractorName,
    subcontractorEmail: summary.subcontractorEmail,
    opportunityId: summary.opportunityId,
    opportunityTitle: summary.opportunityTitle,
    trade: summary.trade,
    state: summary.state,
    stateLabel: CONVERSATION_STATE_LABEL[summary.state] ?? null,
    reason: summary.reason,
    nextAction: summary.nextAction,
    lastAt: summary.lastAt,
    messageCount: summary.messageCount,
    unreadCount: summary.unreadCount,
    followUpAt: summary.followUpAt,
    failedState: summary.failedState,
    deadline: opts.deadline ?? null,
    messages: recent.map((m) => ({
      id: String(m.id),
      direction: m.direction === "inbound" ? ("in" as const) : ("out" as const),
      at: m.created_at ? new Date(m.created_at).toISOString() : null,
      who: m.direction === "inbound" ? summary.subcontractorName : null,
      subject: m.subject ?? null,
      preview: preview(m.body, 160),
    })),
    attachments: [],
    openHref: opts.openHref,
  });

  return {
    view,
    actionFacts: {
      threadKey: summary.threadKey,
      subcontractorId: summary.subcontractorId,
      subcontractorName: summary.subcontractorName,
      opportunityId: summary.opportunityId,
      trade: summary.trade,
      openHref: opts.openHref,
    },
  };
}
