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

  const [counts, engine, automation, quotas] = await Promise.all([
    queueCounts().catch(() => ({ review: 0, callQueue: 0 })),
    engineStatus().catch(() => ({ lastRunAt: null, openCount: 0, heartbeatAt: null, phase: null })),
    getAutomationState().catch(() => ({ paused: false, changed_at: null, changed_by: null })),
    // Only a trial has meters to show; a paid org pays for none of this work.
    access === "trial" ? allQuotaStates(user.organizationId).catch(() => []) : [],
  ]);
  // "Is the machine OK?" answered in the sidebar, so nobody has to remember to
  // go check a log. The worker's own check-in answers it directly; the job log
  // only says when work last ran, which reads as "down" on a quiet stretch.
  // Falls back to the job log when there is no check-in to read (older
  // deployment, or the worker never got far enough to write one). Master pause
  // overrides the label.
  const beating =
    engine.heartbeatAt != null &&
    Date.now() - new Date(engine.heartbeatAt).getTime() < 5 * 60_000;
  const ranRecently =
    engine.lastRunAt != null &&
    Date.now() - new Date(engine.lastRunAt).getTime() < 2 * 3_600_000;
  const engineHealthy =
    !automation.paused && (engine.heartbeatAt != null ? beating && engine.phase === "ready" : ranRecently);
  const engineLabel = automation.paused
    ? "Everything paused · tap to resume"
    : beating && engine.phase === "queue-unreachable"
      ? "Trouble · reconnecting to the job queue"
      : beating && engine.phase !== "ready"
        ? `Starting up · ${engine.phase}`
      : engine.lastRunAt
        ? engineHealthy
          ? `Running normally · ${timeAgo(engine.lastRunAt)}`
          : `Not running · nothing since ${timeAgo(engine.lastRunAt)}`
        : engineHealthy
          ? "Running normally · no work due yet"
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
      <MobileTabBar reviewCount={counts.review} callCount={counts.callQueue} />
    </ToastProvider>
  );
}
