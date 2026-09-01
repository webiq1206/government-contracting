import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { Suspense } from "react";
import { CommandPalette } from "@/components/command-palette";
import { GuideWizard } from "@/components/guide-wizard";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ToastProvider } from "@/components/toaster";
import { getAutomationState } from "@/lib/app-settings";
import { queueCounts } from "@/lib/data";
import { automationHealth } from "@/lib/automation-status";
import { inboxNeedsReplyCount } from "@/lib/conversations";
import { accessLevel, entitlementOf, trialDaysLeft } from "@/lib/billing/entitlements";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { TrialBanner } from "@/components/trial-banner";
import { PaymentFailedBanner } from "@/components/payment-failed-banner";
import { TrialExpiredModal } from "@/components/trial-expired-modal";
import { allQuotaStates } from "@/lib/billing/trial-limits";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");

  const access = accessLevel(entitlementOf(user));
  // No redirect on an expired trial: the paywall renders over the dashboard so
  // the customer sees what they built while deciding. Enforcement is not this
  // panel, it is the 402 that every mutating route returns independently.

  const [counts, health, automation, quotas, inboxWaiting] = await Promise.all([
    queueCounts().catch(() => ({ review: 0, callQueue: 0, today: 0 })),
    automationHealth().catch(() => null),
    getAutomationState().catch(() => ({ paused: false, changed_at: null, changed_by: null })),
    // Only a trial has meters to show; a paid org pays for none of this work.
    access === "trial" ? allQuotaStates(user.organizationId).catch(() => []) : [],
    /*
     * Zero on failure rather than a badge that lies upward. An inbox badge
     * that over-counts sends somebody to a page with nothing on it; one that
     * under-counts costs them the trip they were going to make anyway.
     */
    inboxNeedsReplyCount().catch(() => 0),
  ]);
  return (
    <ToastProvider>
      {/* fixed inset-0: pin the shell to the visual viewport so the document
          cannot rubber-band past the mobile tab bar. Pages scroll inside main. */}
      <div
        data-app-shell
        className="fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background lg:flex-row"
      >
        <Nav
          email={user.email}
          reviewCount={counts.review}
          callCount={counts.callQueue}
          automationState={health?.state}
          automationHeadline={health?.headline}
          automationDetail={health?.detail}
          automationPaused={automation.paused}
          isPlatformAdmin={!user.impersonatedBy && isPlatformAdmin(user.email)}
        />
        <main className="page-main min-h-0 min-w-0 flex-1 bg-background text-foreground">
          {user.impersonatedBy && (
            <ImpersonationBanner
              adminEmail={user.impersonatedBy}
              viewingEmail={user.email}
            />
          )}
          {access === "trial" && (
            <TrialBanner daysLeft={trialDaysLeft(entitlementOf(user))} quotas={quotas} />
          )}
          {user.subscriptionStatus === "past_due" && <PaymentFailedBanner />}
          {children}
        </main>
      </div>
      {access === "none" && <TrialExpiredModal />}
      <CommandPalette />
      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
      <MobileTabBar
        reviewCount={counts.review}
        callCount={counts.callQueue}
        todayCount={counts.today}
        inboxCount={inboxWaiting}
      />
    </ToastProvider>
  );
}
