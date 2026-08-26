/**
 * What this account's own records say about each step of the workflow.
 *
 * The Knowledge Center describes a pipeline. Describing one is easy; the
 * question an operator actually arrives with is "is that happening to me",
 * and a page that answers the first question while dodging the second is the
 * reason people open a support ticket instead.
 *
 * One round trip, org-scoped in every subquery, and every figure allowed to
 * be null. A step whose count could not be read says so on the page rather
 * than showing a zero, because zero here would read as "this never happens
 * for you" and that is a different claim from "we could not tell".
 */
import { query } from "./db";
import { currentOrg, queueCounts } from "./data";
import type { Evidence, EvidenceKey } from "./domain/knowledge";
import type { QuickStartFacts } from "./domain/knowledge";

type Row = Record<string, unknown>;

function n(v: unknown): number | null {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/** node-postgres hands back Date for timestamptz, so never cast, always convert. */
function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
}

export interface KnowledgeFacts {
  evidence: Partial<Record<EvidenceKey, Evidence>>;
  quickStart: QuickStartFacts;
}

/** Stages an opportunity has reached once somebody decided to pursue it. */
const PURSUED_STAGES =
  "('sub_research','outreach','call_queue','quote_entry','bid_building','submitted','won','lost')";

export async function knowledgeFacts(): Promise<KnowledgeFacts> {
  const orgId = await currentOrg();
  /*
   * The two "waiting on you" figures come from queueCounts, which is what the
   * sidebar badge and Today already count. Writing the predicates again here
   * would produce a second answer to "how many decisions are waiting", and a
   * page explaining the workflow is the worst place to disagree with the page
   * doing the work.
   */
  const [rows, queues] = await Promise.all([
    query<Row>(
      `select
       (select max(updated_at) from company_profile where org_id = $1) as profile_at,

       (select count(*) from opportunities
         where org_id = $1 and created_at > now() - interval '7 days') as found_recent,
       (select max(created_at) from opportunities where org_id = $1) as found_at,
       (select title from opportunities where org_id = $1
         order by created_at desc limit 1) as found_example,

       -- Scoring leaves no timestamp of its own, so the opportunity's arrival
       -- stands in for it. The two are minutes apart in practice, and the
       -- alternative is a column written only to be read here.
       (select count(*) from opportunities
         where org_id = $1 and score is not null
           and created_at > now() - interval '7 days') as scored_recent,
       (select max(created_at) from opportunities
         where org_id = $1 and score is not null) as scored_at,
       (select title from opportunities where org_id = $1 and score is not null
         order by created_at desc limit 1) as scored_example,

       (select count(*) from opportunities
         where org_id = $1 and created_at > now() - interval '7 days'
           and (tier = 'pursue' or stage in ${PURSUED_STAGES})) as decided_recent,
       (select max(created_at) from opportunities
         where org_id = $1 and (tier = 'pursue' or stage in ${PURSUED_STAGES})) as decided_at,

       (select count(*) from opportunities
         where org_id = $1 and solicitation_analysis is not null
           and created_at > now() - interval '7 days') as analyzed_recent,
       (select max(created_at) from opportunities
         where org_id = $1 and solicitation_analysis is not null) as analyzed_at,
       (select title from opportunities
         where org_id = $1 and solicitation_analysis is not null
         order by created_at desc limit 1) as analyzed_example,

       (select count(*) from pricing_comps
         where org_id = $1 and created_at > now() - interval '7 days') as comps_recent,
       (select max(created_at) from pricing_comps where org_id = $1) as comps_at,

       (select count(*) from subcontractors
         where org_id = $1 and created_at > now() - interval '7 days') as subs_recent,
       (select max(created_at) from subcontractors where org_id = $1) as subs_at,
       (select company_name from subcontractors where org_id = $1
         order by created_at desc limit 1) as subs_example,

       (select count(*) from communications
         where org_id = $1 and direction = 'outbound'
           and created_at > now() - interval '7 days') as emailed_recent,
       (select max(created_at) from communications
         where org_id = $1 and direction = 'outbound') as emailed_at,

       (select count(*) from call_cards
         where org_id = $1 and called_at > now() - interval '7 days') as called_recent,
       (select max(called_at) from call_cards where org_id = $1) as called_at,

       (select count(*) from quotes
         where org_id = $1 and created_at > now() - interval '7 days') as quoted_recent,
       (select max(created_at) from quotes where org_id = $1) as quoted_at,

       (select count(*) from bids
         where org_id = $1 and created_at > now() - interval '7 days') as built_recent,
       (select max(created_at) from bids where org_id = $1) as built_at,

       (select count(*) from bids
         where org_id = $1 and submitted_at > now() - interval '7 days') as submitted_recent,
       (select max(submitted_at) from bids where org_id = $1) as submitted_at,

       (select count(*) from bids
         where org_id = $1 and outcome in ('won','lost')
           and updated_at > now() - interval '7 days') as outcome_recent,
       (select max(updated_at) from bids
         where org_id = $1 and outcome in ('won','lost')) as outcome_at`,
      [orgId],
    ).catch(() => [] as Row[]),
    queueCounts().catch(() => ({ review: 0, callQueue: 0 })),
  ]);

  const r = rows[0];
  // No row at all means the read failed. Every step then reads "Not recorded",
  // which is the truth, rather than a page full of confident zeroes.
  if (!r) {
    return {
      evidence: {},
      quickStart: {
        hasOpportunities: false,
        hasDecided: false,
        hasSubs: false,
      },
    };
  }

  const ev: Partial<Record<EvidenceKey, Evidence>> = {
    profile: { recent: null, lastAt: iso(r.profile_at) },
    found: {
      recent: n(r.found_recent),
      lastAt: iso(r.found_at),
      example: str(r.found_example),
    },
    scored: {
      recent: n(r.scored_recent),
      lastAt: iso(r.scored_at),
      example: str(r.scored_example),
    },
    decided: {
      recent: n(r.decided_recent),
      lastAt: iso(r.decided_at),
      waiting: queues.review,
    },
    analyzed: {
      recent: n(r.analyzed_recent),
      lastAt: iso(r.analyzed_at),
      example: str(r.analyzed_example),
    },
    comps: { recent: n(r.comps_recent), lastAt: iso(r.comps_at) },
    subs_found: {
      recent: n(r.subs_recent),
      lastAt: iso(r.subs_at),
      example: str(r.subs_example),
    },
    emailed: { recent: n(r.emailed_recent), lastAt: iso(r.emailed_at) },
    called: {
      recent: n(r.called_recent),
      lastAt: iso(r.called_at),
      waiting: queues.callQueue,
    },
    quoted: { recent: n(r.quoted_recent), lastAt: iso(r.quoted_at) },
    built: { recent: n(r.built_recent), lastAt: iso(r.built_at) },
    submitted: { recent: n(r.submitted_recent), lastAt: iso(r.submitted_at) },
    outcome: { recent: n(r.outcome_recent), lastAt: iso(r.outcome_at) },
  };

  return {
    evidence: ev,
    quickStart: {
      hasOpportunities: iso(r.found_at) != null,
      hasDecided: iso(r.decided_at) != null,
      hasSubs: iso(r.subs_at) != null,
    },
  };
}
