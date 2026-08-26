import { actionCenter, opportunityDetail, subDetail } from "@/lib/data";
import { getActiveProfile } from "@/lib/ai/companyProfile";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { accountSetup, type SetupUser } from "@/lib/setup-facts";
import { areCallsEnabled, getAutomationState } from "@/lib/app-settings";
import { computeBidReadiness } from "@/lib/domain/bid-readiness";
import { summarizeTradeCoverage } from "@/lib/domain/trade-coverage";
import {
  buildPageGuide,
  opportunityIdFromPath,
  pageKeyFromPath,
  subIdFromPath,
  summarizeActions,
  type GuideScoreExplain,
  type OpportunityGuideFacts,
  type SubGuideFacts,
} from "@/lib/domain/page-guide";
import { buildGuideAdapters } from "@/lib/guide/build-adapters";
import type { Bid, ScoreBreakdown, SolicitationAnalysis } from "@/lib/types";
import { query, queryOne } from "@/lib/db";
import { WORKABLE_CALL_CARD_SQL } from "@/lib/data";
import { tryResolveTenantOrgId } from "@/lib/tenant";

import type { PageGuide } from "@/lib/domain/page-guide";

export interface GuideBundle {
  guide: PageGuide;
  adapters: ReturnType<typeof buildGuideAdapters>;
  /** Changes when the account's workload does, so the panel can refresh. */
  fingerprint: string;
}

/**
 * Every fact the Guide Me panel stands on, gathered server-side.
 *
 * Extracted from the route so the Q&A endpoint can rebuild it rather than
 * being handed one by the browser. An answer grounded in a snapshot the
 * client supplies is grounded in whatever the client says, and it is also
 * grounded in whatever was true when the panel last loaded, which on a page
 * left open is not now.
 */
export async function loadGuideBundle(
  auth: SetupUser,
  pathname: string
): Promise<GuideBundle> {
  const pageKey = pageKeyFromPath(pathname);

  await hydrateIntegrationEnv().catch(() => undefined);

  // Every raw count below is this organization's own. The guide reads them
  // back as "what needs you", so unscoped they described the whole platform's
  // workload to whoever opened the panel.
  const orgId = await tryResolveTenantOrgId();

  const [profile, automation, callsEnabled, actionsRaw, experienceRow, pulseRow] =
    await Promise.all([
    getActiveProfile().catch(() => null),
    getAutomationState().catch(() => ({
      paused: false,
      changed_at: null,
      changed_by: null,
    })),
    // Calling off means the guide must stop routing people to the Call Queue.
    areCallsEnabled().catch(() => true),
    actionCenter().catch(() => null),
    orgId
      ? queryOne<{ submitted: number; open: number }>(
          // Decides whether the operator is new to the product, so it has to
          // count THEIR history. Platform-wide, one established customer made
          // every brand-new account look experienced and skipped its onboarding.
          `select
             (select count(*)::int from opportunities
               where org_id = $1 and (status <> 'open' or stage in ('submitted','won','lost'))) as submitted,
             (select count(*)::int from opportunities
               where org_id = $1 and status = 'open') as open`,
          [orgId]
        ).catch(() => null)
      : Promise.resolve(null),
    orgId
      ? queryOne<Record<string, unknown>>(
          `select
             (select count(*) from opportunities
               where org_id = $1 and status='open' and human_action_required=true)::int as needs_you,
             (select count(*) from opportunities
               where org_id = $1 and status='open')::int as open_count,
             (select coalesce(max(extract(epoch from updated_at))::bigint, 0)
                from opportunities where org_id = $1) as opp_stamp,
             -- Counted as the Call Queue counts it, so the guide cannot offer
             -- a call the queue will not list.
             (select count(*) from call_cards cc
                join opportunities o on o.id = cc.opportunity_id
                join subcontractors s on s.id = cc.subcontractor_id
               where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL})::int as calls,
             (select count(*) from compliance_items
               where org_id = $1
                 and coalesce(status_override, status) in ('warning','critical','blocked'))::int as compliance,
             (select count(*) from scoring_weights
               where org_id = $1 and approved_at is null and proposed_by='learning-loop')::int as weights,
             (select count(*) from backlink_outreach
               where org_id = $1 and approval_status='pending')::int as backlinks`,
          [orgId]
        ).catch(() => null)
      : Promise.resolve(null),
  ]);

  // Through accountSetup, so this panel and the Today page beside it cannot
  // disagree about how far setup has got. It read the deployment's own
  // environment keys and ignored both the customer's saved keys and the trial,
  // so a trial account with its own SAM key was told the step was outstanding
  // on one half of the screen and done on the other.
  const setup = await accountSetup(profile?.profile_json ?? null, auth);

  // actionsRaw carries `totals` (uncapped counts) and `awardCompliance`, so the
  // guide's number is the same one Today shows rather than a second opinion
  // assembled from page-sized lists.
  const actions = actionsRaw
    ? summarizeActions(actionsRaw)
    : {
        urgent: 0,
        triage: 0,
        calls: 0,
        bidWork: 0,
        subFollowUps: 0,
        quoteReviews: 0,
        compliance: 0,
        approvals: 0,
        totalActions: 0,
      };

  const experience: "new" | "familiar" =
    !setup.complete || (experienceRow?.submitted ?? 0) < 1 ? "new" : "familiar";

  let opportunity: OpportunityGuideFacts | null = null;
  let opportunitySubs: {
    subcontractor_id: string;
    company_name: string;
    trade: string | null;
  }[] = [];
  let sub: SubGuideFacts | null = null;
  let subRow: {
    id: string;
    company_name: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    owner_name: string | null;
  } | null = null;

  const oppId = opportunityIdFromPath(pathname);
  if (pageKey === "opportunity" && oppId) {
    const detail = await opportunityDetail(oppId).catch(() => null);
    if (detail) {
      const { opp, quotes, subs } = detail;
      const bid = detail.bid as Bid | null;
      const analysis = opp.solicitation_analysis as SolicitationAnalysis | null;
      const breakdown = opp.score_breakdown as ScoreBreakdown | null;
      opportunitySubs = subs.map((s) => ({
        subcontractor_id: s.subcontractor_id,
        company_name: s.company_name,
        trade: s.trade,
      }));
      const quoteRows = (quotes as Record<string, unknown>[]).map((q) => ({
        trade: (q.trade as string) ?? null,
        quote_amount: Number(q.quote_amount) || null,
        is_out_of_range: Boolean(q.is_out_of_range),
      }));
      const coverage = summarizeTradeCoverage({
        requiredTrades: analysis?.required_trades ?? [],
        subs: subs.map((s) => ({
          trade: s.trade,
          outreach_state: s.outreach_state,
          emails_sent: s.emails_sent,
          calls_logged: s.calls_logged,
          responded_at: s.responded_at,
        })),
        quotes: quoteRows,
      });
      const readiness = computeBidReadiness({
        stage: opp.stage,
        status: opp.status,
        deadline: opp.deadline,
        riskFlags: opp.risk_flags ?? [],
        attentionFromBrief: analysis?.attention_items ?? [],
        requiredTrades: analysis?.required_trades ?? [],
        quotes: quoteRows,
        tradeCoverageUncovered: coverage.totals.uncovered,
        uncoveredTrades: coverage.trades.filter((t) => t.quotes === 0).map((t) => t.trade),
        tradeStatuses: coverage.trades.map((t) => ({
          trade: t.trade,
          status: t.status,
          quotes: t.quotes,
          contacted: t.contacted,
          found: t.found,
        })),
        subsFound: subs.length,
        hasBid: Boolean(bid),
        packageReady: bid?.package_ready ?? null,
        humanFlags: (bid?.human_flags as string[] | null) ?? null,
        humanActionRequired: opp.human_action_required,
        completenessMissing: analysis?.completeness?.missing ?? null,
        packageBlockers: (bid?.validation_json as { blockers?: string[] } | null)?.blockers ?? null,
      });

      const hoursSinceUpdate = opp.updated_at
        ? (Date.now() - new Date(opp.updated_at).getTime()) / 3_600_000
        : null;

      let scoreExplain: GuideScoreExplain | null = null;
      if (breakdown) {
        scoreExplain = {
          total: breakdown.total,
          summary: breakdown.summary,
          factors: breakdown.dimensions.map((d) => ({
            label: d.label,
            points: d.points,
            max: d.max_points,
            reasoning: d.reasoning,
          })),
        };
      }

      opportunity = {
        id: opp.id,
        title: opp.title,
        stage: opp.stage,
        score: opp.score,
        deadline: opp.deadline,
        stepInput: {
          stage: opp.stage,
          tier: opp.tier,
          humanActionRequired: opp.human_action_required,
          quoteCount: readiness.tradesWithQuotes,
          requiredTradeCount: analysis?.required_trades?.length ?? 0,
          tradesWithQuotes: readiness.tradesWithQuotes,
          tradeCoverageUncovered: coverage.totals.uncovered,
          hasBid: Boolean(bid),
          bidSubmitted: Boolean(bid?.submitted_at),
          outcome: bid?.outcome ?? null,
          pastPerfBlocked: opp.past_perf_classification === "prime_only",
          automationPaused: automation.paused,
          callsEnabled,
          hoursSinceUpdate,
          expired:
            opp.status === "archived" && (opp.risk_flags ?? []).includes("expired"),
        },
        readiness: {
          percent: readiness.percent,
          summary: readiness.summary,
          attention: readiness.attention,
          complete: readiness.complete,
          actionRequired: readiness.actionRequired,
          blocked: readiness.blocked,
        },
        scoreExplain,
        packageReady: bid?.package_ready ?? null,
        packageBlockers:
          (bid?.validation_json as { blockers?: string[] } | null)?.blockers ?? [],
        bidSubmitted: Boolean(bid?.submitted_at),
      };
    }
  }

  const sid = subIdFromPath(pathname);
  if (pageKey === "sub" && sid) {
    const detail = await subDetail(sid).catch(() => null);
    if (detail) {
      const { sub: row, pairings } = detail;
      const openPairings = pairings.filter((p) => p.status === "open");
      subRow = {
        id: row.id,
        company_name: row.company_name,
        email: row.email,
        phone: row.phone,
        website: row.website ?? null,
        owner_name: row.owner_name ?? null,
      };
      sub = {
        id: row.id,
        companyName: row.company_name,
        contactStatus: row.contact_status,
        email: row.email,
        phone: row.phone,
        openJobs: openPairings.length,
        lastTouchAt: null,
        pendingOutreach: openPairings.slice(0, 5).map((p) => ({
          opportunityId: p.opportunity_id,
          title: p.opportunity_title ?? null,
          state: p.outreach_state ?? null,
        })),
        missingContact: !row.email && !row.phone,
      };
    }
  }

  const guide = buildPageGuide({
    pathname,
    setup,
    actions,
    automationPaused: automation.paused,
    experience,
    opportunity,
    sub,
  });

  // Load quote subs for bid-work adapters when not already on that opportunity.
  const quoteOppId =
    guide.steps.find((s) => s.kind === "enter-quote")?.opportunityId ||
    actionsRaw?.bidWork[0]?.id;
  if (quoteOppId && opportunitySubs.length === 0) {
    const rows = await query<{
      subcontractor_id: string;
      company_name: string;
      trade: string | null;
    }>(
      // opportunity_subs carries no org_id of its own, so it is scoped
      // through its opportunity, the same way lib/data.ts scopes it.
      `select os.subcontractor_id, s.company_name, os.trade
         from opportunity_subs os
         join subcontractors s on s.id = os.subcontractor_id
         join opportunities o on o.id = os.opportunity_id
        where os.opportunity_id = $1 and o.org_id = $2
        order by os.trade nulls last, s.company_name
        limit 100`,
      [quoteOppId, orgId]
    ).catch(() => []);
    opportunitySubs = rows;
  }

  const adapters = buildGuideAdapters({
    guide,
    actions: actionsRaw,
    opportunity,
    opportunitySubs,
    sub,
    subRow,
  });

  return { guide, adapters, fingerprint: JSON.stringify(pulseRow ?? {}) };
}
