import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { query } from "@/lib/db";
export const dynamic = "force-dynamic";
/** Aggregated platform-only reporting. No identities or free-form entries. */
export async function GET(req: Request) {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) return auth;
  const value = new URL(req.url).searchParams.get("days");
  const days = value === null ? 28 : Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 90) return NextResponse.json({ error: "days must be an integer from 1 to 90" }, { status: 400 });
  try {
    const [interactions, cohorts] = await Promise.all([
      query(`select event, path, coalesce(meta->>'source', 'unattributed') as source,
        coalesce(meta->>'campaign', 'unattributed') as campaign, count(*)::int as events
        from analytics_events where created_at >= now() - ($1::int * interval '1 day')
        and event in ('marketing_page_view','cta_click','resource_download','tool_completed','signup_started','signup_error')
        group by event,path,meta->>'source',meta->>'campaign' order by events desc limit 500`, [days]),
      query(`with trials as (
        select distinct on (org_id) org_id, created_at, coalesce(meta->>'source', 'unattributed') as source,
        coalesce(meta->>'campaign', 'unattributed') as campaign
        from analytics_events where event='trial_started' and org_id is not null order by org_id, created_at
      ), cohort as (select * from trials where created_at >= now() - ($1::int * interval '1 day'))
      select source, campaign, count(*)::int as trials,
        count(*) filter (where exists (select 1 from analytics_events e where e.org_id=cohort.org_id and e.event='company_profile_saved' and e.created_at >= cohort.created_at))::int as profile_saved,
        count(*) filter (where exists (select 1 from analytics_events e where e.org_id=cohort.org_id and e.event='subscription_completed' and e.created_at >= cohort.created_at))::int as paid
      from cohort group by source,campaign order by trials desc`, [days]),
    ]);
    return NextResponse.json({ days, interactions, cohorts, definitions: { interactions: "Event counts, not unique visitors. Repeated actions and unfiltered bots may be included. Interaction breakdown is capped at 500 rows.", source: "Allowlisted campaign labels carried within a tab; unattributed does not mean direct.", profile_saved: "A company profile save after trial start; not proof of complete onboarding, first analysis or retained use.", paid: "A subscription_completed event for a trial organization, not revenue or active-subscription status." } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Growth reporting could not be loaded. No metrics have been inferred." }, { status: 503 });
  }
}
