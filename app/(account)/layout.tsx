import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { Suspense } from "react";
import { ToastProvider } from "@/components/toaster";
import { GuideWizard } from "@/components/guide-wizard";
import { Wordmark } from "@/components/wordmark";
import { subscriptionAllowsAccess } from "@/lib/organizations";

/**
 * Authenticated but not necessarily subscribed. Used for Billing so checkout
 * failures cannot loop through the dash subscription gate.
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
        <header className="flex shrink-0 items-center justify-between border-b border-border bg-background px-5 py-3">
          <Link
            href={subscribed ? "/today" : "/"}
            className="inline-flex items-center"
            aria-label="Brost Co"
          >
            <Wordmark variant="dark" className="h-6" />
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">{user.email}</span>
            {subscribed ? (
              <Link href="/today" className="btn-ghost">
                Back to Today
              </Link>
            ) : (
              <Link href="/api/billing/checkout?plan=standard" className="btn-primary">
                Complete checkout
              </Link>
            )}
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
      <Suspense fallback={null}>
        <GuideWizard />
      </Suspense>
    </ToastProvider>
  );
}
