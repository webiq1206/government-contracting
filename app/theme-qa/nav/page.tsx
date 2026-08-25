import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Navigation lab",
  description: "Development-only check of the mobile nav drawer and sign-out.",
  robots: { index: false, follow: false },
};

/**
 * The nav, including the mobile drawer that holds sign-out.
 *
 * Sign-out lives at the bottom of a drawer that only exists behind auth, so
 * the control reported as missing is the one nobody can look at without
 * logging in. Open the hamburger at a phone width. Dev only: 404 in
 * production.
 */
export default function NavLab() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Nav
        email="brostcoholdings@example.test"
        reviewCount={3}
        callCount={2}
        automationState={"healthy" as const}
        automationHeadline={"Running normally"}
        automationDetail={"Automation is running and recent jobs have all succeeded."}
      />
      <main className="flex-1 p-6">
        <p className="eyebrow">Theme QA</p>
        <h1 className="font-display text-lg">Navigation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          At a phone width, open the menu to check the account block and Sign out.
        </p>
      </main>
    </div>
  );
}
