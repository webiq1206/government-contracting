import { requestCache as cache } from "@/lib/request-cache";
import type { SessionUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { getAutomationState } from "@/lib/app-settings";
import { queueCounts } from "@/lib/data";
import { automationHealth } from "@/lib/automation-status";
import { inboxNeedsReplyCount } from "@/lib/conversations";
import { accessLevel, entitlementOf, trialDaysLeft } from "@/lib/billing/entitlements";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { TrialBanner } from "@/components/trial-banner";
import { allQuotaStates } from "@/lib/billing/trial-limits";
import { ShellDataWarning } from "@/components/shell-data-warning";

// Request-local sharing: these three independently streamed regions must not
// repeat the same queries. Nothing here gates page content or authentication.
const loadShellData = cache(async (user: SessionUser) => {
  const access = accessLevel(entitlementOf(user));
  const shellWarnings: string[] = [];
  const [counts, health, automation, quotas, inboxWaiting] = await Promise.all([
    queueCounts().catch(() => {
      shellWarnings.push("Navigation task counts are unknown, not zero.");
      return { review: 0, callQueue: 0, today: 0 };
    }),
    automationHealth().catch(() => {
      shellWarnings.push("Automation health is unavailable.");
      return null;
    }),
    getAutomationState().catch(() => {
      shellWarnings.push("The account pause-switch state is unavailable.");
      return null;
    }),
    // Only a trial has meters to show; a paid org pays for none of this work.
    access === "trial" ? allQuotaStates(user.organizationId!).catch(() => {
      shellWarnings.push("Trial usage meters are unavailable.");
      return [];
    }) : [],
    /*
     * Zero on failure rather than a badge that lies upward. An inbox badge
     * that over-counts sends somebody to a page with nothing on it; one that
     * under-counts costs them the trip they were going to make anyway.
     */
    inboxNeedsReplyCount().catch(() => {
      shellWarnings.push("The inbox badge is unknown, not zero.");
      return 0;
    }),
  ]);
  return { counts, health, automation, quotas, inboxWaiting, shellWarnings };
});

export async function DashboardNav({ user }: { user: SessionUser }) {
  const { counts, health, automation } = await loadShellData(user);
  return <Nav email={user.email} reviewCount={counts.review} callCount={counts.callQueue}
    automationState={health?.state} automationHeadline={health?.headline ?? "Automation status unavailable"}
    automationDetail={health?.detail} automationPaused={automation?.paused}
    isPlatformAdmin={!user.impersonatedBy && isPlatformAdmin(user.email)} />;
}

export async function DashboardNotices({ user }: { user: SessionUser }) {
  const { quotas, shellWarnings } = await loadShellData(user);
  return <>
    {accessLevel(entitlementOf(user)) === "trial" &&
      <TrialBanner daysLeft={trialDaysLeft(entitlementOf(user))} quotas={quotas} />}
    <ShellDataWarning items={shellWarnings} />
  </>;
}

export async function DashboardTabs({ user }: { user: SessionUser }) {
  const { counts, inboxWaiting } = await loadShellData(user);
  return <MobileTabBar reviewCount={counts.review} callCount={counts.callQueue}
    todayCount={counts.today} inboxCount={inboxWaiting} />;
}
