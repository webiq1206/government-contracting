import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { queryOne } from "@/lib/db";
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
 */
export async function GET(req: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const pathname = new URL(req.url).searchParams.get("path") || "/today";
  const pageKey = pageKeyFromPath(pathname);

  await hydrateIntegrationEnv().catch(() => undefined);

  const [pulse, profile, oppHint] = await Promise.all([
    queryOne<Record<string, unknown>>(
      `select
         (select count(*) from opportunities
           where status='open' and human_action_required=true)::int as needs_you,
         (select count(*) from call_cards
           where status='pending'
             and (snoozed_until is null or snoozed_until <= now()))::int as calls,
         (select count(*) from compliance_items
           where coalesce(status_override, status) in ('warning','critical','blocked'))::int as compliance,
         (select count(*) from scoring_weights
           where approved_at is null and proposed_by='learning-loop')::int as weights,
         (select count(*) from backlink_outreach where approval_status='pending')::int as backlinks,
         (select coalesce(max(extract(epoch from updated_at))::bigint, 0)
            from opportunities) as opp_stamp`
    ).catch(() => null),
    getActiveProfile().catch(() => null),
    (async () => {
      const id = opportunityIdFromPath(pathname);
      if (!id) return null;
      return queryOne<{ human_action_required: boolean; stage: string }>(
        `select human_action_required, stage from opportunities where id=$1`,
        [id]
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
