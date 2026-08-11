import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignupForm } from "@/components/signup-form";
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
    redirect("/api/billing/checkout?plan=" + (searchParams?.plan || "standard"));
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="font-display text-xl text-foreground">
          BROST <span className="font-accent">CO</span>
        </Link>
        <h1 className="mt-6 font-display text-3xl text-foreground">
          Create your account
        </h1>
        <p className="mt-2 text-sm text-slate-600">
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
        <p className="mt-4 text-center text-xs text-slate-500">
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
    </div>
  );
}
