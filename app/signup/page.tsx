import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignupForm } from "@/components/signup-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { subscriptionAllowsAccess } from "@/lib/organizations";
import { trackEvent } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start your Brost Co subscription",
  description:
    "Create your Brost Co account and subscribe to government contracting software for opportunity scoring, subcontractor sourcing, and bid preparation.",
  alternates: { canonical: "/signup" },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams?: { plan?: string };
}) {
  const user = await currentUser().catch(() => null);
  if (user && subscriptionAllowsAccess(user.subscriptionStatus)) {
    redirect("/today");
  }
  if (user && !subscriptionAllowsAccess(user.subscriptionStatus)) {
    redirect("/settings/billing");
  }

  const promo = await getFoundingPromo({ startIfMissing: true });
  const requested = searchParams?.plan === "founding" ? "founding" : "standard";
  const plan =
    requested === "founding" && promo.active ? "founding" : "standard";
  await trackEvent({
    event: "signup_started",
    path: "/signup",
    meta: { plan },
  });

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

        <h2 className="font-display text-2xl text-foreground">Create your account</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {plan === "founding" ? (
            <>
              Founding rate:{" "}
              <span className="num font-semibold text-foreground">
                ${FOUNDING_MONTHLY_USD.toLocaleString()}/month
              </span>
              , locked in while you stay subscribed. Standard is $
              {STANDARD_MONTHLY_USD.toLocaleString()}/month after the offer ends.
            </>
          ) : (
            <>
              Standard subscription:{" "}
              <span className="num font-semibold text-foreground">
                ${STANDARD_MONTHLY_USD.toLocaleString()}/month
              </span>
              .
            </>
          )}
        </p>
        <div className="card mt-6">
          <SignupForm initialPlan={plan} promoActive={promo.active} />
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          By continuing you agree to the{" "}
          <Link href="/terms" className="text-accent hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-accent hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
