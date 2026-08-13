import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { Suspense } from "react";
import { CommandPalette } from "@/components/command-palette";
import { GuideWizard } from "@/components/guide-wizard";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ToastProvider } from "@/components/toaster";
import { getAutomationState } from "@/lib/app-settings";
import { queueCounts, engineStatus } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { accessLevel, trialDaysLeft } from "@/lib/billing/entitlements";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { TrialBanner } from "@/components/trial-banner";
import { TrialExpiredModal } from "@/components/trial-expired-modal";
import { allQuotaStates } from "@/lib/billing/trial-limits";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");

  const access = accessLevel({
    subscription_status: user.subscriptionStatus,
    trial_ends_at: user.trialEndsAt,
  });
  // No redirect on an expired trial: the paywall renders over the dashboard so
  // the customer sees what they built while deciding. Enforcement is not this
  // panel, it is the 402 that every mutating route returns independently.

  const [counts, engine, automation, quotas] = await Promise.all([
    queueCounts().catch(() => ({ review: 0, callQueue: 0 })),
    engineStatus().catch(() => ({ lastRunAt: null, openCount: 0 })),
    getAutomationState().catch(() => ({ paused: false, changed_at: null, changed_by: null })),
    // Only a trial has meters to show; a paid org pays for none of this work.
    access === "trial" ? allQuotaStates(user.organizationId).catch(() => []) : [],
  ]);
  // "Is the machine OK?" answered in the sidebar, so nobody has to remember to
  // go check a log. Healthy = something ran within the last 2 hours (the
  // sweeps run every 10-20 minutes). Master pause overrides the label.
  const engineHealthy =
    !automation.paused &&
    engine.lastRunAt != null &&
    Date.now() - new Date(engine.lastRunAt).getTime() < 2 * 3_600_000;
  const engineLabel = automation.paused
    ? "Everything paused · tap to resume"
    : engine.lastRunAt
      ? engineHealthy
        ? `Running normally · ${timeAgo(engine.lastRunAt)}`
        : `Not running · nothing since ${timeAgo(engine.lastRunAt)}`
      : "Automation has not run yet";

  return (
    <ToastProvider>
      {/* fixed inset-0: pin the shell to the visual viewport so the document
          cannot rubber-band past the mobile tab bar. Pages scroll inside main. */}
      <div
        data-app-shell
        className="fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background md:flex-row"
      >
        <Nav
          email={user.email}
          reviewCount={counts.review}
          callCount={counts.callQueue}
          engineHealthy={engineHealthy}
          engineLabel={engineLabel}
          automationPaused={automation.paused}
          isPlatformAdmin={isPlatformAdmin(user.email)}
        />
        <main className="page-main min-h-0 min-w-0 flex-1 bg-background text-foreground">
          {access === "trial" && (
            <TrialBanner daysLeft={trialDaysLeft({ subscription_status: user.subscriptionStatus, trial_ends_at: user.trialEndsAt })} quotas={quotas} />
          )}
          {children}
        </main>
      </div>
      {access === "none" && <TrialExpiredModal />}
      <CommandPalette />
      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
      <MobileTabBar reviewCount={counts.review} callCount={counts.callQueue} />
    </ToastProvider>
  );
}
