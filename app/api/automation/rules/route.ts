import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { query, queryOne } from "@/lib/db";
import { getAutomationRules, setAutomationRules } from "@/lib/app-settings";
import { normalizeRules, type AutomationRules } from "@/lib/domain/intake";
import { logAgent } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live counts of what each rule would touch RIGHT NOW, shown next to the
 * settings form so the operator can preview a change before saving it.
 */
async function previewCounts(rules: AutomationRules) {
  const [pastDue, belowLead, pastRetention] = await Promise.all([
    queryOne<{ n: number }>(
      `select count(*)::int as n from opportunities
        where status='open' and stage not in ('submitted','won','lost')
          and deadline is not null and deadline < now()`
    ),
    rules.min_lead_days > 0
      ? queryOne<{ n: number }>(
          `select count(*)::int as n from opportunities
            where status='open' and stage in ('monitoring','scoring')
              and deadline is not null
              and deadline < now() + make_interval(days => $1)`,
          [rules.min_lead_days]
        )
      : Promise.resolve({ n: 0 }),
    rules.retention_days > 0
      ? queryOne<{ n: number }>(
          // Mirror the retentionSweep predicate exactly so the preview count
          // matches what the sweep will actually delete.
          // Uses deadline (falls back to updated_at) and includes the quotes guard.
          `select count(*)::int as n from opportunities o
            where o.status='archived'
              and coalesce(o.deadline, o.updated_at::date)::timestamptz
                  < now() - make_interval(days => $1)
              and not exists (select 1 from bids      b where b.opportunity_id = o.id)
              and not exists (select 1 from contracts c where c.opportunity_id = o.id)
              and not exists (select 1 from quotes    q where q.opportunity_id = o.id)`,
          [rules.retention_days]
        )
      : Promise.resolve({ n: 0 }),
  ]);
  return {
    past_due_open: pastDue?.n ?? 0,
    below_lead_time: belowLead?.n ?? 0,
    past_retention: pastRetention?.n ?? 0,
  };
}

/** Read the rules + a live preview of what they would affect. */
export async function GET() {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const rules = await getAutomationRules();
  return NextResponse.json({ rules, preview: await previewCounts(rules) });
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
  if (body.preview_only) {
    return NextResponse.json({ rules: normalized, preview: await previewCounts(normalized) });
  }
  const saved = await setAutomationRules(normalized, auth.email);
  await logAgent({
    agent: "operator",
    action: "automation-rules-updated",
    level: "info",
    message: `Automation rules updated by ${auth.email}: min lead ${saved.min_lead_days}d (${saved.lead_action}), deadline badges at ${saved.approaching_days}d/${saved.urgent_days}d, retention ${saved.retention_days === 0 ? "keep forever" : `${saved.retention_days}d`}.`,
  });
  return NextResponse.json({ rules: saved, preview: await previewCounts(saved) });
}
