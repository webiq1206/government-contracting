import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { WORKABLE_CALL_CARD_SQL } from "@/lib/data";
import { getAutomationRules, setAutomationRules } from "@/lib/app-settings";
import { normalizeRules, type AutomationRules } from "@/lib/domain/intake";
import { CALL_STAGE } from "@/lib/domain/call-step";
import { clearCallWorkForOrg, type ClearCallWorkResult } from "@/lib/skip-call";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_PREVIEW = {
  past_due_open: 0,
  below_lead_time: 0,
  past_retention: 0,
  queued_calls: 0,
};

/**
 * Live counts of what each rule would touch RIGHT NOW, shown next to the
 * settings form so the operator can preview a change before saving it.
 *
 * Every count is scoped to the caller's own organization. These rules are
 * per-org and the sweeps that enforce them run per-org, so an unscoped count
 * was both a disclosure (one customer reading the size of everyone else's
 * pipeline) and simply the wrong number: the retention line claimed to say
 * what the sweep would delete while counting records the sweep would never
 * touch on this customer's window.
 */
async function previewCounts(rules: AutomationRules, orgId: string | null) {
  // No resolvable organization means there are no records to describe. Better
  // an honest zero than a platform-wide total attributed to this account.
  if (!orgId) return EMPTY_PREVIEW;

  const [pastDue, belowLead, pastRetention, queuedCalls] = await Promise.all([
    queryOne<{ n: number }>(
      `select count(*)::int as n from opportunities
        where org_id = $1
          and status='open' and stage not in ('submitted','won','lost')
          and deadline is not null and deadline < now()`,
      [orgId]
    ),
    rules.min_lead_days > 0
      ? queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities
            where org_id = $1
              and status='open' and stage in ('monitoring','scoring')
              and deadline is not null
              and deadline < now() + make_interval(days => $2)`,
          [orgId, rules.min_lead_days]
        )
      : Promise.resolve({ n: 0 }),
    rules.retention_days > 0
      ? queryOne<{ n: number }>(
          // Mirror the retentionSweep predicate exactly so the preview count
          // matches what the sweep will actually delete. The sweep runs one
          // organization at a time on that organization's own window, so the
          // org filter is part of the predicate being mirrored.
          // Uses deadline (falls back to updated_at) and includes the quotes guard.
          `select count(*)::int as n from opportunities o
            where o.org_id = $1
              and o.status='archived'
              and coalesce(o.deadline, o.updated_at::date)::timestamptz
                  < now() - make_interval(days => $2)
              and not exists (select 1 from bids      b where b.opportunity_id = o.id)
              and not exists (select 1 from contracts c where c.opportunity_id = o.id)
              and not exists (select 1 from quotes    q where q.opportunity_id = o.id)`,
          [orgId, rules.retention_days]
        )
      : Promise.resolve({ n: 0 }),
    // What turning calling off would clear right now: the queue as the Call
    // Queue page counts it, plus records parked on the call stage.
    queryOne<{ n: number }>(
      `select (
                select count(*) from call_cards cc
                  join opportunities o on o.id = cc.opportunity_id
                  join subcontractors s on s.id = cc.subcontractor_id
                 where o.org_id = $1 and ${WORKABLE_CALL_CARD_SQL}
              )
            + (
                select count(*) from opportunities
                 where org_id = $1 and status = 'open' and stage = $2
              ) as n`,
      [orgId, CALL_STAGE]
    ),
  ]);
  return {
    past_due_open: pastDue?.n ?? 0,
    below_lead_time: belowLead?.n ?? 0,
    past_retention: pastRetention?.n ?? 0,
    queued_calls: queuedCalls?.n ?? 0,
  };
}

/** Read the rules + a live preview of what they would affect. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const rules = await getAutomationRules();
  const orgId = await tryResolveTenantOrgId();
  return NextResponse.json({ rules, preview: await previewCounts(rules, orgId) });
}

/**
 * Save the rules. Accepts a partial body; values are normalized/clamped by the
 * domain module so a typo can't produce a nonsensical config. Optional
 * `preview_only: true` returns the would-be effect without saving.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const body = (await req.json().catch(() => ({}))) as Partial<AutomationRules> & {
    preview_only?: boolean;
  };
  const normalized = normalizeRules(body);
  const orgId = await tryResolveTenantOrgId();
  if (body.preview_only) {
    return NextResponse.json({
      rules: normalized,
      preview: await previewCounts(normalized, orgId),
    });
  }
  const before = await getAutomationRules();
  const saved = await setAutomationRules(normalized, auth.email);

  // Turning calling off has to clear the call work already on the books, or
  // the queue the setting exists to empty stays exactly as full as it was.
  let cleared: ClearCallWorkResult | null = null;
  if (before.calls_enabled && !saved.calls_enabled && orgId) {
    cleared = await clearCallWorkForOrg(orgId);
  }

  await logAgent({
    agent: "operator",
    action: "automation-rules-updated",
    level: "info",
    message: `Automation rules updated by ${auth.email}: min lead ${saved.min_lead_days}d (${saved.lead_action}), deadline badges at ${saved.approaching_days}d/${saved.urgent_days}d, retention ${saved.retention_days === 0 ? "keep forever" : `${saved.retention_days}d`}, calls ${saved.calls_enabled ? "on" : "off (email-only workflow)"}.`,
  });
  return NextResponse.json({
    rules: saved,
    preview: await previewCounts(saved, orgId),
    ...(cleared ? { cleared } : {}),
  });
}
