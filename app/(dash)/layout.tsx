import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { CommandPalette } from "@/components/command-palette";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ToastProvider } from "@/components/toaster";
import { queueCounts, engineStatus } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { subscriptionAllowsAccess } from "@/lib/organizations";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");
  if (!user.organizationId) redirect("/signup");
  if (!subscriptionAllowsAccess(user.subscriptionStatus)) {
    redirect("/settings/billing");
  }

  const [counts, engine] = await Promise.all([
    queueCounts().catch(() => ({ review: 0, callQueue: 0 })),
    engineStatus().catch(() => ({ lastRunAt: null, openCount: 0 })),
  ]);
  // "Is the machine OK?" answered in the sidebar, so nobody has to remember to
  // go check a log. Healthy = something ran within the last 2 hours (the
  // sweeps run every 10-20 minutes).
  const engineHealthy =
    engine.lastRunAt != null &&
    Date.now() - new Date(engine.lastRunAt).getTime() < 2 * 3_600_000;
  const engineLabel = engine.lastRunAt
    ? engineHealthy
      ? `Running normally · ${timeAgo(engine.lastRunAt)}`
      : `Not running · nothing since ${timeAgo(engine.lastRunAt)}`
    : "Automation has not run yet";

  return (
    <ToastProvider>
      {/* h-dvh + overflow-hidden: pages fill the visible viewport (not 100vh
          under mobile browser chrome) and scroll inside main, clear of the
          fixed bottom tab bar. */}
      <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
        <Nav
          email={user.email}
          reviewCount={counts.review}
          callCount={counts.callQueue}
          engineHealthy={engineHealthy}
          engineLabel={engineLabel}
        />
        <main className="page-main min-h-0 min-w-0 flex-1 bg-surface">
          {children}
        </main>
      </div>
      <CommandPalette />
      <MobileTabBar reviewCount={counts.review} callCount={counts.callQueue} />
    </ToastProvider>
  );
}
