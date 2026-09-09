import { MenuIsolationProvider, ShellMain } from "@/components/menu-isolation";
import { DashboardNav, DashboardNotices, DashboardTabs } from "@/components/dashboard-shell";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { StreamedNavigation } from "@/components/streamed-navigation";
import { Suspense } from "react";
import { CommandPalette } from "@/components/command-palette";
import { GuideWizard } from "@/components/guide-wizard";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ToastProvider } from "@/components/toaster";
import { accessLevel, entitlementOf } from "@/lib/billing/entitlements";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PaymentFailedBanner } from "@/components/payment-failed-banner";
import { TrialExpiredModal } from "@/components/trial-expired-modal";
import { SessionLoadFailure } from "@/components/session-load-failure";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const auth = await currentUser().then(
    (user) => ({ ok: true as const, user }),
    (error) => {
      console.error("[dashboard] session or organization could not be loaded:", error);
      return { ok: false as const, user: null };
    }
  );
  if (!auth.ok) return <SessionLoadFailure />;
  // Only a successful null means this browser is signed out.
  const user = auth.user;
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");

  const access = accessLevel(entitlementOf(user));
  // No redirect on an expired trial: the paywall renders over the dashboard so
  // the customer sees what they built while deciding. Enforcement is not this
  // panel, it is the 402 that every mutating route returns independently.

  return (
    <ToastProvider><MenuIsolationProvider>
      {/* fixed inset-0: pin the shell to the visual viewport so the document
          cannot rubber-band past the mobile tab bar. Pages scroll inside main. */}
      <div
        data-app-shell
        className="fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background lg:flex-row"
      >
        <StreamedNavigation key={user.organizationId} initial={{ email: user.email, reviewCount: 0, callCount: 0,
          automationHeadline: "Checking automation", automationDetail: "Live status is still loading. You can use the navigation now.",
          isPlatformAdmin: !user.impersonatedBy && isPlatformAdmin(user.email) }}>
          <Suspense fallback={null}><DashboardNav user={user} /></Suspense>
        </StreamedNavigation>
        <ShellMain className="page-main min-h-0 min-w-0 flex-1 bg-background text-foreground">
          {user.impersonatedBy && (
            <ImpersonationBanner
              adminEmail={user.impersonatedBy}
              viewingEmail={user.email}
            />
          )}
          {user.subscriptionStatus === "past_due" && <PaymentFailedBanner />}
          <Suspense fallback={null}><DashboardNotices user={user} /></Suspense>
          {children}
        </ShellMain>
      </div>
      {access === "none" && <TrialExpiredModal />}
      <CommandPalette storageScope={user.organizationId} />
      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
      <Suspense fallback={<MobileTabBar reviewCount={0} callCount={0} />}>
        <DashboardTabs user={user} />
      </Suspense>
    </MenuIsolationProvider></ToastProvider>
  );
}
