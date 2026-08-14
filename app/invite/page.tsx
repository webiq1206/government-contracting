import type { Metadata } from "next";
import Link from "next/link";
import { InvitationAcceptForm } from "@/components/invitation-accept-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { invitationForToken } from "@/lib/admin/invitations";
import { PLANS } from "@/lib/billing/catalog";
import { shortDate } from "@/lib/format";

export const metadata: Metadata = {
  title: "Your invitation | Brost Co",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Accepting an invitation.
 *
 * The terms are stated above the form, in the words the customer would use,
 * before they type anything. Somebody agreeing to a price should be able to
 * read what it is on the same screen they agree to it, not discover it on an
 * invoice a month later.
 */
export default async function InvitePage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  const token = searchParams?.token ?? "";
  const offer = token ? await invitationForToken(token) : null;

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="absolute right-4 top-4">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="eyebrow mb-3">Autonomous Procurement Execution</p>
          <h1 className="flex justify-center">
            <Link href="/">
              <ThemeWordmark className="h-12" />
            </Link>
          </h1>
          <div className="mx-auto mt-4 h-px w-12 bg-accent" />
        </div>

        {!offer ? (
          <div className="card space-y-3">
            <h2 className="font-display text-2xl text-foreground">
              This invitation cannot be used
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The link is invalid, has expired, has already been used, or was
              withdrawn. If you were expecting to join, ask whoever invited you
              to send a new one.
            </p>
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-accent hover:underline">
                Log in
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <h2 className="font-display text-2xl text-foreground">
              {offer.invitedBy} invited you to Brost Co
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Brost Co finds federal contracting opportunities that fit your
              company, scores them, and runs the subcontractor outreach for the
              ones worth bidding.
            </p>

            <div className="card mt-6 space-y-2 border-accent/40 bg-accent/5">
              <p className="eyebrow">Your terms</p>
              <p className="text-sm font-semibold text-foreground">{offer.terms}</p>
              <p className="text-sm text-muted-foreground">
                {PLANS[offer.planKey]?.name ?? "Standard"} plan, billed{" "}
                {offer.interval === "year" ? "annually" : "monthly"}. Nothing is
                charged while you set up your account.
              </p>
              {offer.note && (
                <p className="text-sm leading-relaxed text-muted-foreground">{offer.note}</p>
              )}
              <p className="text-xs text-muted-foreground">
                This invitation is good until {shortDate(offer.expiresAt)}.
              </p>
            </div>

            <div className="card mt-4">
              <InvitationAcceptForm token={token} email={offer.email} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
