import { AppViewport } from "@/components/app-viewport";
import { MenuIsolationProvider, ShellMain } from "@/components/menu-isolation";
import { StreamedNavigation } from "@/components/streamed-navigation";
import { DashboardNav, DashboardNotices } from "@/components/dashboard-shell";
import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Suspense } from "react";
import { ToastProvider } from "@/components/toaster";
import { GuideWizard } from "@/components/guide-wizard";
import { Wordmark } from "@/components/wordmark";
import { CommandPalette } from "@/components/command-palette";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { PaymentFailedBanner } from "@/components/payment-failed-banner";
import { entitlementOf, hasAccess } from "@/lib/billing/entitlements";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { SessionLoadFailure } from "@/components/session-load-failure";

/** Authenticated but not necessarily subscribed. Billing must remain reachable after checkout failures. */
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
  const user = auth.user;
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");

  const entitlement = entitlementOf(user);
  const subscribed = hasAccess(entitlement);

  if (!subscribed) {
    return (
      <ToastProvider><MenuIsolationProvider>
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
          <main className="flex min-h-0 flex-1 flex-col">
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
      </MenuIsolationProvider></ToastProvider>
    );
  }

  return (
    <ToastProvider><MenuIsolationProvider>
      <AppViewport>
        <Suspense fallback={null}>
          <StreamedNavigation key={user.organizationId} initial={{ email: user.email, reviewCount: 0, callCount: 0,
            automationHeadline: "Checking automation", automationDetail: "Live status is still loading. You can use the navigation now.",
            isPlatformAdmin: !user.impersonatedBy && isPlatformAdmin(user.email) }}>
            <Suspense fallback={null}><DashboardNav user={user} /></Suspense>
          </StreamedNavigation>
        </Suspense>
        <ShellMain className="page-main min-w-0 flex-1 bg-background text-foreground">
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
      </AppViewport>
      <CommandPalette storageScope={user.organizationId} />
      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
    </MenuIsolationProvider></ToastProvider>
  );
}
