import type { Metadata } from "next";
import { after } from "next/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { SignupForm } from "@/components/signup-form";
import { AuthSplit } from "@/components/auth-split";
import { loadPublicPromo } from "@/lib/billing/public-promo";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { TRIAL_DAYS } from "@/lib/billing/catalog";
import { entitlementOf, hasAccess } from "@/lib/billing/entitlements";
import { trackEvent } from "@/lib/analytics";
import { SessionLoadFailure } from "@/components/session-load-failure";
import { TrialAllowances } from "@/components/marketing/trial-allowances";
import { MarketingAnalytics } from "@/components/marketing/marketing-analytics";
import { publicMetadata } from "@/lib/marketing/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicMetadata(
  "Start your free 7-day trial",
  "Create a BrostCo account and start a free 7-day trial with no credit card: AI opportunity analysis, subcontractor coordination, and bid preparation.",
  "/signup",
);

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
      event: "signup_page_view",
      path: "/signup",
      meta: { plan },
    }),
  );

  return (
    <AuthSplit
      kicker="Government contracting"
      headline={
        <>
          Begin with one
          <br />
          real pursuit.
        </>
      }
      support="Create your company profile, then review an opportunity."
      footer={`${TRIAL_DAYS} days free. No card to begin.`}
    >
      <MarketingAnalytics />
      <p className="auth-kicker">Your BrostCo workspace</p>
      <h1 className="auth-title">Create your account</h1>
      <p className="auth-lede">
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
      <div className="auth-note">
        <p>
          <strong>Your first goal:</strong> create your company profile, connect
          the services you need, and review one opportunity.
        </p>
        <p className="mt-2">
          Supported trial services have usage limits. Paid service usage is
          separate from the subscription.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4">
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
      <div className="auth-form">
        <SignupForm initialPlan={plan} promoActive={promo.active} />
      </div>
      <div className="auth-allowances">
        <TrialAllowances />
      </div>
      <p className="auth-legal">
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
    </AuthSplit>
  );
}
