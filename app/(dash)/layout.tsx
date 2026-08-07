import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Nav } from "@/components/nav";
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
        <main className="min-w-0 flex-1 bg-surface">{children}</main>
      </div>
    </ToastProvider>
  );
}
