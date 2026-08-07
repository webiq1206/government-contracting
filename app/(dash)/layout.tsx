import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
import { CommandPalette } from "@/components/command-palette";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ToastProvider } from "@/components/toaster";
import { queueCounts } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  if (!user) redirect("/login");

  const counts = await queueCounts().catch(() => ({ review: 0, callQueue: 0 }));

  return (
    <ToastProvider>
      <div className="flex min-h-screen flex-col md:flex-row">
        <Nav email={user.email} reviewCount={counts.review} callCount={counts.callQueue} />
        {/* pb-16 keeps content clear of the mobile bottom tab bar. */}
        <main className="min-w-0 flex-1 bg-surface pb-16 md:pb-0">{children}</main>
      </div>
      <CommandPalette />
      <MobileTabBar reviewCount={counts.review} callCount={counts.callQueue} />
    </ToastProvider>
  );
}
