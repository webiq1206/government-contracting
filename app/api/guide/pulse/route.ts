import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
import { WORKABLE_CALL_CARD_SQL } from "@/lib/data";
import { tryResolveTenantOrgId } from "@/lib/tenant";
import { getActiveProfile } from "@/lib/ai/companyProfile";
import { hydrateIntegrationEnv } from "@/lib/integration-settings";
import { integrationStatus } from "@/lib/config";
import { computeSetupChecklist } from "@/lib/domain/setup";
import { opportunityIdFromPath, pageKeyFromPath } from "@/lib/domain/page-guide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cheap Guide Me badge + fingerprint. Avoids full actionCenter + opportunity
 * detail so the FAB can stay fresh without a heavy load on every route change.
 *
 * Every count is scoped to the caller's organization. Unscoped, the badge on
 * the Guide button was a live readout of how much work the whole platform had
 * outstanding, and the per-opportunity lookup answered for any UUID at all,
 * which told a prober whether another tenant's record exists and what stage it
 * is in.
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const pathname = new URL(req.url).searchParams.get("path") || "/today";
  const pageKey = pageKeyFromPath(pathname);

  await hydrateIntegrationEnv().catch(() => undefined);

  const orgId = await tryResolveTenantOrgId();

  const [pulse, profile, oppHint] = await Promise.all([
    orgId
      ? queryOne<Record<string, unknown>>(
          `select
             (select count(*) from opportunities
               where org_id = $1 and status='open' and human_action_required=true)::int as needs_you,
             -- Counted as the Call Queue counts it, so the badge cannot
             -- advertise calls that page will not list.
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
               where org_id = $1 and approval_status='pending')::int as backlinks,
             (select coalesce(max(extract(epoch from updated_at))::bigint, 0)
                from opportunities where org_id = $1) as opp_stamp`,
          [orgId]
        ).catch(() => null)
      : Promise.resolve(null),
    getActiveProfile().catch(() => null),
    (async () => {
      const id = opportunityIdFromPath(pathname);
      if (!id || !orgId) return null;
      return queryOne<{ human_action_required: boolean; stage: string }>(
        `select human_action_required, stage from opportunities
          where id=$1 and org_id=$2`,
        [id, orgId]
      ).catch(() => null);
    })(),
  ]);

  const integrations = integrationStatus();
  const setup = computeSetupChecklist({
    profile: profile?.profile_json ?? null,
    integrations,
  });
  const setupLeft = setup.complete ? 0 : setup.total - setup.done;

  const needsYou = Number(pulse?.needs_you ?? 0);
  const calls = Number(pulse?.calls ?? 0);
  const compliance = Number(pulse?.compliance ?? 0);
  const weights = Number(pulse?.weights ?? 0);
  const backlinks = Number(pulse?.backlinks ?? 0);
  const globalBadge = setupLeft + needsYou + calls + compliance + weights + backlinks;

  let badgeCount = globalBadge;
  if (pageKey === "opportunity" && oppHint) {
    badgeCount = Math.max(
      oppHint.human_action_required ? 1 : 0,
      setupLeft > 0 ? setupLeft : 0
    );
    // Still show a soft global hint via at least setup / local action.
    if (badgeCount === 0 && globalBadge > 0) badgeCount = 0;
  } else if (pageKey === "call-queue") {
    badgeCount = Math.max(calls, setupLeft);
  } else if (pageKey === "compliance") {
    badgeCount = Math.max(compliance, setupLeft);
  } else if (pageKey === "review") {
    badgeCount = Math.max(needsYou, setupLeft);
  }

  return NextResponse.json({
    fingerprint: JSON.stringify(pulse ?? {}),
    badgeCount,
    setupLeft,
    idle: badgeCount === 0,
  });
}
