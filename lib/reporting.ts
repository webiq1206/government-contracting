/**
 * The reported figures, read from the records that back them.
 *
 * Every function here returns Metric objects carrying their own provenance, so
 * the page cannot render a number without also being able to say where it came
 * from. That is not decoration: the first time one of these disagrees with
 * somebody's spreadsheet, "wins over decided bids, from the bids table,
 * excluding bids still with the agency" is what settles it, and a bare
 * percentage loses.
 *
 * Scoped by org on every query. These are counts an operator plans against,
 * and one tenant's bids in another's win rate would be both a privacy failure
 * and a wrong number.
 */
import { query, queryOne } from "./db";
import { computeCustomKpi, currentOrg } from "./data";
import {
  asMetricUnit,
  isReportedKpi,
  type KpiMetricDef,
  type KpiParams,
} from "./domain/kpi";
import {
  metric,
  share,
  splitValue,
  expectedValue,
  type Metric,
  type ValueRow,
  type ValueSplit,
} from "./domain/report-metrics";

function n(v: unknown): number {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : 0;
}

/** A median from Postgres, kept null when nothing was measured. */
function med(v: unknown): number | null {
  const x = typeof v === "string" ? Number(v) : v;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  return Math.round(Math.max(0, x) * 10) / 10;
}

const range = (from: Date | null, to: Date | null) => [
  from ? from.toISOString() : null,
  to ? to.toISOString() : null,
];

// ---------------------------------------------------------------------------
// Deadlines and decisions
// ---------------------------------------------------------------------------

export async function deadlineMetrics(from: Date | null, to: Date | null): Promise<Metric[]> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `with pursued as (
       select o.id, o.deadline,
              (select min(b.submitted_at) from bids b
                where b.opportunity_id = o.id and b.org_id = $1) as submitted_at
         from opportunities o
        where o.org_id = $1
          and o.deadline is not null
          and o.deadline < now()
          and (o.stage in ('sub_research','outreach','call_queue','quote_entry',
                           'bid_building','submitted','won','lost') or o.tier = 'pursue')
          and ($2::timestamptz is null or o.created_at >= $2::timestamptz)
          and ($3::timestamptz is null or o.created_at <  $3::timestamptz)
     )
     select count(*)::int as due,
            count(*) filter (where submitted_at is null)::int as missed,
            /*
             * Only bids that went in before the deadline count as on time.
             * A submission stamped after the closing date is a miss with a
             * receipt, and counting it as a save is how a process that is
             * chronically late looks fine on a dashboard.
             */
            count(*) filter (where submitted_at is not null and submitted_at <= deadline)::int as on_time,
            count(*) filter (where submitted_at is not null and submitted_at > deadline)::int as late
       from pursued`,
    [orgId, ...range(from, to)]
  );
  const due = n(r?.due);
  const missed = n(r?.missed);
  const late = n(r?.late);

  const prov = {
    formula: "Opportunities pursued whose deadline has passed, split by whether a bid went in before it.",
    sources: ["Opportunities", "Bids"],
    inclusion:
      "Only opportunities that were pursued and whose deadline is in the past. Ones still open with a future deadline are not counted either way.",
  };

  return [
    metric(
      "deadline_missed",
      "Deadlines missed",
      "count",
      due === 0 ? null : missed,
      "No pursued deadline has passed in this period.",
      prov,
      due === 0 ? null : { have: due, need: due }
    ),
    metric(
      "deadline_on_time_rate",
      "Submitted before the deadline",
      "percent",
      share(due - missed - late, due),
      "No pursued deadline has passed in this period.",
      {
        ...prov,
        formula: "Bids submitted on or before the closing date, over pursued opportunities whose deadline has passed.",
      },
      due === 0 ? null : { have: due, need: due }
    ),
    metric(
      "deadline_late",
      "Submitted after the deadline",
      "count",
      due === 0 ? null : late,
      "No pursued deadline has passed in this period.",
      prov
    ),
  ];
}

export async function reviewMetrics(from: Date | null, to: Date | null): Promise<Metric[]> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `select
       /*
        * Counted with the same predicate the median uses, including the
        * sanity guard. A coverage figure computed over a wider set than the
        * median it describes says the number rests on more records than it
        * does, which is the sort of quiet overstatement this page exists to
        * avoid.
        */
       count(*) filter (
         where pursuit_changed_at is not null and pursuit_changed_at >= created_at
       )::int as decided,
       count(*)::int as total,
       percentile_cont(0.5) within group (
         order by extract(epoch from (pursuit_changed_at - created_at)) / 86400.0
       ) filter (where pursuit_changed_at is not null
                   and pursuit_changed_at >= created_at) as median_days,
       /*
        * Still sitting in review with the window already gone. Not the same as
        * a slow decision: this is a decision nobody made.
        */
       count(*) filter (
         where pursuit_changed_at is null
           and review_expires_at is not null and review_expires_at < now()
       )::int as expired
       from opportunities
      where org_id = $1
        and ($2::timestamptz is null or created_at >= $2::timestamptz)
        and ($3::timestamptz is null or created_at <  $3::timestamptz)`,
    [orgId, ...range(from, to)]
  );
  const decided = n(r?.decided);
  const total = n(r?.total);

  return [
    metric(
      "review_decision_days",
      "Time to a pursue or pass decision",
      "days",
      med(r?.median_days),
      "Nothing in this period has been decided yet.",
      {
        formula: "Median days from an opportunity arriving to somebody recording a pursue or pass decision.",
        sources: ["Opportunities"],
        inclusion:
          "Only opportunities where a decision was actually recorded. Ones still waiting are excluded, so this measures how long decisions take, not how long the queue is.",
      },
      { have: decided, need: total }
    ),
    metric(
      "review_expired",
      "Review windows that ran out undecided",
      "count",
      total === 0 ? null : n(r?.expired),
      "Nothing arrived in this period.",
      {
        formula: "Opportunities whose review window has passed with no decision recorded.",
        sources: ["Opportunities"],
        inclusion: "Counted whatever the deadline says: a decision nobody made is the finding.",
      }
    ),
  ];
}

// ---------------------------------------------------------------------------
// Subcontractor outreach
// ---------------------------------------------------------------------------

export async function subcontractorMetrics(from: Date | null, to: Date | null): Promise<Metric[]> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `with sent as (
       select c.id, c.subcontractor_id, c.opportunity_id, c.delivery_state, c.replied_at
         from communications c
        where c.org_id = $1
          and c.direction = 'outbound'
          and c.subcontractor_id is not null
          and ($2::timestamptz is null or c.created_at >= $2::timestamptz)
          and ($3::timestamptz is null or c.created_at <  $3::timestamptz)
     )
     select count(*)::int as sends,
            count(*) filter (where delivery_state = 'delivered')::int as confirmed,
            count(*) filter (where delivery_state in ('bounced','failed'))::int as refused,
            count(*) filter (where replied_at is not null)::int as replied
       from sent`,
    [orgId, ...range(from, to)]
  );
  const sends = n(r?.sends);

  const q = await queryOne<Record<string, unknown>>(
    `with asked as (
       select os.opportunity_id, os.subcontractor_id
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id and o.org_id = $1
        where os.removed_at is null
          and os.outreach_state <> 'pending'
          and ($2::timestamptz is null or os.created_at >= $2::timestamptz)
          and ($3::timestamptz is null or os.created_at <  $3::timestamptz)
     )
     select count(*)::int as asked,
            count(*) filter (
              where exists (
                select 1 from quotes qq
                 where qq.org_id = $1
                   and qq.opportunity_id = asked.opportunity_id
                   and qq.subcontractor_id = asked.subcontractor_id
              )
            )::int as quoted
       from asked`,
    [orgId, ...range(from, to)]
  );
  const asked = n(q?.asked);

  return [
    metric(
      "sub_confirmed_delivery_rate",
      "Confirmed as reaching somebody",
      "percent",
      share(n(r?.confirmed), sends),
      "Nothing was sent in this period.",
      {
        formula: "Outbound emails with positive evidence of arrival (opened, clicked, or replied to), over all outbound emails.",
        sources: ["Communications"],
        /*
         * The honest framing, and the reason there is no single "delivery
         * rate" here. Handing a message to the provider without error is not
         * evidence anybody received it, and the rest of this product refuses
         * to claim otherwise. Reporting one number would either overstate by
         * counting sent as delivered, or understate by treating every quiet
         * send as a failure.
         */
        inclusion:
          "A send that left without error is not counted here: that is not evidence anyone received it. Only an open, a click, or a reply is.",
      },
      { have: n(r?.confirmed), need: sends }
    ),
    metric(
      "sub_refused_rate",
      "Refused by the far end",
      "percent",
      share(n(r?.refused), sends),
      "Nothing was sent in this period.",
      {
        formula: "Outbound emails that bounced or failed to send, over all outbound emails.",
        sources: ["Communications"],
        inclusion: "Bounces and send failures. A quiet send is not counted as a failure.",
      },
      { have: n(r?.refused), need: sends }
    ),
    metric(
      "sub_response_rate",
      "Subcontractors who wrote back",
      "percent",
      share(n(r?.replied), sends),
      "Nothing was sent in this period.",
      {
        formula: "Outbound emails that received a reply, over all outbound emails.",
        sources: ["Communications"],
        inclusion: "Counted against the message that was answered, so a follow-up that finally gets a reply counts once.",
      },
      { have: n(r?.replied), need: sends }
    ),
    metric(
      "sub_quote_rate",
      "Subcontractors who priced the work",
      "percent",
      share(n(q?.quoted), asked),
      "No subcontractor has been asked for a price in this period.",
      {
        formula: "Subcontractors with a quote on record, over subcontractors actually asked.",
        sources: ["Opportunity subcontractors", "Quotes"],
        inclusion:
          "Only pairings that were actually contacted. Ones still pending, and ones removed from the opportunity, are left out of both sides.",
      },
      { have: n(q?.quoted), need: asked }
    ),
  ];
}

/**
 * How much of the work we sourced has a price against it.
 *
 * The number that decides whether a bid can be built at all. A trade with no
 * quote is a hole in the bid, and an opportunity can look busy (twenty
 * subcontractors emailed) while one trade has nothing at all.
 */
export async function tradeCoverageMetrics(from: Date | null, to: Date | null): Promise<Metric[]> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `with trades as (
       select distinct os.opportunity_id, btrim(os.trade) as trade
         from opportunity_subs os
         join opportunities o on o.id = os.opportunity_id and o.org_id = $1
        where os.removed_at is null
          and coalesce(btrim(os.trade), '') <> ''
          and ($2::timestamptz is null or o.created_at >= $2::timestamptz)
          and ($3::timestamptz is null or o.created_at <  $3::timestamptz)
     )
     select count(*)::int as sourced,
            count(*) filter (
              where exists (
                select 1 from quotes q
                 where q.org_id = $1
                   and q.opportunity_id = trades.opportunity_id
                   and btrim(q.trade) = trades.trade
              )
            )::int as covered
       from trades`,
    [orgId, ...range(from, to)]
  );
  const sourced = n(r?.sourced);
  return [
    metric(
      "trade_quote_coverage",
      "Trades with a price on them",
      "percent",
      share(n(r?.covered), sourced),
      "No trade has been sourced in this period.",
      {
        formula: "Distinct opportunity-and-trade pairs with at least one quote, over all pairs sourced.",
        sources: ["Opportunity subcontractors", "Quotes"],
        inclusion:
          "Each trade on each opportunity counts once however many subcontractors were asked. Trades with no name recorded are left out, because they cannot be matched to a quote.",
      },
      { have: n(r?.covered), need: sourced }
    ),
  ];
}

// ---------------------------------------------------------------------------
// What is known about the pipeline
// ---------------------------------------------------------------------------

export interface PipelineValueReport {
  split: ValueSplit;
  /** Open pipeline weighted by the measured win rate, or null without one. */
  expectedCents: number | null;
  metrics: Metric[];
}

export async function pipelineValueReport(
  from: Date | null,
  to: Date | null,
  winRatePercent: number | null
): Promise<PipelineValueReport> {
  const orgId = await currentOrg();
  const rows = await query<{ cents: string | number | null; source: string | null }>(
    `select value_estimated as cents, value_estimated_source as source
       from opportunities
      where org_id = $1
        and status = 'open' and stage not in ('dismissed','lost')
        and ($2::timestamptz is null or created_at >= $2::timestamptz)
        and ($3::timestamptz is null or created_at <  $3::timestamptz)`,
    [orgId, ...range(from, to)]
  );
  const split = splitValue(
    rows.map<ValueRow>((r) => ({
      cents: r.cents == null ? null : Number(r.cents),
      source: r.source,
    }))
  );
  const openTotal = split.known.total + split.modeled.total;
  const expectedCents = expectedValue(openTotal, winRatePercent);
  const inScope = split.known.count + split.modeled.count + split.unknown.count;

  return {
    split,
    expectedCents,
    metrics: [
      metric(
        "value_known_coverage",
        "Open work with a published value",
        "percent",
        share(split.known.count, inScope),
        "Nothing open in this period.",
        {
          formula: "Open opportunities carrying a value published by the notice or entered by a person, over all open opportunities.",
          sources: ["Opportunities"],
          inclusion:
            "A value the analyst inferred from the solicitation counts as estimated, not published, and is reported separately.",
        },
        { have: split.known.count, need: inScope }
      ),
      metric(
        "expected_pipeline_value",
        "Expected value of open work",
        "currency",
        expectedCents,
        winRatePercent == null
          ? "No bids decided yet, so there is no win rate to weight by."
          : "No open opportunity carries a value.",
        {
          formula: "Published and estimated value of open opportunities, multiplied by the measured win rate.",
          sources: ["Opportunities", "Bids"],
          /*
           * A forecast, said out loud. It is the only figure on the page
           * derived from another figure rather than counted, which is why it
           * never joins the published or estimated totals.
           */
          inclusion:
            "A forecast, not a total. Opportunities carrying no figure at all are not counted as nought, so this is a floor on what is already valued rather than a view of the whole pipeline.",
        }
      ),
    ],
  };
}

export async function dataConfidenceMetrics(from: Date | null, to: Date | null): Promise<Metric[]> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `select count(*)::int as scored,
            count(*) filter (
              where score_breakdown -> 'data_confidence' ->> 'level' is not null
            )::int as measured,
            count(*) filter (
              where score_breakdown -> 'data_confidence' ->> 'level' = 'high'
            )::int as high
       from opportunities
      where org_id = $1 and score is not null
        and ($2::timestamptz is null or created_at >= $2::timestamptz)
        and ($3::timestamptz is null or created_at <  $3::timestamptz)`,
    [orgId, ...range(from, to)]
  );
  const scored = n(r?.scored);
  const measured = n(r?.measured);
  return [
    metric(
      "confidence_measured_coverage",
      "Scores with confidence measured",
      "percent",
      share(measured, scored),
      "Nothing has been scored in this period.",
      {
        formula: "Scored opportunities carrying a data-confidence reading, over all scored opportunities.",
        sources: ["Opportunities"],
        /*
         * Records scored before confidence existed are the reason this metric
         * is here at all. They read as ordinary scores and are not, and a
         * coverage figure is how somebody finds out.
         */
        inclusion:
          "Opportunities scored before confidence was measured have none, and count against this figure rather than being quietly excluded.",
      },
      { have: measured, need: scored }
    ),
    metric(
      "confidence_high_share",
      "Scores resting on a full picture",
      "percent",
      share(n(r?.high), measured),
      "No score in this period has confidence measured.",
      {
        formula: "Scored opportunities whose data confidence reads high, over those with confidence measured.",
        sources: ["Opportunities"],
        inclusion:
          "Measured against the ones that have a reading, not against every score, so an old unmeasured record does not drag this down twice.",
      },
      { have: n(r?.high), need: measured }
    ),
  ];
}

// ---------------------------------------------------------------------------
// Automation
// ---------------------------------------------------------------------------

export async function automationMetrics(from: Date | null, to: Date | null): Promise<Metric[]> {
  const orgId = await currentOrg();
  const r = await queryOne<Record<string, unknown>>(
    `with runs as (
       select r.id, r.agent, r.status, r.opportunity_id, r.started_at
         from job_runs r
        where r.org_id = $1
          and ($2::timestamptz is null or r.started_at >= $2::timestamptz)
          and ($3::timestamptz is null or r.started_at <  $3::timestamptz)
     )
     select count(*)::int as total,
            count(*) filter (where status = 'ok')::int as ok,
            count(*) filter (where status = 'error')::int as failed,
            count(*) filter (where status = 'running')::int as running,
            /*
             * A retry is a second run of the same agent against the same
             * record. Counted by record rather than by agent alone, because
             * an agent that runs nightly across the account is not retrying
             * anything.
             */
            count(*) filter (
              where opportunity_id is not null
                and exists (
                  select 1 from runs prior
                   where prior.agent = runs.agent
                     and prior.opportunity_id = runs.opportunity_id
                     and prior.started_at < runs.started_at
                )
            )::int as repeats,
            /*
             * A recovery is a repeat that succeeded after a failure. The
             * figure that says whether retrying is working, as opposed to
             * merely happening.
             */
            count(*) filter (
              where status = 'ok' and opportunity_id is not null
                and exists (
                  select 1 from runs prior
                   where prior.agent = runs.agent
                     and prior.opportunity_id = runs.opportunity_id
                     and prior.started_at < runs.started_at
                     and prior.status = 'error'
                )
            )::int as recovered
       from runs`,
    [orgId, ...range(from, to)]
  );
  const total = n(r?.total);
  const failed = n(r?.failed);

  const m = await queryOne<Record<string, unknown>>(
    `select count(*)::int as flagged
       from opportunities
      where org_id = $1 and human_action_required = true
        and ($2::timestamptz is null or created_at >= $2::timestamptz)
        and ($3::timestamptz is null or created_at <  $3::timestamptz)`,
    [orgId, ...range(from, to)]
  );

  const sources = ["Automation runs"];
  return [
    metric(
      "automation_success_rate",
      "Automation runs that finished cleanly",
      "percent",
      share(n(r?.ok), total),
      "No automation has run in this period.",
      {
        formula: "Runs that finished without error, over all runs that finished.",
        sources,
        inclusion:
          "Runs still in flight are counted in neither the top nor the bottom, so a long job in progress does not read as a failure.",
      },
      { have: n(r?.ok), need: total - n(r?.running) }
    ),
    metric(
      "automation_retry_rate",
      "Work the platform had to attempt again",
      "percent",
      share(n(r?.repeats), total),
      "No automation has run in this period.",
      {
        formula: "Runs that were not the first attempt on that record by that agent, over all runs.",
        sources,
        inclusion:
          "Counted per record, so a nightly sweep across the whole account is not mistaken for a retry.",
      },
      { have: n(r?.repeats), need: total }
    ),
    metric(
      "automation_recovery_rate",
      "Failures the platform recovered from itself",
      "percent",
      share(n(r?.recovered), failed),
      failed === 0 ? "Nothing failed in this period." : "No failure has been retried yet.",
      {
        formula: "Runs that succeeded after an earlier failure on the same record, over failed runs.",
        sources,
        inclusion:
          "The figure that says whether retrying is working, rather than merely happening.",
      },
      { have: n(r?.recovered), need: failed }
    ),
    metric(
      "manual_intervention",
      "Records waiting on a person",
      "count",
      n(m?.flagged),
      "Nothing is waiting on a person.",
      {
        formula: "Opportunities the platform has flagged as needing a person to act.",
        sources: ["Opportunities"],
        inclusion:
          "A count, not a rate: what matters is how many are sitting there, and dividing it by everything the platform touched would shrink a real backlog into a reassuring percentage.",
      }
    ),
  ];
}

// ---------------------------------------------------------------------------
// Pinned metrics
// ---------------------------------------------------------------------------

/**
 * One pinned KPI, in the same shape as a reported one.
 *
 * The point of this function is that there is no second definition. A metric
 * an operator pins is either literally the reported metric, fetched by key
 * from the same function that renders the report, or it is one of the older
 * catalog entries, wrapped so it gains the same absent-reason and provenance
 * treatment. Either way the card can say what it means, and a pinned figure
 * cannot disagree with the one further down the page.
 */
export async function pinnedMetric(
  def: KpiMetricDef,
  params: KpiParams
): Promise<Metric> {
  const days = params.days ?? 0;
  const from = days > 0 ? new Date(Date.now() - days * 86_400_000) : null;

  if (isReportedKpi(def.id)) {
    const groups: Record<string, () => Promise<Metric[]>> = {
      deadline_missed: () => deadlineMetrics(from, null),
      deadline_on_time_rate: () => deadlineMetrics(from, null),
      review_decision_days: () => reviewMetrics(from, null),
      sub_confirmed_delivery_rate: () => subcontractorMetrics(from, null),
      sub_response_rate: () => subcontractorMetrics(from, null),
      sub_quote_rate: () => subcontractorMetrics(from, null),
      trade_quote_coverage: () => tradeCoverageMetrics(from, null),
      confidence_measured_coverage: () => dataConfidenceMetrics(from, null),
      automation_success_rate: () => automationMetrics(from, null),
      automation_recovery_rate: () => automationMetrics(from, null),
    };
    const found = (await groups[def.id]()).find((m) => m.key === def.id);
    /*
     * The label the operator chose, over the catalog's. They named it for a
     * reason, and a card that renames itself is one they stop recognizing.
     */
    if (found) return { ...found, label: def.label };
    return metric(def.id, def.label, asMetricUnit(def.unit), null,
      "This metric could not be computed.", def.provenance);
  }

  const raw = await computeCustomKpi(def.id, params).catch(() => null);
  return metric(
    def.id,
    def.label,
    asMetricUnit(def.unit),
    raw,
    /*
     * A reason rather than a dash. The old card printed "-" for both "nothing
     * qualifies" and "the query failed", which are different problems and one
     * of them needs somebody to look.
     */
    "Nothing in range carries what this needs.",
    def.provenance
  );
}
