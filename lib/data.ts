/**
 * Server-side data-access layer. Dashboard server components import these
 * directly (no internal HTTP hop for reads). All functions are read-only;
 * mutations go through API routes in app/api/*.
 *
 * EVERY function that reads a tenant-owned table must scope it with
 * `currentOrg()`. This is the read half of the tenant boundary: the API routes
 * enforce it for writes, and without it here a brand-new customer's first page
 * load shows another customer's subcontractors, contracts, and pipeline. That
 * is exactly what happened, and it was found by signing up as a new user and
 * seeing "1 subcontractor" on an empty account.
 */
import { query, queryOne } from "./db";
import type { KpiParams } from "./domain/kpi";
import type { BreakdownKey, BreakdownRow, FunnelCounts } from "./domain/funnel";
import type { CredentialSource as ProviderCredentialSource } from "./domain/provider-usage";
import type { TemplateCounts } from "./domain/template-health";
import type { WorkKind } from "./domain/work-queue";
import { resolveSubWork } from "./domain/sub-work";
import {
  loadAwardCompliance,
  needsAttentionOnWonWork,
  type AwardComplianceRow,
} from "./sub-compliance-store";
import type { ContentLibraryItem, Opportunity, Subcontractor } from "./types";
import { readWorkerHeartbeat } from "./worker-heartbeat";
import { THREAD_KEY_SQL } from "./thread-key";

/**
 * The organization every read in this module is scoped to.
 *
 * Resolves from the agent's async-local context first (worker jobs) and then
 * the signed-in user's membership. Falls back to the founding org so the
 * original single-tenant install, whose rows predate organization_members,
 * keeps working.
 *
 * Exported so lib/conversations.ts resolves the tenant the same way rather
 * than growing a second answer to "which org is this". Two resolvers is one
 * more than the number that can be right.
 */
export async function currentOrg(): Promise<string> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  return (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
}

/**
 * What makes a call card still worth working.
 *
 * One string because there were four copies of it and they had drifted: the
 * sidebar badge's copy was missing the snooze clause the other three had, so
 * it advertised more calls than the Call Queue page would list, and two
 * numbers under the same word disagreed on every page load.
 *
 * The opportunity must still be open. A card outlives the record it belongs
 * to: nothing clears pending cards when an opportunity is archived, dismissed,
 * won or lost, so without this the queue keeps asking for calls about work
 * that finished months ago, and the badge counts them forever.
 *
 * Deliberately does NOT carry the org filter. That stays written out at each
 * call site, where a reader can see it, and where the scoping guards in
 * tests/data-scoping.test.ts and tests/agent-scoping.test.ts can see it too:
 * neither can look inside an interpolation, and an org filter they cannot
 * check is one nobody is checking.
 *
 * Expects the aliases cc (call_cards), o (opportunities) and s (subcontractors).
 */
/**
 * Aborted pursuits stay in history. They leave every active work list.
 * Paused stays visible so the operator can resume. A missing value is active.
 * Expects the opportunities table aliased as `o`.
 */
export const ACTIVE_PURSUIT_SQL = `coalesce(o.pursuit_state, 'active') <> 'aborted'`;

export const WORKABLE_CALL_CARD_SQL = `
  cc.status = 'pending'
  and o.status = 'open'
  and ${ACTIVE_PURSUIT_SQL}
  and (cc.snoozed_until is null or cc.snoozed_until <= now())
  -- Uncallable cards (no phone) are never shown; Call Prep refuses to create
  -- them going forward, and this keeps historical empties out of the count.
  and nullif(btrim(coalesce(s.phone, '')), '') is not null
  -- A decline already closed this pairing. Leftover pending cards stay in
  -- history; they leave the queue the same way an expired bid leaves Today.
  and not exists (
    select 1 from opportunity_subs os
     where os.opportunity_id = cc.opportunity_id
       and os.subcontractor_id = cc.subcontractor_id
       and os.outreach_state in ('declined', 'not_a_fit', 'unavailable')
  )`;

/**
 * An opportunity waiting on a pursue-or-pass decision.
 *
 * Shared with actionCenter rather than restated, because it was restated and
 * the two copies drifted: the sidebar badge omitted the snooze check, so
 * snoozing a borderline opportunity removed it from Today and left it in the
 * badge. The operator cleared their queue and the number beside "Review" did
 * not move, which is precisely how a count stops being believed.
 *
 * Expects the opportunities table aliased as `o`.
 */
export const TRIAGE_WHERE_SQL = `o.status='open' and ${ACTIVE_PURSUIT_SQL} and o.tier='review' and o.human_action_required=true
  and (o.snoozed_until is null or o.snoozed_until <= now())`;

export async function queueCounts(): Promise<{
  review: number;
  callQueue: number;
  today: number;
}> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) {
    return { review: 0, callQueue: 0, today: 0 };
  }
  /*
   * Review and Calls stay as the named badges they always were. Today is the
   * same set the work queue lists: unique records that still need a person.
   * Adding urgent + replies + review + calls + bid work used to count one
   * opportunity three times and print 404 next to a list of 351.
   *
   * Awaiting replies are not in this number. They are on the queue under
   * "Waiting on others" and they need nobody.
   */
  const row = await queryOne<{ review: string; call: string; today: string }>(
    `with needs as (
       select e.id::text as fp
         from subcontractor_reply_events e
         left join opportunities o on o.id = e.opportunity_id
        where e.needs_review and e.reviewed_at is null
          and (e.org_id = $1 or (e.org_id is null and o.org_id = $1))
          and (o.id is null or ${ACTIVE_PURSUIT_SQL})
       union
       select o.id::text
         from opportunities o
        where o.org_id = $1 and ${TRIAGE_WHERE_SQL}
       union
       select cc.id::text
         from call_cards cc
         join opportunities o on o.id = cc.opportunity_id
         join subcontractors s on s.id = cc.subcontractor_id
        where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL}
       union
       select o.id::text
         from opportunities o
        where o.org_id = $1 and o.status = 'open' and ${ACTIVE_PURSUIT_SQL}
          and o.human_action_required = true
          and not (o.tier = 'review' and o.stage = 'scoring')
          and (o.snoozed_until is null or o.snoozed_until <= now())
     )
     select
       (select count(*) from opportunities o
         where o.org_id = $1 and ${TRIAGE_WHERE_SQL}) as review,
       (select count(*) from call_cards cc
         join opportunities o on o.id = cc.opportunity_id
         join subcontractors s on s.id = cc.subcontractor_id
        where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL}) as call,
       (select count(*) from needs) as today`,
    [orgId]
  );
  return {
    review: Number(row?.review ?? 0),
    callQueue: Number(row?.call ?? 0),
    today: Number(row?.today ?? 0),
  };
}

export const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: "monitoring", label: "Monitoring" },
  { key: "scoring", label: "Scoring" },
  { key: "analysis", label: "Analysis" },
  { key: "sub_research", label: "Sub Research" },
  { key: "outreach", label: "Outreach" },
  { key: "call_queue", label: "Call Queue" },
  { key: "quote_entry", label: "Quote Entry" },
  { key: "bid_building", label: "Bid Building" },
  { key: "submitted", label: "Submitted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

export async function pipelineOpportunities(): Promise<Opportunity[]> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return [];
  return query<Opportunity>(
    `select * from opportunities
      where org_id = $1 and stage <> 'dismissed' and status <> 'archived'
        and coalesce(pursuit_state, 'active') <> 'aborted'
      order by (deadline is null), deadline asc
      limit 500`,
    [orgId]
  );
}

/**
 * Sortable columns for the opportunities table, and the SQL each one means.
 *
 * A whitelist rather than interpolation: a sort key arrives from a query
 * string, and a query string is a place a stranger can write.
 */
export const OPP_SORTS: Record<string, string> = {
  title: "title",
  agency: "agency nulls last",
  stage: "stage",
  deadline: "deadline nulls last",
  score: "coalesce(score,0)",
  value_estimated: "coalesce(value_estimated,0)",
  location_state: "location_state nulls last",
  updated_at: "updated_at",
};

export interface OppTableFilters {
  q?: string;
  stage?: string;
  /** pursue | review | dismiss. */
  tier?: string;
  state?: string;
  agency?: string;
  naics?: string;
  setAside?: string;
  /** Only rows waiting on a person. */
  needsMe?: boolean;
  /** Deadline inside this many days. */
  dueDays?: number;
  minScore?: number;
  /** "known" or "unknown": whether the contract value was ever published. */
  value?: "known" | "unknown";
  /** Include dismissed and archived records, hidden by default. */
  includeClosed?: boolean;
  /**
   * How much of the score rests on facts the notice actually stated.
   *
   * Read from what the scoring engine wrote rather than re-derived here: the
   * rule lives in assessDataConfidence and a second copy in SQL would drift
   * from it the first time either changed.
   */
  confidence?: "high" | "medium" | "low";
  /** Published value at least this much. Only ever matches published values. */
  valueMin?: number;
  /** Published value at most this much. */
  valueMax?: number;
  /** Only rows automation named something it could not get past. */
  blocked?: boolean;
  /** Only rows with a required trade that nobody has quoted. */
  uncovered?: boolean;
  /** "ready" or "not_ready": whether a package has passed validation. */
  readiness?: "ready" | "not_ready";
  /** "mine" or "unassigned". Needs viewerId to mean the first. */
  owner?: "mine" | "unassigned";
  viewerId?: string;
}

/**
 * Which required trades an opportunity has a quote for.
 *
 * One definition, because two places need it: the "uncovered trades" filter
 * and the coverage figure on every card. Written twice they would drift, and
 * the drift would be silent: a filter that says a bid is covered beside a card
 * that says two trades are missing.
 *
 * The comparison is case-blind on purpose. The extractor writes what the
 * solicitation said and the operator types what they say, so "Electrical" and
 * "electrical" are one trade, and treating them as two sends somebody chasing
 * a quote they already have.
 */
const REQUIRED_TRADES_SQL = `
  jsonb_array_elements_text(
    case when jsonb_typeof(o.solicitation_analysis->'required_trades') = 'array'
         then o.solicitation_analysis->'required_trades'
         else '[]'::jsonb end
  )`;

const TRADE_COVERED_SQL = `
  exists (
    select 1 from quotes q
     where q.opportunity_id = o.id
       and lower(coalesce(q.trade, '')) = lower(t.trade)
  )`;

export interface TradeCoverage {
  /** How many trades the analyst said this job needs. */
  required: number;
  /** How many of them somebody has priced. */
  covered: number;
}

/**
 * Coverage for a page of opportunities, in one query.
 *
 * A record whose analysis has not run has no required trades, and that is
 * `required: 0` rather than "fully covered": the card says "Trades not read
 * yet", because zero of zero is not a reassurance.
 */
export async function tradeCoverageFor(ids: string[]): Promise<Map<string, TradeCoverage>> {
  const out = new Map<string, TradeCoverage>();
  if (ids.length === 0) return out;
  const orgId = await currentOrg();
  const rows = await query<{ id: string; required: number; covered: number }>(
    `select o.id,
            count(t.trade)::int as required,
            count(*) filter (where ${TRADE_COVERED_SQL})::int as covered
       from opportunities o
       left join lateral ${REQUIRED_TRADES_SQL} as t(trade) on true
      where o.org_id = $1 and o.id = any($2::uuid[])
      group by o.id`,
    [orgId, ids]
  );
  for (const r of rows) out.set(r.id, { required: r.required, covered: r.covered });
  return out;
}

function oppTableWhere(f: OppTableFilters, params: unknown[]): string[] {
  const where: string[] = [];
  // The board's own scope. A dismissed record is history, not pipeline, and
  // mixing it in makes every count on the page disagree with the board.
  if (!f.includeClosed) {
    where.push("stage <> 'dismissed' and status <> 'archived'");
    where.push("coalesce(pursuit_state, 'active') <> 'aborted'");
  }
  if (f.stage) {
    params.push(f.stage);
    where.push(`stage = $${params.length}`);
  }
  if (f.tier) {
    params.push(f.tier);
    where.push(`tier = $${params.length}`);
  }
  if (f.state) {
    params.push(f.state);
    where.push(`location_state = $${params.length}`);
  }
  if (f.agency) {
    params.push(`%${f.agency}%`);
    where.push(`agency ilike $${params.length}`);
  }
  if (f.naics) {
    params.push(f.naics);
    where.push(`naics_code = $${params.length}`);
  }
  if (f.setAside) {
    params.push(`%${f.setAside}%`);
    where.push(`coalesce(set_aside_type,'') ilike $${params.length}`);
  }
  if (f.needsMe) where.push("human_action_required = true");
  if (f.minScore != null) {
    params.push(f.minScore);
    where.push(`coalesce(score,0) >= $${params.length}`);
  }
  if (f.dueDays != null) {
    params.push(f.dueDays);
    where.push(
      `deadline is not null and deadline > now() and deadline <= now() + make_interval(days => $${params.length})`
    );
  }
  /*
   * Whether the notice published a value at all. Worth filtering on in both
   * directions: "unknown" is the queue of records whose score rests on a fact
   * nobody has, and "known" is what you can actually plan revenue against.
   */
  if (f.value === "known") where.push("value_estimated is not null");
  if (f.value === "unknown") where.push("value_estimated is null");
  if (f.confidence) {
    params.push(f.confidence);
    // Written by the scoring engine into score_breakdown. A record scored
    // before confidence existed has no key here and matches nothing, which is
    // correct: its confidence is not low, it is unrecorded.
    where.push(`score_breakdown->'data_confidence'->>'level' = $${params.length}`);
  }
  /*
   * A value range only ever matches a published value.
   *
   * An unknown value is not a small one. Treating null as zero would put every
   * unread notice in the "under $100k" band, which is the same lie as printing
   * 0 for an unknown count, told about money.
   */
  if (f.valueMin != null) {
    params.push(f.valueMin);
    where.push(`value_estimated is not null and value_estimated >= $${params.length}`);
  }
  if (f.valueMax != null) {
    params.push(f.valueMax);
    where.push(`value_estimated is not null and value_estimated <= $${params.length}`);
  }
  if (f.blocked) where.push("coalesce(array_length(risk_flags, 1), 0) > 0");
  /*
   * A required trade nobody has priced.
   *
   * The required trades are what the analyst extracted; a trade is covered
   * when a quote exists for it on this opportunity. Compared case-insensitively
   * because the extractor writes what the solicitation said and the quote
   * carries what the operator typed.
   */
  if (f.uncovered) {
    /*
     * The same two fragments the coverage counts use, aliased so `o` means
     * this row. One definition of "covered" rather than two that can drift
     * into a filter and a card disagreeing about the same bid.
     */
    where.push(`exists (
      select 1
        from opportunities o
        join lateral ${REQUIRED_TRADES_SQL} as t(trade) on true
       where o.id = opportunities.id
         and not ${TRADE_COVERED_SQL}
    )`);
  }
  if (f.readiness === "ready") {
    where.push(
      `exists (select 1 from bids b where b.opportunity_id = opportunities.id and b.package_ready)`
    );
  }
  if (f.readiness === "not_ready") {
    where.push(
      `not exists (select 1 from bids b where b.opportunity_id = opportunities.id and b.package_ready)`
    );
  }
  if (f.owner === "unassigned") where.push("assigned_to is null");
  if (f.owner === "mine" && f.viewerId) {
    params.push(f.viewerId);
    where.push(`assigned_to = $${params.length}`);
  }
  if (f.q) {
    params.push(`%${f.q}%`);
    where.push(
      `(title ilike $${params.length} or coalesce(solicitation_number,'') ilike $${params.length} or coalesce(agency,'') ilike $${params.length})`
    );
  }
  return where;
}

export async function opportunityTableCount(f: OppTableFilters = {}): Promise<number> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return 0;
  const params: unknown[] = [orgId];
  const where = oppTableWhere(f, params);
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from opportunities
      where org_id = $1${where.length ? ` and ${where.join(" and ")}` : ""}`,
    params
  );
  return row?.n ?? 0;
}

export async function opportunityTable(
  f: OppTableFilters = {},
  page?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
): Promise<Opportunity[]> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return [];
  const params: unknown[] = [orgId];
  const where = oppTableWhere(f, params);

  // Default: soonest deadline first, undated last. An explicit sort replaces
  // it; id is always the final tiebreak so the ordering is total and a row
  // cannot appear on two pages or neither.
  const column = page?.sort ? OPP_SORTS[page.sort] : undefined;
  const direction = page?.direction === "desc" ? "desc" : "asc";
  const orderBy = column
    ? `${column} ${direction}, id asc`
    : "(deadline is null), deadline asc, id asc";

  params.push(page?.limit ?? 100);
  const limitAt = params.length;
  params.push(page?.offset ?? 0);
  const offsetAt = params.length;

  return query<Opportunity>(
    `select * from opportunities
      where org_id = $1${where.length ? ` and ${where.join(" and ")}` : ""}
      order by ${orderBy}
      limit $${limitAt} offset $${offsetAt}`,
    params
  );
}

export async function reviewQueue(): Promise<Opportunity[]> {
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return [];
  return query<Opportunity>(
    `select * from opportunities
      where org_id = $1 and tier='review' and human_action_required=true and status='open'
      order by (review_expires_at is null), review_expires_at asc`,
    [orgId]
  );
}

/**
 * A CallCardRow carries everything the Call Workspace needs to render on a
 * single screen, contractor contact info, project context (scope, agency,
 * value, deadline), attachments, prior comms, prior quotes, and the SOW-derived
 * script + question list. Building the whole workspace off one query means the
 * operator never has to click into a second page during a call.
 */
export interface CallCardRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  card_json: Record<string, unknown>;
  call_script: string | null;
  /**
   * Job-specific questions, as stored in the jsonb column: typed CallQuestion
   * objects since Call Prep started emitting an answer type per question, and
   * plain strings on every card written before that. Declared as unknown[]
   * because it is genuinely both, and coerceQuestions() in domain/call-guide
   * is the one place that decides which. It was still typed string[] after the
   * writer changed shape, which is a type describing history rather than data.
   */
  question_list: unknown[] | null;
  needs_project_history: boolean;
  status: string;
  /** 'reply' = the sub responded; 'outreach' = cold follow-up after we emailed. */
  source: string;
  response_json: Record<string, unknown> | null;
  quote_amount: number | null;
  // Contractor
  company_name: string;
  owner_name: string | null;
  email: string | null;
  /** Whether that address was ever confirmed deliverable. */
  email_verified?: boolean;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  /** When we last wrote to them, ISO. Null when we never have. */
  last_contacted?: string | null;
  /** When this card was last dialled, ISO. Null when it never has been. */
  called_at?: string | null;
  /** Dials with no answer recorded against this card. */
  attempts?: number | null;
  google_rating: number | null;
  reliability_score: number | null;
  license_status: string | null;
  sam_excluded: boolean;
  trade_categories: string[] | null;
  // Opportunity
  opportunity_title: string | null;
  agency: string | null;
  naics_code: string | null;
  set_aside_type: string | null;
  value_estimated: number | null;
  value_estimated_source: string | null;
  location_state: string | null;
  /** The job site from the notice (city/base), not the sub's own city. */
  opportunity_location: string | null;
  deadline: string | null;
  solicitation_number: string | null;
  description: string | null;
  solicitation_analysis: Record<string, unknown> | null;
  attachments_json: unknown[] | null;
  // Contextual (per-call)
  trade: string | null;
}

export async function callQueue(): Promise<CallCardRow[]> {
  const orgId = await currentOrg();
  return query<CallCardRow>(
    `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
            cc.question_list, cc.needs_project_history, cc.status, cc.source,
            cc.response_json, cc.quote_amount,
            s.company_name, s.owner_name, s.email, s.phone, s.website, s.address,
            s.city, s.state, s.google_rating, s.reliability_score, s.license_status,
            s.sam_excluded, s.trade_categories,
            o.title as opportunity_title, o.agency, o.naics_code, o.set_aside_type,
            o.value_estimated, o.value_estimated_source, o.location_state, o.location_text as opportunity_location,
            o.deadline, o.solicitation_number,
            o.description, o.solicitation_analysis, o.attachments_json,
            /*
             * What the queue needs before anybody dials: whether the address
             * was ever confirmed, when we last wrote, how many times this card
             * has been tried, and the state, which is only used to work out
             * the hour where they are.
             */
            s.email_verified, s.last_contacted::text as last_contacted,
            cc.called_at::text as called_at,
            coalesce((cc.response_json->>'attempts')::int, 0) as attempts,
            (select trade from opportunity_subs os
              where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
       join opportunities o on o.id = cc.opportunity_id
      where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL}
      order by (cc.source='reply') desc, (o.deadline is null), o.deadline asc`,
    [orgId]
  );
}

/**
 * Fetch ONE call card with its full workspace projection, regardless of status
 * (so a completed card can be reopened for review). Same shape as callQueue().
 */
export async function callCardById(id: string): Promise<CallCardRow | null> {
  const orgId = await currentOrg();
  return queryOne<CallCardRow>(
    `select cc.id, cc.opportunity_id, cc.subcontractor_id, cc.card_json, cc.call_script,
            cc.question_list, cc.needs_project_history, cc.status, cc.source,
            cc.response_json, cc.quote_amount,
            s.company_name, s.owner_name, s.email, s.phone, s.website, s.address,
            s.city, s.state, s.google_rating, s.reliability_score, s.license_status,
            s.sam_excluded, s.trade_categories,
            o.title as opportunity_title, o.agency, o.naics_code, o.set_aside_type,
            o.value_estimated, o.value_estimated_source, o.location_state, o.location_text as opportunity_location,
            o.deadline, o.solicitation_number,
            o.description, o.solicitation_analysis, o.attachments_json,
            (select trade from opportunity_subs os
              where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
       from call_cards cc
       join subcontractors s on s.id = cc.subcontractor_id
       join opportunities o on o.id = cc.opportunity_id
      where cc.id=$1 and cc.org_id=$2`,
    [id, orgId]
  );
}

/** Fetch prior communications + quotes for the (sub, opp) pair, used by the Call Workspace. */
export async function callCardHistory(subId: string, oppId: string) {
  const orgId = await currentOrg();
  const [communications, quotes] = await Promise.all([
    query(
      `select id, channel, direction, subject, body, created_at, replied_at
         from communications
        where subcontractor_id=$1 and opportunity_id=$2 and org_id=$3
        order by created_at desc limit 20`,
      [subId, oppId, orgId]
    ),
    query(
      `select id, trade, quote_amount, payment_terms, is_out_of_range, created_at
         from quotes where subcontractor_id=$1 and opportunity_id=$2 and org_id=$3
        order by created_at desc limit 50`,
      [subId, oppId, orgId]
    ),
  ]);
  return { communications, quotes };
}

export interface SubFilters {
  trade?: string;
  state?: string;
  minReliability?: number;
  activeOnly?: boolean;
  q?: string;
  /** Only subs marked preferred. */
  preferred?: boolean;
  /**
   * Where the email stands: verified, unverified, none found, or never
   * checked. The roster's single most consequential fact -- an unverified
   * address is an outreach that will not go out -- and it was not filterable.
   */
  emailHealth?: "verified" | "unverified" | "none" | "unchecked";
  /** Licence state as reported by Sub Verify. */
  license?: "active" | "other" | "unknown";
  /** Minimum Google rating. */
  minRating?: number;
  /** Subs not contacted in this many days (or never). */
  quietDays?: number;
  /** Small-business certified. */
  sbOnly?: boolean;
  /** Include blocked subs, which are hidden by default. */
  includeBlocked?: boolean;
  /**
   * Include records put aside or folded into another, both hidden by default.
   *
   * Separate from `includeBlocked` because they are different statements. A
   * blocked firm is one somebody decided not to use; an archived one is simply
   * not in play; a merged one is not a firm at all any more, it is a pointer to
   * the record that absorbed it. A roster that mixed the three would eventually
   * have somebody email a tombstone.
   */
  includeArchived?: boolean;
  /**
   * Whether anybody could reach this firm at all: a verified address or a
   * phone number. The same predicate the record header uses for its
   * operational state, so a filter and a badge cannot disagree.
   */
  contactable?: "yes" | "no";
  /** Award-blocking paperwork: complete, or something outstanding. */
  paperwork?: "ready" | "short";
  /** Firms that will actually travel to this state. */
  worksIn?: string;
  /** Holds this set-aside certification. */
  certification?: string;
  /** Bonded to at least this much on a single job, in cents. */
  minBondCents?: number;
  /** Crew of at least this many. Excludes firms whose crew nobody has asked about. */
  minCrew?: number;
  /**
   * Rate filters, each with the denominator they need to mean anything.
   *
   * A firm nobody has emailed has no response rate. Reading that as 0% would
   * put every new firm at the bottom of a "responds at least half the time"
   * filter, which is the opposite of what the filter is for: those are the
   * firms most in need of a first touch. So a firm below the minimum evidence
   * is excluded from a rate filter rather than scored at zero, and the roster
   * says how many were set aside.
   */
  minResponseRate?: number;
  minQuoteRate?: number;
  minAwardRate?: number;
  /** How many sends a rate has to be built on before it counts. */
  rateEvidence?: number;
  /** Carries this tag. Matched without regard to case, as tags are stored. */
  tag?: string;
}

/** Below this, a rate is an accident rather than a pattern. */
export const DEFAULT_RATE_EVIDENCE = 3;

/**
 * Columns the roster may be sorted by, and the SQL each one means.
 *
 * A whitelist rather than string interpolation: a sort key arrives from a
 * query string, and a query string is a place a stranger can write.
 */
export const SUB_SORTS: Record<string, string> = {
  company_name: "company_name",
  state: "state nulls last",
  reliability_score: "coalesce(reliability_score,0)",
  google_rating: "coalesce(google_rating,0)",
  last_contacted: "last_contacted nulls last",
  license_status: "license_status nulls last",
};

/**
 * How many award-blocking documents this subcontractor is short.
 *
 * One fragment, used by every list and drawer that needs the number, so a
 * firm cannot read "Ready" on the roster and "Missing documents" on its own
 * record. The doc types are asserted against REQUIRED_FOR_AWARD by a test, so
 * adding a fourth required document cannot leave this behind.
 *
 * Counted rather than inferred from a document count: a subcontractor with
 * three pending uploads and no current coverage has documents and is still
 * not clear.
 */
export const REQUIRED_DOC_SQL_TYPES = ["w9", "coi_general_liability", "coi_workers_comp"] as const;

function unmetRequiredDocsSql(subAlias: string): string {
  const list = REQUIRED_DOC_SQL_TYPES.map((t) => `'${t}'`).join(",");
  return `(select count(*)::int
             from unnest(array[${list}]) t(doc_type)
            where not exists (
              select 1 from subcontractor_documents d
               where d.subcontractor_id = ${subAlias}.id
                 and d.doc_type = t.doc_type
                 and d.status in ('active','expiring')
                 and (d.expires_at is null or d.expires_at > now())
            ))`;
}

function subWhere(filters: SubFilters, params: unknown[]): string[] {
  // org_id stays in the query text rather than in the interpolated list, so
  // the scoping is visible to anyone reading the statement, and to the guard
  // in tests/agent-scoping.test.ts, which cannot see inside an interpolation.
  const where: string[] = [];
  // Blocked subs are hidden unless asked for. They are still on the roster --
  // "we decided not to use these" is a fact worth keeping -- but they are not
  // candidates, and mixing them into the default list means someone eventually
  // emails one.
  if (!filters.includeBlocked) where.push("blacklisted = false");
  /*
   * Archived and merged records are out of the roster unless asked for. The
   * merged ones matter most: a tombstone has no history of its own any more,
   * so it reads as a firm nobody has ever dealt with, and it is the record
   * least deserving of the next outreach email.
   */
  if (!filters.includeArchived) where.push("archived_at is null");
  if (filters.trade) {
    params.push(filters.trade);
    where.push(`$${params.length} = any(trade_categories)`);
  }
  if (filters.state) {
    params.push(filters.state);
    where.push(`state = $${params.length}`);
  }
  if (filters.minReliability != null) {
    params.push(filters.minReliability);
    where.push(`coalesce(reliability_score,0) >= $${params.length}`);
  }
  if (filters.minRating != null) {
    params.push(filters.minRating);
    where.push(`coalesce(google_rating,0) >= $${params.length}`);
  }
  if (filters.preferred) where.push("is_preferred = true");
  if (filters.sbOnly) where.push("sb_certified = true");
  if (filters.emailHealth === "verified") where.push("email is not null and email_verified");
  if (filters.emailHealth === "unverified") where.push("email is not null and not email_verified");
  if (filters.emailHealth === "none") where.push("email is null and contact_status is not null");
  if (filters.emailHealth === "unchecked") where.push("email is null and contact_status is null");
  if (filters.license === "active") where.push("lower(coalesce(license_status,'')) = 'active'");
  if (filters.license === "other") {
    where.push("license_status is not null and lower(license_status) <> 'active'");
  }
  if (filters.license === "unknown") where.push("license_status is null");
  if (filters.quietDays != null) {
    params.push(filters.quietDays);
    // Never contacted counts as quiet. It is the loudest version of quiet, and
    // excluding it would hide exactly the subs most in need of a first touch.
    where.push(
      `(last_contacted is null or last_contacted < now() - make_interval(days => $${params.length}))`
    );
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    where.push(
      `(company_name ilike $${params.length} or coalesce(owner_name,'') ilike $${params.length} or coalesce(email,'') ilike $${params.length})`
    );
  }

  /*
   * Reachability, written once. The same predicate the record header's
   * operational state uses, so a firm cannot be "Bad contact information" on
   * its page and pass a "contactable" filter on the roster.
   */
  const REACHABLE =
    "((email is not null and btrim(email) <> '' and email_verified) or (phone is not null and btrim(phone) <> ''))";
  if (filters.contactable === "yes") where.push(REACHABLE);
  if (filters.contactable === "no") where.push(`not ${REACHABLE}`);

  if (filters.paperwork === "ready") where.push(`${unmetRequiredDocsSql("subcontractors")} = 0`);
  if (filters.paperwork === "short") where.push(`${unmetRequiredDocsSql("subcontractors")} > 0`);

  if (filters.worksIn) {
    params.push(filters.worksIn.toUpperCase());
    /*
     * The firm's own state counts when no service area has been recorded.
     * Excluding every firm nobody has asked about their travel would empty
     * this filter on a roster that has barely been surveyed.
     */
    where.push(
      `(service_area_states is not null and $${params.length} = any(service_area_states)
        or (service_area_states is null and upper(coalesce(state,'')) = $${params.length}))`
    );
  }
  if (filters.certification) {
    params.push(filters.certification);
    where.push(`certifications is not null and $${params.length} = any(certifications)`);
  }
  if (filters.minBondCents != null) {
    params.push(filters.minBondCents);
    // A bond nobody has recorded is not a bond big enough, so it does not pass.
    where.push(`bonded = true and bond_single_cents >= $${params.length}`);
  }
  if (filters.minCrew != null) {
    params.push(filters.minCrew);
    where.push(`crew_size >= $${params.length}`);
  }

  if (filters.tag) {
    params.push(filters.tag);
    where.push(
      `exists (select 1 from subcontractor_tags t
                where t.subcontractor_id = subcontractors.id and lower(t.tag) = lower($${params.length}))`
    );
  }

  const evidence = filters.rateEvidence ?? DEFAULT_RATE_EVIDENCE;
  const sends = `(select count(*) from communications c
                   where c.subcontractor_id = subcontractors.id and c.direction = 'outbound')`;
  if (filters.minResponseRate != null) {
    params.push(evidence);
    const at = params.length;
    params.push(filters.minResponseRate);
    where.push(
      `${sends} >= $${at}
       and (select count(*) from communications c
             where c.subcontractor_id = subcontractors.id and c.direction = 'outbound'
               and c.replied_at is not null)::numeric / nullif(${sends}, 0) * 100 >= $${params.length}`
    );
  }
  if (filters.minQuoteRate != null) {
    params.push(evidence);
    const at = params.length;
    params.push(filters.minQuoteRate);
    where.push(
      `${sends} >= $${at}
       and (select count(*) from quotes q where q.subcontractor_id = subcontractors.id)::numeric
           / nullif(${sends}, 0) * 100 >= $${params.length}`
    );
  }
  if (filters.minAwardRate != null) {
    /*
     * Awards over quotes, not over sends. A firm that quoted twice and won
     * both has a perfect record at the thing this measures; dividing by the
     * emails they were sent would measure our outreach instead of their bids.
     */
    const quoted = `(select count(*) from quotes q where q.subcontractor_id = subcontractors.id)`;
    params.push(evidence);
    const at = params.length;
    params.push(filters.minAwardRate);
    where.push(
      `${quoted} >= $${at}
       and (select count(*) from contracts ct
             where ct.primary_sub_id = subcontractors.id)::numeric
           / nullif(${quoted}, 0) * 100 >= $${params.length}`
    );
  }
  return where;
}

/** How many subcontractors match, before paging. */
export async function subDatabaseCount(filters: SubFilters = {}): Promise<number> {
  const orgId = await currentOrg();
  const params: unknown[] = [orgId];
  const where = subWhere(filters, params);
  const row = await queryOne<{ n: number }>(
    `select count(*)::int as n from subcontractors
      where org_id = $1${where.length ? ` and ${where.join(" and ")}` : ""}`,
    params
  );
  return row?.n ?? 0;
}

export async function subDatabase(
  filters: SubFilters = {},
  page?: { sort?: string; direction?: "asc" | "desc"; limit?: number; offset?: number }
): Promise<Subcontractor[]> {
  const orgId = await currentOrg();
  const params: unknown[] = [orgId];
  const where = subWhere(filters, params);

  /*
   * The default order is a judgement, not an accident: preferred subs first,
   * then the most reliable. An explicit sort replaces it, and company_name is
   * always the last tiebreak so the order is total -- two subs with the same
   * rating must not swap places between page 1 and page 2, which is how a row
   * appears twice or not at all while paging.
   */
  const column = page?.sort ? SUB_SORTS[page.sort] : undefined;
  const direction = page?.direction === "desc" ? "desc" : "asc";
  const orderBy = column
    ? `${column} ${direction}, company_name asc`
    : "is_preferred desc, coalesce(reliability_score,0) desc, company_name asc";

  params.push(page?.limit ?? 500);
  const limitAt = params.length;
  params.push(page?.offset ?? 0);
  const offsetAt = params.length;

  /*
   * Unaliased, deliberately. subWhere writes correlated subqueries against
   * `subcontractors`, and an alias would hide the table name from them.
   */
  return query<Subcontractor>(
    `select subcontractors.*, ${unmetRequiredDocsSql("subcontractors")} as unmet_required_docs
       from subcontractors
      where org_id = $1${where.length ? ` and ${where.join(" and ")}` : ""}
      order by ${orderBy}
      limit $${limitAt} offset $${offsetAt}`,
    params
  );
}

/*
 * The paged email log lived here. It is gone with the page it fed: a list of
 * messages could not answer "who is waiting on me", which is a property of a
 * conversation rather than of a row. lib/conversations.ts replaces it, and
 * lib/domain/message-state.ts replaces its status vocabulary -- which could
 * not tell a policy block apart from a bad address, so the two states that
 * need opposite fixes read the same.
 */


export interface SubCommRow {
  id: string;
  channel: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  replied_at: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  provider: string | null;
  recipient_email: string | null;
}

export interface SubContactStats {
  emails_sent: number;
  emails_in: number;
  calls_logged: number;
  notes_count: number;
  skips_logged: number;
  touches: number;
}

/** Opportunity pairings for the persistent sub record. */
export interface SubPairingRow {
  opportunity_id: string;
  opportunity_title: string | null;
  stage: string;
  deadline: string | null;
  trade: string | null;
  outreach_state: string | null;
  responded_at: string | null;
  quote_amount: number | null;
  status: string;
}

export async function subDetail(id: string) {
  let orgId: string | null = null;
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    orgId = await tryResolveTenantOrgId();
  } catch {
    orgId = null;
  }
  const sub = orgId
    ? await queryOne<Subcontractor>(
        `select * from subcontractors where id=$1 and org_id=$2`,
        [id, orgId]
      )
    : await queryOne<Subcontractor>(`select * from subcontractors where id=$1`, [id]);
  if (!sub) return null;
  const [communications, quotes, stats, pairings] = await Promise.all([
    query<SubCommRow>(
      `select c.id, c.channel, c.direction, c.subject, c.body, c.created_at, c.replied_at,
              c.opportunity_id, o.title as opportunity_title, c.provider, c.recipient_email
         from communications c
         left join opportunities o on o.id = c.opportunity_id
        where c.subcontractor_id = $1
        order by c.created_at desc
        limit 100`,
      [id]
    ),
    query(
      `select q.*, o.title as opportunity_title, o.id as opportunity_id from quotes q
         join opportunities o on o.id=q.opportunity_id
        where q.subcontractor_id=$1 order by q.created_at desc limit 100`,
      [id]
    ),
    queryOne<SubContactStats>(
      `select
         count(*) filter (where channel = 'email' and direction = 'outbound')::int as emails_sent,
         count(*) filter (where channel = 'email' and direction = 'inbound')::int as emails_in,
         count(*) filter (where channel = 'call')::int as calls_logged,
         count(*) filter (where channel = 'note')::int as notes_count,
         count(*) filter (
           where channel = 'note' and subject ilike 'Skipped%'
         )::int as skips_logged,
         count(*)::int as touches
       from communications
       where subcontractor_id = $1`,
      [id]
    ),
    query<SubPairingRow>(
      `select os.opportunity_id, o.title as opportunity_title, o.stage, o.deadline, o.status,
              os.trade, os.outreach_state, os.responded_at,
              q.quote_amount
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         left join lateral (
           select quote_amount
             from quotes
            where opportunity_id = os.opportunity_id
              and subcontractor_id = os.subcontractor_id
            order by created_at desc
            limit 1
         ) q on true
        where os.subcontractor_id = $1
        order by o.deadline asc nulls last, o.updated_at desc
        limit 50`,
      [id]
    ),
  ]);
  return {
    sub,
    communications,
    quotes,
    pairings,
    stats: stats ?? {
      emails_sent: 0,
      emails_in: 0,
      calls_logged: 0,
      notes_count: 0,
      skips_logged: 0,
      touches: 0,
    },
  };
}

export async function complianceBoard() {
  const items = await query(
    `select ci.*, c.contract_number,
            -- Who here is renewing it. Joined rather than fetched per card.
            coalesce(nullif(btrim(au.name), ''), split_part(au.email, '@', 1)) as assigned_name
       from compliance_items ci
       left join contracts c on c.id = ci.contract_id
       left join users au on au.id = ci.assigned_to
      where ci.org_id = $1
      order by
        /*
         * Worst first, in the vocabulary the rows now carry. The old ordering
         * named 'critical' and 'warning', which no longer exist, so every row
         * fell into the else branch and the board came back in date order with
         * a conflicting registration below a certificate expiring in a month.
         */
        case ci.status
          when 'conflicting'    then 0
          when 'expired'        then 1
          when 'blocked'        then 2
          when 'needs_review'   then 3
          when 'expiring_soon'  then 4
          when 'cannot_monitor' then 5
          when 'incomplete'     then 6
          else 7 end,
        (ci.due_at is null), ci.due_at asc`,
    [await currentOrg()]
  );
  return items;
}

/**
 * A timestamp column as an ISO string, whatever the driver handed back.
 *
 * node-postgres returns a `Date` for a `timestamptz`, and the row types here
 * declare these columns as `string`. TypeScript accepts that and the runtime
 * does not: a `Date` reaching anything that slices or compares strings throws,
 * and the last time that happened it took down an entire page for every
 * account that had one row with a date in it. Normalized once, here, so
 * everything downstream gets the shape its type promises.
 */
function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * What the operator actually finished today.
 *
 * Not derived from the queue. The queue is what is left, so an empty queue
 * would give the same answer for "nothing to do" and "everything done", which
 * are opposite mornings. These come from the timestamps the work itself
 * leaves behind: a call placed, a quote entered, a bid submitted, a decision
 * recorded, a compliance item resolved.
 *
 * The day boundary is the database's, which is the server's. That is a real
 * limitation on an account whose operator is several timezones away, and it
 * is named here rather than papered over: the alternative is passing a
 * timezone from the browser into a server component, which arrives one render
 * late and would make the counter flicker.
 */
export interface CompletedToday {
  calls: number;
  quotes: number;
  bidsSubmitted: number;
  decisions: number;
  complianceResolved: number;
  total: number;
}

export async function completedToday(): Promise<CompletedToday> {
  const orgId = await currentOrg();
  const row = await queryOne<Record<string, string>>(
    `select
       (select count(*) from call_cards cc
          join opportunities o on o.id = cc.opportunity_id
         where o.org_id = $1 and cc.called_at >= date_trunc('day', now()))::text as calls,
       (select count(*) from quotes q
         where q.org_id = $1 and q.created_at >= date_trunc('day', now()))::text as quotes,
       (select count(*) from bids b
         where b.org_id = $1 and b.submitted_at >= date_trunc('day', now()))::text as bids,
       (select count(*) from opportunities o
         where o.org_id = $1 and o.human_action_required = false
           and o.updated_at >= date_trunc('day', now())
           and o.stage <> 'discovered')::text as decisions,
       (select count(*) from compliance_items ci
         where ci.org_id = $1 and ci.status_override = 'resolved'
           and ci.updated_at >= date_trunc('day', now()))::text as compliance`,
    [orgId]
  );

  const n = (v: string | undefined) => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? x : 0;
  };
  const calls = n(row?.calls);
  const quotes = n(row?.quotes);
  const bidsSubmitted = n(row?.bids);
  const decisions = n(row?.decisions);
  const complianceResolved = n(row?.compliance);
  return {
    calls,
    quotes,
    bidsSubmitted,
    decisions,
    complianceResolved,
    total: calls + quotes + bidsSubmitted + decisions + complianceResolved,
  };
}

/**
 * What has happened lately, for Guide Me's "What changed".
 *
 * Deliberately not an AI answer. "What changed" is a list of events, and the
 * ledger already holds them: asking a model to summarise a list it has been
 * handed adds a place for the answer to be wrong and takes away the timestamps.
 * The brief's rule is to generate guidance from structured state and use AI
 * only to explain it, and this is the half that is structured state.
 */
export interface RecentChange {
  at: string;
  /** What happened, in the words the log recorded. */
  text: string;
  /** True when the platform did it rather than a person. */
  automatic: boolean;
}

export async function recentChanges(opts: {
  /** Scope to one opportunity when the guide is open on its record. */
  opportunityId?: string | null;
  days?: number;
  limit?: number;
} = {}): Promise<RecentChange[]> {
  const orgId = await currentOrg();
  const days = Math.min(30, Math.max(1, opts.days ?? 7));
  const limit = Math.min(50, Math.max(1, opts.limit ?? 12));
  const rows = await query<{
    created_at: Date;
    message: string | null;
    action: string;
    agent: string;
    status: string | null;
  }>(
    `select created_at, message, action, agent, status
       from agent_logs
      where org_id = $1
        and created_at >= now() - ($2 || ' days')::interval
        and ($3::uuid is null or opportunity_id = $3::uuid)
        -- Skipped work did not change anything, and a list of non-events is
        -- how "what changed" becomes noise nobody reads.
        and coalesce(status, 'ok') <> 'skipped'
      order by created_at desc
      limit $4`,
    [orgId, String(days), opts.opportunityId ?? null, limit]
  );
  return rows.map((r) => ({
    at: r.created_at.toISOString(),
    // The recorded message, or the action when nothing wrote one. Never a
    // generated sentence: this list is the record, not a reading of it.
    text: r.message?.trim() || `${r.agent}: ${r.action.replace(/[_-]+/g, " ")}`,
    automatic: r.agent !== "assignment" && r.agent !== "operator",
  }));
}

/**
 * One finished piece of work, for the Completed today filter.
 *
 * The counters answer "how much"; this answers "what", which is the question
 * somebody actually has at five o'clock. A count of 6 and a list of the six
 * are different objects and only one of them can be checked against memory.
 */
export interface CompletedItem {
  key: string;
  kind: WorkKind;
  /** What was done, in the words the rest of the queue uses. */
  title: string;
  /** The record it happened to. */
  context: string;
  href: string;
  /** When it happened, ISO. */
  at: string;
}

/**
 * What was finished today, as records rather than as a total.
 *
 * From the five places the work leaves its mark, which is the same five the
 * counter above adds up. Deliberately not from the queue: the queue holds what
 * is LEFT, so deriving completions from it would give the same answer for
 * "nothing to do" and "everything done", which are opposite mornings.
 *
 * Capped, and ordered newest first. An operator scanning what they finished
 * wants the last hour before the first, and a day that produced two hundred
 * rows is one where the top fifty answer the question.
 */
export async function completedTodayItems(limit = 50): Promise<CompletedItem[]> {
  const orgId = await currentOrg();
  const rows = await query<{
    key: string;
    kind: string;
    title: string;
    context: string;
    href: string;
    at: Date;
  }>(
    `select * from (
       select
         'call:' || cc.id::text as key,
         'call' as kind,
         'Called ' || coalesce(s.company_name, 'a subcontractor') as title,
         coalesce(o.title, 'An opportunity') as context,
         '/opportunity/' || o.id::text as href,
         cc.called_at as at
       from call_cards cc
       join opportunities o on o.id = cc.opportunity_id
       left join subcontractors s on s.id = cc.subcontractor_id
       where o.org_id = $1 and cc.called_at >= date_trunc('day', now())

       union all
       select
         'quote:' || q.id::text,
         'enter_quote',
         'Entered a quote' || coalesce(' for ' || q.trade, ''),
         coalesce(o.title, 'An opportunity'),
         '/opportunity/' || o.id::text,
         q.created_at
       from quotes q
       join opportunities o on o.id = q.opportunity_id
       where q.org_id = $1 and q.created_at >= date_trunc('day', now())

       union all
       select
         'bid:' || b.id::text,
         'review_bid',
         'Submitted the bid',
         coalesce(o.title, 'An opportunity'),
         '/opportunity/' || o.id::text,
         b.submitted_at
       from bids b
       join opportunities o on o.id = b.opportunity_id
       where b.org_id = $1 and b.submitted_at >= date_trunc('day', now())

       union all
       select
         'decision:' || o.id::text,
         'decide',
         'Decided: ' || o.stage,
         coalesce(o.title, 'An opportunity'),
         '/opportunity/' || o.id::text,
         o.updated_at
       from opportunities o
       where o.org_id = $1 and o.human_action_required = false
         and o.updated_at >= date_trunc('day', now())
         and o.stage <> 'discovered'

       union all
       select
         'compliance:' || ci.id::text,
         'fix_blocker',
         'Resolved ' || ci.label,
         ci.category,
         '/compliance',
         ci.updated_at
       from compliance_items ci
       where ci.org_id = $1 and ci.status_override = 'resolved'
         and ci.updated_at >= date_trunc('day', now())
     ) done
     order by at desc
     limit $2`,
    [orgId, limit]
  );
  return rows.map((r) => ({
    key: r.key,
    kind: r.kind as WorkKind,
    title: r.title,
    context: r.context,
    href: r.href,
    at: r.at.toISOString(),
  }));
}

/*
 * A peek id arrives from a query string, so it is whatever somebody typed.
 * Postgres raises on `uuid = 'not-a-uuid'`, which took the whole roster page
 * down on a malformed URL rather than simply showing no drawer. Checked here
 * rather than at each call site because there is no shape of bad id that
 * should reach the database.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One opportunity, as the table's peek drawer needs it.
 *
 * The same four small indexed reads the board's hover preview does, for the
 * same reason: this answers "should I open this" and must not cost what
 * opening it costs. `opportunityDetail` pulls hundreds of communications,
 * documents and log lines to render a page.
 */
export interface OppPeek {
  opp: Record<string, unknown>;
  requiredTrades: string[];
  tradesCovered: number;
  tradesRequired: number;
  quoteCount: number;
  subsContacted: number;
  subsResponded: number;
  bidSubmitted: boolean;
  outcome: string | null;
}

export async function oppPeek(id: string): Promise<OppPeek | null> {
  if (!UUID_RE.test(id)) return null;
  const orgId = await currentOrg();
  const opp = await queryOne<Record<string, unknown>>(
    `select * from opportunities where id = $1 and org_id = $2`,
    [id, orgId]
  );
  if (!opp) return null;

  const [subs, quotes, bid] = await Promise.all([
    query<{ trade: string | null; outreach_state: string | null; responded_at: string | null }>(
      `select trade, outreach_state, responded_at from opportunity_subs
        where opportunity_id = $1 limit 300`,
      [id]
    ),
    query<{ trade: string | null }>(
      `select trade from quotes where opportunity_id = $1 limit 200`,
      [id]
    ),
    queryOne<{ submitted_at: string | null; outcome: string | null }>(
      `select submitted_at::text as submitted_at, outcome from bids
        where opportunity_id = $1 order by created_at desc limit 1`,
      [id]
    ),
  ]);

  const analysis = opp.solicitation_analysis as { required_trades?: string[] } | null;
  const requiredTrades = analysis?.required_trades ?? [];
  const quotedTrades = new Set(
    quotes.map((q) => (q.trade ?? "").toLowerCase()).filter(Boolean)
  );

  return {
    opp,
    requiredTrades,
    tradesRequired: requiredTrades.length,
    tradesCovered: requiredTrades.filter((t) => quotedTrades.has(t.toLowerCase())).length,
    quoteCount: quotes.length,
    subsContacted: subs.filter((s) => s.outreach_state && s.outreach_state !== "pending").length,
    subsResponded: subs.filter((s) => s.responded_at != null).length,
    bidSubmitted: Boolean(bid?.submitted_at),
    outcome: bid?.outcome ?? null,
  };
}

/**
 * Agent and operator log lines about one subcontractor.
 *
 * The unified timeline existed and only the opportunity record used it, so a
 * subcontractor's own page could show their emails and their quotes but not
 * the decisions taken about them: who marked them preferred, when the sweep
 * expired their certificate, why outreach skipped them. Those are exactly the
 * lines somebody is looking for when they open a record and ask what happened.
 */
export async function subActivityLogs(subId: string) {
  if (!UUID_RE.test(subId)) return [];
  const orgId = await currentOrg();
  return query<Record<string, unknown>>(
    `select agent, action, message, reasoning, created_at::text as created_at
       from agent_logs
      where subcontractor_id = $1 and (org_id = $2 or org_id is null)
      order by created_at desc
      limit 200`,
    [subId, orgId]
  );
}

/**
 * One subcontractor, as the roster's peek drawer needs them.
 *
 * Includes the raw counts the reliability score is computed from, so the
 * drawer can show the arithmetic rather than a bare number out of a hundred.
 * They are counted here rather than read off a stored column because there is
 * no stored column for them: the learning loop computes them, writes the
 * score, and throws the inputs away.
 */
export interface SubPeekRow {
  id: string;
  company_name: string;
  owner_name: string | null;
  email: string | null;
  email_verified: boolean;
  contact_status: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  trade_categories: string[] | null;
  license_number: string | null;
  license_status: string | null;
  sam_excluded: boolean;
  blacklisted: boolean;
  blacklist_reason: string | null;
  archived_at: string | null;
  archived_reason: string | null;
  merged_into: string | null;
  is_preferred: boolean;
  reliability_score: number | null;
  last_contacted: string | null;
  google_rating: string | number | null;
  review_count: number | null;
  outreach: string | number;
  responded_48h: string | number;
  responded_any: string | number;
  quote_count: string | number;
  open_docs: string | number;
  expired_docs: string | number;
  /**
   * Required-for-award documents with nothing current on file. Counted here
   * rather than inferred from `open_docs`, because a subcontractor with three
   * pending uploads and no current coverage has documents and is still not
   * clear.
   */
  unmet_required_docs: string | number;
}

export async function subPeek(id: string): Promise<SubPeekRow | null> {
  if (!UUID_RE.test(id)) return null;
  const orgId = await currentOrg();
  return queryOne<SubPeekRow>(
    `select s.id, s.company_name, s.owner_name, s.email, s.email_verified,
            s.contact_status, s.phone, s.city, s.state, s.trade_categories,
            s.license_number, s.license_status, s.sam_excluded, s.blacklisted,
            s.blacklist_reason, s.archived_at::text as archived_at, s.archived_reason,
            s.merged_into::text as merged_into,
            s.is_preferred, s.reliability_score,
            s.last_contacted::text as last_contacted,
            s.google_rating, s.review_count,
            (select count(*) from communications c
              where c.subcontractor_id = s.id and c.direction = 'outbound'
                and c.org_id = $2) as outreach,
            (select count(*) from communications c
              where c.subcontractor_id = s.id and c.direction = 'outbound'
                and c.org_id = $2 and c.replied_at is not null
                and c.replied_at <= c.created_at + interval '48 hours') as responded_48h,
            (select count(*) from communications c
              where c.subcontractor_id = s.id and c.direction = 'outbound'
                and c.org_id = $2 and c.replied_at is not null) as responded_any,
            (select count(*) from quotes q where q.subcontractor_id = s.id) as quote_count,
            (select count(*) from subcontractor_documents d
              where d.subcontractor_id = s.id
                and d.status in ('pending','active','expiring')) as open_docs,
            (select count(*) from subcontractor_documents d
              where d.subcontractor_id = s.id
                and (d.status = 'expired'
                     or (d.expires_at is not null and d.expires_at <= now()))) as expired_docs,
            ${unmetRequiredDocsSql("s")} as unmet_required_docs
       from subcontractors s
      where s.id = $1 and s.org_id = $2`,
    [id, orgId]
  );
}

/**
 * Subcontractor paperwork for the compliance board.
 *
 * Scoped to engaged subcontractors -- ones with paperwork already started, or
 * named on a contract. The alternative is every prospect ever sourced showing
 * up as "missing W-9", which would be true, useless, and would bury the few
 * that matter.
 *
 * Tenancy is enforced on the subcontractor's own org_id rather than on the
 * document's, because subcontractor_documents.org_id is nullable and rows
 * written before it existed carry null. Reading the gate off a nullable column
 * is how a tenant boundary quietly stops holding.
 */
export async function subcontractorComplianceRows() {
  const orgId = await currentOrg();
  return query<Record<string, unknown>>(
    `with engaged as (
       select distinct d.subcontractor_id as id
         from subcontractor_documents d
         join subcontractors s2 on s2.id = d.subcontractor_id and s2.org_id = $1
       union
       select c.primary_sub_id from contracts c
        where c.org_id = $1 and c.primary_sub_id is not null
       union
       select c.backup_sub_id from contracts c
        where c.org_id = $1 and c.backup_sub_id is not null
     ),
     on_contract as (
       select c.primary_sub_id as id from contracts c
        where c.org_id = $1 and c.primary_sub_id is not null
       union
       select c.backup_sub_id from contracts c
        where c.org_id = $1 and c.backup_sub_id is not null
     )
     select s.id as sub_id, s.company_name,
            (oc.id is not null) as on_contract,
            d.doc_type, d.status,
            d.expires_at::text as expires_at,
            d.signed_at::text as signed_at,
            d.verified_at::text as verified_at
       from engaged e
       join subcontractors s on s.id = e.id and s.org_id = $1
       left join on_contract oc on oc.id = s.id
       left join subcontractor_documents d on d.subcontractor_id = s.id
      order by s.company_name asc, d.doc_type asc`,
    [orgId]
  );
}

/**
 * Every contract, with the columns the five views need.
 *
 * One query rather than two: the views are derived from dates and health
 * signals, not from the stored status, so splitting by status in SQL would
 * mean re-deriving in two places and getting a contract that is both
 * "completed" and "at risk" depending on which list you opened it from.
 */
export async function allContracts() {
  const orgId = await currentOrg();
  return query<Record<string, unknown>>(
    `select c.*, o.title as opportunity_title,
            ps.company_name as primary_sub_name,
            bs.company_name as backup_sub_name,
            -- Who here is running it. Joined rather than fetched per card:
            -- the completed view can be a hundred rows.
            coalesce(nullif(btrim(au.name), ''), split_part(au.email, '@', 1)) as assigned_name
       from contracts c
       left join opportunities o on o.id = c.opportunity_id
       left join subcontractors ps on ps.id = c.primary_sub_id
       left join subcontractors bs on bs.id = c.backup_sub_id
       left join users au on au.id = c.assigned_to
      where c.org_id=$1
      order by c.end_date asc nulls last`,
    [orgId]
  );
}

export async function activeContracts() {
  const orgId = await currentOrg();
  return query(
    `select c.*, o.title as opportunity_title,
            ps.company_name as primary_sub_name,
            bs.company_name as backup_sub_name
       from contracts c
       left join opportunities o on o.id = c.opportunity_id
       left join subcontractors ps on ps.id = c.primary_sub_id
       left join subcontractors bs on bs.id = c.backup_sub_id
      where c.status='active' and c.org_id=$1
      order by c.end_date asc nulls last`,
    [orgId]
  );
}

/** Contracts no longer active (completed/closed), for the Past contracts view. */
export async function completedContracts() {
  const orgId = await currentOrg();
  return query(
    `select c.*, o.title as opportunity_title,
            ps.company_name as primary_sub_name,
            bs.company_name as backup_sub_name
       from contracts c
       left join opportunities o on o.id = c.opportunity_id
       left join subcontractors ps on ps.id = c.primary_sub_id
       left join subcontractors bs on bs.id = c.backup_sub_id
      where c.status <> 'active' and c.org_id=$1
      order by c.end_date desc nulls last, c.updated_at desc`,
    [orgId]
  );
}

export async function latestKpiSnapshot(): Promise<{
  data: Record<string, unknown>;
  generatedAt: Date | null;
} | null> {
  // `created_at` comes back too, because a breakdown with no date on it is
  // presented as current no matter how old it is. A win rate by agency from
  // six weeks ago is not wrong, but reading it as this week's is.
  const row = await queryOne<{ output_json: Record<string, unknown>; created_at: Date | null }>(
    `select output_json, created_at from agent_logs
      where agent='analytics-engine' and action='kpi-snapshot' and org_id=$1
      order by created_at desc limit 1`,
    [await currentOrg()]
  );
  if (!row?.output_json) return null;
  return {
    data: row.output_json,
    generatedAt: row.created_at instanceof Date ? row.created_at : null,
  };
}

/**
 * Which AI credential this account is spending, and what it has spent.
 *
 * Three things can stop every agent overnight and none of them was visible
 * anywhere in the interface: an exhausted credit balance, a borrowed key whose
 * grant expires, and a trial allowance reaching its cap. All three are
 * knowable in advance from data already stored, which is why this reads the
 * grant and the meter rather than only the failures.
 *
 * Every field can be absent, and absent is reported as absent. A window with
 * no recorded calls returns no rows, not a row of zeroes.
 */
export async function providerUsage(): Promise<{
  source: ProviderCredentialSource;
  grantExpiresAt: Date | null;
  callsOnPlatformKey: number | null;
  trialBudget: number | null;
  usageRows: Record<string, unknown>[];
}> {
  const orgId = await currentOrg();
  const KEY = "ANTHROPIC_API_KEY";
  const [own, grant, meter, usageRows] = await Promise.all([
    queryOne<{ ok: boolean }>(
      `select true as ok from integration_settings where env_key = $1 and org_id = $2`,
      [KEY, orgId]
    ).catch(() => null),
    queryOne<{ expires_at: Date | null }>(
      `select expires_at from platform_key_grants
        where org_id = $1 and env_key = $2
          and (expires_at is null or expires_at > now())`,
      [orgId, KEY]
    ).catch(() => null),
    queryOne<{ calls: number }>(
      `select calls from platform_key_usage where org_id = $1 and env_key = $2`,
      [orgId, KEY]
    ).catch(() => null),
    query<{ claude_usage: Record<string, unknown> }>(
      `select claude_usage from agent_logs
        where org_id = $1 and claude_usage is not null
          and created_at >= now() - interval '24 hours'
        limit 5000`,
      [orgId]
    ).catch(() => []),
  ]);

  // The same order the key resolver uses, so this panel cannot describe a
  // credential the automation is not actually spending. Own key first: an
  // account that has supplied one is never borrowing, whatever else exists.
  const { TRIAL_PLATFORM_KEY_BUDGET } = await import("./billing/trial-keys");
  const budget = TRIAL_PLATFORM_KEY_BUDGET[KEY] ?? null;
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  let source: ProviderCredentialSource;
  if (own) source = "own_key";
  else if (grant) source = "granted";
  else if (meter && budget != null && meter.calls > 0) source = "trial";
  // Last in the resolver's order, and easy to leave out: the founding
  // organization falls back to the environment. Omitting this branch reported
  // "no AI credential" on the one account where every agent was in fact
  // running, which is a worse answer than none.
  else if (orgId === LEGACY_ORG_ID && (process.env.ANTHROPIC_API_KEY ?? "").trim())
    source = "environment";
  else source = "none";

  return {
    source,
    grantExpiresAt: grant?.expires_at instanceof Date ? grant.expires_at : null,
    callsOnPlatformKey: meter ? Number(meter.calls) : null,
    trialBudget: source === "trial" ? budget : null,
    usageRows: usageRows
      .map((r) => r.claude_usage)
      .filter((u): u is Record<string, unknown> => !!u && typeof u === "object"),
  };
}

/**
 * How many opportunities sit at each score, for the threshold preview.
 *
 * Scoped to work whose recommendation still means something: anything that has
 * already started running is not un-started by raising the threshold, and
 * counting it would overstate the effect of the change. Dismissed rows ARE
 * included, because lowering the review floor is precisely how they come back.
 *
 * Returned as a 101-slot histogram rather than a row per opportunity, so the
 * preview recomputes in the browser as the number is typed without a request
 * per keystroke, and no opportunity data leaves the server to do it.
 */
export async function scoreHistogram(): Promise<number[]> {
  const rows = await query<{ score: number; n: number }>(
    `select score, count(*)::int as n
       from opportunities
      where org_id = $1 and status = 'open' and score is not null
        and stage in ('monitoring','scoring','analysis','dismissed')
      group by score`,
    [await currentOrg()]
  );
  const hist = new Array(101).fill(0);
  for (const r of rows) {
    const score = Number(r.score);
    if (Number.isInteger(score) && score >= 0 && score <= 100) {
      hist[score] += Number(r.n) || 0;
    }
  }
  return hist;
}

/**
 * What each outreach template has actually done, attributed from the send
 * record rather than from a counter.
 *
 * The attribution is exact because the sender already stamped it. An initial
 * outreach writes no `kind`; a follow-up writes `kind: "followup"` along with
 * `threaded`, which says whether it went into the original conversation or
 * fell back to a fresh one. Those three cases are precisely the three
 * templates the Content Library edits, so nothing here is inferred from
 * matching subject text, which would break the moment somebody edited a
 * template, which is the one thing this page exists to let them do.
 *
 * Delivered counts anything past the handover: a message that opened, was
 * clicked, was replied to, or that the provider confirmed. `sent` on its own
 * means "handed over and nothing came back", which is not delivery.
 */
export async function templateSendStats(): Promise<Record<string, TemplateCounts>> {
  const rows = await query<{
    slug: string;
    sent: number;
    delivered: number;
    opened: number;
    replied: number;
    bounced: number;
    last_sent_at: Date | null;
  }>(
    `select
       case
         when c.meta->>'kind' = 'followup' and c.meta->>'threaded' = 'false'
           then 'template_2_followup_new_thread'
         when c.meta->>'kind' = 'followup' then 'template_2_followup'
         else 'template_1_outreach'
       end as slug,
       count(*)::int as sent,
       count(*) filter (
         where c.delivery_state = 'delivered'
            or c.opened_at is not null
            or c.clicked_at is not null
            or c.replied_at is not null
       )::int as delivered,
       count(*) filter (where c.opened_at is not null)::int as opened,
       count(*) filter (where c.replied_at is not null)::int as replied,
       count(*) filter (where c.delivery_state in ('bounced','failed'))::int as bounced,
       max(c.created_at) as last_sent_at
     from communications c
    where c.org_id = $1 and c.channel = 'email' and c.direction = 'outbound'
    group by 1`,
    [await currentOrg()]
  );
  const out: Record<string, TemplateCounts> = {};
  for (const r of rows) {
    out[r.slug] = {
      sent: Number(r.sent) || 0,
      delivered: Number(r.delivered) || 0,
      opened: Number(r.opened) || 0,
      replied: Number(r.replied) || 0,
      bounced: Number(r.bounced) || 0,
      lastSentAt: r.last_sent_at instanceof Date ? r.last_sent_at.toISOString() : null,
    };
  }
  return out;
}

/** Live-computed KPIs as a fallback when the Analytics Engine hasn't run yet. */
export async function computeKpisFallback() {
  const orgId = await currentOrg();
  const row = await queryOne<{
    won: string;
    lost: string;
    avg_margin: string | null;
    pipeline_value: string | null;
    pipeline_valued: string | null;
    pipeline_total: string | null;
    active_revenue: string | null;
  }>(
    `select
       (select count(*) from bids where outcome='won' and org_id=$1) as won,
       (select count(*) from bids where outcome='lost' and org_id=$1) as lost,
       (select avg(margin_pct) from bids where outcome='won' and org_id=$1) as avg_margin,
       (select sum(value_estimated) from opportunities
         where stage not in ('dismissed','lost') and status='open' and org_id=$1) as pipeline_value,
       -- How many of those opportunities actually carry an estimate, and how
       -- many there are in total. Federal notices frequently publish no
       -- figure, so the sum alone describes an unknown fraction of the
       -- pipeline and reads as though it described all of it.
       (select count(value_estimated) from opportunities
         where stage not in ('dismissed','lost') and status='open' and org_id=$1) as pipeline_valued,
       (select count(*) from opportunities
         where stage not in ('dismissed','lost') and status='open' and org_id=$1) as pipeline_total,
       (select sum(c.award_amount) from contracts c
          left join opportunities o on o.id = c.opportunity_id
         where c.status='active' and c.org_id=$1
           and (o.id is null or o.status <> 'archived')) as active_revenue`,
    [orgId]
  );
  const won = Number(row?.won ?? 0);
  const lost = Number(row?.lost ?? 0);
  return {
    win_rate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null,
    wins: won,
    losses: lost,
    avg_margin_on_wins: row?.avg_margin ? Math.round(Number(row.avg_margin)) : null,
    pipeline_value: Number(row?.pipeline_value ?? 0),
    /** Opportunities carrying a published value, and the total in play. */
    pipeline_valued: Number(row?.pipeline_valued ?? 0),
    pipeline_total: Number(row?.pipeline_total ?? 0),
    active_contract_revenue: Number(row?.active_revenue ?? 0),
  };
}

/**
 * Live built-in analytics that don't depend on the AI Analytics Engine snapshot,
 * so the dashboard is useful the moment there's data: current pipeline counts and
 * the value sitting in each stage.
 */
export async function analyticsExtras(): Promise<{
  counts: { open_opps: number; new_30d: number; bids_30d: number; active_contracts: number };
  byStage: { stage: string; count: number; value: number; valued: number }[];
}> {
  const orgId = await currentOrg();
  const [counts, byStage] = await Promise.all([
    queryOne<{ open_opps: number; new_30d: number; bids_30d: number; active_contracts: number }>(
      `select
         (select count(*)::int from opportunities
           where status='open' and stage not in ('dismissed','lost') and org_id=$1) as open_opps,
         (select count(*)::int from opportunities
           where created_at >= now() - interval '30 days' and org_id=$1) as new_30d,
         (select count(*)::int from bids
           where submitted_at is not null and submitted_at >= now() - interval '30 days'
             and org_id=$1) as bids_30d,
         (select count(*)::int from contracts where status='active' and org_id=$1) as active_contracts`,
      [orgId]
    ),
    query<{ stage: string; count: number; value: number; valued: number }>(
      // `valued` is how many rows actually carry an estimate. Without it the
      // sum is unreadable: SAM notices frequently omit a value, so a stage of
      // sixteen opportunities with no estimate anywhere summed to exactly
      // $0 and rendered identically to "these are worth nothing".
      `select stage, count(*)::int as count,
              coalesce(sum(value_estimated),0)::float8 as value,
              count(value_estimated)::int as valued
         from opportunities
        where status='open' and stage not in ('dismissed','lost') and org_id=$1
        group by stage`,
      [orgId]
    ),
  ]);
  return {
    counts: counts ?? { open_opps: 0, new_30d: 0, bids_30d: 0, active_contracts: 0 },
    byStage,
  };
}

/**
 * The eight-step acquisition funnel over one cohort of opportunities.
 *
 * A cohort is everything found inside the window, followed wherever it got to
 * since. That is the only reading that supports a conversion rate: counting
 * "quotes received this month" against "opportunities found this month" mixes
 * two different sets of work and produces a number that means nothing.
 *
 * Each opportunity is placed at the furthest step it reached, and the ones
 * that stopped short are split by whether they are closed (a real loss) or
 * still open (not a loss yet). The medians measure only spans that have two
 * real timestamps on both ends; there is no stage-history table, so the steps
 * without one report nothing rather than a plausible-looking zero.
 */
export async function funnelCounts(
  from: Date | null,
  to: Date | null = null
): Promise<FunnelCounts> {
  const orgId = await currentOrg();
  const row = await queryOne<Record<string, unknown>>(
    `with cohort as (
       select o.id, o.status, o.stage, o.score, o.tier, o.created_at
         from opportunities o
        where o.org_id = $1
          and ($2::timestamptz is null or o.created_at >= $2::timestamptz)
          and ($3::timestamptz is null or o.created_at <  $3::timestamptz)
     ),
     /*
      * Each of the three milestones, grouped once over the whole account and
      * joined in, rather than looked up per opportunity.
      *
      * These were lateral subqueries correlated on the opportunity id, which
      * is the obvious way to write the question and the wrong way to run it:
      * at 5,000 opportunities the communications lookup alone touched 20,001
      * heap blocks, once per row, and made the Analytics page take 837ms
      * where every other page took under 120. One pass over each table
      * answers the same question for every opportunity at once.
      *
      * Scoped by org_id inside each aggregate, exactly as the laterals were.
      * That is what keeps one account's milestones out of another's funnel,
      * and it has to stay on the inner query rather than move to the join.
      */
     out_first as (
       select opportunity_id, min(created_at) as first_out
         from communications
        where org_id = $1 and direction = 'outbound' and opportunity_id is not null
        group by opportunity_id
     ),
     /*
      * The first time a subcontractor wrote back.
      *
      * Same shape as out_first, and the reason the funnel needed it: without
      * this step "contacted 40, quoted 3" cannot say whether nobody answered
      * or plenty answered and would not price the work, and those two are
      * fixed in different places.
      */
     in_first as (
       select opportunity_id, min(created_at) as first_in
         from communications
        where org_id = $1 and direction = 'inbound' and opportunity_id is not null
        group by opportunity_id
     ),
     quote_first as (
       select opportunity_id, min(created_at) as first_quote
         from quotes
        where org_id = $1 and opportunity_id is not null
        group by opportunity_id
     ),
     bid_first as (
       select opportunity_id,
              min(created_at) as first_bid,
              min(submitted_at) as first_submit,
              bool_or(outcome in ('won','lost')) as decided,
              bool_or(outcome = 'won') as won,
              bool_or(outcome = 'lost') as lost
         from bids
        where org_id = $1 and opportunity_id is not null
        group by opportunity_id
     ),
     facts as (
       select c.id, c.created_at,
              (c.status = 'open' and c.stage not in ('dismissed','lost')) as still_open,
              (c.score is not null) as scored,
              (c.stage in ('sub_research','outreach','call_queue','quote_entry',
                           'bid_building','submitted','won','lost')
                or c.tier = 'pursue') as pursued,
              cm.first_out, rp.first_in, q.first_quote,
              b.first_bid, b.first_submit, b.decided, b.won, b.lost
         from cohort c
         left join out_first cm on cm.opportunity_id = c.id
         left join in_first rp on rp.opportunity_id = c.id
         left join quote_first q on q.opportunity_id = c.id
         left join bid_first b on b.opportunity_id = c.id
     ),
     ranked as (
       select f.*,
              /*
               * Furthest step reached, and it stays monotonic on purpose: a
               * quote that arrived without a logged inbound message still
               * counts as having replied, because the quote is the reply. The
               * alternative is a funnel where the later step is larger than
               * the one before it, which reads as a bug whichever way it is
               * explained.
               */
              case
                when f.decided then 8
                when f.first_submit is not null then 7
                when f.first_bid is not null then 6
                when f.first_quote is not null then 5
                when f.first_in is not null then 4
                when f.first_out is not null then 3
                when f.pursued then 2
                when f.scored then 1
                else 0
              end as furthest
         from facts f
     )
     select
       count(*)::int as r0,
       count(*) filter (where furthest >= 1)::int as r1,
       count(*) filter (where furthest >= 2)::int as r2,
       count(*) filter (where furthest >= 3)::int as r3,
       count(*) filter (where furthest >= 4)::int as r4,
       count(*) filter (where furthest >= 5)::int as r5,
       count(*) filter (where furthest >= 6)::int as r6,
       count(*) filter (where furthest >= 7)::int as r7,
       count(*) filter (where furthest >= 8)::int as r8,
       count(*) filter (where furthest = 0 and not still_open)::int as d1,
       count(*) filter (where furthest = 1 and not still_open)::int as d2,
       count(*) filter (where furthest = 2 and not still_open)::int as d3,
       count(*) filter (where furthest = 3 and not still_open)::int as d4,
       count(*) filter (where furthest = 4 and not still_open)::int as d5,
       count(*) filter (where furthest = 5 and not still_open)::int as d6,
       count(*) filter (where furthest = 6 and not still_open)::int as d7,
       count(*) filter (where furthest = 7 and not still_open)::int as d8,
       count(*) filter (where furthest = 0 and still_open)::int as p1,
       count(*) filter (where furthest = 1 and still_open)::int as p2,
       count(*) filter (where furthest = 2 and still_open)::int as p3,
       count(*) filter (where furthest = 3 and still_open)::int as p4,
       count(*) filter (where furthest = 4 and still_open)::int as p5,
       count(*) filter (where furthest = 5 and still_open)::int as p6,
       count(*) filter (where furthest = 6 and still_open)::int as p7,
       count(*) filter (where furthest = 7 and still_open)::int as p8,
       count(*) filter (where won)::int as won,
       count(*) filter (where lost and not won)::int as lost,
       percentile_cont(0.5) within group (
         order by extract(epoch from (first_out - created_at)) / 86400.0
       ) filter (where first_out is not null) as m_contact,
       percentile_cont(0.5) within group (
         order by extract(epoch from (first_in - first_out)) / 86400.0
       ) filter (where first_in is not null and first_out is not null) as m_reply,
       /*
        * Measured from the reply where there is one, and from the send where
        * there is not. Measuring every quote from the send would make the
        * quote step look slower than it is on every opportunity where a
        * conversation happened first.
        */
       percentile_cont(0.5) within group (
         order by extract(epoch from (first_quote - coalesce(first_in, first_out))) / 86400.0
       ) filter (where first_quote is not null and coalesce(first_in, first_out) is not null) as m_quote,
       percentile_cont(0.5) within group (
         order by extract(epoch from (first_bid - first_quote)) / 86400.0
       ) filter (where first_bid is not null and first_quote is not null) as m_bid,
       percentile_cont(0.5) within group (
         order by extract(epoch from (first_submit - first_bid)) / 86400.0
       ) filter (where first_submit is not null and first_bid is not null) as m_submit
       from ranked`,
    [orgId, from ? from.toISOString() : null, to ? to.toISOString() : null]
  );
  const n = (v: unknown): number => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : 0;
  };
  // A median over an empty set is null in Postgres, and it must stay null here:
  // "no span was measured" and "the span was nought days" are different facts.
  const median = (v: unknown): number | null => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? Math.max(0, x) : null;
  };
  const r = row ?? {};
  return {
    reached: {
      found: n(r.r0),
      scored: n(r.r1),
      pursued: n(r.r2),
      subs_contacted: n(r.r3),
      replies_received: n(r.r4),
      quotes_received: n(r.r5),
      bid_built: n(r.r6),
      submitted: n(r.r7),
      decided: n(r.r8),
    },
    droppedBefore: {
      found: 0,
      scored: n(r.d1),
      pursued: n(r.d2),
      subs_contacted: n(r.d3),
      replies_received: n(r.d4),
      quotes_received: n(r.d5),
      bid_built: n(r.d6),
      submitted: n(r.d7),
      decided: n(r.d8),
    },
    pendingBefore: {
      found: 0,
      scored: n(r.p1),
      pursued: n(r.p2),
      subs_contacted: n(r.p3),
      replies_received: n(r.p4),
      quotes_received: n(r.p5),
      bid_built: n(r.p6),
      submitted: n(r.p7),
      decided: n(r.p8),
    },
    medianDaysInto: {
      subs_contacted: median(r.m_contact),
      replies_received: median(r.m_reply),
      quotes_received: median(r.m_quote),
      bid_built: median(r.m_bid),
      submitted: median(r.m_submit),
    },
    won: n(r.won),
    lost: n(r.lost),
  };
}

/**
 * The same cohort, cut by one dimension.
 *
 * The dimension is chosen from a fixed list and mapped to a fixed expression
 * here, never interpolated from the request, so a drill-down cannot become a
 * way to select arbitrary columns. Rows with no value on the dimension are
 * kept and labelled, because dropping them would make the totals disagree with
 * the funnel directly above them.
 */
export async function funnelBreakdown(
  dimension: BreakdownKey,
  from: Date | null,
  to: Date | null = null
): Promise<BreakdownRow[]> {
  const EXPR: Record<BreakdownKey, string> = {
    naics: `coalesce(nullif(o.naics_code, ''), 'Not stated')`,
    state: `coalesce(nullif(o.location_state, ''), 'Not stated')`,
    agency: `coalesce(nullif(o.agency, ''), 'Not stated')`,
    set_aside: `coalesce(nullif(o.set_aside_type, ''), 'Not stated')`,
    score_band: `case
        when o.score is null then 'Not scored'
        when o.score >= 80 then 'Strong (80 and above)'
        when o.score >= 60 then 'Fair (60 to 79)'
        when o.score >= 40 then 'Weak (40 to 59)'
        else 'Poor (under 40)'
      end`,
    /*
     * Supplied by the trade join below rather than read off the opportunity.
     * An opportunity has as many trades as it sourced, which is why this
     * dimension needs its own FROM.
     */
    trade: `coalesce(nullif(btrim(t.trade), ''), 'Trade not recorded')`,
    /*
     * Unassigned is a real answer and gets its own row. Folding it into
     * "Not stated" alongside a missing agency code would hide the one thing
     * this dimension exists to show: work nobody has picked up.
     */
    owner: `coalesce(nullif(btrim(u.name), ''), nullif(u.email, ''), 'Unassigned')`,
  };
  const expr = EXPR[dimension] ?? EXPR.agency;
  const orgId = await currentOrg();

  /*
   * Trade is many-per-opportunity, so it joins a distinct set of the trades
   * actually sourced. `distinct` matters: opportunity_subs holds one row per
   * subcontractor, so without it an opportunity that went to four roofers
   * would count four times under Roofing and its win rate would be computed
   * over four copies of the same bid.
   */
  const tradeJoin =
    dimension === "trade"
      ? `join lateral (
           select distinct os.trade
             from opportunity_subs os
            where os.opportunity_id = o.id and os.removed_at is null
         ) t on true`
      : "";
  const ownerJoin = dimension === "owner" ? `left join users u on u.id = o.assigned_to` : "";

  return query<BreakdownRow>(
    `select ${expr} as key,
            count(*)::int as found,
            count(*) filter (
              where o.stage in ('sub_research','outreach','call_queue','quote_entry',
                                'bid_building','submitted','won','lost')
                 or o.tier = 'pursue'
            )::int as pursued,
            count(*) filter (where b.first_submit is not null)::int as submitted,
            count(*) filter (where b.won)::int as won,
            count(*) filter (where b.lost and not b.won)::int as lost
       from opportunities o
       ${tradeJoin}
       ${ownerJoin}
       left join lateral (
         select min(submitted_at) as first_submit,
                bool_or(outcome = 'won') as won,
                bool_or(outcome = 'lost') as lost
           from bids where opportunity_id = o.id and org_id = $1
       ) b on true
      where o.org_id = $1
        and ($2::timestamptz is null or o.created_at >= $2::timestamptz)
        and ($3::timestamptz is null or o.created_at <  $3::timestamptz)
      group by 1
      order by count(*) desc, 1 asc
      limit 25`,
    [orgId, from ? from.toISOString() : null, to ? to.toISOString() : null]
  );
}

export interface CustomKpiRow {
  id: string;
  label: string;
  metric: string;
  params: KpiParams;
  sort_order: number;
}

/** Operator-defined KPI definitions for the Analytics dashboard. [] pre-migration. */
export async function customKpis(): Promise<CustomKpiRow[]> {
  try {
    return await query<CustomKpiRow>(
      `select id, label, metric, params, sort_order from custom_kpis
        where org_id = $1
        order by sort_order asc, created_at asc limit 50`,
      [await currentOrg()]
    );
  } catch {
    return [];
  }
}

/**
 * Compute one custom KPI. Each metric maps to a fixed, bounded, parameterized
 * query (no free-form SQL), and every failure returns null so a bad definition
 * or a not-yet-migrated table can't break the dashboard. Percent metrics return
 * a 0..100 number; currency/count return the raw number.
 */
export async function computeCustomKpi(metric: string, params: KpiParams): Promise<number | null> {
  const orgId = await currentOrg();
  const days = params.days ?? 0;
  const minScore = params.minScore ?? 0;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    switch (metric) {
      case "open_opportunities": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities
            where status='open' and stage not in ('dismissed','lost')
              and coalesce(score,0) >= $1 and org_id = $2`,
          [minScore, orgId]
        );
        return Number(r?.n ?? 0);
      }
      case "pipeline_value": {
        const r = await queryOne<{ n: number }>(
          `select coalesce(sum(value_estimated),0)::float8 as n from opportunities
            where status='open' and stage not in ('dismissed','lost')
              and coalesce(score,0) >= $1 and org_id = $2`,
          [minScore, orgId]
        );
        return Number(r?.n ?? 0);
      }
      case "opportunities_added": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities
            where created_at >= $1 and org_id = $2`,
          [since, orgId]
        );
        return Number(r?.n ?? 0);
      }
      case "bids_submitted": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from bids
            where submitted_at is not null and submitted_at >= $1 and org_id = $2`,
          [since, orgId]
        );
        return Number(r?.n ?? 0);
      }
      case "win_rate": {
        const r = await queryOne<{ won: number; decided: number }>(
          `select count(*) filter (where outcome='won')::int as won,
                  count(*) filter (where outcome in ('won','lost'))::int as decided
             from bids
            where ($1::boolean is false or submitted_at >= $2) and org_id = $3`,
          [days > 0, since, orgId]
        );
        const won = Number(r?.won ?? 0);
        const decided = Number(r?.decided ?? 0);
        return decided > 0 ? (won / decided) * 100 : null;
      }
      case "avg_margin": {
        const r = await queryOne<{ n: number | null }>(
          `select avg(margin_pct)::float8 as n from bids where outcome='won' and org_id = $1`,
          [orgId]
        );
        return r?.n != null ? Number(r.n) : null;
      }
      case "active_contracts": {
        const r = await queryOne<{ n: number }>(
          `select count(*)::int as n from contracts where status='active' and org_id = $1`,
          [orgId]
        );
        return Number(r?.n ?? 0);
      }
      case "active_contract_revenue": {
        const r = await queryOne<{ n: number }>(
          `select coalesce(sum(award_amount),0)::float8 as n from contracts
            where status='active' and org_id = $1`,
          [orgId]
        );
        return Number(r?.n ?? 0);
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export async function agentLogs(filters: { agent?: string; limit?: number } = {}) {
  const params: unknown[] = [await currentOrg()];
  const clauses: string[] = ["org_id = $1"];
  if (filters.agent) {
    params.push(filters.agent);
    clauses.push(`agent = $${params.length}`);
  }
  const where = `where ${clauses.join(" and ")}`;
  params.push(filters.limit ?? 200);
  return query(
    `select id, agent, action, level, status, message, reasoning, opportunity_id,
            duration_ms, claude_usage, created_at
       from agent_logs ${where}
      order by created_at desc limit $${params.length}`,
    params
  );
}

/**
 * One run from the automation log, in full.
 *
 * Loaded on its own rather than folded into the list query, and the reason is
 * weight: `input_json` and `output_json` are the whole request and the whole
 * response, and fifty of each on a page nobody has asked to read yet is a slow
 * page in exchange for nothing. The list stays thin; this is fetched when
 * somebody opens a row.
 *
 * The three record ids are resolved to names here. A run that says it failed
 * on `a3f2...` is a run nobody can act on.
 */
export interface AgentRunDetail {
  id: string;
  agent: string;
  action: string;
  level: string;
  status: string;
  message: string | null;
  reasoning: string | null;
  duration_ms: number | null;
  created_at: string;
  input_json: unknown;
  output_json: unknown;
  opportunity_id: string | null;
  opportunity_title: string | null;
  subcontractor_id: string | null;
  subcontractor_name: string | null;
  bid_id: string | null;
  bid_opportunity_id: string | null;
}

export async function agentRun(id: string): Promise<AgentRunDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<AgentRunDetail>(
    `select l.id, l.agent, l.action, l.level, l.status, l.message, l.reasoning,
            l.duration_ms, l.created_at::text as created_at,
            l.input_json, l.output_json,
            l.opportunity_id, o.title as opportunity_title,
            l.subcontractor_id, s.company_name as subcontractor_name,
            l.bid_id, b.opportunity_id as bid_opportunity_id
       from agent_logs l
       left join opportunities o on o.id = l.opportunity_id
       left join subcontractors s on s.id = l.subcontractor_id
       left join bids b on b.id = l.bid_id
      where l.id = $1 and l.org_id = $2`,
    [id, await currentOrg()]
  ).catch(() => null);
}

export const LOG_PAGE_SIZE = 50;

/** Paged + filterable activity feed for the Automation Log page. */
export async function agentLogsPaged(filters: {
  agent?: string;
  level?: string;
  q?: string;
  page?: number;
}): Promise<{ rows: Record<string, unknown>[]; total: number; page: number; pageSize: number }> {
  const params: unknown[] = [await currentOrg()];
  const where: string[] = ["org_id = $1"];
  if (filters.agent) {
    params.push(filters.agent);
    where.push(`agent = $${params.length}`);
  }
  if (filters.level) {
    // "warn" should also match legacy "warning" rows.
    params.push(filters.level === "warn" ? ["warn", "warning"] : [filters.level]);
    where.push(`level = any($${params.length})`);
  }
  if (filters.q && filters.q.trim()) {
    params.push(`%${filters.q.trim()}%`);
    where.push(
      `(message ilike $${params.length} or action ilike $${params.length} or reasoning ilike $${params.length})`
    );
  }
  const whereSql = `where ${where.join(" and ")}`;
  const page = Math.max(1, filters.page ?? 1);
  const countParams = [...params];
  params.push(LOG_PAGE_SIZE, (page - 1) * LOG_PAGE_SIZE);
  const [rows, totalRow] = await Promise.all([
    query(
      `select id, agent, action, level, status, message, reasoning, opportunity_id,
              duration_ms, created_at
         from agent_logs ${whereSql}
        order by created_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params
    ),
    queryOne<{ total: number }>(
      `select count(*)::int as total from agent_logs ${whereSql}`,
      countParams
    ),
  ]);
  return { rows, total: totalRow?.total ?? 0, page, pageSize: LOG_PAGE_SIZE };
}

/**
 * Per-agent status for the roster: not just how many times it ran, but when it
 * last ran, whether that run worked, and what it said.
 *
 * The roster used to show a cron string and nothing else, which cannot answer
 * the only questions anyone actually has of it -- is this on, did it run, did
 * it work. Those answers are all one row of job_runs away, so fetch them here
 * rather than making the page ask per agent.
 */
export interface AgentStatusRow {
  agent: string;
  runs_24h: number;
  errors_24h: number;
  last_run: string | null;
  last_finished: string | null;
  last_status: string | null;
  last_error: string | null;
  last_summary: unknown;
}

/**
 * This organization's agent runs. Never anybody else's.
 *
 * Both this and jobRunsSummary below feed `/agents`, the customer-facing
 * Automation Health page, and both read job_runs, which had no org_id at all.
 * So every customer was shown platform-wide run and error counts, plus the
 * error text and summary JSON of whichever tenant happened to run an agent
 * most recently. A summary reading "Compliance monitor: 3 orgs checked" is
 * another customer's business on this customer's screen, and last_error can
 * name a record outright.
 *
 * Legacy rows written before migration 070 have a null org_id and are
 * excluded rather than attributed. Nothing in such a row says who it belonged
 * to, and a guess here would put a stranger's failure rate in somebody's
 * sidebar with a straight face. They remain visible to platform admin, where
 * a platform-wide question is the question being asked.
 */
export async function agentStatuses(orgId?: string): Promise<AgentStatusRow[]> {
  // currentOrg, not tryResolveTenantOrgId: this file resolves the tenant one
  // way, and that way falls back to the founding organization so the original
  // single-tenant install, whose rows predate organization_members, still sees
  // its own page. LEGACY_ORG_ID is a real organization id, so that fallback is
  // still a scope and not a fall-open.
  const org = orgId ?? (await currentOrg());
  const [fromJobs, fromLogs] = await Promise.all([
    query<AgentStatusRow>(
      `select r.agent,
              count(*) filter (where r.started_at > now() - interval '24 hours')::int as runs_24h,
              count(*) filter (where r.status = 'error'
                                 and r.started_at > now() - interval '24 hours')::int as errors_24h,
              max(r.started_at)::text as last_run,
              (last.finished_at)::text as last_finished,
              last.status  as last_status,
              last.error   as last_error,
              last.summary as last_summary
         from job_runs r
         -- The most recent run for this agent, which is the one the operator is
         -- asking about; the counts beside it are the context for it. Scoped
         -- inside the lateral as well as outside: without it the counts would be
         -- this organization's and the error text beside them somebody else's,
         -- which is the same leak wearing a filter.
         join lateral (
           select status, error, summary, finished_at
             from job_runs x
            where x.agent = r.agent and x.org_id = $1
            order by x.started_at desc
            limit 1
         ) last on true
        where r.org_id = $1
        group by r.agent, last.status, last.error, last.summary, last.finished_at`,
      [org]
    ).catch(() => [] as AgentStatusRow[]),
    // Fan-out agents (opportunity-monitor) write one job_runs row for the
    // sweep and per-org evidence in agent_logs. Without this fallback the
    // roster said "Has never run" on an account that had just ingested work.
    query<AgentStatusRow>(
      `select agent,
              count(*) filter (where created_at > now() - interval '24 hours')::int as runs_24h,
              count(*) filter (where status = 'error'
                                 and created_at > now() - interval '24 hours')::int as errors_24h,
              max(created_at)::text as last_run,
              max(created_at)::text as last_finished,
              (array_agg(status order by created_at desc))[1] as last_status,
              (array_agg(message order by created_at desc)
                 filter (where status = 'error'))[1] as last_error,
              null as last_summary
         from agent_logs
        where org_id = $1
          and status in ('ok','error')
        group by agent`,
      [org]
    ).catch(() => [] as AgentStatusRow[]),
  ]);
  const byAgent = new Map(fromJobs.map((row) => [row.agent, row]));
  for (const row of fromLogs) {
    if (!byAgent.has(row.agent)) byAgent.set(row.agent, row);
  }
  return [...byAgent.values()];
}

/** This organization's run tallies. See agentStatuses for why the scope. */
export async function jobRunsSummary(orgId?: string) {
  const org = orgId ?? (await currentOrg());
  return query(
    `select agent,
            count(*) filter (where status='ok') as ok,
            count(*) filter (where status='error') as error,
            max(started_at) as last_run
       from job_runs
      where org_id = $1
      group by agent order by max(started_at) desc nulls last`,
    [org]
  );
}

/**
 * Every organization's runs, for platform admin only.
 *
 * Deliberately a separate function rather than an optional argument on the two
 * above. An unscoped read is a different question with a different audience,
 * and making it opt-in by name means no customer-facing caller reaches it by
 * forgetting to pass something. Includes the legacy null-org rows, which is
 * the only place they can honestly be shown.
 */
export async function platformJobRunsSummary() {
  return query(
    `select agent,
            count(*) filter (where status='ok') as ok,
            count(*) filter (where status='error') as error,
            count(*) filter (where org_id is null) as unattributed,
            max(started_at) as last_run
       from job_runs
      group by agent order by max(started_at) desc nulls last`
  );
}

/**
 * One competing firm's footprint in this opportunity's NAICS + state, rolled up
 * from the CPI-adjusted pricing_comps the Pricing Research agent already stores.
 * Numeric aggregates are cast to float8 in SQL so they arrive as JS numbers.
 */
export interface CompetitorRow {
  recipient_name: string;
  award_count: number;
  total_adj: number;
  median_adj: number;
  last_award_at: string | null;
  is_incumbent: boolean;
}

/**
 * Competitive landscape for one opportunity: every firm that has won work in
 * the same NAICS + state over the comp window, ranked by how often they win.
 * Reuses the pricing_comps rows already gathered at the pursue tier, so it
 * needs no new API calls and lights up on every opportunity that has been
 * priced. Bounded to keep the render cheap (comps are ≤100 per opportunity).
 */
export async function opportunityCompetitors(id: string): Promise<CompetitorRow[]> {
  return query<CompetitorRow>(
    `select recipient_name,
            count(*)::int                                                   as award_count,
            coalesce(sum(award_amount_adj), 0)::float8                       as total_adj,
            coalesce(percentile_cont(0.5) within group
              (order by award_amount_adj), 0)::float8                       as median_adj,
            max(awarded_at)::text                                           as last_award_at,
            bool_or(is_incumbent)                                           as is_incumbent
       from pricing_comps
      where opportunity_id = $1 and org_id = $2
        and recipient_name is not null and btrim(recipient_name) <> ''
      group by recipient_name
      order by award_count desc, total_adj desc
      limit 50`,
    [id, await currentOrg()]
  );
}

/** Sub paired to an opportunity, with contactability + this-bid touch counts. */
export interface OppSubRow {
  id: string;
  opportunity_id: string;
  subcontractor_id: string;
  trade: string | null;
  candidate_rank: number | null;
  outreach_state: string | null;
  responded_at: string | null;
  verified: boolean | null;
  company_name: string;
  phone: string | null;
  email: string | null;
  email_verified: boolean | null;
  google_rating: number | null;
  contact_status: string | null;
  last_contacted: string | null;
  emails_sent: number;
  calls_logged: number;
  notes_count: number;
  touches: number;
  last_touch_at: string | null;
  last_inbound_at: string | null;
  /** Primary is the firm being priced for this trade. Null is undecided. */
  role: "primary" | "backup" | null;
  /**
   * Off the bid, and why.
   *
   * Removal is a mark rather than a delete: the emails sent and the replies
   * received are the record of who was approached for this job, and that is
   * exactly what somebody asks for when a bid goes wrong.
   */
  removed_at: string | null;
  removed_reason: string | null;
  /**
   * The inbox thread to open, keyed exactly the way the Communications page
   * groups by. Deriving it a second way here would be a link that lands on an
   * empty pane.
   */
  thread_key: string | null;
  /** Whether a quote from this firm is already on the bid. */
  has_quote: boolean;
}

/** Opportunity-scoped communication row for the Subs panel history. */
export interface OppSubCommRow {
  id: string;
  subcontractor_id: string;
  channel: string;
  direction: string | null;
  subject: string | null;
  body: string | null;
  created_at: string;
  replied_at: string | null;
}

export async function opportunityDetail(id: string) {
  // Tenant check: never return another org's opportunity by UUID guess.
  let orgId: string | null = null;
  try {
    const { tryResolveTenantOrgId } = await import("./tenant");
    orgId = await tryResolveTenantOrgId();
  } catch {
    orgId = null;
  }
  const opp = orgId
    ? await queryOne<Opportunity>(
        `select * from opportunities where id=$1 and org_id=$2`,
        [id, orgId]
      )
    : await queryOne<Opportunity>(`select * from opportunities where id=$1`, [id]);
  if (!opp) return null;
  // Independent lookups run in parallel; every list is bounded so an aged
  // opportunity can't balloon the page render.
  const [bid, quotes, subs, documents, logs, competitors, subComms, callRow, callEvents] = await Promise.all([
    queryOne(`select * from bids where opportunity_id=$1 order by created_at desc limit 1`, [id]),
    query(
      `select q.*, s.company_name from quotes q left join subcontractors s on s.id=q.subcontractor_id
        where q.opportunity_id=$1 order by q.created_at desc limit 200`,
      [id]
    ),
    query<OppSubRow>(
      `select os.id, os.opportunity_id, os.subcontractor_id, os.trade, os.candidate_rank,
              os.outreach_state, os.responded_at, os.verified,
              os.role, os.removed_at, os.removed_reason,
              s.company_name, s.phone, s.email, s.email_verified, s.google_rating,
              s.contact_status, s.last_contacted,
              coalesce(stats.emails_sent, 0)::int as emails_sent,
              coalesce(stats.calls_logged, 0)::int as calls_logged,
              coalesce(stats.notes_count, 0)::int as notes_count,
              coalesce(stats.touches, 0)::int as touches,
              stats.last_touch_at, stats.last_inbound_at,
              stats.thread_key,
              exists (
                select 1 from quotes q
                 where q.opportunity_id = os.opportunity_id
                   and q.subcontractor_id = os.subcontractor_id
              ) as has_quote
         from opportunity_subs os
         join subcontractors s on s.id = os.subcontractor_id
         left join lateral (
           select
             count(*) filter (where channel = 'email' and direction = 'outbound') as emails_sent,
             count(*) filter (where channel = 'call') as calls_logged,
             count(*) filter (where channel = 'note') as notes_count,
             count(*) as touches,
             max(created_at) as last_touch_at,
             max(created_at) filter (where direction = 'inbound') as last_inbound_at,
             /*
              * The newest conversation with this firm about this bid, so the
              * row can offer a link to the thread rather than sending an
              * operator to search the inbox for a company name.
              */
             (array_agg(${THREAD_KEY_SQL} order by created_at desc))[1] as thread_key
           from communications c
           where c.subcontractor_id = os.subcontractor_id
             and c.opportunity_id = os.opportunity_id
         ) stats on true
        where os.opportunity_id = $1
        order by os.trade nulls last,
                 /*
                  * Removed firms last, then the primary, then backups, then
                  * everybody else. The order answers "who is on this trade"
                  * before it answers "who else did we try".
                  */
                 (os.removed_at is not null),
                 (os.role is distinct from 'primary'),
                 (os.role is distinct from 'backup'),
                 os.candidate_rank nulls last, s.company_name
        limit 300`,
      [id]
    ),
    query(`select * from documents where opportunity_id=$1 order by created_at desc limit 100`, [id]),
    query(
      `select agent, action, level, message, reasoning, created_at from agent_logs
        where opportunity_id=$1 order by created_at desc limit 50`,
      [id]
    ),
    opportunityCompetitors(id),
    query<OppSubCommRow>(
      `select id, subcontractor_id, channel, direction, subject, body, created_at, replied_at
         from communications
        where opportunity_id = $1
        order by created_at desc
        limit 400`,
      [id]
    ),
    queryOne<{ n: number }>(
      `select count(*)::int as n
         from call_cards cc
         join opportunities o on o.id = cc.opportunity_id
         join subcontractors s on s.id = cc.subcontractor_id
        where cc.opportunity_id = $1 and ${WORKABLE_CALL_CARD_SQL}`,
      [id]
    ),
    // Calls are part of the record too. The activity feed listed agent logs
    // and emails only, so a solicitation whose history was a round of phone
    // calls displayed the words "No activity" over work that had plainly
    // happened.
    query<{
      id: string;
      company_name: string | null;
      trade: string | null;
      status: string;
      created_at: string;
    }>(
      `select cc.id, s.company_name, cc.trade, cc.status, cc.created_at
         from call_cards cc
         left join subcontractors s on s.id = cc.subcontractor_id
        where cc.opportunity_id = $1
        order by cc.created_at desc limit 100`,
      [id]
    ).catch(() => []),
  ]);
  return {
    opp,
    bid,
    quotes,
    subs,
    documents,
    logs,
    competitors,
    subComms,
    pendingCalls: callRow?.n ?? 0,
    callEvents,
  };
}

export async function pricingSummaryFor(opp: Opportunity): Promise<Record<string, unknown> | null> {
  const raw = opp.raw_json as { pricing_summary?: Record<string, unknown> } | null;
  return raw?.pricing_summary ?? null;
}

/**
 * Every content-library snippet, for the management screen. Returns [] if the
 * table hasn't been migrated yet so the settings page still renders its empty
 * state instead of erroring.
 */
export async function contentLibrary(): Promise<ContentLibraryItem[]> {
  try {
    return await query<ContentLibraryItem>(
      `select * from content_library
        where org_id = $1
        order by is_active desc, category asc, updated_at desc
        limit 500`,
      [await currentOrg()]
    );
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------------ */
/* Action Center, powers the guided "Today" home page.                      */
/* ------------------------------------------------------------------------ */

export interface ActionOppRow {
  id: string;
  title: string | null;
  agency: string | null;
  stage: string;
  deadline: string | null;
  value_estimated: number | null;
  risk_flags: string[] | null;
  quote_count: number;
  has_bid: boolean;
  bid_submitted: boolean;
}

export interface ActionCallRow {
  id: string;
  company_name: string;
  phone: string | null;
  opportunity_title: string | null;
  deadline: string | null;
  source: string;
  trade: string | null;
  /** Plain-English work this sub would perform (for calls / Today). */
  work_summary: string | null;
}

/** Subcontractor outreach that needs a human nudge (email follow-ups exhausted). */
export interface ActionSubFollowUpRow {
  opportunity_id: string;
  opportunity_title: string | null;
  deadline: string | null;
  subcontractor_id: string;
  company_name: string;
  phone: string | null;
  trade: string | null;
  outreach_state: string | null;
  last_contacted: string | null;
  emails_sent: number;
  calls_logged: number;
  work_summary: string | null;
}

/** Quote that looks unusually high/low and needs a quick review. */
export interface ActionQuoteReviewRow {
  quote_id: string;
  opportunity_id: string;
  opportunity_title: string | null;
  company_name: string | null;
  trade: string | null;
  quote_amount: number | null;
  deadline: string | null;
}

export interface ComplianceAlertRow {
  id: string;
  category: string;
  label: string;
  due_at: string | null;
  status: string;
  days_remaining: number | null;
}

export interface ProposedWeightsRow {
  id: string;
  version: number;
  rationale: string | null;
  proposed_at: string;
}

/** One reply held back for a person to read and decide. */
export interface ActionReplyReviewRow {
  id: string;
  subcontractor_id: string;
  company_name: string | null;
  opportunity_id: string | null;
  opportunity_title: string | null;
  trade: string | null;
  intent: string;
  reason: string | null;
  review_reason: string | null;
  original_message: string | null;
  confidence: string;
  created_at: string;
}

export interface ActionCenterData {
  /** Opportunities awaiting a pursue/dismiss decision. */
  triage: ActionOppRow[];
  /** Pending call cards: count, soonest deadline, and the top cards to call. */
  calls: { count: number; soonest_deadline: string | null; rows: ActionCallRow[] };
  /** In quote_entry or bid_building: needs quotes entered or bid reviewed. */
  bidWork: ActionOppRow[];
  /** Submitted, waiting on the agency's decision. */
  awaitingOutcome: ActionOppRow[];
  /** Deadline inside the configurable urgent window and not yet submitted. */
  urgent: ActionOppRow[];
  /** Flagged for attention outside the review queue (stalled, blocked, etc.). */
  flagged: ActionOppRow[];
  /** Subs that need a human call/follow-up after automated outreach. */
  subFollowUps: ActionSubFollowUpRow[];
  /** Out-of-range quotes waiting for operator judgment. */
  quoteReviews: ActionQuoteReviewRow[];
  /** Compliance items in one of the five states that need somebody today. */
  complianceAlerts: ComplianceAlertRow[];
  /**
   * Subcontractors on won work whose paperwork is not good enough to put them
   * on the job. Distinct from complianceAlerts, which is our own registrations
   * (SAM, licences). This is other people's insurance, and after an award it
   * is the prime's exposure rather than theirs.
   */
  awardCompliance: AwardComplianceRow[];
  /** Learning Loop scoring-weight proposals awaiting approve/reject. */
  proposedWeights: ProposedWeightsRow[];
  /**
   * Subcontractor replies the platform deliberately did not act on: the read
   * was uncertain, the message contradicted itself, or an attached quote could
   * not be opened. Written to the database whether or not we acted, so this is
   * where those land for a human.
   */
  replyReviews: ActionReplyReviewRow[];
  /** Backlink outreach drafts awaiting the operator's send approval. */
  backlinkApprovals: number;
  /** Items the operator snoozed that are still hidden (they return on their own). */
  snoozedCount: number;
  /** Open-pipeline counts per stage for the progress strip. */
  stageCounts: { stage: string; count: number }[];
  /**
   * How much work there actually is, as opposed to how much was fetched.
   *
   * The lists above are capped at ten or twenty rows because they double as
   * preview strips. Counting their length therefore reports the cap: an
   * account with thirty borderline opportunities was told, in a headline
   * number, that it had ten. These are unbounded counts of the same
   * predicates, and they are what the work ledger adds up.
   */
  totals: {
    triage: number;
    bidWork: number;
    urgent: number;
    flagged: number;
    subFollowUps: number;
    quoteReviews: number;
    replyReviews: number;
    /**
     * Compliance alerts, uncounted by the list above it.
     *
     * complianceAlerts is `limit 8`, because it also renders a preview strip.
     * Today fed that array's LENGTH into the work ledger, so an account with
     * twenty overdue registrations was told in its headline number that it
     * had eight. Same defect this totals block exists to fix, in one of the
     * two inputs it did not cover.
     */
    compliance: number;
  };
}

function actionOppSelect(orgId: string): string {
  // orgId is always a UUID from our session/membership tables.
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error("Invalid organization id.");
  return `
  select o.id, o.title, o.agency, o.stage, o.deadline, o.value_estimated, o.risk_flags,
         (select count(*)::int from quotes q where q.opportunity_id = o.id) as quote_count,
         exists(select 1 from bids b where b.opportunity_id = o.id) as has_bid,
         exists(select 1 from bids b where b.opportunity_id = o.id and b.submitted_at is not null) as bid_submitted
    from opportunities o
   where o.org_id = '${orgId}'`;
}

/** The same rows, counted rather than listed. See ACTION_OPP_WHERE below. */
function actionOppCount(orgId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new Error("Invalid organization id.");
  return `select count(*)::int as n from opportunities o where o.org_id = '${orgId}'`;
}

/**
 * The predicate behind each bucket, written once.
 *
 * Each of these tails is appended BOTH to the list query (capped, because the
 * list is also a preview strip) and to the count query (uncapped, because a
 * headline number must describe the work rather than the page size). Sharing
 * the text is the point: when the two drifted, the list showed one set of
 * opportunities and the number described another, and there was no way to
 * tell from the screen which was wrong.
 */
const ACTION_OPP_WHERE = {
  triage: `and ${TRIAGE_WHERE_SQL}`,
  bidWork: `and o.status='open' and ${ACTIVE_PURSUIT_SQL} and o.stage in ('quote_entry','bid_building')
            and (o.snoozed_until is null or o.snoozed_until <= now())`,
  awaitingOutcome: `and o.status='open' and ${ACTIVE_PURSUIT_SQL} and o.stage='submitted'
                    and (o.snoozed_until is null or o.snoozed_until <= now())`,
  urgent: `and o.status='open' and ${ACTIVE_PURSUIT_SQL}
           and o.stage in ('analysis','sub_research','outreach','call_queue','quote_entry','bid_building')
           and o.deadline is not null and o.deadline > now()
           and o.deadline <= now() + make_interval(days => $1)
           and (o.snoozed_until is null or o.snoozed_until <= now())`,
  // `is distinct from` so records without a tier yet (e.g. a flagged
  // sources-sought notice racing its first scoring run) still surface.
  flagged: `and o.status='open' and ${ACTIVE_PURSUIT_SQL} and o.human_action_required=true
            and o.tier is distinct from 'review'
            and (o.snoozed_until is null or o.snoozed_until <= now())`,
} as const;

export async function actionCenter(opts?: { urgentDays?: number }): Promise<ActionCenterData> {
  // The "do this first" window matches the configurable red deadline badge, so
  // "urgent" means the same thing everywhere (Settings → Automation rules).
  const urgentDays = Math.max(1, opts?.urgentDays ?? 3);
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  const ACTION_OPP_SELECT = actionOppSelect(orgId);
  const [
    triage,
    callRow,
    callRows,
    bidWork,
    awaitingOutcome,
    urgent,
    flagged,
    subFollowUps,
    quoteReviews,
    complianceAlerts,
    proposedWeights,
    backlinkRow,
    snoozedRow,
    stageCounts,
    replyReviews,
    awardComplianceRows,
    totalsRow,
  ] = await Promise.all([
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT} ${ACTION_OPP_WHERE.triage}
          order by (o.deadline is null), o.deadline asc limit 10`
    ),
    queryOne<{ count: number; soonest_deadline: string | null }>(
      `select count(*)::int as count, min(o.deadline) as soonest_deadline
           from call_cards cc
           join opportunities o on o.id = cc.opportunity_id
           join subcontractors s on s.id = cc.subcontractor_id
          where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL}`,
      [orgId]
    ),
    query<
      Omit<ActionCallRow, "work_summary"> & {
        solicitation_analysis: Record<string, unknown> | null;
        description: string | null;
      }
    >(
      `select cc.id, s.company_name, s.phone, o.title as opportunity_title,
              o.deadline, cc.source, o.solicitation_analysis, o.description,
              (select trade from opportunity_subs os
                where os.opportunity_id=cc.opportunity_id and os.subcontractor_id=cc.subcontractor_id limit 1) as trade
         from call_cards cc
         join subcontractors s on s.id = cc.subcontractor_id
         join opportunities o on o.id = cc.opportunity_id
        where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL}
        order by (cc.source='reply') desc, (o.deadline is null), o.deadline asc
        limit 6`,
      [orgId]
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT} ${ACTION_OPP_WHERE.bidWork}
          order by (o.deadline is null), o.deadline asc limit 10`
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT} ${ACTION_OPP_WHERE.awaitingOutcome}
          order by o.updated_at asc limit 10`
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT} ${ACTION_OPP_WHERE.urgent}
          order by o.deadline asc limit 10`,
      [urgentDays]
    ),
    query<ActionOppRow>(
      `${ACTION_OPP_SELECT} ${ACTION_OPP_WHERE.flagged}
          order by o.updated_at asc limit 10`
    ),
    // After automated email + follow-up, surface human call/nudge work so
    // operators do not have to open every opportunity to find stalled subs.
    query<
      Omit<ActionSubFollowUpRow, "work_summary"> & {
        solicitation_analysis: Record<string, unknown> | null;
        description: string | null;
      }
    >(
      `select o.id as opportunity_id, o.title as opportunity_title, o.deadline,
              s.id as subcontractor_id, s.company_name, s.phone, os.trade,
              os.outreach_state, s.last_contacted,
              o.solicitation_analysis, o.description,
              coalesce((
                select count(*)::int from communications c
                 where c.opportunity_id = os.opportunity_id
                   and c.subcontractor_id = os.subcontractor_id
                   and c.channel = 'email' and c.direction = 'outbound'
              ), 0) as emails_sent,
              coalesce((
                select count(*)::int from communications c
                 where c.opportunity_id = os.opportunity_id
                   and c.subcontractor_id = os.subcontractor_id
                   and c.channel = 'call'
              ), 0) as calls_logged
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         join subcontractors s on s.id = os.subcontractor_id
        where o.org_id = '${orgId}'
          and o.status = 'open'
          and ${ACTIVE_PURSUIT_SQL}
          and o.stage in ('outreach','call_queue','quote_entry','sub_research')
          and (o.snoozed_until is null or o.snoozed_until <= now())
          and os.outreach_state in ('followed_up','unresponsive')
          and not exists (
                select 1 from quotes q
                 where q.opportunity_id = os.opportunity_id
                   and q.subcontractor_id = os.subcontractor_id
                   and q.quote_amount > 0
              )
          and not exists (
                select 1 from call_cards cc
                 where cc.opportunity_id = os.opportunity_id
                   and cc.subcontractor_id = os.subcontractor_id
                   and cc.status = 'pending'
              )
        order by (o.deadline is null), o.deadline asc, s.company_name asc
        limit 12`
    ),
    // Scoped like every other row on this screen. Unscoped it listed other
    // customers' opportunity titles, subcontractor names, and quote amounts on
    // the Action Center, which is as direct a disclosure as this product has.
    query<ActionQuoteReviewRow>(
      `select q.id as quote_id, o.id as opportunity_id, o.title as opportunity_title,
              s.company_name, q.trade, q.quote_amount, o.deadline
         from quotes q
         join opportunities o on o.id = q.opportunity_id
         left join subcontractors s on s.id = q.subcontractor_id
        where o.org_id = $1
          and o.status = 'open'
          and ${ACTIVE_PURSUIT_SQL}
          and q.is_out_of_range = true
          and o.stage in ('quote_entry','bid_building','call_queue','outreach')
          and (o.snoozed_until is null or o.snoozed_until <= now())
        order by (o.deadline is null), o.deadline asc
        limit 10`,
      [orgId]
    ),
    query<ComplianceAlertRow>(
      `select id, category, label, due_at,
              coalesce(status_override, status) as status, days_remaining
         from compliance_items
        where org_id = $1
          /*
           * The five states that need somebody today, in the vocabulary the
           * rows now carry. Written as the old three severities, this clause
           * matched nothing at all after the migration and the Today counter
           * silently read zero for every account.
           */
          and coalesce(status_override, status)
              in ('conflicting','expired','blocked','needs_review','expiring_soon')
        order by case coalesce(status_override, status)
                   when 'conflicting'   then 0
                   when 'expired'       then 1
                   when 'blocked'       then 2
                   when 'needs_review'  then 3
                   else 4 end,
                 (due_at is null), due_at asc
        limit 8`,
      [orgId]
    ),
    // A weight proposal is a rubric change this customer is being asked to
    // approve, and the rationale quotes their own win/loss record back to
    // them. Approving another org's proposal would also retune the wrong
    // rubric.
    query<ProposedWeightsRow>(
      `select id, version, rationale, proposed_at
         from scoring_weights
        where org_id = $1 and approved_at is null and proposed_by = 'learning-loop'
        order by proposed_at desc limit 3`,
      [orgId]
    ),
    queryOne<{ n: number }>(
      `select count(*)::int as n from backlink_outreach
        where org_id = $1 and approval_status='pending'`,
      [orgId]
    ),
    queryOne<{ n: number }>(
      `select (select count(*) from opportunities
                where status='open' and org_id='${orgId}' and snoozed_until > now())::int
           + (select count(*) from call_cards cc
                join opportunities o on o.id = cc.opportunity_id
                where cc.status='pending' and o.org_id='${orgId}' and cc.snoozed_until > now())::int as n`
    ),
    query<{ stage: string; count: number }>(
      `select stage, count(*)::int as count from opportunities
          where status='open' and org_id='${orgId}'
            and coalesce(pursuit_state, 'active') <> 'aborted'
          group by stage`
    ),
    // Replies the platform held back rather than acted on. Scoped by org so
    // one tenant never sees another's subcontractor correspondence.
    query<ActionReplyReviewRow>(
      `select e.id, e.subcontractor_id, s.company_name,
              e.opportunity_id, o.title as opportunity_title, e.trade,
              e.intent, e.reason, e.review_reason, e.original_message,
              e.confidence::text as confidence, e.created_at
         from subcontractor_reply_events e
         left join subcontractors s on s.id = e.subcontractor_id
         left join opportunities o on o.id = e.opportunity_id
        where e.needs_review and e.reviewed_at is null
          and (e.org_id = '${orgId}' or (e.org_id is null and o.org_id = '${orgId}'))
          and (o.id is null or ${ACTIVE_PURSUIT_SQL})
        order by e.created_at desc
        limit 20`
    ).catch(() => []),
    // Subcontractor paperwork on live contracts. Assessed in TypeScript rather
    // than SQL so Today, the onboarding agent, and the sub's own page all
    // apply exactly the same rules.
    loadAwardCompliance({ orgId }).catch(() => []),
    /*
     * The same predicates, uncapped. Built from ACTION_OPP_WHERE so a change
     * to a bucket's meaning cannot move the list without moving the number.
     */
    queryOne<{
      triage: number;
      bid_work: number;
      urgent: number;
      flagged: number;
      sub_follow_ups: number;
      quote_reviews: number;
      reply_reviews: number;
      compliance: number;
    }>(
      `select
         (${actionOppCount(orgId)} ${ACTION_OPP_WHERE.triage}) as triage,
         (${actionOppCount(orgId)} ${ACTION_OPP_WHERE.bidWork}) as bid_work,
         (${actionOppCount(orgId)} ${ACTION_OPP_WHERE.urgent}) as urgent,
         (${actionOppCount(orgId)} ${ACTION_OPP_WHERE.flagged}) as flagged,
         (select count(*)::int from opportunity_subs os
            join opportunities o on o.id = os.opportunity_id
           where o.org_id = '${orgId}' and o.status='open'
             and ${ACTIVE_PURSUIT_SQL}
             and os.outreach_state in ('followed_up','unresponsive')) as sub_follow_ups,
         (select count(*)::int from quotes q
            join opportunities o on o.id = q.opportunity_id
           where o.org_id = '${orgId}' and o.status='open' and ${ACTIVE_PURSUIT_SQL} and q.is_out_of_range) as quote_reviews,
         (select count(*)::int from subcontractor_reply_events e
            left join opportunities o on o.id = e.opportunity_id
           where e.needs_review and e.reviewed_at is null
             and (e.org_id = '${orgId}' or (e.org_id is null and o.org_id = '${orgId}'))
             and (o.id is null or ${ACTIVE_PURSUIT_SQL})) as reply_reviews,
         (select count(*)::int from compliance_items ci
           where ci.org_id = '${orgId}'
             and coalesce(ci.status_override, ci.status)
                 in ('conflicting','expired','blocked','needs_review','expiring_soon')) as compliance`,
      [urgentDays]
    ).catch(() => null),
  ]);

  const callsWithWork: ActionCallRow[] = callRows.map(
    ({ solicitation_analysis, description, ...row }) => ({
      ...row,
      work_summary:
        resolveSubWork({
          trade: row.trade,
          analysis: solicitation_analysis,
          description,
          maxChars: 180,
        }).work || null,
    })
  );
  // Only the ones a person has to do something about. A sub whose paperwork
  // is complete is not news.
  const awardCompliance = awardComplianceRows.filter(needsAttentionOnWonWork);
  const followUpsWithWork: ActionSubFollowUpRow[] = subFollowUps.map(
    ({ solicitation_analysis, description, ...row }) => ({
      ...row,
      work_summary:
        resolveSubWork({
          trade: row.trade,
          analysis: solicitation_analysis,
          description,
          maxChars: 180,
        }).work || null,
    })
  );

  return {
    triage,
    calls: {
      count: callRow?.count ?? 0,
      soonest_deadline: callRow?.soonest_deadline ?? null,
      rows: callsWithWork,
    },
    bidWork,
    awaitingOutcome,
    urgent,
    flagged,
    subFollowUps: followUpsWithWork,
    quoteReviews,
    complianceAlerts,
    awardCompliance,
    proposedWeights,
    backlinkApprovals: backlinkRow?.n ?? 0,
    snoozedCount: snoozedRow?.n ?? 0,
    stageCounts,
    replyReviews,
    /*
     * Fall back to the fetched lengths when the count query fails, rather
     * than to zero: an understated number is a smaller lie than a screen
     * claiming there is nothing to do while showing ten things to do.
     */
    totals: {
      triage: totalsRow?.triage ?? triage.length,
      bidWork: totalsRow?.bid_work ?? bidWork.length,
      urgent: totalsRow?.urgent ?? urgent.length,
      flagged: totalsRow?.flagged ?? flagged.length,
      subFollowUps: totalsRow?.sub_follow_ups ?? followUpsWithWork.length,
      quoteReviews: totalsRow?.quote_reviews ?? quoteReviews.length,
      replyReviews: totalsRow?.reply_reviews ?? replyReviews.length,
      compliance: totalsRow?.compliance ?? complianceAlerts.length,
    },
  };
}

export interface EngineStatus {
  lastRunAt: string | null;
  openCount: number;
  /** Last check-in from the worker process itself, and the step it is on. */
  heartbeatAt: string | null;
  phase: string | null;
}

/**
 * Is the background engine (worker + scheduler) alive at all? Maintenance
 * sweeps run every 10-20 minutes, so a multi-hour silence while opportunities
 * sit open means the worker process isn't running, the single failure mode
 * that strands every record at once (e.g. a web-only deployment).
 */
export async function engineStatus(): Promise<EngineStatus> {
  const [row, heartbeat] = await Promise.all([
    queryOne<{ last_run: string | null; open_count: number }>(
      `select (select max(started_at) from job_runs) as last_run,
            (select count(*)::int from opportunities
              where status='open' and org_id=$1) as open_count`,
      [await currentOrg()]
    ),
    // The worker's own check-in. A job log can only say when work last ran,
    // which reads as "dead" on a quiet afternoon and as "fine" when a run is
    // wedged half-open. Tolerated as missing so an older schema still renders.
    readWorkerHeartbeat().catch(() => null),
  ]);
  return {
    lastRunAt: row?.last_run ?? null,
    openCount: row?.open_count ?? 0,
    heartbeatAt: heartbeat?.updatedAt ?? null,
    phase: heartbeat?.phase ?? null,
  };
}

export interface AgentHealth {
  runs24h: number;
  errors24h: number;
  lastRunAt: string | null;
  /** Agent with the most failures in the window, when any failed. */
  worstAgent: string | null;
}

/** One-look answer to "is the machine OK?", shown atop the Automation Log. */
export async function agentHealth(): Promise<AgentHealth> {
  const org = await currentOrg();
  const [totals, worst] = await Promise.all([
    queryOne<{ runs: number; errors: number; last_run: string | null }>(
      `select count(*)::int as runs,
              count(*) filter (where status='error')::int as errors,
              max(started_at) as last_run
         from job_runs
        where org_id = $1
          and started_at > now() - interval '24 hours'`,
      [org]
    ),
    queryOne<{ agent: string }>(
      `select agent from job_runs
        where org_id = $1
          and status='error' and started_at > now() - interval '24 hours'
        group by agent order by count(*) desc limit 1`,
      [org]
    ),
  ]);
  return {
    runs24h: totals?.runs ?? 0,
    errors24h: totals?.errors ?? 0,
    lastRunAt: totals?.last_run ?? null,
    worstAgent: worst?.agent ?? null,
  };
}

export interface DailyDigest {
  found: number;
  autoPursued: number;
  replies: number;
  bidsPriced: number;
  expiredArchived: number;
  callsLogged: number;
}

/**
 * What the automation did in the last 24 hours, the "while you were away"
 * strip on Today. Counts real events (rows + agent logs), never estimates.
 */
export async function dailyDigest(): Promise<DailyDigest> {
  const row = await queryOne<Record<keyof DailyDigest, number>>(
    `select
       (select count(*) from opportunities
         where created_at > now() - interval '24 hours' and org_id=$1)::int as found,
       (select count(*) from agent_logs
         where agent='scoring-engine' and action='auto-pursue'
           and created_at > now() - interval '24 hours' and org_id=$1)::int as "autoPursued",
       (select count(*) from communications
         where direction='inbound' and channel='email'
           and created_at > now() - interval '24 hours' and org_id=$1)::int as replies,
       (select count(distinct opportunity_id) from bids
         where updated_at > now() - interval '24 hours' and org_id=$1)::int as "bidsPriced",
       (select count(*) from agent_logs
         where agent='expired-opportunity-sweep' and action='archive-expired'
           and created_at > now() - interval '24 hours' and org_id=$1)::int as "expiredArchived",
       (select count(*) from agent_logs
         where agent='operator' and action='call-logged'
           and created_at > now() - interval '24 hours' and org_id=$1)::int as "callsLogged"`,
    [await currentOrg()]
  );
  return {
    found: row?.found ?? 0,
    autoPursued: row?.autoPursued ?? 0,
    replies: row?.replies ?? 0,
    bidsPriced: row?.bidsPriced ?? 0,
    expiredArchived: row?.expiredArchived ?? 0,
    callsLogged: row?.callsLogged ?? 0,
  };
}

// --- Site Authority / backlink module ---

export interface AuthorityOverview {
  latest: { domain_rating: number | null; referring_domains: number | null; backlinks_total: number | null; captured_at: string } | null;
  first: { domain_rating: number | null; captured_at: string } | null;
  trend: { domain_rating: number | null; captured_at: string }[];
}

/** Latest authority snapshot + a trend series (most recent 60 points). */
export async function authorityOverview(): Promise<AuthorityOverview> {
  const rows = await query<{ domain_rating: string | null; referring_domains: number | null; backlinks_total: number | null; captured_at: string }>(
    `select domain_rating, referring_domains, backlinks_total, captured_at
       from authority_snapshots order by captured_at desc limit 60`
  );
  const asNum = (v: string | null) => (v == null ? null : Number(v));
  const latest = rows[0]
    ? { domain_rating: asNum(rows[0].domain_rating), referring_domains: rows[0].referring_domains, backlinks_total: rows[0].backlinks_total, captured_at: rows[0].captured_at }
    : null;
  const first = rows.length
    ? { domain_rating: asNum(rows[rows.length - 1].domain_rating), captured_at: rows[rows.length - 1].captured_at }
    : null;
  const trend = [...rows].reverse().map((r) => ({ domain_rating: asNum(r.domain_rating), captured_at: r.captured_at }));
  return { latest, first, trend };
}

export interface ProspectRow {
  id: string;
  domain: string;
  opportunity_type: string;
  domain_rating: number | null;
  relevance: number | null;
  traffic: number | null;
  priority_score: number | null;
  tier: string | null;
  link_type: string | null;
  status: string;
  qualification_json: unknown;
  contact_email: string | null;
  outreach_status: string | null;
}

/** Qualified prospects (highest priority first), excluding rejects, with any outreach state. */
export async function backlinkProspects(limit = 200): Promise<ProspectRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select p.id, p.domain, p.opportunity_type, p.domain_rating, p.relevance, p.traffic,
            p.priority_score, p.tier, p.link_type, p.status, p.qualification_json, p.contact_email,
            (select o.approval_status from backlink_outreach o
               where o.prospect_id = p.id order by o.created_at desc limit 1) as outreach_status
       from backlink_prospects p
      where p.org_id = $2 and p.tier is not null and p.tier <> 'reject'
      order by p.priority_score desc nulls last
      limit $1`,
    [limit, await currentOrg()]
  );
  return rows.map((r) => ({
    id: String(r.id),
    domain: String(r.domain),
    opportunity_type: String(r.opportunity_type),
    domain_rating: r.domain_rating == null ? null : Number(r.domain_rating),
    relevance: r.relevance == null ? null : Number(r.relevance),
    traffic: r.traffic == null ? null : Number(r.traffic),
    priority_score: r.priority_score == null ? null : Number(r.priority_score),
    tier: r.tier == null ? null : String(r.tier),
    link_type: r.link_type == null ? null : String(r.link_type),
    status: String(r.status),
    qualification_json: r.qualification_json,
    contact_email: r.contact_email == null ? null : String(r.contact_email),
    outreach_status: r.outreach_status == null ? null : String(r.outreach_status),
  }));
}

export interface OutreachActivityRow {
  id: string;
  domain: string;
  contact_email: string | null;
  subject: string | null;
  sent_at: string | null;
  replied_at: string | null;
  follow_up_sent: boolean;
  send_error: string | null;
}

/** Approved outreach and its send/reply state (the "in outreach" tracker). */
export async function outreachActivity(limit = 100): Promise<OutreachActivityRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select o.id, p.domain, p.contact_email, o.subject, o.sent_at, o.replied_at,
            o.follow_up_sent, o.send_error
       from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.org_id = $2 and o.approval_status = 'approved'
      order by o.replied_at desc nulls last, o.sent_at desc nulls last, o.updated_at desc
      limit $1`,
    [limit, await currentOrg()]
  );
  return rows.map((r) => ({
    id: String(r.id),
    domain: String(r.domain),
    contact_email: r.contact_email == null ? null : String(r.contact_email),
    subject: r.subject == null ? null : String(r.subject),
    sent_at: r.sent_at == null ? null : String(r.sent_at),
    replied_at: r.replied_at == null ? null : String(r.replied_at),
    follow_up_sent: Boolean(r.follow_up_sent),
    send_error: r.send_error == null ? null : String(r.send_error),
  }));
}

export interface OutreachRow {
  id: string;
  prospect_id: string;
  domain: string;
  channel: string;
  subject: string | null;
  body: string | null;
  approval_status: string;
  created_at: string;
  sent_at: string | null;
}

/** Drafted outreach awaiting a human decision (the approval gate). */
export async function outreachQueue(status = "pending"): Promise<OutreachRow[]> {
  const rows = await query<Record<string, unknown>>(
    `select o.id, o.prospect_id, p.domain, o.channel, o.subject, o.body,
            o.approval_status, o.created_at, o.sent_at
       from backlink_outreach o join backlink_prospects p on p.id = o.prospect_id
      where o.org_id = $2 and o.approval_status = $1
      order by p.priority_score desc nulls last, o.created_at desc`,
    [status, await currentOrg()]
  );
  return rows.map((r) => ({
    id: String(r.id),
    prospect_id: String(r.prospect_id),
    domain: String(r.domain),
    channel: String(r.channel),
    subject: r.subject == null ? null : String(r.subject),
    body: r.body == null ? null : String(r.body),
    approval_status: String(r.approval_status),
    created_at: String(r.created_at),
    sent_at: r.sent_at == null ? null : String(r.sent_at),
  }));
}

export interface BacklinkChange {
  source_domain: string;
  domain_rating: number | null;
  link_type: string | null;
  first_seen_at: string;
  last_seen_at: string;
  lost_at: string | null;
}

/** Recent backlink changes: newest live links and recently-lost links. */
export async function backlinkChanges(): Promise<{ recent: BacklinkChange[]; lost: BacklinkChange[]; liveCount: number }> {
  const map = (r: Record<string, unknown>): BacklinkChange => ({
    source_domain: String(r.source_domain),
    domain_rating: r.domain_rating == null ? null : Number(r.domain_rating),
    link_type: r.link_type == null ? null : String(r.link_type),
    first_seen_at: String(r.first_seen_at),
    last_seen_at: String(r.last_seen_at),
    lost_at: r.lost_at == null ? null : String(r.lost_at),
  });
  const recent = await query<Record<string, unknown>>(
    `select source_domain, domain_rating, link_type, first_seen_at, last_seen_at, lost_at
       from backlinks where lost_at is null order by first_seen_at desc limit 25`
  );
  const lost = await query<Record<string, unknown>>(
    `select source_domain, domain_rating, link_type, first_seen_at, last_seen_at, lost_at
       from backlinks where lost_at is not null order by lost_at desc limit 25`
  );
  const live = await queryOne<{ n: string }>(`select count(*)::text as n from backlinks where lost_at is null`);
  return { recent: recent.map(map), lost: lost.map(map), liveCount: Number(live?.n ?? 0) };
}

/**
 * The unified work queue: everything waiting on the operator, as one list.
 *
 * Feeds the queue-first Today. Each source maps to a WorkItem whose href is
 * the one place the item is completed. Org-scoped the same way reviewQueue
 * is; an unresolvable tenant yields an empty queue rather than the founding
 * org's work.
 */
export async function workQueue(): Promise<import("./domain/work-queue").WorkItem[]> {
  const { dedupeWorkItems } = await import("./domain/work-queue");
  const { flagSummary } = await import("./flag-labels");
  const { tryResolveTenantOrgId } = await import("./tenant");
  const { LEGACY_ORG_ID } = await import("./tenant-context");
  const orgId = (await tryResolveTenantOrgId()) ?? LEGACY_ORG_ID;
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return [];

  const [replies, decisions, calls, actionable, awaitingReply] = await Promise.all([
    // Unread subcontractor replies. These go to the very front of the queue:
    // the reply-poll flags a reply it could not act on confidently, and until
    // a person reads it, the solicitation it belongs to is stuck.
    query<{
      id: string;
      company_name: string | null;
      opp_id: string | null;
      opp_title: string | null;
      deadline: string | null;
      assigned_to: string | null;
    }>(
      `select e.id, s.company_name, o.id as opp_id, o.title as opp_title, o.deadline,
              o.assigned_to
         from subcontractor_reply_events e
         join subcontractors s on s.id = e.subcontractor_id
         left join opportunities o on o.id = e.opportunity_id
        where e.org_id=$1 and e.needs_review and e.reviewed_at is null
          and (o.id is null or ${ACTIVE_PURSUIT_SQL})
        order by e.created_at desc`,
      [orgId]
    ),
    query<{ id: string; title: string | null; deadline: string | null; review_expires_at: string | null; assigned_to: string | null }>(
      `select id, title, deadline, review_expires_at, assigned_to from opportunities o
        where o.org_id=$1 and ${TRIAGE_WHERE_SQL}`,
      [orgId]
    ),
    query<{ id: string; company_name: string; subcontractor_id: string | null; trade: string | null; opp_title: string | null; deadline: string | null; assigned_to: string | null }>(
      // The trade is inside card_json, not a column. `cc.trade` has never
      // existed, so this whole function has been throwing -- and Today wraps
      // it in .catch(() => []), so the work queue simply never appeared. A
      // silent catch around a query is how a feature goes missing without a
      // single error reaching anybody.
      `select cc.id, s.company_name, cc.subcontractor_id,
              coalesce(cc.card_json->>'trade', s.trade_categories[1]) as trade,
              o.title as opp_title, o.deadline, o.assigned_to
         from call_cards cc
         join opportunities o on o.id = cc.opportunity_id
         join subcontractors s on s.id = cc.subcontractor_id
        where o.org_id=$1 and ${WORKABLE_CALL_CARD_SQL}`,
      [orgId]
    ),
    query<{
      id: string;
      title: string | null;
      stage: string;
      deadline: string | null;
      risk_flags: string[] | null;
      assigned_to: string | null;
    }>(
      `select id, title, stage, deadline, risk_flags, assigned_to from opportunities o
        where o.org_id=$1 and o.human_action_required=true and o.status='open'
          and ${ACTIVE_PURSUIT_SQL}
          and not (o.tier='review' and o.stage='scoring')
          and (o.snoozed_until is null or o.snoozed_until <= now())`,
      [orgId]
    ),
    /*
     * Outreach that is out and not yet answered.
     *
     * Nothing is wrong with these and nobody needs to do anything: the packet
     * went, the follow-up has not come due, and the right action is to let the
     * clock run. They were invisible, which meant Today could say "nothing
     * waiting on you" while eleven quote requests were in flight, and an
     * operator had no way to see the pipeline was moving without opening each
     * opportunity.
     *
     * Deliberately excludes 'followed_up' and 'unresponsive': those are the
     * subFollowUps bucket, where we have already chased and a person now has
     * to decide whether to call or replace them. That is our move, not theirs.
     */
    query<{
      id: string;
      company_name: string | null;
      trade: string | null;
      opp_id: string;
      opp_title: string | null;
      deadline: string | null;
      sent_at: string | null;
      assigned_to: string | null;
    }>(
      /*
       * The send time comes from the communication, not the pairing.
       * opportunity_subs has no last_contacted_at column; it carries
       * created_at and responded_at only. Asking it for one would throw at
       * runtime and be swallowed by the caller's catch, which is exactly how
       * the call_cards query above lost `cc.trade` and took this whole
       * function with it, silently, until somebody noticed the queue was
       * always empty.
       */
      `select os.id, s.company_name, os.trade,
              o.id as opp_id, o.title as opp_title, o.deadline, o.assigned_to,
              (select max(c.created_at) from communications c
                where c.opportunity_id = os.opportunity_id
                  and c.subcontractor_id = os.subcontractor_id
                  and c.direction = 'outbound') as sent_at
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id
         join subcontractors s on s.id = os.subcontractor_id
        where o.org_id=$1 and o.status='open'
          and ${ACTIVE_PURSUIT_SQL}
          and os.outreach_state = 'sent'
        order by os.created_at asc
        limit 25`,
      [orgId]
    ),
  ]);

  const items = [
    ...replies.map((r) => ({
      key: `reply:${r.id}`,
      kind: "read_reply" as const,
      title: `Read reply from ${r.company_name ?? "a subcontractor"}`,
      context: r.opp_title ?? "",
      due: isoOrNull(r.deadline),
      recordHref: "/today#reply-reviews",
      actionLabel: "Read reply",
      record: { kind: "reply" as const, id: r.id },
      opportunityId: r.opp_id,
      assignedTo: r.assigned_to,
      reason: "The automatic reader was not confident enough to act on this, so the conversation is stopped until somebody reads it.",
    })),
    ...decisions.map((d) => ({
      key: `decide:${d.id}`,
      kind: "decide" as const,
      title: `Pursue or pass: ${d.title ?? "untitled opportunity"}`,
      context: "Borderline score",
      due: isoOrNull(d.deadline),
      expiresAt: isoOrNull(d.review_expires_at),
      recordHref: `/opportunity/${d.id}#next`,
      actionLabel: "Decide",
      record: { kind: "opportunity" as const, id: d.id },
      opportunityId: d.id,
      assignedTo: d.assigned_to,
      // The whole task is the decision, so it can be made from the row.
      actions: {
        snooze: { kind: "opportunity" as const, id: d.id },
        decide: { opportunityId: d.id, title: d.title ?? "opportunity" },
      },
      reason: d.review_expires_at
        ? "Scored close enough to the line that a person has to call it. It is dismissed automatically if nobody does."
        : "Scored close enough to the line that a person has to call it.",
    })),
    ...calls.map((c) => ({
      key: `call:${c.id}`,
      kind: "call" as const,
      title: `Call ${c.company_name}${c.trade ? ` about ${c.trade}` : ""}`,
      context: c.opp_title ?? "",
      due: isoOrNull(c.deadline),
      recordHref: `/call-queue?open=${c.id}`,
      actionLabel: "Open call",
      record: { kind: "call_card" as const, id: c.id },
      opportunityId: null,
      assignedTo: c.assigned_to,
      // Snoozes the card, not the opportunity: the bid is not on hold
      // because one subcontractor is being rung on Thursday instead.
      actions: {
        snooze: { kind: "call_card" as const, id: c.id },
        call: {
          companyName: c.company_name,
          trade: c.trade ?? null,
          subcontractorId: c.subcontractor_id ?? null,
        },
      },
      reason: "Email has not produced a price on this trade, so the next move is a phone call.",
    })),
    ...actionable.map((o) => ({
      key: `act:${o.id}`,
      kind:
        o.stage === "bid_building"
          ? ("review_bid" as const)
          : o.stage === "quote_entry"
            ? ("enter_quote" as const)
            : ("fix_blocker" as const),
      title:
        o.stage === "bid_building"
          ? `Review & submit bid: ${o.title ?? "untitled"}`
          : o.stage === "quote_entry"
            ? `Enter quotes: ${o.title ?? "untitled"}`
            : `Resolve blocker: ${o.title ?? "untitled"}`,
      context: o.stage.replace(/_/g, " "),
      due: isoOrNull(o.deadline),
      recordHref:
        o.stage === "bid_building"
          ? `/opportunity/${o.id}#submission`
          : o.stage === "quote_entry"
            ? `/opportunity/${o.id}#quotes`
            : `/opportunity/${o.id}#next`,
      actionLabel:
        o.stage === "bid_building" ? "Review bid" : o.stage === "quote_entry" ? "Enter quote" : "Resolve",
      record: { kind: "opportunity" as const, id: o.id },
      opportunityId: o.id,
      assignedTo: o.assigned_to,
      /*
       * Snooze only. Pursue and pass belong to a scoring decision, and
       * offering "pass" beside a bid that is already being built would put an
       * archive button next to a week of somebody's work.
       */
      actions: { snooze: { kind: "opportunity" as const, id: o.id } },
      reason:
        o.stage === "bid_building"
          ? "The package is assembled. Nothing goes to the agency until a person reads it and signs."
          : o.stage === "quote_entry"
            ? "Subcontractor prices are in hand and have to be recorded before the bid can be built."
            : "Automation stopped here and named what it could not resolve.",
      // The flags are what automation could not get past, in its own words.
      // Naming them is the difference between "resolve blocker" and knowing
      // which blocker.
      blocker: o.risk_flags?.length ? flagSummary(o.risk_flags) : null,
    })),
    /*
     * Quote requests that are out and unanswered.
     *
     * `fix_blocker` would be wrong and `call` would be wrong: nothing is
     * broken and nobody should be dialling yet. The kind is decide because
     * that is what the row eventually becomes, and stateOf() reads waitingOn
     * before anything else, so it never appears under "Needs you" while the
     * subcontractor still has it.
     */
    ...awaitingReply.map((w) => ({
      key: `awaiting:${w.id}`,
      kind: "decide" as const,
      title: `Waiting on ${w.company_name ?? "a subcontractor"}${w.trade ? ` for ${w.trade}` : ""}`,
      context: w.opp_title ?? "",
      due: isoOrNull(w.deadline),
      recordHref: `/opportunity/${w.opp_id}`,
      actionLabel: "Open opportunity",
      record: { kind: "pairing" as const, id: w.id },
      opportunityId: w.opp_id,
      assignedTo: w.assigned_to,
      reason: w.sent_at
        ? `The quote request went out on ${new Date(w.sent_at).toISOString().slice(0, 10)} and they have not answered yet.`
        : "The quote request has gone out and they have not answered yet.",
      waitingOn: {
        party: w.company_name ?? "a subcontractor",
        since: isoOrNull(w.sent_at),
      },
    })),
  ];
  /*
   * Whose each of these is.
   *
   * Resolved in one query for the whole queue rather than per row. The queue
   * draws up to fifty items and a per-row lookup here is the shape that turns
   * a fast page into a slow one without anybody changing the page.
   *
   * The owner comes from the opportunity, because every item above is about
   * one. A task in this product is a view of a record at a moment, so it has
   * no independent existence to hang an owner off; the record carries it and
   * the task inherits it, which also means the answer is the same wherever the
   * record appears.
   */
  const assigneeIds = Array.from(
    new Set(items.map((i) => i.assignedTo).filter((v): v is string => typeof v === "string"))
  );
  const people = new Map<string, { id: string; name: string }>();
  if (assigneeIds.length > 0) {
    const { ownerName } = await import("./domain/ownership");
    const rows = await query<{ id: string; name: string | null; email: string | null }>(
      `select id, name, email from users where id = any($1::uuid[])`,
      [assigneeIds]
    );
    for (const r of rows) people.set(r.id, { id: r.id, name: ownerName(r) });
  }
  /*
   * One destination for every row.
   *
   * `href` is the workbench, opened on this exact item, for all six kinds.
   * The per-kind deep link is kept as `recordHref` for the "open the whole
   * record" affordance, so nothing is lost: what changes is that the DEFAULT
   * of clicking a task is a screen you can finish it on, rather than a page
   * you have to find the right part of.
   */
  const owned = items.map(({ assignedTo, ...item }) => ({
    ...item,
    href: `/workbench?i=${encodeURIComponent(item.key)}`,
    owner: assignedTo ? (people.get(assignedTo) ?? null) : null,
  }));

  /*
   * Dedupe before sorting: one opportunity can be flagged for attention AND
   * sitting in bid_building, which produced two rows for one piece of work and
   * made the count at the top of Today disagree with the list under it.
   */
  return dedupeWorkItems(owned);
}
