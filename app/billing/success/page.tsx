import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getOrganization, subscriptionAllowsAccess } from "@/lib/organizations";
import { trackEvent } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams?: { session_id?: string };
}) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");
  if (user.organizationId) {
    const org = await getOrganization(user.organizationId);
    if (org && subscriptionAllowsAccess(org.subscription_status)) {
      await trackEvent({
        event: "onboarding_started",
        orgId: org.id,
        userId: user.id,
        path: "/billing/success",
        meta: { session_id: searchParams?.session_id },
      });
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="card max-w-lg text-center">
        <p className="eyebrow text-pursue">Subscription active</p>
        <h1 className="mt-2 font-display text-3xl text-foreground">
          Welcome to Brost Co
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your account is ready. Next, finish company setup so Brost Co can find
          matching opportunities and build your Today queue.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/settings/profile" className="btn-primary">
            Complete company profile
          </Link>
          <Link href="/today" className="btn-ghost">
            Go to Today
          </Link>
        </div>
      </div>
    </main>
  );
}
