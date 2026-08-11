import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Suspense } from "react";
import { ToastProvider } from "@/components/toaster";
import { GuideWizard } from "@/components/guide-wizard";
import { Wordmark } from "@/components/wordmark";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { subscriptionAllowsAccess } from "@/lib/organizations";

/**
 * Authenticated but not necessarily subscribed. Used for Billing so checkout
 * failures cannot loop through the dash subscription gate.
 *
 * Header behaviour:
 *  - Subscribed:   Compact dark ink bar (matches the dash mobile header)
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

  const subscribed = subscriptionAllowsAccess(user.subscriptionStatus);

  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        {subscribed ? (
          /* ── Subscribed header: matches the dash ink bar ── */
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-ink px-3">
            <Link
              href="/today"
              className="inline-flex shrink-0 items-center"
              style={{ height: "1.75rem" }}
              aria-label="Brost Co Today"
            >
              <Wordmark variant="light" className="h-full w-auto" />
            </Link>
            <div className="flex-1" />
            <Link
              href="/today"
              className="text-sm text-white/50 hover:text-white/90 transition-colors"
            >
              ← Today
            </Link>
          </header>
        ) : (
          /* ── Unsubscribed header: checkout CTA ── */
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

        <main className={`flex min-h-0 flex-1 flex-col ${subscribed ? "pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0" : ""}`}>
          {children}
        </main>
      </div>

      {/* Bottom nav bar for subscribed users so Today / Calls / Pipeline / Review
          are reachable directly from the billing page on mobile. */}
      {subscribed && <MobileTabBar reviewCount={0} callCount={0} />}

      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
    </ToastProvider>
  );
}
