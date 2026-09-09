import { can } from "@/lib/domain/roles";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Suspense } from "react";
import { ToastProvider } from "@/components/toaster";
import { GuideWizard } from "@/components/guide-wizard";
import { Wordmark } from "@/components/wordmark";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { Nav } from "@/components/nav";
import { CommandPalette } from "@/components/command-palette";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { TrialBanner } from "@/components/trial-banner";
import { PaymentFailedBanner } from "@/components/payment-failed-banner";
import { entitlementOf, hasAccess, accessLevel, trialDaysLeft } from "@/lib/billing/entitlements";
import { getAutomationState } from "@/lib/app-settings";
import { queueCounts } from "@/lib/data";
import { automationHealth } from "@/lib/automation-status";
import { inboxNeedsReplyCount } from "@/lib/conversations";
import { allQuotaStates } from "@/lib/billing/trial-limits";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { ShellDataWarning } from "@/components/shell-data-warning";
import { SessionLoadFailure } from "@/components/session-load-failure";

/**
 * Authenticated but not necessarily subscribed. Used for Billing so checkout
 * failures cannot loop through the dash subscription gate.
 *
 * Header behaviour:
 *  - Subscribed:   The same sidebar and tab bar as the rest of the product.
 *                  Billing, Notifications, and Your account used to drop it,
 *                  so a working account lost Today, search, and automation
 *                  health the moment they opened a Settings page.
 *  - Unsubscribed: Standard light checkout header with "Complete checkout" CTA.
 */
export const dynamic = "force-dynamic";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const auth = await currentUser().then(
    (user) => ({ ok: true as const, user }),
    (error) => {
      console.error("[account] session or organization could not be loaded:", error);
      return { ok: false as const, user: null };
    }
  );
  if (!auth.ok) return <SessionLoadFailure />;
  // Only a successful null means this browser is signed out.
  const user = auth.user;
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");

  // Comped and trialling accounts get the full in-app header here, not the
  // checkout header: they are not mid-purchase and telling them to "complete
  // checkout" would be wrong.
  const entitlement = entitlementOf(user);
  const subscribed = hasAccess(entitlement);
  const access = accessLevel(entitlement);

  if (!subscribed) {
    return (
      <ToastProvider>
        <div className="flex min-h-dvh flex-col bg-background text-foreground">
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-5 py-3">
            <Link href="/" className="inline-flex items-center" aria-label="Brost Co">
              <Wordmark variant="dark" className="h-6 w-auto" />
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-slate-500 sm:inline">{user.email}</span>
              <Link href="/api/billing/checkout?plan=standard" className="btn-primary">
                Complete checkout
              </Link>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {user.impersonatedBy && (
              <ImpersonationBanner
                adminEmail={user.impersonatedBy}
                viewingEmail={user.email}
              />
            )}
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <GuideWizard />
        </Suspense>
      </ToastProvider>
    );
  }

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
      return { paused: false, changed_at: null, changed_by: null };
    }),
    access === "trial" ? allQuotaStates(user.organizationId).catch(() => {
      shellWarnings.push("Trial usage meters are unavailable.");
      return [];
    }) : [],
    inboxNeedsReplyCount().catch(() => {
      shellWarnings.push("The inbox badge is unknown, not zero.");
      return 0;
    }),
  ]);

  return (
    <ToastProvider>
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
          canPauseAutomation={!user.impersonatedBy && can(user.orgRole, "pause_automation")}
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
            <TrialBanner daysLeft={trialDaysLeft(entitlement)} quotas={quotas} />
          )}
          {user.subscriptionStatus === "past_due" && <PaymentFailedBanner />}
          <ShellDataWarning items={shellWarnings} />
          {children}
        </main>
      </div>
      <CommandPalette storageScope={user.organizationId} />
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
