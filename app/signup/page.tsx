import type { Metadata } from "next";
import { after } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignupForm } from "@/components/signup-form";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { ThemeToggle } from "@/components/theme-toggle";
import { loadPublicPromo } from "@/lib/billing/public-promo";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { entitlementOf, hasAccess } from "@/lib/billing/entitlements";
import { trackEvent } from "@/lib/analytics";
import { SessionLoadFailure } from "@/components/session-load-failure";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Start your BrostCo free trial",
  description:
    "Start a no-card BrostCo trial for AI opportunity analysis, subcontractor coordination, and bid preparation.",
  alternates: { canonical: "/signup" },
};

export default async function SignupPage(props: {
  searchParams?: Promise<{ plan?: string }>;
}) {
  const searchParams = await props.searchParams;
  const auth = await currentUser().then(
    (user) => ({ ok: true as const, user }),
    (error) => {
      console.error("[signup] existing session could not be checked:", error);
      return { ok: false as const, user: null };
    },
  );
  if (!auth.ok) return <SessionLoadFailure />;
  const user = auth.user;
  if (user) {
    redirect(hasAccess(entitlementOf(user)) ? "/today" : "/settings/billing");
  }

  const promo = await loadPublicPromo(true);
  const requested = searchParams?.plan === "founding" ? "founding" : "standard";
  const plan =
    requested === "founding" && promo.active ? "founding" : "standard";
  after(() =>
    trackEvent({
      event: "signup_started",
      path: "/signup",
      meta: { plan },
    }),
  );

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="mb-4 flex w-full max-w-md justify-end">
        <ThemeToggle compact />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            A clearer way to pursue federal work
          </p>
          <h1 className="flex justify-center">
            <Link href="/">
              <ThemeWordmark className="h-12" />
            </Link>
          </h1>
        </div>

        <h2 className="font-display text-3xl text-foreground">
          Create your account
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {plan === "founding" ? (
            <>
              Founding rate:{" "}
              <span className="num font-semibold text-foreground">
                ${FOUNDING_MONTHLY_USD.toLocaleString()}/month
              </span>
              , locked in while you stay subscribed. Starts with a free 7-day
              trial, no card required; nothing is charged unless you choose a
              plan. Standard is ${STANDARD_MONTHLY_USD.toLocaleString()}/month
              after the offer ends.
            </>
          ) : (
            <>
              Standard subscription:{" "}
              <span className="num font-semibold text-foreground">
                ${STANDARD_MONTHLY_USD.toLocaleString()}/month
              </span>
              . Starts with a free 7-day trial, no card required; nothing is
              charged unless you choose a plan.
            </>
          )}
        </p>
        <div className="mt-4 rounded-lg border border-border bg-surface p-4 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Your first goal:</strong> create
            your company profile, connect the services you need, and review one
            opportunity.
          </p>
          <p className="mt-2">
            Supported trial services have usage limits. Paid service usage is
            separate from the subscription.
          </p>
          <div className="mt-2 flex flex-wrap gap-4">
            <Link
              href="/get-started"
              className="inline-flex min-h-11 items-center text-accent underline"
            >
              Setup checklist
            </Link>
            <Link
              href="/pricing-guide#usage"
              className="inline-flex min-h-11 items-center text-accent underline"
            >
              Usage costs
            </Link>
          </div>
        </div>
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
