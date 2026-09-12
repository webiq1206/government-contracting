import { can } from "@/lib/domain/roles";
import { requestCache as cache } from "@/lib/request-cache";
import type { SessionUser } from "@/lib/auth";
import { NavigationUpdate } from "@/components/streamed-navigation";
import { getAutomationState } from "@/lib/app-settings";
import { queueCounts } from "@/lib/data";
import { automationHealth } from "@/lib/automation-status";
import { accessLevel, entitlementOf, trialDaysLeft } from "@/lib/billing/entitlements";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { TrialBanner } from "@/components/trial-banner";
import { allQuotaStates } from "@/lib/billing/trial-limits";
import { ShellDataWarning } from "@/components/shell-data-warning";

// Request-local sharing: navigation and account notices read these facts once.
const loadShellData = cache(async (user: SessionUser) => {
  const access = accessLevel(entitlementOf(user));
  const shellWarnings: string[] = [];
  const [counts, health, automation, quotas] = await Promise.all([
    queueCounts().catch(() => {
      shellWarnings.push("Navigation task counts are unavailable.");
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
    access === "trial"
      ? allQuotaStates(user.organizationId!).catch(() => {
          shellWarnings.push("Trial usage meters are unavailable.");
          return [];
        })
      : [],
  ]);
  return { counts, health, automation, quotas, shellWarnings };
});

export async function DashboardNav({ user }: { user: SessionUser }) {
  const { counts, health, automation } = await loadShellData(user);
  return <NavigationUpdate data={{ email: user.email, reviewCount: counts.review, callCount: counts.callQueue,
    automationState: health?.state, automationHeadline: health?.headline ?? "Automation status unavailable",
    automationDetail: health?.detail, automationPaused: automation?.paused,
    canPauseAutomation: !user.impersonatedBy && can(user.orgRole, "pause_automation"),
    isPlatformAdmin: !user.impersonatedBy && isPlatformAdmin(user.email) }} />;
}

export async function DashboardNotices({ user }: { user: SessionUser }) {
  const { quotas, shellWarnings } = await loadShellData(user);
  return <>
    {accessLevel(entitlementOf(user)) === "trial" &&
      <TrialBanner daysLeft={trialDaysLeft(entitlementOf(user))} quotas={quotas} />}
    <ShellDataWarning items={shellWarnings} />
  </>;
}
