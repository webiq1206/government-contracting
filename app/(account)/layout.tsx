import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Suspense } from "react";
import { ToastProvider } from "@/components/toaster";
import { GuideWizard } from "@/components/guide-wizard";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { Wordmark } from "@/components/wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { entitlementOf, hasAccess } from "@/lib/billing/entitlements";
import { ImpersonationBanner } from "@/components/impersonation-banner";

/**
 * Authenticated but not necessarily subscribed. Used for Billing so checkout
 * failures cannot loop through the dash subscription gate.
 *
 * Header behaviour:
 *  - Subscribed:   Compact bar matching the dash mobile header
 *                  + MobileTabBar so Today / Calls / Pipeline / Review are
 *                  reachable without going back to the dash layout.
 *  - Unsubscribed: Standard light checkout header with "Complete checkout" CTA.
 */
export const dynamic = "force-dynamic";

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");

  // Comped and trialling accounts get the full in-app header here, not the
  // checkout header: they are not mid-purchase and telling them to "complete
  // checkout" would be wrong.
  const subscribed = hasAccess(entitlementOf(user));

  return (
    <ToastProvider>
      <div
        {...(subscribed ? { "data-app-shell": true } : {})}
        className={
          subscribed
            ? "fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background text-foreground"
            : "flex min-h-dvh flex-col bg-background text-foreground"
        }
      >
        {subscribed ? (
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 bg-background px-3 dark:border-white/10">
            <Link
              href="/today"
              className="inline-flex min-h-11 min-w-0 max-w-[42%] items-center overflow-hidden"
              aria-label="Brost Co Today"
            >
              <ThemeWordmark className="h-6 w-auto max-w-full" />
            </Link>
            <div className="flex-1" />
            <ThemeToggle compact />
            <Link
              href="/today"
              className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Today
            </Link>
          </header>
        ) : (
          <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-5 py-3">
            <Link
              href="/"
              className="inline-flex items-center"
              aria-label="Brost Co"
            >
              <Wordmark variant="dark" className="h-6 w-auto" />
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-slate-500 sm:inline">{user.email}</span>
              <Link href="/api/billing/checkout?plan=standard" className="btn-primary">
                Complete checkout
              </Link>
            </div>
          </header>
        )}

        <main
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            subscribed ? "pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0" : ""
          }`}
        >
          {user.impersonatedBy && (
            <ImpersonationBanner
              adminEmail={user.impersonatedBy}
              viewingEmail={user.email}
            />
          )}
          {children}
        </main>
      </div>

      {subscribed && <MobileTabBar reviewCount={0} callCount={0} />}

      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
    </ToastProvider>
  );
}
